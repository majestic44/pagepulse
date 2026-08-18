import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger, loadEnvironment } from '@pagepulse/config';
import { QueueNames, type CheckJob } from '@pagepulse/contracts';
const env = loadEnvironment();
const log = createLogger('fetch-worker', env.LOG_LEVEL);
const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
const worker = new Worker<CheckJob>(
  QueueNames.pageFetch,
  (job) => {
    log.info(
      { jobId: job.id, monitorId: job.data.monitorId, correlationId: job.data.correlationId },
      'placeholder check claimed',
    );
    return Promise.resolve({ status: 'not-implemented' });
  },
  {
    connection,
    concurrency: env.HTTP_FETCH_CONCURRENCY,
    prefix: env.QUEUE_PREFIX,
  },
);
async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await worker.close();
  await connection.quit();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
