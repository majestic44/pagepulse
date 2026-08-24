import { describe, expect, it, vi } from 'vitest';

import {
  deleteOwnedMonitorSchedule,
  MonitorScheduleNotFoundError,
  upsertOwnedMonitorSchedule,
} from './monitor-scheduling.js';
import { MonitorRevisionConflictError } from './monitors.js';
import { MonitorScheduleValidationError } from './schedules.js';

const createdAt = new Date('2026-08-24T12:00:00.000Z');
const monitorRow = {
  createdAt,
  id: 'monitor-id',
  name: 'Career openings',
  revision: 1,
  state: 'active',
  url: 'https://example.test/jobs',
};
type MonitorScheduleConnection = Parameters<typeof upsertOwnedMonitorSchedule>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as MonitorScheduleConnection;
}

describe('member monitor scheduling', () => {
  it('stores a daily schedule with its timezone and a new monitor revision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValue([[], []]);

    const result = await upsertOwnedMonitorSchedule(
      connection(query),
      'member-id',
      'monitor-id',
      1,
      {
        dailyTime: '09:30',
        scheduleType: 'daily',
        timeZone: 'America/New_York',
      },
    );

    expect(result.monitor).toMatchObject({ id: 'monitor-id', revision: 2 });
    expect(result.schedule).toMatchObject({
      customIntervalMinutes: null,
      dailyTime: '09:30',
      hourlyMinute: null,
      monitorId: 'monitor-id',
      monitorRevision: 2,
      scheduleType: 'daily',
      timeZone: 'America/New_York',
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), [
      'monitor-id',
      'member-id',
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE monitors'), [
      2,
      'monitor-id',
      'member-id',
      1,
    ]);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO monitor_schedules'),
      [
        'monitor-id',
        2,
        86_400_000,
        'daily',
        'America/New_York',
        null,
        '09:30',
        null,
        expect.any(String),
      ],
    );
  });

  it('rejects invalid time zones and custom intervals before it locks a monitor', async () => {
    const query = vi.fn();
    await expect(
      upsertOwnedMonitorSchedule(connection(query), 'member-id', 'monitor-id', 1, {
        scheduleType: 'daily',
        dailyTime: '09:30',
        timeZone: 'Not/A_Timezone',
      }),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);
    await expect(
      upsertOwnedMonitorSchedule(connection(query), 'member-id', 'monitor-id', 1, {
        customIntervalMinutes: 59,
        scheduleType: 'custom',
        timeZone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(MonitorScheduleValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('enforces revision preconditions and does not delete a missing schedule', async () => {
    const stale = vi.fn().mockResolvedValue([[monitorRow], []]);
    await expect(
      upsertOwnedMonitorSchedule(connection(stale), 'member-id', 'monitor-id', 2, {
        hourlyMinute: 0,
        scheduleType: 'hourly',
        timeZone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(MonitorRevisionConflictError);

    const missing = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    await expect(
      deleteOwnedMonitorSchedule(connection(missing), 'member-id', 'monitor-id', 1),
    ).rejects.toBeInstanceOf(MonitorScheduleNotFoundError);
    expect(missing).toHaveBeenCalledTimes(2);
  });
});
