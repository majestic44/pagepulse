import { randomUUID } from 'node:crypto';

import { normalizeEmail } from '@pagepulse/auth';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { revokeSessionsForUser } from './sessions.js';

export const AccountTokenTypes = Object.freeze({
  accountDeletionRecovery: 'account_deletion_recovery',
  emailVerification: 'email_verification',
  passwordReset: 'password_reset',
});

export type AccountTokenType = (typeof AccountTokenTypes)[keyof typeof AccountTokenTypes];

export class AuthenticationTokenError extends Error {
  constructor() {
    super('The authentication token is invalid or expired');
    this.name = 'AuthenticationTokenError';
  }
}

export class AuthenticationStateError extends Error {
  constructor(message: string) {
    super(`The account cannot complete this authentication action: ${message}`);
    this.name = 'AuthenticationStateError';
  }
}

export class AuthenticationDataError extends Error {
  constructor(message: string) {
    super(`Authentication data is invalid: ${message}`);
    this.name = 'AuthenticationDataError';
  }
}

type AuthConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type AuthPool = Pick<Pool, 'getConnection'>;

export type AuthenticationUser = Readonly<{
  email: string;
  emailVerified: boolean;
  id: string;
  passwordHash: string | null;
  role: 'member' | 'owner';
  status: 'active' | 'deleting' | 'invited' | 'suspended';
}>;

export type IssueAccountToken = Readonly<{
  expiresAt: Date;
  tokenHash: string;
  type: AccountTokenType;
}>;

export type RedeemAccountSetup = Readonly<{
  passwordHash: string;
  setupTokenHash: string;
  verificationToken: IssueAccountToken;
}>;

export type RedeemInvitation = Readonly<{
  invitationTokenHash: string;
  passwordHash: string;
  verificationToken: IssueAccountToken;
}>;

export type ResetPassword = Readonly<{
  passwordHash: string;
  resetTokenHash: string;
}>;

export type IssueEmailVerification = Readonly<{
  token: IssueAccountToken;
}>;

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthenticationDataError(`${key} is missing`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AuthenticationDataError(`${key} is invalid`);
  }
  return value;
}

function readNullableDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AuthenticationDataError(`${key} is invalid`);
  }
  return value;
}

function requireUsableToken(record: Record<string, unknown>, now: Date) {
  const expiresAt = readNullableDate(record, 'expiresAt');
  if (
    !expiresAt ||
    expiresAt.getTime() <= now.getTime() ||
    readNullableDate(record, 'usedAt') ||
    readNullableDate(record, 'revokedAt')
  ) {
    throw new AuthenticationTokenError();
  }
}

async function issueAccountToken(
  connection: AuthConnection,
  userId: string,
  token: IssueAccountToken,
  now: Date,
) {
  await connection.query(
    'UPDATE account_tokens SET revoked_at = ? WHERE user_id = ? AND type = ? AND used_at IS NULL AND revoked_at IS NULL',
    [now, userId, token.type],
  );
  await connection.query(
    'INSERT INTO account_tokens (id, user_id, type, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [randomUUID(), userId, token.type, token.tokenHash, token.expiresAt],
  );
}

export async function withAuthenticationTransaction<T>(
  pool: AuthPool,
  operation: (connection: AuthConnection) => Promise<T>,
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
        // Keep the original failure because it identifies the failed auth action.
      }
      throw toError(error, 'Authentication transaction failed');
    }
  } finally {
    connection.release();
  }
}

export async function redeemOwnerSetup(
  connection: AuthConnection,
  input: RedeemAccountSetup,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT owner_setup_tokens.id AS tokenId, owner_setup_tokens.expires_at AS expiresAt,
      owner_setup_tokens.used_at AS usedAt, owner_setup_tokens.revoked_at AS revokedAt,
      users.id AS userId, users.email AS email, users.status AS status
     FROM owner_setup_tokens
     INNER JOIN users ON users.id = owner_setup_tokens.owner_id
     WHERE owner_setup_tokens.token_hash = ? LIMIT 1 FOR UPDATE`,
    [input.setupTokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  requireUsableToken(record, now);
  if (readString(record, 'status') !== 'invited') {
    throw new AuthenticationStateError('owner setup has already completed');
  }
  const userId = readString(record, 'userId');
  await connection.query(
    'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
    [input.passwordHash, now, userId],
  );
  await connection.query('UPDATE owner_setup_tokens SET used_at = ? WHERE id = ?', [
    now,
    readString(record, 'tokenId'),
  ]);
  await issueAccountToken(connection, userId, input.verificationToken, now);
  return { email: normalizeEmail(readString(record, 'email')), userId };
}

export async function redeemInvitation(
  connection: AuthConnection,
  input: RedeemInvitation,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT invitations.id AS invitationId, invitations.email AS email, invitations.expires_at AS expiresAt,
      invitations.redeemed_at AS usedAt, invitations.revoked_at AS revokedAt
     FROM invitations WHERE invitations.token_hash = ? LIMIT 1 FOR UPDATE`,
    [input.invitationTokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  requireUsableToken(record, now);
  const email = normalizeEmail(readString(record, 'email'));
  const [existingUsers] = await connection.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
    [email],
  );
  if (existingUsers.length > 0) {
    throw new AuthenticationStateError('invitation email already has an account');
  }
  const userId = randomUUID();
  await connection.query(
    "INSERT INTO users (id, email, password_hash, password_changed_at, role, status) VALUES (?, ?, ?, ?, 'member', 'invited')",
    [userId, email, input.passwordHash, now],
  );
  await connection.query('UPDATE invitations SET redeemed_at = ? WHERE id = ?', [
    now,
    readString(record, 'invitationId'),
  ]);
  await issueAccountToken(connection, userId, input.verificationToken, now);
  return { email, userId };
}

