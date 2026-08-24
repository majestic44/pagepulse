import { randomUUID } from 'node:crypto';

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type MonitorConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type MonitorPool = Pick<Pool, 'getConnection'>;

export type MonitorState = 'active' | 'authentication_required' | 'blocked' | 'paused';

export type Monitor = Readonly<{
  createdAt: Date;
  id: string;
  name: string;
  revision: number;
  state: MonitorState;
  url: string;
}>;

export type MonitorConfiguration = Readonly<{
  name: string;
  url: string;
}>;

export class MonitorAccessError extends Error {
  constructor() {
    super('The account cannot manage monitors');
    this.name = 'MonitorAccessError';
  }
}

export class MonitorInputError extends Error {
  constructor(message: string) {
    super(`Monitor configuration is invalid: ${message}`);
    this.name = 'MonitorInputError';
  }
}

export class MonitorLimitError extends Error {
  constructor() {
    super('The monitor limit has been reached');
    this.name = 'MonitorLimitError';
  }
}

export class MonitorNotFoundError extends Error {
  constructor() {
    super('The monitor does not exist');
    this.name = 'MonitorNotFoundError';
  }
}

export class MonitorRevisionConflictError extends Error {
  constructor() {
    super('The monitor has changed since it was loaded');
    this.name = 'MonitorRevisionConflictError';
  }
}

export class MonitorStateError extends Error {
  constructor(message: string) {
    super(`The monitor state cannot be changed: ${message}`);
    this.name = 'MonitorStateError';
  }
}

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Monitor data is invalid: ${key}`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Monitor data is invalid: ${key}`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Monitor data is invalid: ${key}`);
  }
  return value;
}

function readState(record: Record<string, unknown>, key: string): MonitorState {
  const value = readString(record, key);
  if (
    value !== 'active' &&
    value !== 'authentication_required' &&
    value !== 'blocked' &&
    value !== 'paused'
  ) {
    throw new Error(`Monitor data is invalid: ${key}`);
  }
  return value;
}

function validateIdentifier(value: string, field: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/u.test(value)) {
    throw new MonitorInputError(`${field} is invalid`);
  }
}

function validateRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MonitorInputError('revision is invalid');
  }
}

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function normalizeName(name: string) {
  if (typeof name !== 'string') {
    throw new MonitorInputError('name is invalid');
  }
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 160 || containsControlCharacter(normalized)) {
    throw new MonitorInputError('name is invalid');
  }
  return normalized;
}

function normalizeUrl(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new MonitorInputError('URL is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MonitorInputError('URL is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new MonitorInputError('URL is invalid');
  }
  const normalized = parsed.toString();
  if (normalized.length > 2_048) {
    throw new MonitorInputError('URL is invalid');
  }
  return normalized;
}

function validateConfiguration(configuration: MonitorConfiguration) {
  return {
    name: normalizeName(configuration.name),
    url: normalizeUrl(configuration.url),
  };
}

function toMonitor(row: RowDataPacket): Monitor {
  const record = asRecord(row);
  return {
    createdAt: readDate(record, 'createdAt'),
    id: readString(record, 'id'),
    name: readString(record, 'name'),
    revision: readInteger(record, 'revision'),
    state: readState(record, 'state'),
    url: readString(record, 'url'),
  };
}

async function findMonitorForUpdate(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, name, url, state, revision, created_at AS createdAt
     FROM monitors
     WHERE id = ? AND owner_id = ?
     LIMIT 1 FOR UPDATE`,
    [monitorId, ownerId],
  );
  const row = rows[0];
  if (!row) {
    throw new MonitorNotFoundError();
  }
  return toMonitor(row);
}

function requireRevision(monitor: Monitor, expectedRevision: number) {
  validateRevision(expectedRevision);
  if (monitor.revision !== expectedRevision) {
    throw new MonitorRevisionConflictError();
  }
}

