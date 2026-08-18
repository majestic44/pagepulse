import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { createLogger, loadEnvironment } from '@pagepulse/config';
import { HealthResponse } from '@pagepulse/contracts';

export async function buildApp() {
  const env = loadEnvironment();
  const app = Fastify({ loggerInstance: createLogger('api', env.LOG_LEVEL) });
  await app.register(swagger, {
    openapi: { info: { title: 'PagePulse API', version: env.APP_VERSION } },
  });
  const started = Date.now();
  app.get('/health/live', { schema: { response: { 200: HealthResponse } } }, () => ({
    status: 'ok' as const,
    service: 'api',
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - started) / 1000),
  }));
  app.get('/health/ready', () => ({
    status: 'ok',
    dependencies: { database: 'not-wired', redis: 'not-wired' },
  }));
  app.get('/api/v1/system/version', () => ({
    version: env.APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - started) / 1000),
  }));
  return app;
}
