import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordValidationError, type RateLimitStore } from '@pagepulse/auth';
import { loadEnvironment } from '@pagepulse/config';
import {
  AccountDeletionTokenError,
  MemberLifecycleStateError,
  type ActiveSession,
  type AuthenticationUser,
} from '@pagepulse/db';
import type { AuthenticationDependencies, AuthenticationService } from './auth.js';
import type { AccountDeletionService } from './account-deletion.js';
import { buildApp } from './app.js';
import { createHealthService } from './health.js';
import type { MemberService } from './members.js';
import type { SessionService } from './session.js';
import type { TotpService } from './totp.js';

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => app?.close());

function createAuthenticationDependencies(
  service: Partial<AuthenticationService> = {},
  rateLimitStore: RateLimitStore = {
    increment: vi.fn().mockResolvedValue({ count: 1, ttlMs: 60_000 }),
  },
  sessions: Partial<SessionService> = {},
  totp: Partial<TotpService> = {},
  members: Partial<MemberService> = {},
  accountDeletion: Partial<AccountDeletionService> = {},
): AuthenticationDependencies {
  return {
    accountDeletion: {
      purgeExpired: vi.fn().mockResolvedValue(0),
      recover: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        deadline: new Date('2026-08-31T00:00:00.000Z'),
        token: 'C'.repeat(43),
      }),
      ...accountDeletion,
    },
    members: {
      list: vi.fn().mockResolvedValue([]),
      reactivate: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
      ...members,
    },
    rateLimitPolicies: {
      deletion: { limit: 3, windowMs: 60_000 },
      login: { limit: 5, windowMs: 60_000 },
      redemption: { limit: 5, windowMs: 60_000 },
      reset: { limit: 3, windowMs: 60_000 },
      totp: { limit: 5, windowMs: 60_000 },
    },
    rateLimitStore,
    service: {
      completePasswordReset: vi.fn().mockResolvedValue(undefined),
      confirmEmailVerification: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      redeemInvitation: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      redeemOwnerSetup: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      verifyCurrentPassword: vi.fn().mockResolvedValue(false),
      ...service,
    },
    sessions: {
      authenticate: vi.fn().mockResolvedValue(undefined),
      issue: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-09-22T00:00:00.000Z'),
        token: 'A'.repeat(43),
      }),
      list: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue(false),
      revokeByToken: vi.fn().mockResolvedValue(undefined),
      revokeOthers: vi.fn().mockResolvedValue(undefined),
      ...sessions,
    },
    totp: {
      beginEnrollment: vi.fn().mockResolvedValue({
        manualEntryKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
        otpauthUri:
          'otpauth://totp/PagePulse%3Aowner%40example.test?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      }),
      completeLogin: vi.fn().mockResolvedValue({
        email: authenticatedUser.email,
        role: authenticatedUser.role,
        userId: authenticatedUser.id,
      }),
      confirmEnrollment: vi.fn().mockResolvedValue(['ABCD-EFGH-JKLM']),
      createLoginChallenge: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-08-23T00:05:00.000Z'),
        token: 'B'.repeat(43),
      }),
      disable: vi.fn().mockResolvedValue(undefined),
      isEnabled: vi.fn().mockResolvedValue(false),
      replaceRecoveryCodes: vi.fn().mockResolvedValue(['ABCD-EFGH-JKLM']),
      verify: vi.fn().mockResolvedValue(undefined),
      ...totp,
    },
  };
}

const authenticatedUser: AuthenticationUser = {
  email: 'owner@example.test',
  emailVerified: true,
  id: 'owner-id',
  passwordHash: 'argon2id$password-digest',
  role: 'owner',
  status: 'active',
};

const activeSession: ActiveSession = {
  absoluteExpiresAt: new Date('2026-09-22T00:00:00.000Z'),
  createdAt: new Date('2026-08-23T00:00:00.000Z'),
  deviceLabel: 'Chrome on Windows',
  email: authenticatedUser.email,
  id: 'session-id',
  idleExpiresAt: new Date('2026-08-23T08:00:00.000Z'),
  lastUsedAt: new Date('2026-08-23T00:00:00.000Z'),
  role: 'owner',
  userId: authenticatedUser.id,
};

