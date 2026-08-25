import { createLogger, loadEnvironment } from '@pagepulse/config';
import {
  createDatabase,
  createDatabasePool,
  getActiveMonitorForScheduledFetch,
} from '@pagepulse/db';
import {
  createDomainConcurrencyGate,
  createRedisConnection,
  createValidatedWorker,
  installGracefulShutdown,
  QueueNames,
} from '@pagepulse/queue';

function startFetchWorker() {
  const environment = loadEnvironment();
  const logger = createLogger('fetch-worker', environment.LOG_LEVEL);
  const connection = createRedisConnection(environment.REDIS_URL);
  const pool = createDatabasePool(environment.DATABASE_URL);
  const database = createDatabase(pool);
  const domains = createDomainConcurrencyGate(environment.DOMAIN_CONCURRENCY);
  connection.on('error', (error) => logger.error({ error }, 'Redis connection failed'));

  const worker = createValidatedWorker(
    QueueNames.pageFetch,
    connection,
    environment.QUEUE_PREFIX,
    async (job) => {
      const monitor = await getActiveMonitorForScheduledFetch(
        database,
        job.data.monitorId,
        job.data.monitorRevision,
      );
      if (!monitor) {
        return { status: 'stale' as const };
      }
      let domain: string;
      try {
        const target = new URL(monitor.url);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return { status: 'invalid_target' as const };
        }
        domain = target.hostname;
      } catch {
        return { status: 'invalid_target' as const };
      }
      return domains.run(domain, () => {
        logger.info(
          {
            checkId: job.data.checkId,
            correlationId: job.data.correlationId,
            domain,
            jobId: job.id,
            monitorId: job.data.monitorId,
          },
          'Scheduled page-fetch check claimed',
        );
        return Promise.resolve({ status: 'not-implemented' as const });
      });
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
    resources: [worker, { close: () => pool.end() }],
  });

  return { connection, worker };
}

startFetchWorker();
