import { readFileSync } from 'node:fs';
import pino, { type DestinationStream, type Logger } from 'pino';
import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const workerRoles = ['scheduler', 'change-detection', 'notification', 'maintenance'] as const;

const secretFileVariables = [
  'DATABASE_URL',
  'REDIS_URL',
  'OWNER_DIAGNOSTICS_TOKEN',
  'SESSION_SECRET',
  'COOKIE_ENCRYPTION_KEK',
  'CREDENTIAL_ENCRYPTION_KEK',
  'TOTP_ENCRYPTION_KEK',
  'RESEND_API_KEY',
  'POSTMARK_SERVER_TOKEN',
  'VAPID_PRIVATE_KEY',
  'CLOUDFLARE_TUNNEL_TOKEN',
] as const;

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DEVTOOLS_PORT: z.coerce.number().int().min(1).max(65_535).default(4010),
    APP_VERSION: z.string().trim().min(1).max(128).default('0.0.0-dev'),
    APP_BASE_URL: z.url().optional(),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    DATABASE_URL: z.url().default('mysql://pagepulse:pagepulse@localhost:3306/pagepulse'),
    REDIS_URL: z.url().default('redis://localhost:6379/0'),
    OWNER_DIAGNOSTICS_TOKEN: z.string().trim().min(1).optional(),
    QUEUE_PREFIX: z.string().trim().min(1).max(64).default('pagepulse'),
    WORKER_ROLE: z.enum(workerRoles).default('scheduler'),
    SCHEDULER_RECONCILIATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(3_600_000)
      .default(300_000),
    HTTP_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
    HTTP_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    HTTP_FETCH_MAX_BYTES: z.coerce.number().int().min(1_024).max(100_000_000).default(5_242_880),
    DOMAIN_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    BROWSER_CONCURRENCY_MIN: z.coerce.number().int().min(1).max(16).default(1),
    BROWSER_CONCURRENCY_MAX: z.coerce.number().int().min(1).max(16).default(2),
    BROWSER_MEMORY_HIGH_WATERMARK_MB: z.coerce.number().int().min(256).max(65_536).default(7_000),
    BROWSER_JOB_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
    SESSION_SECRET: z.string().trim().min(1).optional(),
    COOKIE_ENCRYPTION_KEK: z.string().trim().min(1).optional(),
    CREDENTIAL_ENCRYPTION_KEK: z.string().trim().min(1).optional(),
    TOTP_ENCRYPTION_KEK: z.string().trim().min(1).optional(),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    POSTMARK_SERVER_TOKEN: z.string().trim().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().trim().min(1).optional(),
    CLOUDFLARE_TUNNEL_TOKEN: z.string().trim().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.BROWSER_CONCURRENCY_MIN > environment.BROWSER_CONCURRENCY_MAX) {
      context.addIssue({
        code: 'custom',
        message: 'BROWSER_CONCURRENCY_MIN must not exceed BROWSER_CONCURRENCY_MAX',
        path: ['BROWSER_CONCURRENCY_MIN'],
      });
    }
    if (environment.NODE_ENV === 'production' && environment.APP_BASE_URL?.startsWith('http://')) {
      context.addIssue({
        code: 'custom',
        message: 'APP_BASE_URL must use HTTPS in production',
        path: ['APP_BASE_URL'],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export type EnvironmentValidationIssue = Readonly<{
  code: string;
  message: string;
  path: ReadonlyArray<PropertyKey>;
}>;

export class EnvironmentSecretFileError extends Error {
  constructor(variable: string, filePath: string, cause?: unknown) {
    super(`Unable to load ${variable}_FILE at ${JSON.stringify(filePath)}`, { cause });
    this.name = 'EnvironmentSecretFileError';
  }
}

export class EnvironmentValidationError extends Error {
  readonly issues: ReadonlyArray<EnvironmentValidationIssue>;

  constructor(issues: ReadonlyArray<EnvironmentValidationIssue>) {
    const normalizedIssues = issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [...issue.path],
    }));
    super(
      `Invalid PagePulse environment: ${normalizedIssues
        .map((issue) => `${issue.path.map(String).join('.') || 'environment'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.issues = normalizedIssues;
    this.name = 'EnvironmentValidationError';
  }
}

function loadSecretFile(variable: (typeof secretFileVariables)[number], input: NodeJS.ProcessEnv) {
  const fileVariable = `${variable}_FILE`;
  const inlineValue = input[variable];
  const filePath = input[fileVariable];
  if (inlineValue !== undefined && filePath !== undefined) {
    throw new EnvironmentSecretFileError(
      variable,
      filePath,
      new Error(`${variable} and ${fileVariable} cannot both be set`),
    );
  }
  if (filePath === undefined) {
    return inlineValue;
  }
  try {
    const value = readFileSync(filePath, 'utf8').trimEnd();
    if (value.length === 0) {
      throw new Error('Secret file is empty');
    }
    return value;
  } catch (error) {
    throw new EnvironmentSecretFileError(variable, filePath, error);
  }
}

function resolveSecretFiles(input: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(
    secretFileVariables.map((variable) => [variable, loadSecretFile(variable, input)]),
  );
}

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse({ ...input, ...resolveSecretFiles(input) });
  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }
  return result.data;
}

const sensitiveLogKey =
  /authorization|cookie|password|credential|token|secret|header|body|email|url|uri|query|payload|content|totp|vapid|kek/i;
const redacted = '[REDACTED]';

function redactLogValue(value: unknown, visited: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: redacted };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, visited));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (visited.has(value)) {
    return '[CIRCULAR]';
  }
  visited.add(value);
  const redactedValue: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === 'req') {
      redactedValue[key] = serializeRequest(nestedValue);
    } else if (key === 'res') {
      redactedValue[key] = serializeResponse(nestedValue);
    } else if (key === 'err' || key === 'error') {
      redactedValue[key] = serializeError(nestedValue);
    } else {
      redactedValue[key] = sensitiveLogKey.test(key)
        ? redacted
        : redactLogValue(nestedValue, visited);
    }
  }
  return redactedValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function serializeRequest(request: unknown): Record<string, string> {
  const method = asRecord(request).method;
  return typeof method === 'string' ? { method } : {};
}

function serializeResponse(response: unknown): Record<string, number> {
  const statusCode = asRecord(response).statusCode;
  return typeof statusCode === 'number' ? { statusCode } : {};
}

function serializeError(error: unknown): Record<string, string> {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: redacted,
  };
}

export function createLogger(
  service: string,
  level: Environment['LOG_LEVEL'] = 'info',
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      name: service,
      level,
      formatters: {
        log: (object) => redactLogValue(object, new WeakSet()) as Record<string, unknown>,
      },
      serializers: {
        err: serializeError,
        error: serializeError,
        req: serializeRequest,
        res: serializeResponse,
      },
    },
    destination,
  );
}
