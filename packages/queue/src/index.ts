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
const monitorSchedulerIdPrefix = 'monitor-';

export type MonitorScheduleDefinition = Readonly<{
  correlationId: string;
  everyMilliseconds: number;
  monitorId: string;
  monitorRevision: number;
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

function validateMonitorSchedule(schedule: MonitorScheduleDefinition) {
  parseQueuePayload(QueueNames.monitorSchedule, {
    correlationId: schedule.correlationId,
    monitorId: schedule.monitorId,
    monitorRevision: schedule.monitorRevision,
    version: 1,
  });
  if (
    !Number.isSafeInteger(schedule.everyMilliseconds) ||
    schedule.everyMilliseconds < MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS
  ) {
    throw new MonitorScheduleValidationError(
      `everyMilliseconds must be an integer of at least ${MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS}`,
    );
  }
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
    await queue.upsertJobScheduler(
      monitorJobSchedulerId(schedule),
      { every: schedule.everyMilliseconds },
      {
        data: {
          correlationId: schedule.correlationId,
          monitorId: schedule.monitorId,
          monitorRevision: schedule.monitorRevision,
          version: 1,
        },
        name: QueueNames.monitorSchedule,
        opts: { removeOnComplete: 1_000, removeOnFail: 1_000 },
      },
    );
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
