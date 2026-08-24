import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client.js';
import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES,
  MonitorScheduleValidationError,
  upsertMonitorSchedule,
} from './schedules.js';
import { monitorSchedules } from './schema.js';

const schedule = {
  correlationId: 'correlation_1',
  customIntervalMinutes: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES,
  dailyTime: null,
  hourlyMinute: null,
  monitorId: 'monitor_1',
  monitorRevision: 1,
  scheduleType: 'custom' as const,
  timeZone: 'UTC',
};

describe('monitor schedule registry', () => {
  it('persists an authoritative monitor schedule', async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const insert = vi.fn().mockReturnValue({ values });

    await expect(
      upsertMonitorSchedule({ insert } as unknown as Database, schedule),
    ).resolves.toEqual(schedule);

    expect(insert).toHaveBeenCalledWith(monitorSchedules);
    expect(values).toHaveBeenCalledWith({
      correlationId: schedule.correlationId,
      customIntervalMinutes: schedule.customIntervalMinutes,
      dailyTime: null,
      hourlyMinute: null,
      intervalMs: schedule.customIntervalMinutes * 60_000,
      monitorId: schedule.monitorId,
      monitorRevision: schedule.monitorRevision,
      scheduleType: 'custom',
      timeZone: 'UTC',
    });
  });

  it('refuses sub-hour schedules before they reach MariaDB', async () => {
    const insert = vi.fn();

    await expect(
      upsertMonitorSchedule({ insert } as unknown as Database, {
        ...schedule,
        customIntervalMinutes: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MINUTES - 1,
      }),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);

    expect(insert).not.toHaveBeenCalled();
  });
});
