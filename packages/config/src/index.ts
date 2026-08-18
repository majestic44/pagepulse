import pino from 'pino';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().default('0.0.0-dev'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
});

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.parse(input);
}

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    name: service,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'credential',
        'cookies',
        'token',
        'secret',
        'headers',
      ],
      censor: '[REDACTED]',
    },
  });
}
