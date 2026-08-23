import { describe, expect, it } from 'vitest';

import {
  AuthRateLimitExceededError,
  AuthRateLimitUnavailableError,
  RedisFixedWindowRateLimitStore,
  authRateLimitKey,
  enforceAuthRateLimit,
} from './rate-limit.js';

describe('authentication rate limits', () => {
  it('uses a stable, non-plaintext requester key', () => {
    const key = authRateLimitKey('login', '203.0.113.10');

    expect(key).toMatch(/^pagepulse:auth-rate-limit:login:[a-f0-9]{64}$/u);
    expect(key).not.toContain('203.0.113.10');
  });

  it('rejects requests over the limit with a bounded retry-after value', async () => {
    const store = { increment: () => Promise.resolve({ count: 6, ttlMs: 1_500 }) };

    await expect(
      enforceAuthRateLimit(store, 'login', '203.0.113.10', { limit: 5, windowMs: 60_000 }),
    ).rejects.toMatchObject({
      name: AuthRateLimitExceededError.name,
      retryAfterSeconds: 2,
    });
  });

  it('fails closed when the rate-limit store is unavailable', async () => {
    const store = { increment: async () => Promise.reject(new Error('redis unavailable')) };

    await expect(
      enforceAuthRateLimit(store, 'login', '203.0.113.10', { limit: 5, windowMs: 60_000 }),
    ).rejects.toBeInstanceOf(AuthRateLimitUnavailableError);
  });
});

describe('RedisFixedWindowRateLimitStore', () => {
  it('returns the counter and remaining fixed-window lifetime', async () => {
    const pipeline = {
      exec: () =>
        Promise.resolve([
          [null, 2],
          [null, 1],
          [null, 59_000],
        ]),
      incr: () => pipeline,
      pexpire: () => pipeline,
      pttl: () => pipeline,
    };
    const store = new RedisFixedWindowRateLimitStore({ multi: () => pipeline } as never);

    await expect(store.increment('pagepulse:auth-rate-limit:login:key', 60_000)).resolves.toEqual({
      count: 2,
      ttlMs: 59_000,
    });
  });
});
