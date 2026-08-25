import { Writable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  EnvironmentSecretFileError,
  EnvironmentValidationError,
  loadEnvironment,
} from './index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('loadEnvironment', () => {
  it('uses safe development defaults and coerces numeric settings', () => {
    const environment = loadEnvironment({ PORT: '4011', HTTP_FETCH_CONCURRENCY: '3' });

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4011,
      HTTP_FETCH_CONCURRENCY: 3,
      REDIS_URL: 'redis://localhost:6379/0',
      SCHEDULER_RECONCILIATION_INTERVAL_MS: 300_000,
      ACCOUNT_DELETION_SWEEP_INTERVAL_MS: 3_600_000,
      OWNER_SETUP_TOKEN_TTL_MINUTES: 30,
      AUTH_EMAIL_DELIVERY_MODE: 'disabled',
      AUTH_ARGON2_MEMORY_KIB: 65_536,
      AUTH_LOGIN_RATE_LIMIT_MAX: 5,
      AUTH_DELETION_RATE_LIMIT_MAX: 3,
      AUTH_TOTP_RATE_LIMIT_MAX: 5,
      MONITOR_PREVIEW_RATE_LIMIT_MAX: 10,
      MONITOR_PREVIEW_RATE_LIMIT_WINDOW_MS: 60_000,
    });
  });

  it('rejects an unsafe owner setup token lifetime', () => {
    let validationError: EnvironmentValidationError | undefined;
    try {
      loadEnvironment({ OWNER_SETUP_TOKEN_TTL_MINUTES: '4' });
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        validationError = error;
      }
    }

    expect(validationError).toBeInstanceOf(EnvironmentValidationError);
    expect(validationError?.issues).toContainEqual(
      expect.objectContaining({ path: ['OWNER_SETUP_TOKEN_TTL_MINUTES'] }),
    );
  });

  it('rejects Argon2 settings with too little memory for the requested parallelism', () => {
    let validationError: EnvironmentValidationError | undefined;
    try {
      loadEnvironment({ AUTH_ARGON2_MEMORY_KIB: '8', AUTH_ARGON2_PARALLELISM: '2' });
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        validationError = error;
      }
    }

    expect(validationError?.issues).toContainEqual(
      expect.objectContaining({ path: ['AUTH_ARGON2_MEMORY_KIB'] }),
    );
  });

  it('rejects an idle session lifetime longer than the absolute lifetime', () => {
    let validationError: EnvironmentValidationError | undefined;
    try {
      loadEnvironment({ SESSION_ABSOLUTE_TTL_MINUTES: '60', SESSION_IDLE_TTL_MINUTES: '61' });
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        validationError = error;
      }
    }

    expect(validationError?.issues).toContainEqual(
      expect.objectContaining({ path: ['SESSION_IDLE_TTL_MINUTES'] }),
    );
  });

  it('rejects an unsafe scheduler reconciliation interval', () => {
    let validationError: EnvironmentValidationError | undefined;
    try {
      loadEnvironment({ SCHEDULER_RECONCILIATION_INTERVAL_MS: '59999' });
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        validationError = error;
      }
    }

    expect(validationError).toBeInstanceOf(EnvironmentValidationError);
    expect(validationError?.issues).toContainEqual(
      expect.objectContaining({ path: ['SCHEDULER_RECONCILIATION_INTERVAL_MS'] }),
    );
  });

  it('loads a secret from a file and removes all trailing whitespace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pagepulse-config-'));
    temporaryDirectories.push(directory);
    const secretPath = join(directory, 'redis-url');
    await writeFile(secretPath, 'redis://:secret@redis:6379/0  \n\n');

    const environment = loadEnvironment({ REDIS_URL_FILE: secretPath });

    expect(environment.REDIS_URL).toBe('redis://:secret@redis:6379/0');
  });

  it('rejects ambiguous direct and file-backed secrets', () => {
    expect(() =>
      loadEnvironment({
        REDIS_URL: 'redis://localhost:6379/0',
        REDIS_URL_FILE: '/run/secrets/redis_url',
      }),
    ).toThrow(EnvironmentSecretFileError);
  });

  it('reports invalid cross-field configuration with its variable path', () => {
    let validationError: EnvironmentValidationError | undefined;

    try {
      loadEnvironment({ BROWSER_CONCURRENCY_MIN: '3', BROWSER_CONCURRENCY_MAX: '2' });
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        validationError = error;
      }
    }

    expect(validationError).toBeInstanceOf(EnvironmentValidationError);
    expect(validationError?.message).toContain('BROWSER_CONCURRENCY_MIN:');
    expect(validationError?.issues).toContainEqual(
      expect.objectContaining({ path: ['BROWSER_CONCURRENCY_MIN'] }),
    );
  });

  it('allows Mailpit delivery only for local development with an application URL', () => {
    expect(() =>
      loadEnvironment({
        APP_BASE_URL: 'http://localhost:8080',
        AUTH_EMAIL_DELIVERY_MODE: 'mailpit',
        NODE_ENV: 'production',
      }),
    ).toThrow(EnvironmentValidationError);

    expect(() => loadEnvironment({ AUTH_EMAIL_DELIVERY_MODE: 'mailpit' })).toThrow(
      EnvironmentValidationError,
    );
  });
});

describe('createLogger', () => {
  it('redacts sensitive values recursively before JSON serialization', () => {
    const lines: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        const line = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        lines.push(JSON.parse(line) as Record<string, unknown>);
        callback();
      },
    });
    const logger = createLogger('config-test', 'info', destination);

    logger.info(
      {
        email: 'member@example.test',
        nested: {
          accessToken: 'never-log-me',
          correlationId: 'safe-correlation-id',
        },
        requestUrl: 'https://example.test/private?token=never-log-me',
        req: {
          headers: { authorization: 'Bearer never-log-me' },
          method: 'GET',
          url: '/private?token=never-log-me',
        },
        res: { statusCode: 200 },
        err: new Error('never-log-me'),
      },
      'configuration test',
    );

    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain('member@example.test');
    expect(serialized).not.toContain('never-log-me');
    expect(lines[0]).toMatchObject({ email: '[REDACTED]', requestUrl: '[REDACTED]' });
    expect(lines[0]?.nested).toEqual({
      accessToken: '[REDACTED]',
      correlationId: 'safe-correlation-id',
    });
    expect(lines[0]?.req).toEqual({ method: 'GET' });
    expect(lines[0]?.res).toEqual({ statusCode: 200 });
    expect(lines[0]?.err).toEqual({ name: 'Error', message: '[REDACTED]' });
  });
});
