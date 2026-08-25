import { createLogger, loadEnvironment, type Environment } from '@pagepulse/config';
import {
  createDatabase,
  createDatabasePool,
  listActiveMonitorSchedules,
  listPendingOutboxEvents,
  markOutboxEventPublished,
  listExpiredSnapshots,
  purgeExpiredChecks,
  purgeExpiredAuditEvents,
  purgeExpiredAccountDeletions as purgeExpiredAccountDeletionRecords,
  removeExpiredSnapshotRecord,
  removeSnapshotFile,
  withAccountDeletionTransaction,
} from '@pagepulse/db';
import {
  createQueue,
  createRedisConnection,
  createValidatedWorker,
  dispatchScheduledPageFetch,
  installGracefulShutdown,
  QueueNames,
  type QueueName,
  type QueueResource,
} from '@pagepulse/queue';

import { createSchedulerReconciler, runInitialWorkerReconciliation } from './scheduler.js';

const queueNamesByRole: Record<Environment['WORKER_ROLE'], ReadonlyArray<QueueName>> = {
  scheduler: [],
  'change-detection': [QueueNames.changeDetection],
  notification: [QueueNames.notification, QueueNames.digest],
  maintenance: [QueueNames.maintenance],
};

async function startControlWorker() {
  const environment = loadEnvironment();
  const role = environment.WORKER_ROLE;
  const logger = createLogger(`control-worker:${role}`, environment.LOG_LEVEL);
  const connection = createRedisConnection(environment.REDIS_URL);
  connection.on('error', (error) => logger.error({ error }, 'Redis connection failed'));

  const workers: QueueResource[] = queueNamesByRole[role].map((queueName) => {
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

  const resources: QueueResource[] = [...workers];
  let accountDeletionTimer: NodeJS.Timeout | undefined;
  let logReconciliation: (() => Promise<void>) | undefined;
  let reconciliationTimer: NodeJS.Timeout | undefined;
  if (role === 'scheduler') {
    const pool = createDatabasePool(environment.DATABASE_URL);
    const database = createDatabase(pool);
    const monitorScheduleQueue = createQueue(
      QueueNames.monitorSchedule,
      connection,
      environment.QUEUE_PREFIX,
    );
    const notificationQueue = createQueue(
      QueueNames.notification,
      connection,
      environment.QUEUE_PREFIX,
    );
    const pageFetchQueue = createQueue(QueueNames.pageFetch, connection, environment.QUEUE_PREFIX);
    const scheduleWorker = createValidatedWorker(
      QueueNames.monitorSchedule,
      connection,
      environment.QUEUE_PREFIX,
      async (job) => {
        const scheduled = await dispatchScheduledPageFetch(
          pageFetchQueue,
          job.data,
          String(job.id),
        );
        logger.info(
          {
            correlationId: job.data.correlationId,
            jobId: job.id,
            monitorId: job.data.monitorId,
          },
          'Scheduled monitor check dispatched',
        );
        return { dispatchedJobId: scheduled.id ?? null };
      },
      { concurrency: 1 },
    );
    scheduleWorker.on('error', (error) =>
      logger.error({ error }, 'Schedule dispatch worker failed'),
    );
    workers.push(scheduleWorker);
    resources.push(scheduleWorker);
    const reconcile = createSchedulerReconciler({
      listActiveSchedules: () => listActiveMonitorSchedules(database),
      listPendingOutboxEvents: () => listPendingOutboxEvents(database),
      markOutboxEventPublished: (eventId) => markOutboxEventPublished(database, eventId),
      monitorScheduleQueue,
      notificationQueue,
    });
    logReconciliation = async () => {
      const result = await reconcile();
      logger.info(
        {
          publishedOutboxEvents: result.publishedOutboxEvents,
          removedSchedulers: result.schedules.removed,
          upsertedSchedulers: result.schedules.upserted,
        },
        'Scheduler reconciliation completed',
      );
    };
    resources.push(monitorScheduleQueue, notificationQueue, pageFetchQueue, {
      close: async () => {
        if (reconciliationTimer) {
          clearInterval(reconciliationTimer);
        }
        await pool.end();
      },
    });
  }

  let runAccountDeletionPurge: (() => Promise<void>) | undefined;
  if (role === 'maintenance') {
    const pool = createDatabasePool(environment.DATABASE_URL);
    runAccountDeletionPurge = async () => {
      const now = new Date();
      const expiredSnapshots = await listExpiredSnapshots(pool, now);
      let purgedSnapshots = 0;
      for (const snapshot of expiredSnapshots) {
        await removeSnapshotFile(environment.SNAPSHOT_ROOT, snapshot.storageKey);
        purgedSnapshots += await removeExpiredSnapshotRecord(pool, snapshot.id, now);
      }
      const result = await withAccountDeletionTransaction(pool, async (connection) => ({
        purgedAccounts: await purgeExpiredAccountDeletionRecords(connection),
        purgedAuditEvents: await purgeExpiredAuditEvents(connection),
        purgedChecks: await purgeExpiredChecks(connection, now),
      }));
      logger.info({ ...result, purgedSnapshots }, 'Retention cleanup completed');
    };
    resources.push({
      close: async () => {
        if (accountDeletionTimer) {
          clearInterval(accountDeletionTimer);
        }
        await pool.end();
      },
    });
  }

  const shutdown = installGracefulShutdown({
    connection,
    onFailure: (signal, error) => {
      logger.error({ error, role, signal }, 'Control worker shutdown failed');
      process.exitCode = 1;
    },
    onStart: (signal) => logger.info({ role, signal }, 'Shutting down control worker'),
    resources,
  });

  if (logReconciliation) {
    await runInitialWorkerReconciliation(logReconciliation, shutdown.shutdown);
    reconciliationTimer = setInterval(() => {
      void logReconciliation().catch((error: unknown) =>
        logger.error({ error }, 'Scheduler reconciliation failed'),
      );
    }, environment.SCHEDULER_RECONCILIATION_INTERVAL_MS);
    reconciliationTimer.unref();
  }

  if (runAccountDeletionPurge) {
    await runInitialWorkerReconciliation(runAccountDeletionPurge, shutdown.shutdown);
    accountDeletionTimer = setInterval(() => {
      void runAccountDeletionPurge().catch((error: unknown) =>
        logger.error({ error }, 'Account deletion cleanup failed'),
      );
    }, environment.ACCOUNT_DELETION_SWEEP_INTERVAL_MS);
    accountDeletionTimer.unref();
  }

  return { connection, workers };
}

startControlWorker().catch((error: unknown) => {
  const logger = createLogger('control-worker');
  logger.error({ error }, 'Control worker failed to start');
  process.exitCode = 1;
});
