import { randomUUID } from 'node:crypto';

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { AuthenticationStateError, AuthenticationTokenError } from './auth.js';
import { revokeSessionsForUser } from './sessions.js';

type TotpConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type TotpPool = Pick<Pool, 'getConnection'>;

export type TotpMethod = Readonly<{
  encryptedSecret: string;
  lastVerifiedTimeStep: number | undefined;
  userId: string;
}>;

export type PendingTotpEnrollment = Readonly<{
  encryptedSecret: string;
  expiresAt: Date;
}>;

export type TotpLoginChallenge = Readonly<{
  email: string;
  role: 'member' | 'owner';
  userId: string;
}>;

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`TOTP data is invalid: ${key}`);
  }
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`TOTP data is invalid: ${key}`);
  }
  return value;
}

function readNullableTimeStep(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return undefined;
  }
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`TOTP data is invalid: ${key}`);
  }
  return parsed;
}

function readRole(record: Record<string, unknown>): 'member' | 'owner' {
  const role = readString(record, 'role');
  if (role !== 'owner' && role !== 'member') {
    throw new Error('TOTP data is invalid: role');
  }
  return role;
}

function affectedRows(result: unknown) {
  return result && typeof result === 'object' && 'affectedRows' in result
    ? Number(result.affectedRows)
    : 0;
}

export async function withTotpTransaction<T>(
  pool: TotpPool,
  operation: (connection: TotpConnection) => Promise<T>,
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
        // Keep the original TOTP operation failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function hasTotpMethod(connection: Pick<TotpConnection, 'query'>, userId: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT 1 FROM totp_methods WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows.length > 0;
}

export async function createTotpLoginChallenge(
  connection: Pick<TotpConnection, 'query'>,
  input: Readonly<{ expiresAt: Date; tokenHash: string; userId: string }>,
  now = new Date(),
) {
  await connection.query(
    'UPDATE totp_login_challenges SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL',
    [now, input.userId],
  );
  await connection.query(
    'INSERT INTO totp_login_challenges (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [randomUUID(), input.userId, input.tokenHash, input.expiresAt],
  );
}

export async function findTotpLoginChallengeForUpdate(
  connection: Pick<TotpConnection, 'query'>,
  tokenHash: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT totp_login_challenges.id AS challengeId, users.id AS userId, users.email, users.role,
      users.status, users.email_verified_at AS emailVerifiedAt,
      totp_login_challenges.expires_at AS expiresAt, totp_login_challenges.used_at AS usedAt,
      totp_login_challenges.revoked_at AS revokedAt
     FROM totp_login_challenges
     INNER JOIN users ON users.id = totp_login_challenges.user_id
     WHERE totp_login_challenges.token_hash = ?
     LIMIT 1 FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  if (
    readDate(record, 'expiresAt').getTime() <= now.getTime() ||
    record.usedAt !== null ||
    record.revokedAt !== null
  ) {
    throw new AuthenticationTokenError();
  }
  if (readString(record, 'status') !== 'active' || record.emailVerifiedAt === null) {
    throw new AuthenticationStateError('account is not eligible for TOTP authentication');
  }
  return {
    challengeId: readString(record, 'challengeId'),
    email: readString(record, 'email'),
    role: readRole(record),
    userId: readString(record, 'userId'),
  };
}

export async function consumeTotpLoginChallenge(
  connection: Pick<TotpConnection, 'query'>,
  challengeId: string,
  now = new Date(),
) {
  await connection.query(
    'UPDATE totp_login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
    [now, challengeId],
  );
}

export async function beginTotpEnrollment(
  connection: Pick<TotpConnection, 'query'>,
  input: Readonly<{ encryptedSecret: string; expiresAt: Date; userId: string }>,
  now = new Date(),
) {
  await connection.query(
    `INSERT INTO totp_enrollments (user_id, secret_ciphertext, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE secret_ciphertext = VALUES(secret_ciphertext), expires_at = VALUES(expires_at), created_at = VALUES(created_at)`,
    [input.userId, input.encryptedSecret, input.expiresAt, now],
  );
}

