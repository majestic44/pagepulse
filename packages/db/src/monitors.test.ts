import { describe, expect, it, vi } from 'vitest';

import {
  createMonitor,
  deleteMonitor,
  MonitorInputError,
  MonitorLimitError,
  MonitorRevisionConflictError,
  pauseMonitor,
  updateMonitor,
} from './monitors.js';

const now = new Date('2026-08-24T12:00:00.000Z');
const monitorRow = {
  createdAt: now,
  id: 'monitor-id',
  name: 'Career openings',
  revision: 1,
  state: 'active',
  url: 'https://example.test/jobs',
};
type MonitorConnection = Parameters<typeof createMonitor>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as MonitorConnection;
}

describe('monitor persistence', () => {
  it('creates a canonical HTTP monitor after locking the account limit', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'member-id', monitorLimit: 50 }], []])
      .mockResolvedValueOnce([[{ monitorCount: 0 }], []])
      .mockResolvedValue([[], []]);

    const monitor = await createMonitor(
      connection(query),
      'member-id',
      { name: ' Career openings ', url: 'https://example.test/jobs' },
      now,
    );

    expect(monitor).toMatchObject({
      createdAt: now,
      name: 'Career openings',
      revision: 1,
      state: 'active',
      url: 'https://example.test/jobs',
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('LIMIT 1 FOR UPDATE'), [
      'member-id',
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('COUNT(*)'), ['member-id']);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO monitors'), [
      monitor.id,
      'member-id',
      'Career openings',
      'https://example.test/jobs',
      'active',
      1,
      now,
    ]);
  });

  it('rejects unsafe monitor input and a reached account limit before insertion', async () => {
    const invalid = vi.fn();
    await expect(
      createMonitor(connection(invalid), 'member-id', {
        name: 'Career openings',
        url: 'ftp://example.test/jobs',
      }),
    ).rejects.toBeInstanceOf(MonitorInputError);
    expect(invalid).not.toHaveBeenCalled();

    const atLimit = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'member-id', monitorLimit: 1 }], []])
      .mockResolvedValueOnce([[{ monitorCount: 1 }], []]);
    await expect(
      createMonitor(connection(atLimit), 'member-id', {
        name: 'Career openings',
        url: 'https://example.test/jobs',
      }),
    ).rejects.toBeInstanceOf(MonitorLimitError);
    expect(atLimit).toHaveBeenCalledTimes(2);
  });

  it('updates only with the revision that was read', async () => {
    const stale = vi.fn().mockResolvedValue([[monitorRow], []]);
    await expect(
      updateMonitor(connection(stale), 'member-id', 'monitor-id', 2, {
        name: 'New name',
        url: 'https://example.test/new',
      }),
    ).rejects.toBeInstanceOf(MonitorRevisionConflictError);
    expect(stale).toHaveBeenCalledTimes(1);

    const query = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValue([[], []]);
    await expect(
      updateMonitor(connection(query), 'member-id', 'monitor-id', 1, {
        name: 'New name',
        url: 'https://example.test/new',
      }),
    ).resolves.toMatchObject({ name: 'New name', revision: 2, url: 'https://example.test/new' });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('revision = ?'), [
      'New name',
      'https://example.test/new',
      2,
      'monitor-id',
      'member-id',
      1,
    ]);
  });

  it('pauses and deletes a monitor using revision preconditions', async () => {
    const paused = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValue([[], []]);
    await expect(
      pauseMonitor(connection(paused), 'member-id', 'monitor-id', 1),
    ).resolves.toMatchObject({
      revision: 2,
      state: 'paused',
    });
    expect(paused).toHaveBeenLastCalledWith(expect.stringContaining('SET state = ?'), [
      'paused',
      2,
      'monitor-id',
      'member-id',
      1,
    ]);

    const deleted = vi
      .fn()
      .mockResolvedValueOnce([[monitorRow], []])
      .mockResolvedValue([[], []]);
    await expect(
      deleteMonitor(connection(deleted), 'member-id', 'monitor-id', 1),
    ).resolves.toBeUndefined();
    expect(deleted).toHaveBeenLastCalledWith(expect.stringContaining('DELETE FROM monitors'), [
      'monitor-id',
      'member-id',
      1,
    ]);
  });
});
