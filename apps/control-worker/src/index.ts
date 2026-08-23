import { createLogger, loadEnvironment, type Environment } from '@pagepulse/config';
import {
  createDatabase,
  createDatabasePool,
  listActiveMonitorSchedules,
  listPendingOutboxEvents,
  markOutboxEventPublished,
} from '@pagepulse/db';
import {
  createQueue,
  createRedisConnection,
  createValidatedWorker,
  installGracefulShutdown,
  QueueNames,
  type QueueName,
  type QueueResource,
} from '@pagepulse/queue';

import { createSchedulerReconciler } from './scheduler.js';

const queueNamesByRole: Record<Environment['WORKER_ROLE'], ReadonlyArray<QueueName>> = {
  scheduler: [QueueNames.monitorSchedule],
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

  const resources: QueueResource[] = [...workers];
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
    const reconcile = createSchedulerReconciler({
      listActiveSchedules: () => listActiveMonitorSchedules(database),
      listPendingOutboxEvents: () => listPendingOutboxEvents(database),
      markOutboxEventPublished: (eventId) => markOutboxEventPublished(database, eventId),
      monitorScheduleQueue,
      notificationQueue,
    });
    const logReconciliation = async () => {
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

    await logReconciliation();
    const reconciliationTimer = setInterval(() => {
      void logReconciliation().catch((error: unknown) =>
        logger.error({ error }, 'Scheduler reconciliation failed'),
      );
    }, environment.SCHEDULER_RECONCILIATION_INTERVAL_MS);
    reconciliationTimer.unref();
    resources.push(monitorScheduleQueue, notificationQueue, {
      close: async () => {
        clearInterval(reconciliationTimer);
        await pool.end();
      },
    });
  }

  installGracefulShutdown({
    connection,
    onFailure: (signal, error) => {
      logger.error({ error, role, signal }, 'Control worker shutdown failed');
      process.exitCode = 1;
    },
    onStart: (signal) => logger.info({ role, signal }, 'Shutting down control worker'),
    resources,
  });

  return { connection, workers };
}

startControlWorker().catch((error: unknown) => {
  const logger = createLogger('control-worker');
  logger.error({ error }, 'Control worker failed to start');
  process.exitCode = 1;
});
