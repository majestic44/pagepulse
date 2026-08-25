import { describe, expect, it, vi } from 'vitest';

import {
  MonitorRuleValidationError,
  getMonitorRules,
  upsertOwnedMonitorRules,
} from './monitor-rules.js';

const monitor = {
  createdAt: new Date('2026-08-25T00:00:00.000Z'),
  id: 'monitor-id',
  name: 'Career openings',
  revision: 1,
  state: 'active' as const,
  url: 'https://example.test/jobs',
};

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as never;
}

describe('member monitor rules', () => {
  it('defaults to text changes with a pending baseline', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitor], []])
      .mockResolvedValueOnce([[], []]);

    await expect(getMonitorRules(connection(query), 'member-id', 'monitor-id')).resolves.toEqual({
      monitor,
      rules: {
        baseline: { revision: 1, state: 'pending' },
        configuration: { keyword: null, newItem: false, textChange: true },
      },
    });
  });

  it('resets the baseline and monitor revision when rules change', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitor], []])
      .mockResolvedValueOnce([[{ identitySelector: 'a[href]', itemSelector: 'li.job' }], []])
      .mockResolvedValue([[], []]);
    const configuration = {
      keyword: { phrases: ['Hiring freeze'], transition: 'appears' as const },
      newItem: true,
      textChange: false,
    };

    await expect(
      upsertOwnedMonitorRules(connection(query), 'member-id', 'monitor-id', 1, configuration),
    ).resolves.toEqual({
      monitor: { ...monitor, revision: 2 },
      rules: {
        baseline: { revision: 2, state: 'pending' },
        configuration,
      },
    });
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM monitor_targets'), [
      'monitor-id',
    ]);
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE monitors'), [
      2,
      'monitor-id',
      'member-id',
      1,
    ]);
    expect(query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE monitor_schedules'), [
      2,
      'monitor-id',
    ]);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO monitor_rules'), [
      'monitor-id',
      2,
      JSON.stringify(configuration),
      2,
    ]);
  });

  it('rejects invalid input before locking the monitor', async () => {
    const query = vi.fn();

    await expect(
      upsertOwnedMonitorRules(connection(query), 'member-id', 'monitor-id', 1, {}),
    ).rejects.toBeInstanceOf(MonitorRuleValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a repeated-list target for new-item rules', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitor], []])
      .mockResolvedValueOnce([[], []]);

    await expect(
      upsertOwnedMonitorRules(connection(query), 'member-id', 'monitor-id', 1, {
        newItem: true,
      }),
    ).rejects.toThrow('newItem requires a repeated-list target');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
