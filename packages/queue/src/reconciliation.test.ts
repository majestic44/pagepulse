import { describe, expect, it, vi } from 'vitest';

import { QueueNames } from '@pagepulse/contracts';

import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  MonitorScheduleValidationError,
  monitorJobSchedulerId,
  notificationOutboxJobId,
  publishPendingNotificationOutboxEvents,
  reconcileMonitorSchedules,
  type QueueForName,
} from './index.js';

const monitorSchedule = {
  correlationId: 'correlation_1',
  everyMilliseconds: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  monitorId: 'monitor_1',
  monitorRevision: 1,
};

describe('outbox publication', () => {
  it('publishes notification events with a deterministic queue job ID', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job_1' });
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as QueueForName<typeof QueueNames.notification>;

    await expect(
      publishPendingNotificationOutboxEvents(
        queue,
        [{ correlationId: 'correlation_1', eventType: 'notification', id: 'outbox_1' }],
        markPublished,
      ),
    ).resolves.toBe(1);

    expect(add).toHaveBeenCalledWith(
      QueueNames.notification,
      { correlationId: 'correlation_1', outboxEventId: 'outbox_1', version: 1 },
      { jobId: notificationOutboxJobId('outbox_1') },
    );
    expect(markPublished).toHaveBeenCalledWith('outbox_1');
  });

  it('does not mark an event published when queue publication fails', async () => {
    const queue = {
      add: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    } as unknown as QueueForName<typeof QueueNames.notification>;
    const markPublished = vi.fn();

    await expect(
      publishPendingNotificationOutboxEvents(
        queue,
        [{ correlationId: 'correlation_1', eventType: 'notification', id: 'outbox_1' }],
        markPublished,
      ),
    ).rejects.toThrow('Redis unavailable');

    expect(markPublished).not.toHaveBeenCalled();
  });
});

describe('scheduler reconciliation', () => {
  it('upserts authoritative schedules and removes only stale PagePulse schedulers', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'job_1' });
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const queue = {
      getJobSchedulers: vi
        .fn()
        .mockResolvedValue([{ id: 'monitor-c3RhbGU-r1' }, { id: 'unrelated-scheduler' }]),
      removeJobScheduler,
      upsertJobScheduler,
    } as unknown as QueueForName<typeof QueueNames.monitorSchedule>;

    await expect(reconcileMonitorSchedules(queue, [monitorSchedule])).resolves.toEqual({
      removed: 1,
      upserted: 1,
    });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      monitorJobSchedulerId(monitorSchedule),
      { every: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS },
      {
        data: {
          correlationId: 'correlation_1',
          monitorId: 'monitor_1',
          monitorRevision: 1,
          version: 1,
        },
        name: QueueNames.monitorSchedule,
        opts: { removeOnComplete: 1_000, removeOnFail: 1_000 },
      },
    );
    expect(removeJobScheduler).toHaveBeenCalledWith('monitor-c3RhbGU-r1');
  });

  it('validates every schedule before making queue changes', async () => {
    const getJobSchedulers = vi.fn();
    const upsertJobScheduler = vi.fn();
    const queue = {
      getJobSchedulers,
      removeJobScheduler: vi.fn(),
      upsertJobScheduler,
    } as unknown as QueueForName<typeof QueueNames.monitorSchedule>;

    await expect(
      reconcileMonitorSchedules(queue, [
        { ...monitorSchedule, everyMilliseconds: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS - 1 },
      ]),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);

    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(getJobSchedulers).not.toHaveBeenCalled();
  });
});
