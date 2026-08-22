import { createLogger, loadEnvironment } from '@pagepulse/config';
import {
  createRedisConnection,
  createValidatedWorker,
  installGracefulShutdown,
  QueueNames,
} from '@pagepulse/queue';

function startBrowserWorker() {
  const environment = loadEnvironment();
  const logger = createLogger('browser-worker', environment.LOG_LEVEL);
  const connection = createRedisConnection(environment.REDIS_URL);
  connection.on('error', (error) => logger.error({ error }, 'Redis connection failed'));

  const worker = createValidatedWorker(
    QueueNames.browserFetch,
    connection,
    environment.QUEUE_PREFIX,
    (job) => {
      logger.info(
        {
          checkId: job.data.checkId,
          correlationId: job.data.correlationId,
          jobId: job.id,
          monitorId: job.data.monitorId,
        },
        'Placeholder browser-fetch check claimed',
      );
      return Promise.resolve({ status: 'not-implemented' });
    },
    { concurrency: environment.BROWSER_CONCURRENCY_MIN },
  );
  worker.on('error', (error) => logger.error({ error }, 'Browser-fetch worker failed'));

  installGracefulShutdown({
    connection,
    onFailure: (signal, error) => {
      logger.error({ error, signal }, 'Browser-fetch worker shutdown failed');
      process.exitCode = 1;
    },
    onStart: (signal) => logger.info({ signal }, 'Shutting down browser-fetch worker'),
    resources: [worker],
  });

  return { connection, worker };
}

startBrowserWorker();
