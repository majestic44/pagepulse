import { createLogger, loadEnvironment } from '@pagepulse/config';
import {
  createRedisConnection,
  createValidatedWorker,
  installGracefulShutdown,
  QueueNames,
} from '@pagepulse/queue';

function startFetchWorker() {
  const environment = loadEnvironment();
  const logger = createLogger('fetch-worker', environment.LOG_LEVEL);
  const connection = createRedisConnection(environment.REDIS_URL);
  connection.on('error', (error) => logger.error({ error }, 'Redis connection failed'));

  const worker = createValidatedWorker(
    QueueNames.pageFetch,
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
        'Placeholder page-fetch check claimed',
      );
      return Promise.resolve({ status: 'not-implemented' });
    },
    { concurrency: environment.HTTP_FETCH_CONCURRENCY },
  );
  worker.on('error', (error) => logger.error({ error }, 'Page-fetch worker failed'));

  installGracefulShutdown({
    connection,
    onFailure: (signal, error) => {
      logger.error({ error, signal }, 'Page-fetch worker shutdown failed');
      process.exitCode = 1;
    },
    onStart: (signal) => logger.info({ signal }, 'Shutting down page-fetch worker'),
    resources: [worker],
  });

  return { connection, worker };
}

startFetchWorker();
