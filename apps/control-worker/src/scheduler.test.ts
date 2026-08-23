import { describe, expect, it, vi } from 'vitest';

import { type MonitorSchedule, type PendingOutboxEvent } from '@pagepulse/db';
import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  QueueNames,
  type QueueForName,
} from '@pagepulse/queue';

import { createSchedulerReconciler } from './scheduler.js';

const schedules: MonitorSchedule[] = [
  {
    correlationId: 'correlation_1',
    everyMilliseconds: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
    monitorId: 'monitor_1',
    monitorRevision: 1,
  },
];

const events: PendingOutboxEvent[] = [
  { correlationId: 'correlation_1', eventType: 'notification', id: 'outbox_1' },
];

describe('scheduler reconciliation service', () => {
  it('shares concurrent reconciliation requests and reconciles schedules and outbox events', async () => {
    const listActiveSchedules = vi.fn().mockResolvedValue(schedules);
    const listPendingOutboxEvents = vi.fn().mockResolvedValue(events);
    const markOutboxEventPublished = vi.fn().mockResolvedValue(undefined);
    const monitorScheduleQueue = {
      getJobSchedulers: vi.fn().mockResolvedValue([]),
      removeJobScheduler: vi.fn(),
      upsertJobScheduler: vi.fn().mockResolvedValue({}),
    } as unknown as QueueForName<typeof QueueNames.monitorSchedule>;
    const notificationQueue = {
      add: vi.fn().mockResolvedValue({}),
    } as unknown as QueueForName<typeof QueueNames.notification>;
    const reconcile = createSchedulerReconciler({
      listActiveSchedules,
      listPendingOutboxEvents,
      markOutboxEventPublished,
      monitorScheduleQueue,
      notificationQueue,
    });

    const [first, second] = await Promise.all([reconcile(), reconcile()]);

    expect(first).toEqual({
      publishedOutboxEvents: 1,
      schedules: { removed: 0, upserted: 1 },
    });
    expect(second).toEqual(first);
    expect(listActiveSchedules).toHaveBeenCalledOnce();
    expect(listPendingOutboxEvents).toHaveBeenCalledOnce();
    expect(markOutboxEventPublished).toHaveBeenCalledWith('outbox_1');
  });
});
