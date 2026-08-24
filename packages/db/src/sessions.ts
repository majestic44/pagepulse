import { randomUUID } from 'node:crypto';

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type SessionConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type SessionPool = Pick<Pool, 'getConnection'>;

export type ActiveSession = Readonly<{
  absoluteExpiresAt: Date;
  createdAt: Date;
  deviceLabel: string;
  email: string;
  id: string;
  idleExpiresAt: Date;
  lastUsedAt: Date;
  role: 'member' | 'owner';
  userId: string;
}>;

export type CreateSession = Readonly<{
  absoluteExpiresAt: Date;
  deviceLabel: string;
  idleExpiresAt: Date;
  tokenHash: string;
  userId: string;
}>;

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Session data is invalid: ${key}`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Session data is invalid: ${key}`);
  }
  return value;
}

function toActiveSession(row: RowDataPacket): ActiveSession {
  const record = asRecord(row);
  const role = readString(record, 'role');
  if (role !== 'owner' && role !== 'member') {
    throw new Error('Session data is invalid: role');
  }
  return {
    absoluteExpiresAt: readDate(record, 'absoluteExpiresAt'),
    createdAt: readDate(record, 'createdAt'),
    deviceLabel: readString(record, 'deviceLabel'),
    email: readString(record, 'email'),
    id: readString(record, 'id'),
    idleExpiresAt: readDate(record, 'idleExpiresAt'),
    lastUsedAt: readDate(record, 'lastUsedAt'),
    role,
    userId: readString(record, 'userId'),
  };
}

export async function withSessionTransaction<T>(
  pool: SessionPool,
  operation: (connection: SessionConnection) => Promise<T>,
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
        // Preserve the original session operation failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function createSession(
  connection: SessionConnection,
  input: CreateSession,
  now = new Date(),
  previousTokenHash?: string,
) {
  if (previousTokenHash) {
    await connection.query(
      'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [now, previousTokenHash],
    );
  }
  const id = randomUUID();
  await connection.query(
    `INSERT INTO sessions
      (id, user_id, token_hash, device_label, last_used_at, idle_expires_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.tokenHash,
      input.deviceLabel,
      now,
      input.idleExpiresAt,
      input.absoluteExpiresAt,
    ],
  );
  return id;
}

export async function findActiveSession(
  connection: SessionConnection,
  tokenHash: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT sessions.id, sessions.user_id AS userId, sessions.device_label AS deviceLabel,
      sessions.created_at AS createdAt, sessions.last_used_at AS lastUsedAt,
      sessions.idle_expires_at AS idleExpiresAt, sessions.absolute_expires_at AS absoluteExpiresAt,
      users.email, users.role, users.status, users.email_verified_at AS emailVerifiedAt
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
       AND sessions.idle_expires_at > ? AND sessions.absolute_expires_at > ?
     LIMIT 1 FOR UPDATE`,
    [tokenHash, now, now],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const record = asRecord(row);
  if (readString(record, 'status') !== 'active' || record.emailVerifiedAt === null) {
    await connection.query(
      'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [now, readString(record, 'id')],
    );
    return undefined;
  }
  return toActiveSession(row);
}

export async function touchSession(
  connection: SessionConnection,
  session: ActiveSession,
  idleExpiresAt: Date,
  now = new Date(),
) {
  await connection.query(
    `UPDATE sessions SET last_used_at = ?, idle_expires_at = ?
     WHERE id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?`,
    [now, idleExpiresAt, session.id, now, now],
  );
  return { ...session, idleExpiresAt, lastUsedAt: now };
}

export async function listActiveSessions(
  connection: SessionConnection,
  userId: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT sessions.id, sessions.user_id AS userId, sessions.device_label AS deviceLabel,
      sessions.created_at AS createdAt, sessions.last_used_at AS lastUsedAt,
      sessions.idle_expires_at AS idleExpiresAt, sessions.absolute_expires_at AS absoluteExpiresAt,
      users.email, users.role
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.user_id = ? AND sessions.revoked_at IS NULL
       AND sessions.idle_expires_at > ? AND sessions.absolute_expires_at > ?
     ORDER BY sessions.last_used_at DESC, sessions.id ASC`,
    [userId, now, now],
  );
  return rows.map(toActiveSession);
}

export async function revokeSession(
  connection: SessionConnection,
  userId: string,
  sessionId: string,
  now = new Date(),
) {
  const [result] = await connection.query(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [now, sessionId, userId],
  );
  return 'affectedRows' in result && result.affectedRows === 1;
}

export async function revokeSessionsForUser(
  connection: Pick<SessionConnection, 'query'>,
  userId: string,
  now = new Date(),
  exceptSessionId?: string,
) {
  if (exceptSessionId) {
    await connection.query(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [now, userId, exceptSessionId],
    );
    return;
  }
  await connection.query(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [now, userId],
  );
}

export async function revokeSessionByTokenHash(
  connection: SessionConnection,
  tokenHash: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, user_id AS userId
     FROM sessions
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1 FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const record = asRecord(row);
  const session = { id: readString(record, 'id'), userId: readString(record, 'userId') };
  await connection.query('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
    now,
    session.id,
  ]);
  return session;
}
