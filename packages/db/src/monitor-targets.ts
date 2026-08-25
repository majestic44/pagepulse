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
  return normalizeMonitorTargetConfiguration({
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
    `SELECT target_type AS targetType, selector
     FROM monitor_targets
     WHERE monitor_id = ?
     LIMIT 1`,
    [monitorId],
  );
  return {
    monitor,
    target: rows[0] ? readTarget(rows[0]) : { selector: null, targetType: 'whole_page' },
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
    `INSERT INTO monitor_targets (monitor_id, target_type, selector)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE target_type = VALUES(target_type), selector = VALUES(selector),
                             updated_at = CURRENT_TIMESTAMP`,
    [monitorId, target.targetType, target.selector],
  );
  return { monitor: { ...monitor, revision }, target };
}

export type MonitorTargetPool = MonitorPool;
