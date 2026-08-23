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
    });
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

  it('loads the owner diagnostics token from a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pagepulse-config-'));
    temporaryDirectories.push(directory);
    const secretPath = join(directory, 'owner-diagnostics-token');
    await writeFile(secretPath, 'diagnostics-token\n');

    const environment = loadEnvironment({ OWNER_DIAGNOSTICS_TOKEN_FILE: secretPath });

    expect(environment.OWNER_DIAGNOSTICS_TOKEN).toBe('diagnostics-token');
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
