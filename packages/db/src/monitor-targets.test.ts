import { describe, expect, it, vi } from 'vitest';

import { getMonitorTarget, upsertOwnedMonitorTarget } from './monitor-targets.js';
import { MonitorTargetValidationError } from '@pagepulse/monitor-engine';
import { MonitorRevisionConflictError } from './monitors.js';

const createdAt = new Date('2026-08-25T00:00:00.000Z');
const monitorRow = {
  createdAt,
  id: 'monitor-id',
  name: 'Career openings',
  revision: 1,
  state: 'active',
  url: 'https://example.test/jobs',
};
type MonitorTargetConnection = Parameters<typeof upsertOwnedMonitorTarget>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as MonitorTargetConnection;
}

describe('member monitor targets', () => {
  it('defaults existing monitors to a whole-page target', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValueOnce([[], []]);

    await expect(getMonitorTarget(connection(query), 'member-id', 'monitor-id')).resolves.toEqual({
      monitor: monitorRow,
      target: { selector: null, targetType: 'whole_page' },
    });
  });

  it('stores a selector target with a new monitor revision and scheduler revision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValue([[], []]);

    await expect(
      upsertOwnedMonitorTarget(connection(query), 'member-id', 'monitor-id', 1, {
        selector: 'main > article',
        targetType: 'css_selector',
      }),
    ).resolves.toEqual({
      monitor: { ...monitorRow, revision: 2 },
      target: { selector: 'main > article', targetType: 'css_selector' },
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
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE monitor_schedules'), [
      2,
      'monitor-id',
    ]);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO monitor_targets'), [
      'monitor-id',
      'css_selector',
      'main > article',
    ]);
  });

  it('validates target input before locking and enforces revision preconditions', async () => {
    const invalid = vi.fn();
    await expect(
      upsertOwnedMonitorTarget(connection(invalid), 'member-id', 'monitor-id', 1, {
        selector: 'main[',
        targetType: 'css_selector',
      }),
    ).rejects.toBeInstanceOf(MonitorTargetValidationError);
    expect(invalid).not.toHaveBeenCalled();

    const stale = vi.fn().mockResolvedValueOnce([[monitorRow], []]);
    await expect(
      upsertOwnedMonitorTarget(connection(stale), 'member-id', 'monitor-id', 2, {
        targetType: 'whole_page',
      }),
    ).rejects.toBeInstanceOf(MonitorRevisionConflictError);
  });
});
