import type { MonitorSchedule, PendingOutboxEvent } from '@pagepulse/db';
import {
  publishPendingNotificationOutboxEvents,
  reconcileMonitorSchedules,
  type QueueForName,
  QueueNames,
  type SchedulerReconciliationResult,
} from '@pagepulse/queue';

export type SchedulerReconciliationDependencies = Readonly<{
  listActiveSchedules: () => Promise<ReadonlyArray<MonitorSchedule>>;
  listPendingOutboxEvents: () => Promise<ReadonlyArray<PendingOutboxEvent>>;
  markOutboxEventPublished: (eventId: string) => Promise<unknown>;
  monitorScheduleQueue: QueueForName<typeof QueueNames.monitorSchedule>;
  notificationQueue: QueueForName<typeof QueueNames.notification>;
}>;

export type SchedulerReconciliationRun = Readonly<{
  publishedOutboxEvents: number;
  schedules: SchedulerReconciliationResult;
}>;

export async function runInitialSchedulerReconciliation(
  reconcile: () => Promise<void>,
  shutdown: (signal: string) => Promise<void>,
) {
  try {
    await reconcile();
  } catch (error) {
    await shutdown('startup_failure');
    throw error;
  }
}

export function createSchedulerReconciler({
  listActiveSchedules,
  listPendingOutboxEvents,
  markOutboxEventPublished,
  monitorScheduleQueue,
  notificationQueue,
}: SchedulerReconciliationDependencies) {
  let inFlight: Promise<SchedulerReconciliationRun> | undefined;

  return () => {
    inFlight ??= (async () => {
      const [schedules, pendingOutboxEvents] = await Promise.all([
        listActiveSchedules(),
        listPendingOutboxEvents(),
      ]);
      const [scheduleResult, publishedOutboxEvents] = await Promise.all([
        reconcileMonitorSchedules(monitorScheduleQueue, schedules),
        publishPendingNotificationOutboxEvents(
          notificationQueue,
          pendingOutboxEvents,
          markOutboxEventPublished,
        ),
      ]);
      return { publishedOutboxEvents, schedules: scheduleResult };
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
