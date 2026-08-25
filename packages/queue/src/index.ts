import {
  type Job,
  type JobsOptions,
  Queue,
  type QueueOptions,
  type WorkerOptions,
  Worker,
} from 'bullmq';
import { Value } from '@sinclair/typebox/value';
import { Redis } from 'ioredis';

import {
  QueueNames,
  QueuePayloadSchemas,
  type QueueName,
  type QueuePayloadByName,
} from '@pagepulse/contracts';
import { createHash, randomUUID } from 'node:crypto';

export { QueueNames, type QueueName, type QueuePayloadByName } from '@pagepulse/contracts';

export const redisConnectionOptions = Object.freeze({
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});

const redisReadinessOptions = Object.freeze({
  ...redisConnectionOptions,
  connectTimeout: 1_000,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: () => null,
});

export type QueuePayloadValidationIssue = Readonly<{
  message: string;
  path: string;
}>;

export type QueueForName<Name extends QueueName> = Queue<
  QueuePayloadByName[Name],
  unknown,
  string,
  QueuePayloadByName[Name],
  unknown,
  string
>;

export class QueuePayloadValidationError extends Error {
  readonly issues: ReadonlyArray<QueuePayloadValidationIssue>;
  readonly queueName: QueueName;

  constructor(queueName: QueueName, issues: ReadonlyArray<QueuePayloadValidationIssue>) {
    super(
      `Invalid ${queueName} queue payload: ${issues
        .map((issue) => `${issue.path || 'payload'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'QueuePayloadValidationError';
    this.queueName = queueName;
    this.issues = issues;
  }
}

export function parseQueuePayload<Name extends QueueName>(
  queueName: Name,
  payload: unknown,
): QueuePayloadByName[Name] {
  const schema = QueuePayloadSchemas[queueName];
  if (Value.Check(schema, payload)) {
    return payload as QueuePayloadByName[Name];
  }

  const issues = Array.from(Value.Errors(schema, payload), (error) => ({
    message: error.message,
    path: error.path,
  })).slice(0, 5);
  throw new QueuePayloadValidationError(queueName, issues);
}

export function createRedisConnection(redisUrl: string) {
  return new Redis(redisUrl, redisConnectionOptions);
}

export async function probeRedis(redisUrl: string) {
  const connection = new Redis(redisUrl, redisReadinessOptions);
  try {
    await connection.connect();
    await connection.ping();
  } finally {
    connection.disconnect();
  }
}

export function createQueue<Name extends QueueName>(
  queueName: Name,
  connection: Redis,
  prefix: string,
  options: Omit<QueueOptions, 'connection' | 'prefix'> = {},
): QueueForName<Name> {
  return new Queue<
    QueuePayloadByName[Name],
    unknown,
    string,
    QueuePayloadByName[Name],
    unknown,
    string
  >(queueName, {
    ...options,
    connection,
    prefix,
  });
}

export async function enqueueJob<Name extends QueueName>(
  queueName: Name,
  queue: QueueForName<Name>,
  payload: unknown,
  options?: JobsOptions,
) {
  return queue.add(queueName, parseQueuePayload(queueName, payload), options);
}

export type PendingNotificationOutboxEvent = Readonly<{
  correlationId: string;
  eventType: 'notification';
  id: string;
}>;

export function notificationOutboxJobId(eventId: string) {
  return `outbox-${Buffer.from(eventId).toString('base64url')}`;
}

export async function publishPendingNotificationOutboxEvents(
  queue: QueueForName<typeof QueueNames.notification>,
  events: ReadonlyArray<PendingNotificationOutboxEvent>,
  markPublished: (eventId: string) => Promise<unknown>,
) {
  let published = 0;
  for (const event of events) {
    await enqueueJob(
      QueueNames.notification,
      queue,
      {
        correlationId: event.correlationId,
        outboxEventId: event.id,
        version: 1,
      },
      { jobId: notificationOutboxJobId(event.id) },
    );
    await markPublished(event.id);
    published += 1;
  }
  return published;
}

export const MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS = 3_600_000;
export const MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES =
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS / 60_000;
export const MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000);
const monitorSchedulerIdPrefix = 'monitor-';
export const SCHEDULE_DISPATCH_JITTER_MAXIMUM_MS = 60_000;
export const SCHEDULE_DISPATCH_ATTEMPTS = 5;
export const SCHEDULE_DISPATCH_BACKOFF_DELAY_MS = 1_000;

export type MonitorScheduleDefinition = Readonly<{
  correlationId: string;
  customIntervalMinutes: number | null;
  dailyTime: string | null;
  hourlyMinute: number | null;
  monitorId: string;
  monitorRevision: number;
  scheduleType: 'custom' | 'daily' | 'hourly';
  timeZone: string;
}>;

export type SchedulerReconciliationResult = Readonly<{
  removed: number;
  upserted: number;
}>;

export class MonitorScheduleValidationError extends Error {
  constructor(message: string) {
    super(`Invalid monitor schedule: ${message}`);
    this.name = 'MonitorScheduleValidationError';
  }
}

export function monitorJobSchedulerId({ monitorId, monitorRevision }: MonitorScheduleDefinition) {
  return `${monitorSchedulerIdPrefix}${Buffer.from(monitorId).toString('base64url')}-r${monitorRevision}`;
}

export function deterministicJitterMilliseconds(
  seed: string,
  maximumMilliseconds = SCHEDULE_DISPATCH_JITTER_MAXIMUM_MS,
) {
  if (!Number.isSafeInteger(maximumMilliseconds) || maximumMilliseconds < 0) {
    throw new MonitorScheduleValidationError('jitter maximum must be a non-negative integer');
  }
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) % (maximumMilliseconds + 1);
}

