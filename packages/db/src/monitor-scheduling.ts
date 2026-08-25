import { randomUUID } from 'node:crypto';

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import {
  MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS,
  MonitorScheduleValidationError,
  normalizeMonitorScheduleConfiguration,
  type MonitorSchedule,
  type MonitorScheduleConfiguration,
} from './schedules.js';
import {
  MonitorNotFoundError,
  MonitorRevisionConflictError,
  type Monitor,
  type MonitorPool,
} from './monitors.js';

type MonitorScheduleConnection = Pick<PoolConnection, 'query'>;

export type MonitorScheduleWithMonitor = Readonly<{
  monitor: Monitor;
  schedule: MonitorSchedule;
}>;

export class MonitorScheduleNotFoundError extends Error {
  constructor() {
    super('The monitor does not have a schedule');
    this.name = 'MonitorScheduleNotFoundError';
  }
}

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Monitor scheduling data is invalid: ${key}`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new Error(`Monitor scheduling data is invalid: ${key}`);
  }
  return value;
}

function readNullableInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  return readInteger(record, key);
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Monitor scheduling data is invalid: ${key}`);
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
    throw new Error('Monitor scheduling data is invalid: state');
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

function readSchedule(row: RowDataPacket): MonitorSchedule {
  const record = asRecord(row);
  const customIntervalMinutes = readNullableInteger(record, 'customIntervalMinutes');
  const dailyTime = readNullableString(record, 'dailyTime');
  const hourlyMinute = readNullableInteger(record, 'hourlyMinute');
  const normalized = normalizeMonitorScheduleConfiguration({
    ...(customIntervalMinutes === null ? {} : { customIntervalMinutes }),
    ...(dailyTime === null ? {} : { dailyTime }),
    ...(hourlyMinute === null ? {} : { hourlyMinute }),
    scheduleType: readString(record, 'scheduleType') as MonitorSchedule['scheduleType'],
    timeZone: readString(record, 'timeZone'),
  });
  return {
    correlationId: readString(record, 'correlationId'),
    ...normalized,
    monitorId: readString(record, 'monitorId'),
    monitorRevision: readInteger(record, 'monitorRevision'),
  };
}

function validateIdentifier(value: string, field: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/u.test(value)) {
    throw new MonitorScheduleValidationError(`${field} is invalid`);
  }
}

function validateRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MonitorScheduleValidationError('revision is invalid');
  }
}

async function findOwnedMonitor(
  connection: MonitorScheduleConnection,
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

function storageIntervalMilliseconds(schedule: MonitorSchedule) {
  if (schedule.scheduleType === 'custom') {
    return schedule.customIntervalMinutes! * 60_000;
  }
  return schedule.scheduleType === 'daily'
    ? MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS * 24
    : MINIMUM_MONITOR_SCHEDULE_INTERVAL_MS;
}

export async function getMonitorSchedule(
  connection: MonitorScheduleConnection,
  ownerId: string,
  monitorId: string,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, false);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT monitor_id AS monitorId, monitor_revision AS monitorRevision,
            schedule_type AS scheduleType, time_zone AS timeZone,
            hourly_minute AS hourlyMinute, daily_time AS dailyTime,
            custom_interval_minutes AS customIntervalMinutes, correlation_id AS correlationId
     FROM monitor_schedules
     WHERE monitor_id = ?
     LIMIT 1`,
    [monitorId],
  );
  return { monitor, schedule: rows[0] ? readSchedule(rows[0]) : null };
}

export async function upsertOwnedMonitorSchedule(
  connection: MonitorScheduleConnection,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
  configuration: MonitorScheduleConfiguration,
): Promise<MonitorScheduleWithMonitor> {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const normalized = normalizeMonitorScheduleConfiguration(configuration);
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, true);
  requireRevision(monitor, expectedRevision);
  const revision = monitor.revision + 1;
  const correlationId = randomUUID();
  const schedule: MonitorSchedule = {
    correlationId,
    ...normalized,
    monitorId,
    monitorRevision: revision,
  };

  await connection.query(
    'UPDATE monitors SET revision = ? WHERE id = ? AND owner_id = ? AND revision = ?',
    [revision, monitorId, ownerId, monitor.revision],
  );
  await connection.query(
    `INSERT INTO monitor_schedules
       (monitor_id, monitor_revision, interval_ms, schedule_type, time_zone, hourly_minute,
        daily_time, custom_interval_minutes, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       monitor_revision = VALUES(monitor_revision), interval_ms = VALUES(interval_ms),
       schedule_type = VALUES(schedule_type), time_zone = VALUES(time_zone),
       hourly_minute = VALUES(hourly_minute), daily_time = VALUES(daily_time),
       custom_interval_minutes = VALUES(custom_interval_minutes), correlation_id = VALUES(correlation_id)`,
    [
      schedule.monitorId,
      schedule.monitorRevision,
      storageIntervalMilliseconds(schedule),
      schedule.scheduleType,
      schedule.timeZone,
      schedule.hourlyMinute,
      schedule.dailyTime,
      schedule.customIntervalMinutes,
      schedule.correlationId,
    ],
  );
  return { monitor: { ...monitor, revision }, schedule };
}

export async function deleteOwnedMonitorSchedule(
  connection: MonitorScheduleConnection,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findOwnedMonitor(connection, ownerId, monitorId, true);
  requireRevision(monitor, expectedRevision);
  const [result] = await connection.query<ResultSetHeader>(
    'DELETE FROM monitor_schedules WHERE monitor_id = ?',
    [monitorId],
  );
  if (result.affectedRows !== 1) {
    throw new MonitorScheduleNotFoundError();
  }
  const revision = monitor.revision + 1;
  await connection.query(
    'UPDATE monitors SET revision = ? WHERE id = ? AND owner_id = ? AND revision = ?',
    [revision, monitorId, ownerId, monitor.revision],
  );
  return { ...monitor, revision };
}

export type MonitorSchedulePool = MonitorPool;
