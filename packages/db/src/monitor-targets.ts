import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  normalizeMonitorTargetConfiguration,
  MonitorTargetValidationError,
  type MonitorTargetConfiguration,
  type NormalizedMonitorTargetConfiguration,
} from '@pagepulse/monitor-engine';

import {
  MonitorNotFoundError,
  MonitorRevisionConflictError,
  type Monitor,
  type MonitorPool,
} from './monitors.js';

type MonitorTargetConnection = Pick<PoolConnection, 'query'>;

export type MonitorTarget = NormalizedMonitorTargetConfiguration;

export type MonitorTargetWithMonitor = Readonly<{
  monitor: Monitor;
  target: MonitorTarget;
}>;

export { MonitorTargetValidationError, type MonitorTargetConfiguration };

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Monitor target data is invalid: ${key}`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Monitor target data is invalid: ${key}`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Monitor target data is invalid: ${key}`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  return readString(record, key);
}

function asUnknownArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? (value as unknown[]) : undefined;
}

function asStringArray(
  value: ReadonlyArray<unknown> | undefined,
): ReadonlyArray<string> | undefined {
  return value?.every((entry) => typeof entry === 'string') ? value : undefined;
}

function readIgnoreSelectors(record: Record<string, unknown>): ReadonlyArray<string> {
  const value = record.ignoreSelectors;
  if (value === null) {
    return [];
  }
  const array = asStringArray(asUnknownArray(value));
  if (array) {
    return array;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      const parsedArray = asStringArray(asUnknownArray(parsed));
      if (parsedArray) {
        return parsedArray;
      }
    } catch {
      // Fall through to the invalid database-data error below.
    }
  }
  throw new Error('Monitor target data is invalid: ignoreSelectors');
}

function readMonitor(row: RowDataPacket): Monitor {
  const record = asRecord(row);
  const state = readString(record, 'state');
  if (
    state !== 'active' &&
    state !== 'authentication_required' &&
    state !== 'blocked' &&
    state !== 'paused'
  ) {
    throw new Error('Monitor target data is invalid: state');
  }
  return {
    createdAt: readDate(record, 'createdAt'),
    id: readString(record, 'id'),
    name: readString(record, 'name'),
    revision: readInteger(record, 'revision'),
    state,
    url: readString(record, 'url'),
  };
}

function readTarget(row: RowDataPacket): MonitorTarget {
  const record = asRecord(row);
  const selector = readNullableString(record, 'selector');
  const itemSelector = readNullableString(record, 'itemSelector');
  const identitySelector = readNullableString(record, 'identitySelector');
  const ignoreSelectors = readIgnoreSelectors(record);
  if (itemSelector === null && identitySelector === null && ignoreSelectors.length === 0) {
    return normalizeMonitorTargetConfiguration({
      ...(selector === null ? {} : { selector }),
      targetType: readString(record, 'targetType') as MonitorTarget['targetType'],
    });
  }
  if (itemSelector === null || identitySelector === null) {
    throw new Error('Monitor target data is invalid: repeated list configuration');
  }
  return normalizeMonitorTargetConfiguration({
    repeatedList: { identitySelector, ignoreSelectors, itemSelector },
    ...(selector === null ? {} : { selector }),
    targetType: readString(record, 'targetType') as MonitorTarget['targetType'],
  });
}

function validateIdentifier(value: string, field: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/u.test(value)) {
    throw new MonitorTargetValidationError(`${field} is invalid`);
  }
}

function validateRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MonitorTargetValidationError('revision is invalid');
  }
}

async function findOwnedMonitor(
  connection: MonitorTargetConnection,
  ownerId: string,
  monitorId: string,
  forUpdate: boolean,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, name, url, state, revision, created_at AS createdAt
     FROM monitors
     WHERE id = ? AND owner_id = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [monitorId, ownerId],
  );
  const row = rows[0];
  if (!row) {
    throw new MonitorNotFoundError();
  }
  return readMonitor(row);
}

function requireRevision(monitor: Monitor, expectedRevision: number) {
  validateRevision(expectedRevision);
  if (monitor.revision !== expectedRevision) {
    throw new MonitorRevisionConflictError();
  }
}

export async function getMonitorTarget(
  connection: MonitorTargetConnection,
  ownerId: string,
  monitorId: string,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, false);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT target_type AS targetType, selector, item_selector AS itemSelector,
            identity_selector AS identitySelector, ignore_selectors AS ignoreSelectors
     FROM monitor_targets
     WHERE monitor_id = ?
     LIMIT 1`,
    [monitorId],
  );
  return {
    monitor,
    target: rows[0]
      ? readTarget(rows[0])
      : { repeatedList: null, selector: null, targetType: 'whole_page' },
  } satisfies MonitorTargetWithMonitor;
}

export async function upsertOwnedMonitorTarget(
  connection: MonitorTargetConnection,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
  configuration: MonitorTargetConfiguration,
): Promise<MonitorTargetWithMonitor> {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const target = normalizeMonitorTargetConfiguration(configuration);
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, true);
  requireRevision(monitor, expectedRevision);
  const revision = monitor.revision + 1;
  await connection.query(
    'UPDATE monitors SET revision = ? WHERE id = ? AND owner_id = ? AND revision = ?',
    [revision, monitorId, ownerId, monitor.revision],
  );
  await connection.query('UPDATE monitor_schedules SET monitor_revision = ? WHERE monitor_id = ?', [
    revision,
    monitorId,
  ]);
  await connection.query(
    `INSERT INTO monitor_targets (
       monitor_id, target_type, selector, item_selector, identity_selector, ignore_selectors
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE target_type = VALUES(target_type), selector = VALUES(selector),
                             item_selector = VALUES(item_selector),
                             identity_selector = VALUES(identity_selector),
                             ignore_selectors = VALUES(ignore_selectors),
                             updated_at = CURRENT_TIMESTAMP`,
    [
      monitorId,
      target.targetType,
      target.selector,
      target.repeatedList?.itemSelector ?? null,
      target.repeatedList?.identitySelector ?? null,
      target.repeatedList ? JSON.stringify(target.repeatedList.ignoreSelectors) : null,
    ],
  );
  return { monitor: { ...monitor, revision }, target };
}

export type MonitorTargetPool = MonitorPool;
