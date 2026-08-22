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

import { QueuePayloadSchemas, type QueueName, type QueuePayloadByName } from '@pagepulse/contracts';

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
  Name,
  QueuePayloadByName[Name],
  unknown,
  Name
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
    Name,
    QueuePayloadByName[Name],
    unknown,
    Name
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