export function scheduledPageFetchJobId(
  scheduleJobId: string,
  monitorId: string,
  monitorRevision: number,
) {
  return `scheduled-${createHash('sha256')
    .update(`${scheduleJobId}:${monitorId}:${monitorRevision}`)
    .digest('hex')}`;
}

export async function dispatchScheduledPageFetch(
  queue: QueueForName<typeof QueueNames.pageFetch>,
  schedule: QueuePayloadByName[typeof QueueNames.monitorSchedule],
  scheduleJobId: string,
) {
  const payload = {
    checkId: randomUUID(),
    correlationId: schedule.correlationId,
    monitorId: schedule.monitorId,
    monitorRevision: schedule.monitorRevision,
    version: 1,
  } as const;
  return enqueueJob(QueueNames.pageFetch, queue, payload, {
    attempts: SCHEDULE_DISPATCH_ATTEMPTS,
    backoff: { delay: SCHEDULE_DISPATCH_BACKOFF_DELAY_MS, type: 'exponential' },
    delay: deterministicJitterMilliseconds(
      `${scheduleJobId}:${schedule.monitorId}:${schedule.monitorRevision}`,
    ),
    jobId: scheduledPageFetchJobId(scheduleJobId, schedule.monitorId, schedule.monitorRevision),
    removeOnComplete: 1_000,
    removeOnFail: 1_000,
  });
}

export type DomainConcurrencyGate = Readonly<{
  run: <Result>(domain: string, operation: () => Promise<Result>) => Promise<Result>;
}>;

export function createDomainConcurrencyGate(limit: number): DomainConcurrencyGate {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Domain concurrency limit must be a positive integer');
  }
  const pending = new Map<string, Array<() => void>>();
  const active = new Map<string, number>();
  const release = (domain: string) => {
    const next = pending.get(domain)?.shift();
    if (next) {
      next();
      return;
    }
    active.delete(domain);
    pending.delete(domain);
  };
  return {
    async run<Result>(domain: string, operation: () => Promise<Result>) {
      const normalizedDomain = domain.toLowerCase();
      if (normalizedDomain.length === 0) {
        throw new Error('Domain is required');
      }
      if ((active.get(normalizedDomain) ?? 0) >= limit) {
        await new Promise<void>((resolve) => {
          const queue = pending.get(normalizedDomain) ?? [];
          queue.push(resolve);
          pending.set(normalizedDomain, queue);
        });
      } else {
        active.set(normalizedDomain, (active.get(normalizedDomain) ?? 0) + 1);
      }
      try {
        return await operation();
      } finally {
        release(normalizedDomain);
      }
    },
  };
}

function validateMonitorSchedule(schedule: MonitorScheduleDefinition) {
  parseQueuePayload(QueueNames.monitorSchedule, {
    correlationId: schedule.correlationId,
    monitorId: schedule.monitorId,
    monitorRevision: schedule.monitorRevision,
    version: 1,
  });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone });
  } catch {
    throw new MonitorScheduleValidationError('timeZone must be a valid IANA time zone');
  }
  if (schedule.scheduleType === 'custom') {
    const customIntervalMinutes = schedule.customIntervalMinutes;
    if (
      typeof customIntervalMinutes !== 'number' ||
      !Number.isSafeInteger(customIntervalMinutes) ||
      customIntervalMinutes < MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES ||
      customIntervalMinutes > MAXIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES ||
      schedule.dailyTime !== null ||
      schedule.hourlyMinute !== null
    ) {
      throw new MonitorScheduleValidationError(
        'custom schedules require a bounded whole-minute interval',
      );
    }
    return;
  }
  if (schedule.scheduleType === 'hourly') {
    const hourlyMinute = schedule.hourlyMinute;
    if (
      typeof hourlyMinute !== 'number' ||
      !Number.isSafeInteger(hourlyMinute) ||
      hourlyMinute < 0 ||
      hourlyMinute > 59 ||
      schedule.customIntervalMinutes !== null ||
      schedule.dailyTime !== null
    ) {
      throw new MonitorScheduleValidationError(
        'hourly schedules require a minute from 0 through 59',
      );
    }
    return;
  }
  if (
    schedule.scheduleType !== 'daily' ||
    typeof schedule.dailyTime !== 'string' ||
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(schedule.dailyTime) ||
    schedule.customIntervalMinutes !== null ||
    schedule.hourlyMinute !== null
  ) {
    throw new MonitorScheduleValidationError('daily schedules require a 24-hour HH:MM time');
  }
}

