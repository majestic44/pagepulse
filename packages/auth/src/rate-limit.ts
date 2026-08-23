import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export type RateLimitPolicy = Readonly<{
  limit: number;
  windowMs: number;
}>;

export type RateLimitStore = Readonly<{
  increment: (key: string, windowMs: number) => Promise<Readonly<{ count: number; ttlMs: number }>>;
}>;

export class RedisFixedWindowRateLimitStore implements RateLimitStore {
  constructor(private readonly connection: Pick<Redis, 'multi'>) {}

  async increment(key: string, windowMs: number) {
    const results = await this.connection
      .multi()
      .incr(key)
      .pexpire(key, windowMs, 'NX')
      .pttl(key)
      .exec();
    const count = results?.[0]?.[1];
    const ttlMs = results?.[2]?.[1];
    if (typeof count !== 'number' || typeof ttlMs !== 'number' || ttlMs < 0) {
      throw new Error('Redis returned an invalid rate-limit result');
    }
    return { count, ttlMs };
  }
}

export class AuthRateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many authentication attempts');
    this.name = 'AuthRateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AuthRateLimitUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Authentication rate limiting is unavailable', { cause });
    this.name = 'AuthRateLimitUnavailableError';
  }
}

export function authRateLimitKey(scope: string, requesterIp: string) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(scope)) {
    throw new Error('Authentication rate-limit scope is invalid');
  }
  return `pagepulse:auth-rate-limit:${scope}:${createHash('sha256').update(requesterIp).digest('hex')}`;
}

export async function enforceAuthRateLimit(
  store: RateLimitStore,
  scope: string,
  requesterIp: string,
  policy: RateLimitPolicy,
) {
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1) {
    throw new Error('Authentication rate-limit limit is invalid');
  }
  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1_000) {
    throw new Error('Authentication rate-limit window is invalid');
  }
  let result: Readonly<{ count: number; ttlMs: number }>;
  try {
    result = await store.increment(authRateLimitKey(scope, requesterIp), policy.windowMs);
  } catch (error) {
    throw new AuthRateLimitUnavailableError(error);
  }
  if (!Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.ttlMs)) {
    throw new AuthRateLimitUnavailableError();
  }
  if (result.count > policy.limit) {
    throw new AuthRateLimitExceededError(Math.max(1, Math.ceil(result.ttlMs / 1_000)));
  }
}
