import { createHash } from 'node:crypto';

import { createLogger, loadEnvironment } from '@pagepulse/config';
import {
  createDatabase,
  createDatabasePool,
  getActiveMonitorForScheduledFetch,
  publishSnapshotFile,
  recordFailedCheck,
  recordSuccessfulCheck,
} from '@pagepulse/db';
import {
  canonicalMonitorSourceJson,
  fetchMonitorSource,
  normalizeMonitorSource,
  SourceAdapterError,
} from '@pagepulse/monitor-engine';
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
      const startedAt = new Date();
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
      return domains.run(domain, async () => {
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
        let serialized: Buffer;
        let contentHash: string;
        try {
          const source = await fetchMonitorSource(monitor.url, {
            maxBytes: environment.HTTP_FETCH_MAX_BYTES,
            sourceType: 'html',
            timeoutMs: environment.HTTP_FETCH_TIMEOUT_MS,
          });
          const content = normalizeMonitorSource(source);
          serialized = Buffer.from(canonicalMonitorSourceJson(content.canonical), 'utf8');
          contentHash = content.hash;
        } catch (error: unknown) {
          const failureCode = error instanceof SourceAdapterError ? error.code : 'fetch_failed';
          const completedAt = new Date();
          const expiresAt = new Date(
            completedAt.getTime() + environment.CHECK_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
          );
          await recordFailedCheck(pool, {
            checkId: job.data.checkId,
            completedAt,
            correlationId: job.data.correlationId,
            expiresAt,
            failureCode,
            monitorId: monitor.id,
            monitorRevision: monitor.revision,
            startedAt,
          });
          logger.warn(
            {
              checkId: job.data.checkId,
              correlationId: job.data.correlationId,
              domain,
              failureCode,
              monitorId: monitor.id,
            },
            'Scheduled page-fetch check failed',
          );
          return { failureCode, status: 'failed' as const };
        }
        const snapshotId = job.data.checkId;
        const storageKey = `${monitor.id}/${snapshotId}.json`;
        const completedAt = new Date();
        const snapshotExpiresAt = new Date(
          completedAt.getTime() + environment.SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        );
        const checkExpiresAt = new Date(
          completedAt.getTime() + environment.CHECK_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        );
        await publishSnapshotFile(environment.SNAPSHOT_ROOT, storageKey, serialized);
        const outcome = await recordSuccessfulCheck(pool, {
          checkId: job.data.checkId,
          completedAt,
          contentHash,
          correlationId: job.data.correlationId,
          expiresAt: checkExpiresAt,
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          snapshot: {
            byteSize: serialized.length,
            checksum: createHash('sha256').update(serialized).digest('hex'),
            expiresAt: snapshotExpiresAt,
            id: snapshotId,
            mediaType: 'application/json',
            storageKey,
          },
          startedAt,
        });
        logger.info(
          {
            checkId: job.data.checkId,
            correlationId: job.data.correlationId,
            domain,
            monitorId: monitor.id,
            recorded: outcome.recorded,
          },
          'Scheduled page-fetch check completed',
        );
        return { status: 'succeeded' as const };
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
