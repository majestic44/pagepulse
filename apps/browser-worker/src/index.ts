import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger } from '@pagepulse/config';
import { QueueNames, type CheckJob } from '@pagepulse/contracts';
const log = createLogger('browser-worker');
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const worker = new Worker<CheckJob>(
  QueueNames.browserFetch,
  (job) => {
    log.info(
      { jobId: job.id, monitorId: job.data.monitorId, correlationId: job.data.correlationId },
      'placeholder browser check claimed',
    );
    return Promise.resolve({ status: 'not-implemented' });
  },
  {
    connection,
    concurrency: Number(process.env.BROWSER_CONCURRENCY_MIN ?? 1),
    prefix: process.env.QUEUE_PREFIX ?? 'pagepulse',
  },
);
async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await worker.close();
  await connection.quit();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
