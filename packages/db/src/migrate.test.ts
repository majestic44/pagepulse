import type { Connection } from 'mysql2/promise';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  currentSchemaCompatibility,
  MIGRATION_LOCK_NAME,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  isMigrationEntrypoint,
  withMigrationLock,
} from './migrate.js';

describe('current schema compatibility', () => {
  it('records the monitor target configuration migration', () => {
    expect(currentSchemaCompatibility).toEqual({
      migrationId: 'monitor-target-configuration',
      minimumAppVersion: '0.0.0',
      schemaVersion: 10,
    });
  });
});

function createConnection(acquired: number | null) {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[{ acquired }], []])
    .mockResolvedValue([[], []]);
  return { connection: { query } as unknown as Connection, query };
}

describe('withMigrationLock', () => {
  it('acquires and releases the MariaDB advisory lock around migrations', async () => {
    const { connection, query } = createConnection(1);
    const operation = vi.fn().mockResolvedValue('migrated');

    await expect(withMigrationLock(connection, operation)).resolves.toBe('migrated');

    expect(query).toHaveBeenNthCalledWith(1, 'SELECT GET_LOCK(?, ?) AS acquired', [
      MIGRATION_LOCK_NAME,
      MIGRATION_LOCK_TIMEOUT_SECONDS,
    ]);
    expect(operation).toHaveBeenCalledOnce();
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?) AS released', [
      MIGRATION_LOCK_NAME,
    ]);
  });

  it('releases the advisory lock when a migration fails', async () => {
    const { connection, query } = createConnection(1);

    await expect(
      withMigrationLock(connection, () => Promise.reject(new Error('migration failed'))),
    ).rejects.toThrow('migration failed');

    expect(query).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?) AS released', [
      MIGRATION_LOCK_NAME,
    ]);
  });

  it('does not run migrations when the advisory lock is unavailable', async () => {
    const { connection, query } = createConnection(0);
    const operation = vi.fn().mockResolvedValue(undefined);

    await expect(withMigrationLock(connection, operation)).rejects.toThrow(
      `Could not acquire MariaDB migration lock ${MIGRATION_LOCK_NAME}`,
    );

    expect(operation).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('isMigrationEntrypoint', () => {
  it('recognizes a relative migration script path', () => {
    const moduleUrl = import.meta.url.replace(/\.test\.([cm]?[jt]s)$/, '.$1');
    const entrypoint = relative(process.cwd(), fileURLToPath(moduleUrl));

    expect(isMigrationEntrypoint(entrypoint, moduleUrl)).toBe(true);
  });
});