export async function findTotpEnrollmentForUpdate(
  connection: Pick<TotpConnection, 'query'>,
  userId: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT secret_ciphertext AS encryptedSecret, expires_at AS expiresAt
     FROM totp_enrollments WHERE user_id = ? LIMIT 1 FOR UPDATE`,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  const expiresAt = readDate(record, 'expiresAt');
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AuthenticationTokenError();
  }
  return {
    encryptedSecret: readString(record, 'encryptedSecret'),
    expiresAt,
  } as PendingTotpEnrollment;
}

export async function findTotpMethodForUpdate(
  connection: Pick<TotpConnection, 'query'>,
  userId: string,
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT user_id AS userId, secret_ciphertext AS encryptedSecret,
      last_verified_time_step AS lastVerifiedTimeStep
     FROM totp_methods WHERE user_id = ? LIMIT 1 FOR UPDATE`,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  return {
    encryptedSecret: readString(record, 'encryptedSecret'),
    lastVerifiedTimeStep: readNullableTimeStep(record, 'lastVerifiedTimeStep'),
    userId: readString(record, 'userId'),
  } as TotpMethod;
}

export async function recordTotpTimeStep(
  connection: Pick<TotpConnection, 'query'>,
  userId: string,
  timeStep: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(timeStep) || timeStep < 0) {
    throw new Error('TOTP time step is invalid');
  }
  await connection.query(
    'UPDATE totp_methods SET last_verified_time_step = ?, updated_at = ? WHERE user_id = ?',
    [timeStep, now, userId],
  );
}

export async function consumeTotpRecoveryCode(
  connection: Pick<TotpConnection, 'query'>,
  userId: string,
  codeHash: string,
  now = new Date(),
) {
  const [result] = await connection.query(
    'UPDATE totp_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
    [now, userId, codeHash],
  );
  return affectedRows(result) === 1;
}

export async function enableTotpMethod(
  connection: Pick<TotpConnection, 'query'>,
  input: Readonly<{
    encryptedSecret: string;
    initialVerifiedTimeStep: number;
    recoveryCodeHashes: ReadonlyArray<string>;
    userId: string;
  }>,
  currentSessionId: string,
  now = new Date(),
) {
  await connection.query(
    `INSERT INTO totp_methods (user_id, secret_ciphertext, last_verified_time_step, enabled_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE secret_ciphertext = VALUES(secret_ciphertext), last_verified_time_step = VALUES(last_verified_time_step),
       enabled_at = VALUES(enabled_at), updated_at = VALUES(updated_at)`,
    [input.userId, input.encryptedSecret, input.initialVerifiedTimeStep, now, now],
  );
  await connection.query('DELETE FROM totp_recovery_codes WHERE user_id = ?', [input.userId]);
  for (const codeHash of input.recoveryCodeHashes) {
    await connection.query(
      'INSERT INTO totp_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)',
      [randomUUID(), input.userId, codeHash],
    );
  }
  await connection.query('DELETE FROM totp_enrollments WHERE user_id = ?', [input.userId]);
  await revokeSessionsForUser(connection, input.userId, now, currentSessionId);
}

export async function replaceTotpRecoveryCodes(
  connection: Pick<TotpConnection, 'query'>,
  input: Readonly<{ recoveryCodeHashes: ReadonlyArray<string>; userId: string }>,
) {
  await connection.query('DELETE FROM totp_recovery_codes WHERE user_id = ?', [input.userId]);
  for (const codeHash of input.recoveryCodeHashes) {
    await connection.query(
      'INSERT INTO totp_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)',
      [randomUUID(), input.userId, codeHash],
    );
  }
}

export async function disableTotpMethod(
  connection: Pick<TotpConnection, 'query'>,
  userId: string,
  currentSessionId: string,
  now = new Date(),
) {
  await connection.query('DELETE FROM totp_methods WHERE user_id = ?', [userId]);
  await connection.query('DELETE FROM totp_recovery_codes WHERE user_id = ?', [userId]);
  await connection.query('DELETE FROM totp_enrollments WHERE user_id = ?', [userId]);
  await revokeSessionsForUser(connection, userId, now, currentSessionId);
}
