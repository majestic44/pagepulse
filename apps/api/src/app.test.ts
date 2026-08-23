import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordValidationError, type RateLimitStore } from '@pagepulse/auth';
import { loadEnvironment } from '@pagepulse/config';
import type { AuthenticationDependencies, AuthenticationService } from './auth.js';
import { buildApp } from './app.js';
import { createHealthService } from './health.js';

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => app?.close());

function createAuthenticationDependencies(
  service: Partial<AuthenticationService> = {},
  rateLimitStore: RateLimitStore = {
    increment: vi.fn().mockResolvedValue({ count: 1, ttlMs: 60_000 }),
  },
): AuthenticationDependencies {
  return {
    rateLimitPolicies: {
      login: { limit: 5, windowMs: 60_000 },
      redemption: { limit: 5, windowMs: 60_000 },
      reset: { limit: 3, windowMs: 60_000 },
    },
    rateLimitStore,
    service: {
      completePasswordReset: vi.fn().mockResolvedValue(undefined),
      confirmEmailVerification: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(false),
      redeemInvitation: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      redeemOwnerSetup: vi.fn().mockResolvedValue({
        expiresAt: new Date('2026-08-24T00:00:00.000Z'),
        token: 'verification-token-must-not-be-returned',
      }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      ...service,
    },
  };
}

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

  it('restricts detailed diagnostics to the configured owner token', async () => {
    const token = 'diagnostics-owner-token';
    const testApp = await buildApp({
      environment: loadEnvironment({ APP_VERSION: '1.2.3', OWNER_DIAGNOSTICS_TOKEN: token }),
      healthService: createHealthService({
        database: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      }),
      now: () => 1_000,
    });
    app = testApp;

    await expect(
      testApp.inject({ method: 'GET', url: '/api/v1/system/diagnostics' }),
    ).resolves.toMatchObject({
      statusCode: 401,
    });
    await expect(
      testApp.inject({
        method: 'GET',
        url: '/api/v1/system/diagnostics',
        headers: { authorization: `Bearer ${token}` },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/v1/system/diagnostics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.json()).toEqual({
      status: 'degraded',
      service: 'api',
      version: '1.2.3',
      uptimeSeconds: 0,
      dependencies: { database: 'ok', redis: 'unavailable' },
    });
    expect(response.body).not.toContain('redis unavailable');
  });

  it('does not register diagnostics without an owner token', async () => {
    const testApp = await buildApp({
      healthService: createHealthService({
        database: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockResolvedValue(undefined),
      }),
    });
    app = testApp;

    const response = await testApp.inject({ method: 'GET', url: '/api/v1/system/diagnostics' });

    expect(response.statusCode).toBe(404);
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

  it('does not create a session until the next identity item implements sessions', async () => {
    const authentication = createAuthenticationDependencies({
      login: vi.fn().mockResolvedValue(true),
    });
    const testApp = await buildApp({ authentication });
    app = testApp;

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@example.test', password: 'a secure password' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
