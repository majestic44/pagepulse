import { describe, expect, it, vi } from 'vitest';

import { QueueNames } from '@pagepulse/contracts';

import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES,
  MonitorScheduleValidationError,
  monitorJobSchedulerId,
  notificationOutboxJobId,
  publishPendingNotificationOutboxEvents,
  reconcileMonitorSchedules,
  type QueueForName,
} from './index.js';

const monitorSchedule = {
  correlationId: 'correlation_1',
  customIntervalMinutes: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES,
  dailyTime: null,
  hourlyMinute: null,
  monitorId: 'monitor_1',
  monitorRevision: 1,
  scheduleType: 'custom' as const,
  timeZone: 'UTC',
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
      { every: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES * 60_000 },
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
        {
          ...monitorSchedule,
          customIntervalMinutes: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES - 1,
        },
      ]),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);

    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(getJobSchedulers).not.toHaveBeenCalled();
  });

  it('uses timezone-aware cron patterns for hourly and daily schedules', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'job_1' });
    const queue = {
      getJobSchedulers: vi.fn().mockResolvedValue([]),
      removeJobScheduler: vi.fn(),
      upsertJobScheduler,
    } as unknown as QueueForName<typeof QueueNames.monitorSchedule>;

    await reconcileMonitorSchedules(queue, [
      {
        ...monitorSchedule,
        customIntervalMinutes: null,
        hourlyMinute: 17,
        monitorId: 'hourly-monitor',
        scheduleType: 'hourly',
        timeZone: 'America/New_York',
      },
      {
        ...monitorSchedule,
        customIntervalMinutes: null,
        dailyTime: '09:30',
        monitorId: 'daily-monitor',
        scheduleType: 'daily',
        timeZone: 'America/New_York',
      },
    ]);

    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      monitorJobSchedulerId({ ...monitorSchedule, monitorId: 'hourly-monitor' }),
      { pattern: '17 * * * *', tz: 'America/New_York' },
      expect.any(Object),
    );
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      monitorJobSchedulerId({ ...monitorSchedule, monitorId: 'daily-monitor' }),
      { pattern: '30 09 * * *', tz: 'America/New_York' },
      expect.any(Object),
    );
  });
});
