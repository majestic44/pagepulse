import { describe, expect, it, vi } from 'vitest';

import {
  listExpiredSnapshots,
  purgeExpiredChecks,
  recordFailedCheck,
  recordSuccessfulCheck,
  removeExpiredSnapshotRecord,
} from './check-outcomes.js';

const now = new Date('2026-08-25T12:00:00.000Z');

function pool(query: ReturnType<typeof vi.fn>) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    query,
    release: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  return {
    connection,
    pool: { getConnection: vi.fn().mockResolvedValue(connection) },
  };
}

describe('check outcome persistence', () => {
  it('records a successful check and private snapshot in one MariaDB transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    const fixture = pool(query);

    await expect(
      recordSuccessfulCheck(fixture.pool, {
        checkId: 'check-1',
        completedAt: now,
        contentHash: 'a'.repeat(64),
        correlationId: 'correlation-1',
        expiresAt: new Date('2026-09-24T12:00:00.000Z'),
        monitorId: 'monitor-1',
        monitorRevision: 2,
        snapshot: {
          byteSize: 14,
          checksum: 'b'.repeat(64),
          expiresAt: new Date('2026-09-01T12:00:00.000Z'),
          id: 'snapshot-1',
          mediaType: 'application/json',
          storageKey: 'monitor-1/snapshot-1.json',
        },
        startedAt: new Date('2026-08-25T11:59:00.000Z'),
      }),
    ).resolves.toEqual({ recorded: true, reviewCreated: false });

    expect(fixture.connection.beginTransaction).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("'succeeded'"),
      expect.arrayContaining(['check-1', 'monitor-1', 'correlation-1']),
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("'yes'"),
      expect.arrayContaining(['snapshot-1', 'check-1', 'monitor-1']),
    );
  });

  it('does not overwrite a previously recorded check on a retried job', async () => {
    const query = vi.fn().mockResolvedValueOnce([[{ id: 'check-1' }], []]);
    const fixture = pool(query);

    await expect(
      recordFailedCheck(fixture.pool, {
        checkId: 'check-1',
        completedAt: now,
        correlationId: 'correlation-1',
        expiresAt: new Date('2026-09-24T12:00:00.000Z'),
        failureCode: 'fetch_failed',
        monitorId: 'monitor-1',
        monitorRevision: 1,
        startedAt: now,
      }),
    ).resolves.toEqual({ recorded: false });
    expect(query).toHaveBeenCalledOnce();
  });

  it('selects snapshots and checks for bounded expiry cleanup', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 'snapshot-1', storageKey: 'monitor-1/snapshot-1.json' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 2 }, []]);
    const connection = { query } as Parameters<typeof listExpiredSnapshots>[0];

    await expect(listExpiredSnapshots(connection, now, 10)).resolves.toEqual([
      { id: 'snapshot-1', storageKey: 'monitor-1/snapshot-1.json' },
    ]);
    await expect(removeExpiredSnapshotRecord(connection, 'snapshot-1', now)).resolves.toBe(1);
    await expect(purgeExpiredChecks(connection, now, 20)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT 10'), [now]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT 20'), [now]);
  });
});
