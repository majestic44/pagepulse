import { randomUUID } from 'node:crypto';

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { AuditActions, recordAuditEvent } from './audit.js';
import { revokeSessionsForUser } from './sessions.js';

type AccountDeletionConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type AccountDeletionPool = Pick<Pool, 'getConnection'>;

export type AccountDeletionRequest = Readonly<{
  deadline: Date;
  recoveryTokenHash: string;
  requestedAt: Date;
}>;

export class AccountDeletionStateError extends Error {
  constructor(message: string) {
    super(`The account deletion action cannot complete: ${message}`);
    this.name = 'AccountDeletionStateError';
  }
}

export class AccountDeletionTokenError extends Error {
  constructor() {
    super('The account deletion recovery token is invalid or expired');
    this.name = 'AccountDeletionTokenError';
  }
}

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AccountDeletionStateError(`${key} is invalid`);
  }
  return value;
}

function readNullableDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  return readDate(record, key);
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AccountDeletionStateError(`${key} is invalid`);
  }
  return value;
}

function requireMemberDeletingState(record: Record<string, unknown>, now: Date) {
  if (
    readString(record, 'role') !== 'member' ||
    readString(record, 'status') !== 'deleting' ||
    !readNullableDate(record, 'deletionRequestedAt') ||
    !readNullableDate(record, 'deletionDeadline') ||
    readDate(record, 'deletionDeadline').getTime() <= now.getTime()
  ) {
    throw new AccountDeletionTokenError();
  }
}

export async function withAccountDeletionTransaction<T>(
  pool: AccountDeletionPool,
  operation: (connection: AccountDeletionConnection) => Promise<T>,
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
        // Preserve the original account deletion failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function scheduleAccountDeletion(
  connection: Pick<AccountDeletionConnection, 'query'>,
  userId: string,
  request: AccountDeletionRequest,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT id, role, status FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
    [userId],
  );
  const row = rows[0];
  if (!row) {
    throw new AccountDeletionStateError('account no longer exists');
  }
  const record = asRecord(row);
  if (readString(record, 'role') !== 'member' || readString(record, 'status') !== 'active') {
    throw new AccountDeletionStateError('only an active member account can be deleted');
  }
  const id = readString(record, 'id');
  await connection.query(
    "UPDATE users SET status = 'deleting', deletion_requested_at = ?, deletion_deadline = ? WHERE id = ?",
    [request.requestedAt, request.deadline, id],
  );
  await revokeSessionsForUser(connection, id, request.requestedAt);
  await connection.query(
    "UPDATE account_tokens SET revoked_at = ? WHERE user_id = ? AND type = 'account_deletion_recovery' AND used_at IS NULL AND revoked_at IS NULL",
    [request.requestedAt, id],
  );
  await connection.query(
    `INSERT INTO account_tokens (id, user_id, type, token_hash, expires_at)
     VALUES (?, ?, 'account_deletion_recovery', ?, ?)`,
    [randomUUID(), id, request.recoveryTokenHash, request.deadline],
  );
}

export async function recoverAccountDeletion(
  connection: Pick<AccountDeletionConnection, 'query'>,
  recoveryTokenHash: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT account_tokens.id AS tokenId, account_tokens.expires_at AS expiresAt,
      account_tokens.used_at AS usedAt, account_tokens.revoked_at AS revokedAt,
      users.id AS userId, users.role, users.status,
      users.deletion_requested_at AS deletionRequestedAt, users.deletion_deadline AS deletionDeadline
     FROM account_tokens
     INNER JOIN users ON users.id = account_tokens.user_id
     WHERE account_tokens.token_hash = ? AND account_tokens.type = 'account_deletion_recovery'
     LIMIT 1 FOR UPDATE`,
    [recoveryTokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AccountDeletionTokenError();
  }
  const record = asRecord(row);
  if (
    readNullableDate(record, 'usedAt') ||
    readNullableDate(record, 'revokedAt') ||
    readDate(record, 'expiresAt').getTime() <= now.getTime()
  ) {
    throw new AccountDeletionTokenError();
  }
  requireMemberDeletingState(record, now);
  await connection.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [
    now,
    readString(record, 'tokenId'),
  ]);
  await connection.query(
    "UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_deadline = NULL WHERE id = ?",
    [readString(record, 'userId')],
  );
  return readString(record, 'userId');
}

export async function purgeExpiredAccountDeletions(
  connection: Pick<AccountDeletionConnection, 'query'>,
  now = new Date(),
  limit = 100,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new AccountDeletionStateError('purge limit is invalid');
  }
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id FROM users
     WHERE role = 'member' AND status = 'deleting' AND deletion_deadline <= ?
     ORDER BY deletion_deadline ASC, id ASC
     LIMIT ${limit} FOR UPDATE`,
    [now],
  );
  let deleted = 0;
  for (const row of rows) {
    const id = readString(asRecord(row), 'id');
    await revokeSessionsForUser(connection, id, now);
    const [result] = await connection.query(
      "DELETE FROM users WHERE id = ? AND role = 'member' AND status = 'deleting' AND deletion_deadline <= ?",
      [id, now],
    );
    if ('affectedRows' in result && result.affectedRows === 1) {
      await recordAuditEvent(connection, {
        action: AuditActions.accountDeletionCompleted,
        createdAt: now,
        targetId: id,
        targetType: 'account',
      });
      deleted += 1;
    }
  }
  return deleted;
}
