import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { createLogger, loadEnvironment, type Environment } from '@pagepulse/config';
import { probeDatabase } from '@pagepulse/db';
import {
  DiagnosticsResponse,
  HealthResponse,
  UnauthorizedResponse,
  VersionResponse,
} from '@pagepulse/contracts';
import { probeRedis } from '@pagepulse/queue';
import { createHealthService, type HealthService } from './health.js';

export type BuildAppOptions = Readonly<{
  environment?: Environment;
  healthService?: HealthService;
  now?: () => number;
}>;

function hasOwnerDiagnosticsAccess(authorization: string | undefined, token: string) {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(authorization ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function buildApp(options: BuildAppOptions = {}) {
  const env = options.environment ?? loadEnvironment();
  const app = Fastify({ loggerInstance: createLogger('api', env.LOG_LEVEL) });
  await app.register(swagger, {
    openapi: { info: { title: 'PagePulse API', version: env.APP_VERSION } },
  });
  const now = options.now ?? Date.now;
  const started = now();
  const healthService =
    options.healthService ??
    createHealthService({
      database: () => probeDatabase(env.DATABASE_URL),
      redis: () => probeRedis(env.REDIS_URL),
    });
  const serviceHealth = (status: 'ok' | 'degraded') => ({
    status,
    service: 'api',
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((now() - started) / 1000),
  });

  app.get('/health/live', { schema: { response: { 200: HealthResponse } } }, () => ({
    ...serviceHealth('ok'),
  }));

  app.get(
    '/health/ready',
    { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
    async (_request, reply) => {
      const diagnostics = await healthService.collectDiagnostics();
      return reply
        .code(diagnostics.status === 'ok' ? 200 : 503)
        .send(serviceHealth(diagnostics.status));
    },
  );

  app.get('/api/v1/system/version', { schema: { response: { 200: VersionResponse } } }, () => ({
    service: 'api',
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((now() - started) / 1000),
  }));

  if (env.OWNER_DIAGNOSTICS_TOKEN) {
    app.get(
      '/api/v1/system/diagnostics',
      {
        preHandler: async (request, reply) => {
          if (
            !hasOwnerDiagnosticsAccess(request.headers.authorization, env.OWNER_DIAGNOSTICS_TOKEN!)
          ) {
            return reply.code(401).send({ error: 'Unauthorized' });
          }
        },
        schema: { response: { 200: DiagnosticsResponse, 401: UnauthorizedResponse } },
      },
      async () => {
        const diagnostics = await healthService.collectDiagnostics();
        return { ...serviceHealth(diagnostics.status), dependencies: diagnostics.dependencies };
      },
    );
  }

  return app;
}