function repeatOptions(schedule: MonitorScheduleDefinition) {
  if (schedule.scheduleType === 'custom') {
    const customIntervalMinutes = schedule.customIntervalMinutes;
    if (customIntervalMinutes === null) {
      throw new MonitorScheduleValidationError('custom schedules require an interval');
    }
    return { every: customIntervalMinutes * 60_000 };
  }
  if (schedule.scheduleType === 'hourly') {
    const hourlyMinute = schedule.hourlyMinute;
    if (hourlyMinute === null) {
      throw new MonitorScheduleValidationError('hourly schedules require a minute');
    }
    return { pattern: `${hourlyMinute} * * * *`, tz: schedule.timeZone };
  }
  const [hour, minute] = schedule.dailyTime!.split(':');
  return { pattern: `${minute} ${hour} * * *`, tz: schedule.timeZone };
}

export async function reconcileMonitorSchedules(
  queue: QueueForName<typeof QueueNames.monitorSchedule>,
  schedules: ReadonlyArray<MonitorScheduleDefinition>,
): Promise<SchedulerReconciliationResult> {
  const desiredScheduleIds = new Set<string>();
  for (const schedule of schedules) {
    validateMonitorSchedule(schedule);
    const scheduleId = monitorJobSchedulerId(schedule);
    if (desiredScheduleIds.has(scheduleId)) {
      throw new MonitorScheduleValidationError('duplicate monitor and revision');
    }
    desiredScheduleIds.add(scheduleId);
  }

  let upserted = 0;
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(monitorJobSchedulerId(schedule), repeatOptions(schedule), {
      data: {
        correlationId: schedule.correlationId,
        monitorId: schedule.monitorId,
        monitorRevision: schedule.monitorRevision,
        version: 1,
      },
      name: QueueNames.monitorSchedule,
      opts: {
        attempts: SCHEDULE_DISPATCH_ATTEMPTS,
        backoff: { delay: SCHEDULE_DISPATCH_BACKOFF_DELAY_MS, type: 'exponential' },
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      },
    });
    upserted += 1;
  }

  const existingSchedulers = await queue.getJobSchedulers();
  const staleScheduleIds = existingSchedulers.flatMap((scheduler) => {
    const scheduleId = scheduler.id;
    return typeof scheduleId === 'string' &&
      scheduleId.startsWith(monitorSchedulerIdPrefix) &&
      !desiredScheduleIds.has(scheduleId)
      ? [scheduleId]
      : [];
  });
  for (const scheduleId of staleScheduleIds) {
    await queue.removeJobScheduler(scheduleId);
  }

  return { removed: staleScheduleIds.length, upserted };
}

export function validateClaimedJob<Name extends QueueName, Result>(
  queueName: Name,
  job: Job<QueuePayloadByName[Name], Result>,
) {
  job.data = parseQueuePayload(queueName, job.data);
  return job;
}

export function createValidatedWorker<Name extends QueueName, Result>(
  queueName: Name,
  connection: Redis,
  prefix: string,
  processor: (job: Job<QueuePayloadByName[Name], Result>) => Promise<Result>,
  options: Omit<WorkerOptions, 'connection' | 'prefix'> = {},
) {
  return new Worker<QueuePayloadByName[Name], Result>(
    queueName,
    async (job) => processor(validateClaimedJob(queueName, job)),
    { ...options, connection, prefix },
  );
}

export type QueueResource = Readonly<{
  close: () => Promise<void>;
}>;

export type QueueRedisConnection = Readonly<{
  quit: () => Promise<unknown>;
}>;

function toError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(fallbackMessage, { cause: error });
}

export async function closeQueueResources(
  connection: QueueRedisConnection,
  resources: ReadonlyArray<QueueResource>,
) {
  const closeResults = await Promise.allSettled(resources.map((resource) => resource.close()));
  let connectionError: unknown;
  try {
    await connection.quit();
  } catch (error) {
    connectionError = error;
  }

  const closeFailure = closeResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (closeFailure) {
    throw toError(closeFailure.reason, 'Queue resource shutdown failed');
  }
  if (connectionError) {
    throw toError(connectionError, 'Redis shutdown failed');
  }
}

export type GracefulShutdownOptions = Readonly<{
  connection: QueueRedisConnection;
  onStart?: (signal: string) => void;
  resources: ReadonlyArray<QueueResource>;
}>;

export function createGracefulShutdown({
  connection,
  onStart,
  resources,
}: GracefulShutdownOptions) {
  let shutdown: Promise<void> | undefined;
  return (signal: string) => {
    shutdown ??= (async () => {
      onStart?.(signal);
      await closeQueueResources(connection, resources);
    })();
    return shutdown;
  };
}

export function installGracefulShutdown(
  options: GracefulShutdownOptions &
    Readonly<{
      onFailure: (signal: string, error: unknown) => void;
    }>,
) {
  const shutdown = createGracefulShutdown(options);
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((error: unknown) => options.onFailure(signal, error));
  };
  const onSigint = () => handleSignal('SIGINT');
  const onSigterm = () => handleSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  return {
    dispose() {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
    shutdown,
  };
}
