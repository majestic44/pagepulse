import { createLogger, loadEnvironment, type Environment } from '@pagepulse/config';
import {
  createRedisConnection,
  createValidatedWorker,
  installGracefulShutdown,
  QueueNames,
  type QueueName,
} from '@pagepulse/queue';

const queueNamesByRole: Record<Environment['WORKER_ROLE'], ReadonlyArray<QueueName>> = {
  scheduler: [QueueNames.monitorSchedule],
  'change-detection': [QueueNames.changeDetection],
  notification: [QueueNames.notification, QueueNames.digest],
  maintenance: [QueueNames.maintenance],
};

function startControlWorker() {
  const environment = loadEnvironment();
  const role = environment.WORKER_ROLE;
  const logger = createLogger(`control-worker:${role}`, environment.LOG_LEVEL);
  const connection = createRedisConnection(environment.REDIS_URL);
  connection.on('error', (error) => logger.error({ error }, 'Redis connection failed'));

  const workers = queueNamesByRole[role].map((queueName) => {
    const worker = createValidatedWorker(queueName, connection, environment.QUEUE_PREFIX, (job) => {
      logger.info(
        {
          correlationId: job.data.correlationId,
          jobId: job.id,
          queueName,
          role,
        },
        'Placeholder queue job claimed',
      );
      return Promise.resolve({ status: 'not-implemented' });
    });
    worker.on('error', (error) => logger.error({ error, queueName }, 'Control worker failed'));
    return worker;
  });

  installGracefulShutdown({
    connection,
    onFailure: (signal, error) => {
      logger.error({ error, role, signal }, 'Control worker shutdown failed');
      process.exitCode = 1;
    },
    onStart: (signal) => logger.info({ role, signal }, 'Shutting down control worker'),
    resources: workers,
  });

  return { connection, workers };
}

startControlWorker();
