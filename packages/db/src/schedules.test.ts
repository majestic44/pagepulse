import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client.js';
import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  MonitorScheduleValidationError,
  upsertMonitorSchedule,
} from './schedules.js';
import { monitorSchedules } from './schema.js';

const schedule = {
  correlationId: 'correlation_1',
  everyMilliseconds: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  monitorId: 'monitor_1',
  monitorRevision: 1,
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
      intervalMs: schedule.everyMilliseconds,
      monitorId: schedule.monitorId,
      monitorRevision: schedule.monitorRevision,
    });
  });

  it('refuses sub-hour schedules before they reach MariaDB', async () => {
    const insert = vi.fn();

    await expect(
      upsertMonitorSchedule({ insert } as unknown as Database, {
        ...schedule,
        everyMilliseconds: MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS - 1,
      }),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);

    expect(insert).not.toHaveBeenCalled();
  });
});