const memberSession: ActiveSession = {
  ...activeSession,
  email: 'member@example.test',
  role: 'member',
  userId: 'member-id',
};

describe('health contract', () => {
  it('returns liveness without probing dependencies', async () => {
    const database = vi.fn().mockResolvedValue(undefined);
    const redis = vi.fn().mockResolvedValue(undefined);
    const testApp = await buildApp({
      healthService: createHealthService({ database, redis }),
      now: () => 1_000,
    });
    app = testApp;
    const response = await testApp.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });
    expect(database).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();
  });

  it('returns readiness only when MariaDB and Redis are available', async () => {
    const testApp = await buildApp({
      healthService: createHealthService({
        database: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockResolvedValue(undefined),
      }),
      now: () => 1_000,
    });
    app = testApp;

    const response = await testApp.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api',
      version: '0.0.0-dev',
      uptimeSeconds: 0,
    });
  });

  it('returns public version metadata without probing dependencies', async () => {
    const database = vi.fn().mockResolvedValue(undefined);
    const redis = vi.fn().mockResolvedValue(undefined);
    const testApp = await buildApp({
      environment: loadEnvironment({ APP_VERSION: '1.2.3' }),
      healthService: createHealthService({ database, redis }),
      now: () => 1_000,
    });
    app = testApp;

    const response = await testApp.inject({ method: 'GET', url: '/api/v1/system/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'api', version: '1.2.3', uptimeSeconds: 0 });
    expect(database).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();
  });

  it('degrades readiness without exposing dependency errors', async () => {
    const testApp = await buildApp({
      healthService: createHealthService({
        database: vi.fn().mockRejectedValue(new Error('database password must stay private')),
        redis: vi.fn().mockResolvedValue(undefined),
      }),
    });
    app = testApp;

    const response = await testApp.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', service: 'api' });
    expect(response.body).not.toContain('database password must stay private');
  });

  it('restricts detailed diagnostics to an owner session', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(activeSession),
    });
    const testApp = await buildApp({
      authentication,
      environment: loadEnvironment({ APP_VERSION: '1.2.3' }),
      healthService: createHealthService({
        database: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      }),
      now: () => 1_000,
    });
    app = testApp;

    await expect(
      testApp.inject({
        method: 'GET',
        url: '/api/v1/system/diagnostics',
        headers: { authorization: 'Bearer retired-diagnostics-token' },
      }),
    ).resolves.toMatchObject({
      statusCode: 401,
    });

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/system/diagnostics',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      status: 'degraded',
      service: 'api',
      version: '1.2.3',
      uptimeSeconds: 0,
      dependencies: { database: 'ok', redis: 'unavailable' },
    });
    expect(response.body).not.toContain('redis unavailable');
  });

  it('forbids a member session from detailed diagnostics', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(memberSession),
    });
    const testApp = await buildApp({
      authentication,
      healthService: createHealthService({
        database: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockResolvedValue(undefined),
      }),
    });
    app = testApp;

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/system/diagnostics',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
  });
});

