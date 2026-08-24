import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

const retentionDays = 90;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const AuditActions = Object.freeze({
  accountDeletionCompleted: 'account.deletion.completed',
  accountDeletionRecovered: 'account.deletion.recovered',
  accountDeletionRequested: 'account.deletion.requested',
  emailVerificationResent: 'auth.email_verification.resent',
  emailVerified: 'auth.email_verified',
  invitationRedeemed: 'auth.invitation.redeemed',
  loginSucceeded: 'auth.login.succeeded',
  logout: 'auth.logout',
  ownerSetupCompleted: 'auth.owner_setup.completed',
  passwordResetCompleted: 'auth.password_reset.completed',
  sessionRevoked: 'auth.session.revoked',
  sessionsRevoked: 'auth.sessions.revoked',
  totpDisabled: 'auth.totp.disabled',
  totpEnabled: 'auth.totp.enabled',
  totpEnrollmentStarted: 'auth.totp.enrollment.started',
  totpRecoveryCodesReplaced: 'auth.totp.recovery_codes.replaced',
  memberReactivated: 'member.reactivated',
  memberRemoved: 'member.removed',
  memberSuspended: 'member.suspended',
});

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
export type AuditTargetType = 'account' | 'member' | 'session' | 'system';

export type AuditContext = Readonly<{
  requesterIpHash?: string;
  requestId?: string;
}>;

export type AuditEventInput = AuditContext &
  Readonly<{
    action: AuditAction;
    actorUserId?: string;
    createdAt?: Date;
    targetId?: string;
    targetType: AuditTargetType;
  }>;

export type AuditEvent = Readonly<{
  action: AuditAction;
  actorUserId: string | undefined;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  requesterIpHash: string | undefined;
  requestId: string | undefined;
  targetId: string | undefined;
  targetType: AuditTargetType;
}>;

type AuditConnection = Pick<
  PoolConnection,
  'beginTransaction' | 'commit' | 'query' | 'release' | 'rollback'
>;
export type AuditPool = Pick<Pool, 'getConnection'>;

function asRecord(value: RowDataPacket): Record<string, unknown> {
  return value;
}

function optionalIdentifier(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Audit event ${field} is invalid`);
  }
  return value;
}

function optionalSha256(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw new Error(`Audit event ${field} is invalid`);
  }
  return value;
}

function readDate(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Audit event ${field} is invalid`);
  }
  return value;
}

function readAction(record: Record<string, unknown>) {
  const value = record.action;
  if (!Object.values(AuditActions).includes(value as AuditAction)) {
    throw new Error('Audit event action is invalid');
  }
  return value as AuditAction;
}

function readTargetType(record: Record<string, unknown>) {
  const value = record.targetType;
  if (value !== 'account' && value !== 'member' && value !== 'session' && value !== 'system') {
    throw new Error('Audit event target type is invalid');
  }
  return value;
}

function retentionDeadline(createdAt: Date) {
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1_000);
}

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Audit event limit is invalid');
  }
}

function toAuditEvent(row: RowDataPacket): AuditEvent {
  const record = asRecord(row);
  const id = optionalIdentifier(record.id, 'id');
  if (!id) {
    throw new Error('Audit event id is invalid');
  }
  return {
    action: readAction(record),
    actorUserId: optionalIdentifier(record.actorUserId, 'actorUserId'),
    createdAt: readDate(record, 'createdAt'),
    expiresAt: readDate(record, 'expiresAt'),
    id,
    requesterIpHash: optionalSha256(record.requesterIpHash, 'requesterIpHash'),
    requestId: optionalIdentifier(record.requestId, 'requestId'),
    targetId: optionalIdentifier(record.targetId, 'targetId'),
    targetType: readTargetType(record),
  };
}

export function hashAuditRequesterIp(requesterIp: string) {
  if (typeof requesterIp !== 'string' || requesterIp.length === 0) {
    throw new Error('Audit requester IP is invalid');
  }
  return createHash('sha256').update(requesterIp, 'utf8').digest('hex');
}

export async function withAuditTransaction<T>(
  pool: AuditPool,
  operation: (connection: AuditConnection) => Promise<T>,
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
        // Keep the original audit operation failure.
      }
      throw error;
    }
  } finally {
    connection.release();
  }
}

export async function recordAuditEvent(
  connection: Pick<AuditConnection, 'query'>,
  input: AuditEventInput,
): Promise<AuditEvent> {
  const createdAt = input.createdAt ?? new Date();
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Audit event createdAt is invalid');
  }
  const event: AuditEvent = {
    action: input.action,
    actorUserId: optionalIdentifier(input.actorUserId, 'actorUserId'),
    createdAt,
    expiresAt: retentionDeadline(createdAt),
    id: randomUUID(),
    requesterIpHash: optionalSha256(input.requesterIpHash, 'requesterIpHash'),
    requestId: optionalIdentifier(input.requestId, 'requestId'),
    targetId: optionalIdentifier(input.targetId, 'targetId'),
    targetType: input.targetType,
  };
  if (!Object.values(AuditActions).includes(event.action)) {
    throw new Error('Audit event action is invalid');
  }
  if (!['account', 'member', 'session', 'system'].includes(event.targetType)) {
    throw new Error('Audit event target type is invalid');
  }
  await connection.query(
    `INSERT INTO audit_events (
      id, actor_user_id, action, target_type, target_id, requester_ip_hash, request_id, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.actorUserId ?? null,
      event.action,
      event.targetType,
      event.targetId ?? null,
      event.requesterIpHash ?? null,
      event.requestId ?? null,
      event.expiresAt,
      event.createdAt,
    ],
  );
  return event;
}

export async function listAuditEvents(
  connection: Pick<AuditConnection, 'query'>,
  limit = 100,
  now = new Date(),
): Promise<ReadonlyArray<AuditEvent>> {
  validateLimit(limit);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, actor_user_id AS actorUserId, action, target_type AS targetType, target_id AS targetId,
      requester_ip_hash AS requesterIpHash, request_id AS requestId, expires_at AS expiresAt, created_at AS createdAt
     FROM audit_events
     WHERE expires_at > ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
    [now],
  );
  return rows.map(toAuditEvent);
}

export async function purgeExpiredAuditEvents(
  connection: Pick<AuditConnection, 'query'>,
  now = new Date(),
  limit = 1_000,
) {
  validateLimit(limit);
  const [result] = await connection.query<ResultSetHeader>(
    `DELETE FROM audit_events WHERE expires_at <= ? ORDER BY expires_at ASC, id ASC LIMIT ${limit}`,
    [now],
  );
  return result.affectedRows;
}