export async function issueEmailVerification(
  connection: AuthConnection,
  email: string,
  input: IssueEmailVerification,
  now = new Date(),
) {
  const normalizedEmail = normalizeEmail(email);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, status, password_hash AS passwordHash, email_verified_at AS emailVerifiedAt
     FROM users WHERE email = ? LIMIT 1 FOR UPDATE`,
    [normalizedEmail],
  );
  const row = rows[0];
  if (!row) {
    return false;
  }
  const record = asRecord(row);
  if (
    readString(record, 'status') !== 'invited' ||
    readNullableDate(record, 'emailVerifiedAt') !== null ||
    readNullableString(record, 'passwordHash') === null
  ) {
    return false;
  }
  await issueAccountToken(connection, readString(record, 'id'), input.token, now);
  return true;
}

export async function verifyEmailAddress(
  connection: AuthConnection,
  tokenHash: string,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT account_tokens.id AS tokenId, account_tokens.expires_at AS expiresAt,
      account_tokens.used_at AS usedAt, account_tokens.revoked_at AS revokedAt,
      users.id AS userId, users.status AS status
     FROM account_tokens
     INNER JOIN users ON users.id = account_tokens.user_id
     WHERE account_tokens.token_hash = ? AND account_tokens.type = 'email_verification'
     LIMIT 1 FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  requireUsableToken(record, now);
  if (readString(record, 'status') !== 'invited') {
    throw new AuthenticationStateError('account is not awaiting verification');
  }
  await connection.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [
    now,
    readString(record, 'tokenId'),
  ]);
  await connection.query("UPDATE users SET email_verified_at = ?, status = 'active' WHERE id = ?", [
    now,
    readString(record, 'userId'),
  ]);
}

export async function findAuthenticationUser(connection: AuthConnection, email: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, email, password_hash AS passwordHash, email_verified_at AS emailVerifiedAt, role, status
     FROM users WHERE email = ? LIMIT 1`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const record = asRecord(row);
  const role = readString(record, 'role');
  const status = readString(record, 'status');
  if (
    (role !== 'owner' && role !== 'member') ||
    !['active', 'deleting', 'invited', 'suspended'].includes(status)
  ) {
    throw new AuthenticationDataError('user role or status is invalid');
  }
  return {
    email: normalizeEmail(readString(record, 'email')),
    emailVerified: readNullableDate(record, 'emailVerifiedAt') !== null,
    id: readString(record, 'id'),
    passwordHash: readNullableString(record, 'passwordHash'),
    role,
    status,
  } as AuthenticationUser;
}

export async function findAuthenticationUserById(connection: AuthConnection, userId: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, email, password_hash AS passwordHash, email_verified_at AS emailVerifiedAt, role, status
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const record = asRecord(row);
  const role = readString(record, 'role');
  const status = readString(record, 'status');
  if (
    (role !== 'owner' && role !== 'member') ||
    !['active', 'deleting', 'invited', 'suspended'].includes(status)
  ) {
    throw new AuthenticationDataError('user role or status is invalid');
  }
  return {
    email: normalizeEmail(readString(record, 'email')),
    emailVerified: readNullableDate(record, 'emailVerifiedAt') !== null,
    id: readString(record, 'id'),
    passwordHash: readNullableString(record, 'passwordHash'),
    role,
    status,
  } as AuthenticationUser;
}

export async function issuePasswordReset(
  connection: AuthConnection,
  email: string,
  token: IssueAccountToken,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, status, email_verified_at AS emailVerifiedAt
     FROM users WHERE email = ? LIMIT 1 FOR UPDATE`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  if (!row) {
    return false;
  }
  const record = asRecord(row);
  if (readString(record, 'status') !== 'active' || !readNullableDate(record, 'emailVerifiedAt')) {
    return false;
  }
  await issueAccountToken(connection, readString(record, 'id'), token, now);
  return true;
}

export async function resetPassword(
  connection: AuthConnection,
  input: ResetPassword,
  now = new Date(),
) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT account_tokens.id AS tokenId, account_tokens.expires_at AS expiresAt,
      account_tokens.used_at AS usedAt, account_tokens.revoked_at AS revokedAt,
      users.id AS userId, users.status AS status, users.email_verified_at AS emailVerifiedAt
     FROM account_tokens
     INNER JOIN users ON users.id = account_tokens.user_id
     WHERE account_tokens.token_hash = ? AND account_tokens.type = 'password_reset'
     LIMIT 1 FOR UPDATE`,
    [input.resetTokenHash],
  );
  const row = rows[0];
  if (!row) {
    throw new AuthenticationTokenError();
  }
  const record = asRecord(row);
  requireUsableToken(record, now);
  if (readString(record, 'status') !== 'active' || !readNullableDate(record, 'emailVerifiedAt')) {
    throw new AuthenticationStateError('account is not eligible for password reset');
  }
  await connection.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [
    now,
    readString(record, 'tokenId'),
  ]);
  await connection.query(
    'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
    [input.passwordHash, now, readString(record, 'userId')],
  );
  await revokeSessionsForUser(connection, readString(record, 'userId'), now);
}