describe('authentication contract', () => {
  it('redeems an owner setup token without exposing its verification token', async () => {
    const authentication = createAuthenticationDependencies();
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/owner-setup',
      payload: { password: 'a secure password', token: 'owner-setup-token' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'verification_required' });
    expect(response.body).not.toContain('verification-token-must-not-be-returned');
    expect(authentication.service.redeemOwnerSetup).toHaveBeenCalledWith(
      'owner-setup-token',
      'a secure password',
    );
  });

  it('returns a generic response for password reset requests', async () => {
    const authentication = createAuthenticationDependencies({
      requestPasswordReset: vi.fn().mockRejectedValue(new Error('unknown email')),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      payload: { email: 'nobody@example.test' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'reset_requested' });
    expect(response.body).not.toContain('unknown email');
  });

  it('rejects a throttled login before asking the authentication service', async () => {
    const rateLimitStore: RateLimitStore = {
      increment: vi.fn().mockResolvedValue({ count: 6, ttlMs: 31_000 }),
    };
    const authentication = createAuthenticationDependencies({}, rateLimitStore);
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.test', password: 'a secure password' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('31');
    expect(response.json()).toEqual({ error: 'Too many authentication attempts' });
    expect(authentication.service.login).not.toHaveBeenCalled();
  });

  it('returns the same invalid response for malformed invitation credentials', async () => {
    const authentication = createAuthenticationDependencies({
      redeemInvitation: vi
        .fn()
        .mockRejectedValue(new PasswordValidationError('must be at least 12 characters')),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/redeem',
      payload: { password: 'short', token: 'invitation-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid authentication request' });
    expect(response.body).not.toContain('at least 12');
  });

  it('issues an HTTP-only strict session cookie after login', async () => {
    const authentication = createAuthenticationDependencies({
      login: vi.fn().mockResolvedValue({ totpEnabled: false, user: authenticatedUser }),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.test', password: 'a secure password' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('pagepulse_session=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(authentication.sessions.issue).toHaveBeenCalledWith(
      { deviceLabel: 'Unknown browser on unknown device', userId: authenticatedUser.id },
      undefined,
    );
  });

  it('requires a short-lived HTTP-only challenge before creating a session for a TOTP account', async () => {
    const authentication = createAuthenticationDependencies({
      login: vi.fn().mockResolvedValue({ totpEnabled: true, user: authenticatedUser }),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.test', password: 'a secure password' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'totp_required' });
    expect(response.headers['set-cookie']).toContain('pagepulse_totp_challenge=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(authentication.sessions.issue).not.toHaveBeenCalled();
  });

  it('exchanges a valid TOTP challenge for a session without returning either opaque token', async () => {
    const authentication = createAuthenticationDependencies();
    const testApp = await buildApp({ authentication });
    app = testApp;
    const challengeToken = 'B'.repeat(43);

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/login',
      headers: { cookie: `pagepulse_totp_challenge=${challengeToken}` },
      payload: { code: '123456' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pagepulse_totp_challenge=; Max-Age=0'),
        expect.stringContaining('pagepulse_session='),
      ]),
    );
    expect(response.body).not.toContain(challengeToken);
    expect(authentication.totp.completeLogin).toHaveBeenCalledWith(challengeToken, {
      code: '123456',
    });
  });

  it('enrolls TOTP only for the current session and displays recovery codes once', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(activeSession),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const enrollment = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/totp/enrollments',
      headers: { cookie },
    });
    const confirmation = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/totp/enrollments/confirm',
      headers: { cookie },
      payload: { code: '123456' },
    });

    expect(enrollment.statusCode).toBe(200);
    expect(enrollment.headers['cache-control']).toBe('no-store');
    expect(enrollment.json()).toEqual({
      manualEntryKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      otpauthUri:
        'otpauth://totp/PagePulse%3Aowner%40example.test?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json()).toEqual({ recoveryCodes: ['ABCD-EFGH-JKLM'] });
    expect(authentication.totp.confirmEnrollment).toHaveBeenCalledWith(
      'owner-id',
      'session-id',
      '123456',
    );
  });

  it('requires a fresh factor proof to replace recovery codes or disable TOTP', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(activeSession),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const replacement = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/totp/recovery-codes',
      headers: { cookie },
      payload: { recoveryCode: 'ABCD-EFGH-JKLM' },
    });
    const disabled = await testApp.inject({
      method: 'DELETE',
      url: '/api/v1/account/totp',
      headers: { cookie },
      payload: { code: '123456' },
    });

    expect(replacement.statusCode).toBe(200);
    expect(replacement.json()).toEqual({ recoveryCodes: ['ABCD-EFGH-JKLM'] });
    expect(authentication.totp.replaceRecoveryCodes).toHaveBeenCalledWith(
      'owner-id',
      'session-id',
      { recoveryCode: 'ABCD-EFGH-JKLM' },
    );
    expect(disabled.statusCode).toBe(204);
    expect(authentication.totp.disable).toHaveBeenCalledWith('owner-id', 'session-id', {
      code: '123456',
    });
  });

  it('lists the current active session without exposing its token', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(activeSession),
      list: vi.fn().mockResolvedValue([activeSession]),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/account/sessions',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      sessions: [
        expect.objectContaining({
          current: true,
          deviceLabel: 'Chrome on Windows',
          id: 'session-id',
        }),
      ],
    });
    expect(response.body).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('revokes the current session and clears its cookie', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(activeSession),
      revoke: vi.fn().mockResolvedValue(true),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'DELETE',
      url: '/api/v1/account/sessions/session-id',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    expect(authentication.sessions.revoke).toHaveBeenCalledWith('owner-id', 'session-id');
  });

  it('requires the current password and factor proof before scheduling deletion, then clears the session', async () => {
    const authentication = createAuthenticationDependencies(
      { verifyCurrentPassword: vi.fn().mockResolvedValue(true) },
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
      { isEnabled: vi.fn().mockResolvedValue(true) },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/deletion',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      payload: { code: '123456', password: 'a secure password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    expect(response.json()).toEqual({
      deletionDeadline: '2026-08-31T00:00:00.000Z',
      recoveryToken: 'C'.repeat(43),
    });
    expect(authentication.service.verifyCurrentPassword).toHaveBeenCalledWith(
      'member-id',
      'a secure password',
    );
    expect(authentication.totp.verify).toHaveBeenCalledWith('member-id', { code: '123456' });
    expect(authentication.accountDeletion.request).toHaveBeenCalledWith('member-id');
  });

  it('does not schedule deletion with an invalid password confirmation', async () => {
    const authentication = createAuthenticationDependencies(
      { verifyCurrentPassword: vi.fn().mockResolvedValue(false) },
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/deletion',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      payload: { password: 'incorrect password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid account deletion confirmation' });
    expect(authentication.accountDeletion.request).not.toHaveBeenCalled();
  });

  it('recovers a deletion only with a valid opaque recovery token', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { recover: vi.fn().mockRejectedValue(new AccountDeletionTokenError()) },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/account/deletion/recover',
      payload: { token: 'C'.repeat(43) },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized' });
    expect(response.body).not.toContain('recovery token is invalid');
  });

  it('allows an owner to list and manage member lifecycle state', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      {
        list: vi.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-08-23T00:00:00.000Z'),
            email: 'member@example.test',
            emailVerified: true,
            id: 'member-id',
            monitorLimit: 50,
            status: 'active',
          },
        ]),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const headers = { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };

    const listed = await testApp.inject({
      method: 'GET',
      url: '/api/v1/owner/members',
      headers,
    });
    const suspended = await testApp.inject({
      method: 'POST',
      url: '/api/v1/owner/members/member-id/suspend',
      headers,
    });
    const reactivated = await testApp.inject({
      method: 'POST',
      url: '/api/v1/owner/members/member-id/reactivate',
      headers,
    });
    const removed = await testApp.inject({
      method: 'DELETE',
      url: '/api/v1/owner/members/member-id',
      headers,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.json()).toEqual({
      members: [
        {
          createdAt: '2026-08-23T00:00:00.000Z',
          email: 'member@example.test',
          emailVerified: true,
          id: 'member-id',
          monitorLimit: 50,
          status: 'active',
        },
      ],
    });
    expect(suspended.statusCode).toBe(204);
    expect(reactivated.statusCode).toBe(204);
    expect(removed.statusCode).toBe(204);
    expect(authentication.members.suspend).toHaveBeenCalledWith('member-id');
    expect(authentication.members.reactivate).toHaveBeenCalledWith('member-id');
    expect(authentication.members.remove).toHaveBeenCalledWith('member-id');
  });

  it('forbids members from accessing owner member management', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(memberSession),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/owner/members',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
    expect(authentication.members.list).not.toHaveBeenCalled();
  });

  it('returns a safe conflict when a member lifecycle transition is no longer valid', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      {
        suspend: vi
          .fn()
          .mockRejectedValue(
            new MemberLifecycleStateError('only an active member can be suspended'),
          ),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/owner/members/member-id/suspend',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Member lifecycle action cannot be completed' });
    expect(response.body).not.toContain('only an active member');
  });
});
