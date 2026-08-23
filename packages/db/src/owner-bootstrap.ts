import { createHash, randomBytes, randomUUID } from 'node:crypto';

import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';

export const OWNER_BOOTSTRAP_LOCK_NAME = 'pagepulse_owner_bootstrap';
export const OWNER_BOOTSTRAP_LOCK_TIMEOUT_SECONDS = 60;
export const MINIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES = 5;
export const MAXIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES = 1_440;

const ownerEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type OwnerBootstrapConnection = Pick<
  Connection,
  'beginTransaction' | 'commit' | 'end' | 'query' | 'rollback'
>;

export type OwnerBootstrapOptions = Readonly<{
  email: string;
  now?: Date;
  tokenTtlMinutes: number;
}>;

export type OwnerBootstrapResult = Readonly<{
  expiresAt: Date;
  ownerId: string;
  token: string;
}>;

export class OwnerBootstrapAlreadyConfiguredError extends Error {
  constructor() {
    super('An active owner account is already configured');
    this.name = 'OwnerBootstrapAlreadyConfiguredError';
  }
}

export class OwnerBootstrapPendingOwnerMismatchError extends Error {
  constructor() {
    super('The pending owner does not match the requested bootstrap email');
    this.name = 'OwnerBootstrapPendingOwnerMismatchError';
  }
}

export class OwnerBootstrapInputError extends Error {
  constructor(message: string) {
    super(`Invalid owner bootstrap input: ${message}`);
    this.name = 'OwnerBootstrapInputError';
  }
}

export class OwnerBootstrapConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid owner bootstrap configuration: ${message}`);
    this.name = 'OwnerBootstrapConfigurationError';
  }
}

export function normalizeOwnerEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 320 || !ownerEmailPattern.test(normalized)) {
    throw new OwnerBootstrapInputError('email must be a valid address of at most 320 characters');
  }
  return normalized;
}

function validateTokenTtl(tokenTtlMinutes: number) {
  if (
    !Number.isInteger(tokenTtlMinutes) ||
    tokenTtlMinutes < MINIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES ||
    tokenTtlMinutes > MAXIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES
  ) {
    throw new OwnerBootstrapInputError(
      `token lifetime must be an integer between ${MINIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES} and ${MAXIMUM_OWNER_SETUP_TOKEN_TTL_MINUTES} minutes`,
    );
  }
}

export function createOwnerSetupToken() {
  return randomBytes(32).toString('base64url');
}

export function hashOwnerSetupToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOwnerSetupUrl(appBaseUrl: string, token: string) {
  const url = new URL(appBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/setup/owner`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
}

export async function acquireOwnerBootstrapLock(
  connection: Pick<Connection, 'query'>,
  timeoutSeconds = OWNER_BOOTSTRAP_LOCK_TIMEOUT_SECONDS,
) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
    OWNER_BOOTSTRAP_LOCK_NAME,
    timeoutSeconds,
  ]);
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error(`Could not acquire MariaDB owner bootstrap lock ${OWNER_BOOTSTRAP_LOCK_NAME}`);
  }
}

export async function releaseOwnerBootstrapLock(connection: Pick<Connection, 'query'>) {
  await connection.query('SELECT RELEASE_LOCK(?) AS released', [OWNER_BOOTSTRAP_LOCK_NAME]);
}

export async function withOwnerBootstrapLock<T>(
  connection: Pick<Connection, 'query'>,
  operation: () => Promise<T>,
) {
  await acquireOwnerBootstrapLock(connection);
  try {
    return await operation();
  } finally {
    await releaseOwnerBootstrapLock(connection);
  }
}

function parseExistingOwner(row: RowDataPacket) {
  const record = row as unknown as Record<string, unknown>;
  const id = record.id;
  const email = record.email;
  const status = record.status;
  if (
    typeof id !== 'string' ||
    typeof email !== 'string' ||
    typeof status !== 'string' ||
    id.length === 0
  ) {
    throw new OwnerBootstrapConfigurationError('existing owner record is invalid');
  }
  return { email, id, status };
}

export async function createOwnerBootstrap(
  connection: OwnerBootstrapConnection,
  options: OwnerBootstrapOptions,
) {
  const email = normalizeOwnerEmail(options.email);
  validateTokenTtl(options.tokenTtlMinutes);
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + options.tokenTtlMinutes * 60_000);
  let ownerId: string = randomUUID();
  const token = createOwnerSetupToken();
  const tokenHash = hashOwnerSetupToken(token);

  await connection.beginTransaction();
  try {
    const [existingOwners] = await connection.query<RowDataPacket[]>(
      "SELECT id, email, status FROM users WHERE role = 'owner' LIMIT 2 FOR UPDATE",
    );
    if (existingOwners.length > 1) {
      throw new OwnerBootstrapConfigurationError('multiple owner accounts are configured');
    }
    const existingOwner = existingOwners[0] && parseExistingOwner(existingOwners[0]);
    if (existingOwner) {
      if (existingOwner.status !== 'invited') {
        throw new OwnerBootstrapAlreadyConfiguredError();
      }
      if (existingOwner.email !== email) {
        throw new OwnerBootstrapPendingOwnerMismatchError();
      }
      ownerId = existingOwner.id;
      await connection.query(
        'UPDATE owner_setup_tokens SET revoked_at = ? WHERE owner_id = ? AND used_at IS NULL AND revoked_at IS NULL',
        [now, ownerId],
      );
    } else {
      await connection.query(
        "INSERT INTO users (id, email, role, status) VALUES (?, ?, 'owner', 'invited')",
        [ownerId, email],
      );
    }
    await connection.query(
      'INSERT INTO owner_setup_tokens (id, owner_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), ownerId, tokenHash, expiresAt],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }

  return { expiresAt, ownerId, token } satisfies OwnerBootstrapResult;
}

export async function bootstrapOwner(databaseUrl: string, options: OwnerBootstrapOptions) {
  const connection = await mysql.createConnection(databaseUrl);
  try {
    return await withOwnerBootstrapLock(connection, () =>
      createOwnerBootstrap(connection, options),
    );
  } finally {
    await connection.end();
  }
}
