import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '@pagepulse/config';
import { buildApp } from './app.js';
import { createHealthService } from './health.js';

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => app?.close());

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
