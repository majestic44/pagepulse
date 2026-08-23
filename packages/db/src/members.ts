import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { revokeSessionsForUser } from './sessions.js';

type MemberConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;

export type MemberPool = Pick<Pool, 'getConnection'>;

export type MemberStatus = 'active' | 'deleting' | 'invited' | 'suspended';

export type ManagedMember = Readonly<{
  createdAt: Date;
  email: string;
  emailVerified: boolean;
  id: string;
  monitorLimit: number;
  status: MemberStatus;
}>;

export class MemberNotFoundError extends Error {
  constructor() {
    super('The member does not exist');
    this.name = 'MemberNotFoundError';
  }
}

export class MemberLifecycleStateError extends Error {
  constructor(message: string) {
    super(`The member lifecycle action cannot complete: ${message}`);
    this.name = 'MemberLifecycleStateError';
  }
}

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function readDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Member data is invalid: ${key}`);
  }
  return value;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Member data is invalid: ${key}`);
  }
  return parsed;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Member data is invalid: ${key}`);
  }
  return value;
}

function readStatus(record: Record<string, unknown>, key: string): MemberStatus {
  const value = readString(record, key);
  if (value !== 'active' && value !== 'deleting' && value !== 'invited' && value !== 'suspended') {
    throw new Error(`Member data is invalid: ${key}`);
  }
  return value;
}

function toManagedMember(row: RowDataPacket): ManagedMember {
  const record = asRecord(row);
  return {
    createdAt: readDate(record, 'createdAt'),
    email: readString(record, 'email'),
    emailVerified: record.emailVerifiedAt instanceof Date,
    id: readString(record, 'id'),
    monitorLimit: readNonNegativeInteger(record, 'monitorLimit'),
    status: readStatus(record, 'status'),
  };
}

export async function withMemberTransaction<T>(
  pool: MemberPool,
  operation: (connection: MemberConnection) => Promise<T>,
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
        // Preserve the original member lifecycle failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function listManagedMembers(connection: Pick<MemberConnection, 'query'>) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, email, email_verified_at AS emailVerifiedAt, monitor_limit AS monitorLimit,
      status, created_at AS createdAt
     FROM users
     WHERE role = 'member'
     ORDER BY created_at ASC, id ASC`,
  );
  return rows.map(toManagedMember);
}

async function findMemberForUpdate(connection: Pick<MemberConnection, 'query'>, memberId: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, status
     FROM users
     WHERE id = ? AND role = 'member'
     LIMIT 1 FOR UPDATE`,
    [memberId],
  );
  const row = rows[0];
  if (!row) {
    throw new MemberNotFoundError();
  }
  const record = asRecord(row);
  return { id: readString(record, 'id'), status: readStatus(record, 'status') };
}

export async function suspendMember(
  connection: Pick<MemberConnection, 'query'>,
  memberId: string,
  now = new Date(),
) {
  const member = await findMemberForUpdate(connection, memberId);
  if (member.status !== 'active') {
    throw new MemberLifecycleStateError('only an active member can be suspended');
  }
  await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [member.id]);
  await revokeSessionsForUser(connection, member.id, now);
}

export async function reactivateMember(
  connection: Pick<MemberConnection, 'query'>,
  memberId: string,
) {
  const member = await findMemberForUpdate(connection, memberId);
  if (member.status !== 'suspended') {
    throw new MemberLifecycleStateError('only a suspended member can be reactivated');
  }
  await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [member.id]);
}

export async function removeMember(
  connection: Pick<MemberConnection, 'query'>,
  memberId: string,
  now = new Date(),
) {
  const member = await findMemberForUpdate(connection, memberId);
  await revokeSessionsForUser(connection, member.id, now);
  await connection.query("DELETE FROM users WHERE id = ? AND role = 'member'", [member.id]);
}