export async function withMonitorTransaction<T>(
  pool: MonitorPool,
  operation: (connection: MonitorConnection) => Promise<T>,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    try {
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original monitor operation failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function listMonitors(connection: Pick<MonitorConnection, 'query'>, ownerId: string) {
  validateIdentifier(ownerId, 'ownerId');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, name, url, state, revision, created_at AS createdAt
     FROM monitors
     WHERE owner_id = ?
     ORDER BY created_at ASC, id ASC`,
    [ownerId],
  );
  return rows.map(toMonitor);
}

export async function createMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  configuration: MonitorConfiguration,
  now = new Date(),
) {
  validateIdentifier(ownerId, 'ownerId');
  const normalized = validateConfiguration(configuration);
  const [userRows] = await connection.query<RowDataPacket[]>(
    `SELECT id, monitor_limit AS monitorLimit
     FROM users
     WHERE id = ? AND status = 'active'
     LIMIT 1 FOR UPDATE`,
    [ownerId],
  );
  const user = userRows[0];
  if (!user) {
    throw new MonitorAccessError();
  }
  const monitorLimit = readInteger(asRecord(user), 'monitorLimit');
  const [countRows] = await connection.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS monitorCount FROM monitors WHERE owner_id = ?',
    [ownerId],
  );
  const count = countRows[0] ? readInteger(asRecord(countRows[0]), 'monitorCount') : 0;
  if (count >= monitorLimit) {
    throw new MonitorLimitError();
  }
  const monitor: Monitor = {
    createdAt: now,
    id: randomUUID(),
    name: normalized.name,
    revision: 1,
    state: 'active',
    url: normalized.url,
  };
  await connection.query(
    `INSERT INTO monitors (id, owner_id, name, url, state, revision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      monitor.id,
      ownerId,
      monitor.name,
      monitor.url,
      monitor.state,
      monitor.revision,
      monitor.createdAt,
    ],
  );
  return monitor;
}

export async function getMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, name, url, state, revision, created_at AS createdAt
     FROM monitors
     WHERE id = ? AND owner_id = ?
     LIMIT 1`,
    [monitorId, ownerId],
  );
  const row = rows[0];
  if (!row) {
    throw new MonitorNotFoundError();
  }
  return toMonitor(row);
}

export async function updateMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
  configuration: MonitorConfiguration,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const normalized = validateConfiguration(configuration);
  const monitor = await findMonitorForUpdate(connection, ownerId, monitorId);
  requireRevision(monitor, expectedRevision);
  const revision = monitor.revision + 1;
  await connection.query(
    `UPDATE monitors
     SET name = ?, url = ?, revision = ?
     WHERE id = ? AND owner_id = ? AND revision = ?`,
    [normalized.name, normalized.url, revision, monitor.id, ownerId, monitor.revision],
  );
  return { ...monitor, ...normalized, revision };
}

async function transitionMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
  from: MonitorState,
  to: MonitorState,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findMonitorForUpdate(connection, ownerId, monitorId);
  requireRevision(monitor, expectedRevision);
  if (monitor.state !== from) {
    throw new MonitorStateError(`only a ${from} monitor can transition to ${to}`);
  }
  const revision = monitor.revision + 1;
  await connection.query(
    `UPDATE monitors
     SET state = ?, revision = ?
     WHERE id = ? AND owner_id = ? AND revision = ?`,
    [to, revision, monitor.id, ownerId, monitor.revision],
  );
  return { ...monitor, revision, state: to };
}

export async function pauseMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
) {
  return transitionMonitor(connection, ownerId, monitorId, expectedRevision, 'active', 'paused');
}

export async function resumeMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
) {
  return transitionMonitor(connection, ownerId, monitorId, expectedRevision, 'paused', 'active');
}

export async function deleteMonitor(
  connection: Pick<MonitorConnection, 'query'>,
  ownerId: string,
  monitorId: string,
  expectedRevision: number,
) {
  validateIdentifier(ownerId, 'ownerId');
  validateIdentifier(monitorId, 'monitorId');
  const monitor = await findMonitorForUpdate(connection, ownerId, monitorId);
  requireRevision(monitor, expectedRevision);
  await connection.query('DELETE FROM monitors WHERE id = ? AND owner_id = ? AND revision = ?', [
    monitor.id,
    ownerId,
    monitor.revision,
  ]);
}
