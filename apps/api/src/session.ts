import { createOpaqueToken, hashOpaqueToken } from '@pagepulse/auth';
import {
  AuditActions,
  createSession,
  findActiveSession,
  listActiveSessions,
  revokeSession,
  revokeSessionByTokenHash,
  revokeSessionsForUser,
  recordAuditEvent,
  type AuditContext,
  type ActiveSession,
  type SessionPool,
  touchSession,
  withSessionTransaction,
} from '@pagepulse/db';

export const SESSION_COOKIE_NAME = 'pagepulse_session';

export type SessionTiming = Readonly<{
  absoluteTtlMinutes: number;
  idleTtlMinutes: number;
}>;

export type SessionIssue = Readonly<{
  expiresAt: Date;
  token: string;
}>;

export type SessionService = Readonly<{
  authenticate: (token: string) => Promise<ActiveSession | undefined>;
  issue: (
    input: Readonly<{ deviceLabel: string; userId: string }>,
    previousToken?: string,
    audit?: AuditContext,
  ) => Promise<SessionIssue>;
  list: (userId: string) => Promise<ReadonlyArray<ActiveSession>>;
  revoke: (userId: string, sessionId: string, audit?: AuditContext) => Promise<boolean>;
  revokeByToken: (token: string, audit?: AuditContext) => Promise<void>;
  revokeOthers: (userId: string, currentSessionId: string, audit?: AuditContext) => Promise<void>;
}>;

export type SessionServiceOptions = Readonly<{
  now?: () => Date;
  pool: SessionPool;
  timing: SessionTiming;
}>;

function expiresAfterMinutes(minutes: number, now: Date) {
  return new Date(now.getTime() + minutes * 60_000);
}

function nextIdleExpiry(now: Date, absoluteExpiresAt: Date, timing: SessionTiming) {
  const idleExpiresAt = expiresAfterMinutes(timing.idleTtlMinutes, now);
  return idleExpiresAt.getTime() < absoluteExpiresAt.getTime() ? idleExpiresAt : absoluteExpiresAt;
}

export function deviceLabel(userAgent: string | undefined) {
  const value = userAgent ?? '';
  const browser = /firefox\//iu.test(value)
    ? 'Firefox'
    : /edg\//iu.test(value)
      ? 'Microsoft Edge'
      : /chrome\//iu.test(value)
        ? 'Chrome'
        : /safari\//iu.test(value)
          ? 'Safari'
          : 'Unknown browser';
  const platform = /windows/iu.test(value)
    ? 'Windows'
    : /android/iu.test(value)
      ? 'Android'
      : /iphone|ipad|ipod/iu.test(value)
        ? 'iOS'
        : /mac os/iu.test(value)
          ? 'macOS'
          : /linux/iu.test(value)
            ? 'Linux'
            : 'unknown device';
  return `${browser} on ${platform}`;
}

export function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return undefined;
  }
  let token: string | undefined;
  for (const item of cookieHeader.split(';')) {
    const [name, ...valueParts] = item.trim().split('=');
    if (name !== SESSION_COOKIE_NAME || valueParts.length !== 1) {
      continue;
    }
    const value = valueParts[0];
    if (!value || !/^[A-Za-z0-9_-]{43}$/u.test(value) || token) {
      return undefined;
    }
    token = value;
  }
  return token;
}

function sessionCookieAttributes(secure: boolean) {
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function serializeSessionCookie(token: string, expiresAt: Date, now: Date, secure: boolean) {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${maxAge}; ${sessionCookieAttributes(secure)}`;
}

export function clearSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${sessionCookieAttributes(secure)}`;
}

export function createSessionService({
  now = () => new Date(),
  pool,
  timing,
}: SessionServiceOptions): SessionService {
  if (!Number.isSafeInteger(timing.idleTtlMinutes) || timing.idleTtlMinutes < 1) {
    throw new Error('Session idle lifetime is invalid');
  }
  if (
    !Number.isSafeInteger(timing.absoluteTtlMinutes) ||
    timing.absoluteTtlMinutes < timing.idleTtlMinutes
  ) {
    throw new Error('Session absolute lifetime is invalid');
  }

  return {
    async authenticate(token) {
      const current = now();
      return withSessionTransaction(pool, async (connection) => {
        const session = await findActiveSession(connection, hashOpaqueToken(token), current);
        if (!session) {
          return undefined;
        }
        return touchSession(
          connection,
          session,
          nextIdleExpiry(current, session.absoluteExpiresAt, timing),
          current,
        );
      });
    },

    async issue(input, previousToken, audit) {
      const current = now();
      const token = createOpaqueToken();
      const absoluteExpiresAt = expiresAfterMinutes(timing.absoluteTtlMinutes, current);
      await withSessionTransaction(pool, async (connection) => {
        const sessionId = await createSession(
          connection,
          {
            absoluteExpiresAt,
            deviceLabel: input.deviceLabel,
            idleExpiresAt: nextIdleExpiry(current, absoluteExpiresAt, timing),
            tokenHash: hashOpaqueToken(token),
            userId: input.userId,
          },
          current,
          previousToken ? hashOpaqueToken(previousToken) : undefined,
        );
        if (audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.loginSucceeded,
            actorUserId: input.userId,
            createdAt: current,
            targetId: sessionId,
            targetType: 'session',
          });
        }
      });
      return { expiresAt: absoluteExpiresAt, token };
    },

    async list(userId) {
      return withSessionTransaction(pool, (connection) =>
        listActiveSessions(connection, userId, now()),
      );
    },

    async revoke(userId, sessionId, audit) {
      const current = now();
      return withSessionTransaction(pool, async (connection) => {
        const revoked = await revokeSession(connection, userId, sessionId, current);
        if (revoked && audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.sessionRevoked,
            actorUserId: userId,
            createdAt: current,
            targetId: sessionId,
            targetType: 'session',
          });
        }
        return revoked;
      });
    },

    async revokeByToken(token, audit) {
      const current = now();
      await withSessionTransaction(pool, async (connection) => {
        const session = await revokeSessionByTokenHash(connection, hashOpaqueToken(token), current);
        if (session && audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.logout,
            actorUserId: session.userId,
            createdAt: current,
            targetId: session.id,
            targetType: 'session',
          });
        }
      });
    },

    async revokeOthers(userId, currentSessionId, audit) {
      const current = now();
      await withSessionTransaction(pool, async (connection) => {
        await revokeSessionsForUser(connection, userId, current, currentSessionId);
        if (audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.sessionsRevoked,
            actorUserId: userId,
            createdAt: current,
            targetId: userId,
            targetType: 'account',
          });
        }
      });
    },
  };
}
