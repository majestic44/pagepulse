import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordValidationError, type RateLimitStore } from '@pagepulse/auth';
import { loadEnvironment } from '@pagepulse/config';
import { MonitorPreviewError, MonitorTargetValidationError } from '@pagepulse/monitor-engine';
import {
  AccountDeletionTokenError,
  ChangeReviewConflictError,
  MemberLifecycleStateError,
  MonitorRevisionConflictError,
  type ActiveSession,
  type AuthenticationUser,
  type Monitor,
} from '@pagepulse/db';
import type { AuthenticationDependencies, AuthenticationService } from './auth.js';
import type { AccountDeletionService } from './account-deletion.js';
import type { AuditService } from './audit.js';
import type { VerificationEmailDelivery } from './email-delivery.js';
import { buildApp } from './app.js';
import { createHealthService } from './health.js';
import type { MemberService } from './members.js';
import type { MonitorService } from './monitors.js';
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
  emailDelivery: Partial<VerificationEmailDelivery> = {},
  audit: Partial<AuditService> = {},
  monitors: Partial<MonitorService> = {},
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
    audit: {
      list: vi.fn().mockResolvedValue([]),
      ...audit,
    },
    members: {
      list: vi.fn().mockResolvedValue([]),
      reactivate: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
      ...members,
    },
    monitors: {
      create: vi.fn().mockResolvedValue(monitor),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteSchedule: vi.fn().mockResolvedValue({ ...monitor, revision: 2 }),
      get: vi.fn().mockResolvedValue(monitor),
      getSchedule: vi.fn().mockResolvedValue({ monitor, schedule: null }),
      getTarget: vi.fn().mockResolvedValue({
        monitor,
        target: { repeatedList: null, selector: null, targetType: 'whole_page' as const },
      }),
      getRules: vi.fn().mockResolvedValue({
        monitor,
        rules: {
          baseline: { revision: 1, state: 'pending' as const },
          configuration: { keyword: null, newItem: false, textChange: true },
        },
      }),
      list: vi.fn().mockResolvedValue([monitor]),
      listChangeReviews: vi.fn().mockResolvedValue([]),
      pause: vi.fn().mockResolvedValue({ ...monitor, revision: 2, state: 'paused' }),
      resume: vi.fn().mockResolvedValue(monitor),
      resolveChangeReview: vi.fn(),
      update: vi.fn().mockResolvedValue({ ...monitor, name: 'Updated monitor', revision: 2 }),
      updateSchedule: vi.fn().mockResolvedValue({
        monitor: { ...monitor, revision: 2 },
        schedule: {
          correlationId: 'schedule-correlation-id',
          customIntervalMinutes: 60,
          dailyTime: null,
          hourlyMinute: null,
          monitorId: monitor.id,
          monitorRevision: 2,
          scheduleType: 'custom' as const,
          timeZone: 'UTC',
        },
      }),
      updateTarget: vi.fn().mockResolvedValue({
        monitor: { ...monitor, revision: 2 },
        target: { repeatedList: null, selector: null, targetType: 'whole_page' as const },
      }),
      updateRules: vi.fn().mockResolvedValue({
        monitor: { ...monitor, revision: 2 },
        rules: {
          baseline: { revision: 2, state: 'pending' as const },
          configuration: { keyword: null, newItem: false, textChange: true },
        },
      }),
      ...monitors,
    },
    emailDelivery: {
      enabled: true,
      sendVerification: vi.fn().mockResolvedValue(undefined),
      ...emailDelivery,
    },
    rateLimitPolicies: {
      deletion: { limit: 3, windowMs: 60_000 },
      login: { limit: 5, windowMs: 60_000 },
      preview: { limit: 10, windowMs: 60_000 },
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
        email: 'member@example.test',
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      redeemOwnerSetup: vi.fn().mockResolvedValue({
        email: 'owner@example.test',
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      requestEmailVerification: vi.fn().mockResolvedValue(undefined),
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

const monitor: Monitor = {
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  id: 'monitor-id',
  name: 'Career openings',
  revision: 1,
  state: 'active',
  url: 'https://example.test/jobs',
};

function serializeMonitorForTest(value: Monitor) {
  return {
    createdAt: value.createdAt.toISOString(),
    id: value.id,
    name: value.name,
    revision: value.revision,
    state: value.state,
    url: value.url,
  };
}

const localAuditIpHash = '12ca17b49af2289436f303e0166030a21e525d266e209267433801a8fd4071a0';

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
      expect.objectContaining({ requestId: 'req-1', requesterIpHash: localAuditIpHash }),
    );
    expect(authentication.emailDelivery.sendVerification).toHaveBeenCalledWith({
      email: 'owner@example.test',
      expiresAt: new Date('2026-08-24T00:00:00.000Z'),
      token: 'verification-token-must-not-be-returned',
    });
  });

  it('does not consume an owner setup token when verification delivery is disabled', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        enabled: false,
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/owner-setup',
      payload: { password: 'a secure password', token: 'owner-setup-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Authentication temporarily unavailable' });
    expect(authentication.service.redeemOwnerSetup).not.toHaveBeenCalled();
  });

  it('resends verification mail without revealing whether an account is eligible', async () => {
    const authentication = createAuthenticationDependencies({
      requestEmailVerification: vi.fn().mockResolvedValue({
        email: 'owner@example.test',
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'replacement-verification-token',
      }),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verifications/resend',
      payload: { email: 'owner@example.test' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'verification_required' });
    expect(response.body).not.toContain('replacement-verification-token');
    expect(authentication.emailDelivery.sendVerification).toHaveBeenCalledWith({
      email: 'owner@example.test',
      expiresAt: new Date('2026-08-24T00:00:00.000Z'),
      token: 'replacement-verification-token',
    });
  });

  it('returns unavailable when a verification message cannot be delivered', async () => {
    const authentication = createAuthenticationDependencies(
      {
        requestEmailVerification: vi.fn().mockResolvedValue({
          email: 'owner@example.test',
          expiresAt: new Date('2026-08-24T00:00:00.000Z'),
          token: 'replacement-verification-token',
        }),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { sendVerification: vi.fn().mockRejectedValue(new Error('Mailpit unavailable')) },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verifications/resend',
      payload: { email: 'owner@example.test' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Authentication temporarily unavailable' });
    expect(response.body).not.toContain('Mailpit unavailable');
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
      expect.objectContaining({ requestId: 'req-1', requesterIpHash: localAuditIpHash }),
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
      expect.objectContaining({ requestId: 'req-2', requesterIpHash: localAuditIpHash }),
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
      expect.objectContaining({ requestId: 'req-1', requesterIpHash: localAuditIpHash }),
    );
    expect(disabled.statusCode).toBe(204);
    expect(authentication.totp.disable).toHaveBeenCalledWith(
      'owner-id',
      'session-id',
      { code: '123456' },
      expect.objectContaining({ requestId: 'req-2', requesterIpHash: localAuditIpHash }),
    );
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
    expect(authentication.sessions.revoke).toHaveBeenCalledWith(
      'owner-id',
      'session-id',
      expect.objectContaining({ requestId: 'req-1', requesterIpHash: localAuditIpHash }),
    );
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
    expect(authentication.accountDeletion.request).toHaveBeenCalledWith(
      'member-id',
      expect.objectContaining({ requestId: 'req-1', requesterIpHash: localAuditIpHash }),
    );
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

  it('allows a member to create, revise, pause, resume, and delete only their own monitors', async () => {
    const created = { ...monitor, revision: 1 };
    const updated = { ...monitor, name: 'Updated monitor', revision: 2 };
    const paused = { ...updated, revision: 3, state: 'paused' as const };
    const resumed = { ...updated, revision: 4, state: 'active' as const };
    const monitors: Partial<MonitorService> = {
      create: vi.fn().mockResolvedValue(created),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(created),
      list: vi.fn().mockResolvedValue([created]),
      pause: vi.fn().mockResolvedValue(paused),
      resume: vi.fn().mockResolvedValue(resumed),
      update: vi.fn().mockResolvedValue(updated),
    };
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      monitors,
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const listed = await testApp.inject({
      method: 'GET',
      url: '/api/v1/monitors',
      headers: { cookie },
    });
    const createdResponse = await testApp.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: { cookie },
      payload: { name: 'Career openings', url: 'https://example.test/jobs' },
    });
    const fetched = await testApp.inject({
      method: 'GET',
      url: '/api/v1/monitors/monitor-id',
      headers: { cookie },
    });
    const changed = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id',
      headers: { cookie, 'if-match': '"1"' },
      payload: { name: 'Updated monitor', url: 'https://example.test/jobs' },
    });
    const pausedResponse = await testApp.inject({
      method: 'POST',
      url: '/api/v1/monitors/monitor-id/pause',
      headers: { cookie, 'if-match': '"2"' },
    });
    const resumedResponse = await testApp.inject({
      method: 'POST',
      url: '/api/v1/monitors/monitor-id/resume',
      headers: { cookie, 'if-match': '"3"' },
    });
    const deleted = await testApp.inject({
      method: 'DELETE',
      url: '/api/v1/monitors/monitor-id',
      headers: { cookie, 'if-match': '"4"' },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.json()).toEqual({
      monitors: [expect.objectContaining({ id: 'monitor-id', revision: 1 })],
    });
    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.headers.etag).toBe('"1"');
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers.etag).toBe('"1"');
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).toBe('"2"');
    expect(pausedResponse.json()).toMatchObject({ revision: 3, state: 'paused' });
    expect(resumedResponse.json()).toMatchObject({ revision: 4, state: 'active' });
    expect(deleted.statusCode).toBe(204);
    expect(authentication.monitors.create).toHaveBeenCalledWith('member-id', {
      name: 'Career openings',
      url: 'https://example.test/jobs',
    });
    expect(authentication.monitors.update).toHaveBeenCalledWith('member-id', 'monitor-id', 1, {
      name: 'Updated monitor',
      url: 'https://example.test/jobs',
    });
    expect(authentication.monitors.pause).toHaveBeenCalledWith('member-id', 'monitor-id', 2);
    expect(authentication.monitors.resume).toHaveBeenCalledWith('member-id', 'monitor-id', 3);
    expect(authentication.monitors.delete).toHaveBeenCalledWith('member-id', 'monitor-id', 4);
  });

  it('rejects missing and stale monitor revisions without exposing monitor data', async () => {
    const monitors: Partial<MonitorService> = {
      update: vi.fn().mockRejectedValue(new MonitorRevisionConflictError()),
    };
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      monitors,
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const payload = { name: 'Career openings', url: 'https://example.test/jobs' };

    const missing = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      payload,
    });
    const stale = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id',
      headers: {
        cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'if-match': '"1"',
      },
      payload,
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'Invalid monitor request' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'Monitor has changed' });
    expect(authentication.monitors.update).toHaveBeenCalledTimes(1);
  });

  it('lets a member configure, read, and remove a timezone-aware monitor schedule', async () => {
    const scheduledMonitor = { ...monitor, revision: 2 };
    const schedule = {
      correlationId: 'schedule-correlation-id',
      customIntervalMinutes: null,
      dailyTime: '09:30',
      hourlyMinute: null,
      monitorId: monitor.id,
      monitorRevision: 2,
      scheduleType: 'daily' as const,
      timeZone: 'America/New_York',
    };
    const monitors: Partial<MonitorService> = {
      deleteSchedule: vi.fn().mockResolvedValue({ ...scheduledMonitor, revision: 3 }),
      getSchedule: vi.fn().mockResolvedValue({ monitor, schedule: null }),
      updateSchedule: vi.fn().mockResolvedValue({ monitor: scheduledMonitor, schedule }),
    };
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      monitors,
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const fetched = await testApp.inject({
      method: 'GET',
      url: '/api/v1/monitors/monitor-id/schedule',
      headers: { cookie },
    });
    const configured = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id/schedule',
      headers: { cookie, 'if-match': '"1"' },
      payload: { dailyTime: '09:30', scheduleType: 'daily', timeZone: 'America/New_York' },
    });
    const removed = await testApp.inject({
      method: 'DELETE',
      url: '/api/v1/monitors/monitor-id/schedule',
      headers: { cookie, 'if-match': '"2"' },
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers.etag).toBe('"1"');
    expect(fetched.json()).toEqual({
      monitor: {
        createdAt: '2026-08-24T00:00:00.000Z',
        id: 'monitor-id',
        name: 'Career openings',
        revision: 1,
        state: 'active',
        url: 'https://example.test/jobs',
      },
      schedule: null,
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.headers.etag).toBe('"2"');
    expect(configured.json()).toEqual({
      monitor: {
        createdAt: '2026-08-24T00:00:00.000Z',
        id: 'monitor-id',
        name: 'Career openings',
        revision: 2,
        state: 'active',
        url: 'https://example.test/jobs',
      },
      schedule: {
        customIntervalMinutes: null,
        dailyTime: '09:30',
        hourlyMinute: null,
        scheduleType: 'daily',
        timeZone: 'America/New_York',
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.headers.etag).toBe('"3"');
    expect(authentication.monitors.updateSchedule).toHaveBeenCalledWith(
      'member-id',
      'monitor-id',
      1,
      {
        dailyTime: '09:30',
        scheduleType: 'daily',
        timeZone: 'America/New_York',
      },
    );
    expect(authentication.monitors.deleteSchedule).toHaveBeenCalledWith(
      'member-id',
      'monitor-id',
      2,
    );
  });

  it('rejects invalid schedule preconditions before calling monitor services', async () => {
    const authentication = createAuthenticationDependencies({}, undefined, {
      authenticate: vi.fn().mockResolvedValue(memberSession),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id/schedule',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      payload: { dailyTime: '09:30', scheduleType: 'daily', timeZone: 'America/New_York' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid monitor schedule' });
    expect(authentication.monitors.updateSchedule).not.toHaveBeenCalled();
  });

  it('lets a member configure a CSS target and preview the selected text', async () => {
    const cssTarget = {
      repeatedList: {
        identitySelector: 'a[href]',
        ignoreSelectors: ['.meta'],
        itemSelector: 'ul.openings > li.job',
      },
      selector: 'main > article',
      targetType: 'css_selector' as const,
    };
    const cssTargetRequest = {
      repeatedList: {
        identitySelector: 'a[href]',
        ignoreSelectors: ['.meta'],
        itemSelector: 'ul.openings > li.job',
      },
      selector: 'main > article',
      targetType: 'css_selector' as const,
    };
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        getTarget: vi.fn().mockResolvedValue({ monitor, target: cssTarget }),
        updateTarget: vi.fn().mockResolvedValue({
          monitor: { ...monitor, revision: 2 },
          target: cssTarget,
        }),
      },
    );
    const monitorPreview = {
      preview: vi.fn().mockResolvedValue({
        matchCount: 2,
        repeatedList: {
          itemCount: 2,
          items: [{ identity: 'First role', text: 'First role' }],
          truncated: true,
        },
        repeatedListCandidates: [
          {
            identitySelectorSuggestions: ['a[href]'],
            itemCount: 2,
            itemSelector: 'ul.openings > li.job',
            sampleTexts: ['First role Remote'],
          },
        ],
        text: 'First role Second role',
        truncated: false,
      }),
    };
    const testApp = await buildApp({ authentication, monitorPreview });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const fetched = await testApp.inject({
      method: 'GET',
      url: '/api/v1/monitors/monitor-id/target',
      headers: { cookie },
    });
    const configured = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id/target',
      headers: { cookie, 'if-match': '"1"' },
      payload: cssTargetRequest,
    });
    const previewed = await testApp.inject({
      method: 'POST',
      url: '/api/v1/monitors/monitor-id/target/preview',
      headers: { cookie },
      payload: cssTargetRequest,
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers.etag).toBe('"1"');
    expect(fetched.json()).toEqual({
      monitor: serializeMonitorForTest(monitor),
      target: cssTarget,
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.headers.etag).toBe('"2"');
    expect(configured.json()).toEqual({
      monitor: serializeMonitorForTest({ ...monitor, revision: 2 }),
      target: cssTarget,
    });
    expect(previewed.statusCode).toBe(200);
    expect(previewed.json()).toEqual({
      preview: {
        matchCount: 2,
        repeatedList: {
          itemCount: 2,
          items: [{ identity: 'First role', text: 'First role' }],
          truncated: true,
        },
        repeatedListCandidates: [
          {
            identitySelectorSuggestions: ['a[href]'],
            itemCount: 2,
            itemSelector: 'ul.openings > li.job',
            sampleTexts: ['First role Remote'],
          },
        ],
        text: 'First role Second role',
        truncated: false,
      },
    });
    expect(authentication.monitors.updateTarget).toHaveBeenCalledWith(
      activeSession.userId,
      'monitor-id',
      1,
      cssTargetRequest,
    );
    expect(monitorPreview.preview).toHaveBeenCalledWith(monitor, cssTargetRequest);
  });

  it('does not expose preview failures and enforces the preview rate limit', async () => {
    const monitorPreview = {
      preview: vi.fn().mockRejectedValue(new MonitorPreviewError('destination_not_allowed')),
    };
    const authentication = createAuthenticationDependencies(
      {},
      { increment: vi.fn().mockResolvedValue({ count: 1, ttlMs: 60_000 }) },
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
    );
    const testApp = await buildApp({ authentication, monitorPreview });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const rejected = await testApp.inject({
      method: 'POST',
      url: '/api/v1/monitors/monitor-id/target/preview',
      headers: { cookie },
      payload: { targetType: 'whole_page' },
    });

    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toEqual({ error: 'Preview target is not allowed' });
    expect(rejected.body).not.toContain('destination_not_allowed');

    await testApp.close();

    const throttledAuthentication = createAuthenticationDependencies(
      {},
      { increment: vi.fn().mockResolvedValue({ count: 11, ttlMs: 31_000 }) },
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
    );
    const throttledPreview = { preview: vi.fn() };
    const throttledApp = await buildApp({
      authentication: throttledAuthentication,
      monitorPreview: throttledPreview,
    });
    app = throttledApp;

    const throttled = await throttledApp.inject({
      method: 'POST',
      url: '/api/v1/monitors/monitor-id/target/preview',
      headers: { cookie },
      payload: { targetType: 'whole_page' },
    });

    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['retry-after']).toBe('31');
    expect(throttled.json()).toEqual({ error: 'Too many preview attempts' });
    expect(throttledPreview.preview).not.toHaveBeenCalled();
  });

  it('reads and resets a monitor rule baseline when the member saves rules', async () => {
    const rules = {
      baseline: { revision: 1, state: 'pending' as const },
      configuration: {
        keyword: { phrases: ['Hiring freeze'], transition: 'appears' as const },
        newItem: true,
        textChange: false,
      },
    };
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        getRules: vi.fn().mockResolvedValue({ monitor, rules }),
        updateRules: vi.fn().mockResolvedValue({
          monitor: { ...monitor, revision: 2 },
          rules: { ...rules, baseline: { revision: 2, state: 'pending' as const } },
        }),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const cookie = 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const configuration = rules.configuration;

    const fetched = await testApp.inject({
      method: 'GET',
      url: '/api/v1/monitors/monitor-id/rules',
      headers: { cookie },
    });
    const updated = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id/rules',
      headers: { cookie, 'if-match': '"1"' },
      payload: configuration,
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers.etag).toBe('"1"');
    expect(fetched.json()).toEqual({ monitor: serializeMonitorForTest(monitor), rules });
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.json()).toEqual({
      monitor: serializeMonitorForTest({ ...monitor, revision: 2 }),
      rules: { ...rules, baseline: { revision: 2, state: 'pending' } },
    });
    expect(authentication.monitors.updateRules).toHaveBeenCalledWith(
      activeSession.userId,
      'monitor-id',
      1,
      configuration,
    );
  });

  it('requires a session and preserves review conflicts for change actions', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(memberSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        resolveChangeReview: vi.fn().mockRejectedValue(new ChangeReviewConflictError()),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;
    const unauthorized = await testApp.inject({ method: 'GET', url: '/api/v1/changes' });
    const conflict = await testApp.inject({
      method: 'POST',
      url: '/api/v1/changes/change-id/review',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      payload: { state: 'expected' },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(conflict.statusCode).toBe(409);
    expect(authentication.monitors.resolveChangeReview).toHaveBeenCalledWith(
      memberSession.userId,
      'change-id',
      'expected',
    );
  });

  it('returns a safe target validation error without overwriting a newer monitor revision', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        updateTarget: vi
          .fn()
          .mockRejectedValue(new MonitorTargetValidationError('selector is not valid CSS')),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/v1/monitors/monitor-id/target',
      headers: {
        cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'if-match': '"1"',
      },
      payload: { selector: 'main[', targetType: 'css_selector' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid monitor target' });
    expect(response.body).not.toContain('selector is not valid CSS');
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
    expect(authentication.members.suspend).toHaveBeenCalledWith(
      'member-id',
      expect.objectContaining({ actorUserId: 'owner-id', requestId: 'req-2' }),
    );
    expect(authentication.members.reactivate).toHaveBeenCalledWith(
      'member-id',
      expect.objectContaining({ actorUserId: 'owner-id', requestId: 'req-3' }),
    );
    expect(authentication.members.remove).toHaveBeenCalledWith(
      'member-id',
      expect.objectContaining({ actorUserId: 'owner-id', requestId: 'req-4' }),
    );
  });

  it('limits audit history to owners and omits requester network metadata', async () => {
    const authentication = createAuthenticationDependencies(
      {},
      undefined,
      { authenticate: vi.fn().mockResolvedValue(activeSession) },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        list: vi.fn().mockResolvedValue([
          {
            action: 'member.suspended',
            actorUserId: 'owner-id',
            createdAt: new Date('2026-08-24T12:00:00.000Z'),
            expiresAt: new Date('2026-11-22T12:00:00.000Z'),
            id: 'audit-event-id',
            requesterIpHash: 'a'.repeat(64),
            requestId: 'req-1',
            targetId: 'member-id',
            targetType: 'member',
          },
        ]),
      },
    );
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/owner/audit-events',
      headers: { cookie: 'pagepulse_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      events: [
        {
          action: 'member.suspended',
          actorUserId: 'owner-id',
          createdAt: '2026-08-24T12:00:00.000Z',
          id: 'audit-event-id',
          targetId: 'member-id',
          targetType: 'member',
        },
      ],
    });
    expect(response.body).not.toContain('a'.repeat(64));
    expect(response.body).not.toContain('req-1');
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
