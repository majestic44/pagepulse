import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const files = ['compose.yaml', 'compose.dev.yaml', 'compose.production.yaml'];
const appServices = [
  'gateway',
  'api',
  'scheduler',
  'fetch-worker',
  'browser-worker',
  'change-worker',
  'notification-worker',
  'maintenance-worker',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasLogRotation(service) {
  return (
    service.logging?.driver === 'json-file' &&
    typeof service.logging.options?.['max-size'] === 'string' &&
    typeof service.logging.options?.['max-file'] === 'string'
  );
}

for (const file of files) {
  const model = parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), {
    merge: true,
  });
  assert(model?.services && Object.keys(model.services).length > 0, `${file}: no services`);

  if (file === 'compose.yaml') {
    assert(model.networks?.app?.internal === true, `${file}: app network must be internal`);
    assert(model.networks?.data?.internal === true, `${file}: data network must be internal`);

    for (const service of appServices) {
      assert(
        model.services[service]?.healthcheck?.test,
        `${file}: ${service} must define a health check`,
      );
      assert(hasLogRotation(model.services[service]), `${file}: ${service} must use log rotation`);
    }

    for (const service of ['mariadb', 'redis'])
      assert(hasLogRotation(model.services[service]), `${file}: ${service} must use log rotation`);

    assert(
      model.services.gateway.networks?.includes('edge'),
      `${file}: gateway must use edge network`,
    );
    assert(
      !model.services.mariadb.networks?.includes('app'),
      `${file}: mariadb cannot use app network`,
    );
    assert(
      !model.services.redis.networks?.includes('app'),
      `${file}: redis cannot use app network`,
    );

    for (const volume of ['mariadb-data', 'redis-data', 'snapshots'])
      assert(model.volumes?.[volume], `${file}: ${volume} volume is required`);
  }

  if (file === 'compose.dev.yaml') {
    assert(!model.services.gateway, `${file}: gateway must inherit the core loopback binding`);
    assert(
      model.services.devtools?.healthcheck?.test,
      `${file}: devtools must define a health check`,
    );
    for (const name of ['mailpit', 'adminer', 'devtools', 'queue-dashboard']) {
      const service = model.services[name];
      assert(hasLogRotation(service), `${file}: ${name} must use log rotation`);
      for (const port of service.ports ?? [])
        assert(
          String(port).startsWith('127.0.0.1:'),
          `${file}: ${name} must bind ports to loopback`,
        );
    }
  }

  if (file === 'compose.production.yaml') {
    for (const service of appServices) {
      const definition = model.services[service];
      assert(
        definition?.image?.startsWith('ghcr.io/majestic44/pagepulse-'),
        `${file}: ${service} image missing`,
      );
      assert(definition.build === null, `${file}: ${service} must not build locally`);
      assert(
        definition.environment?.NODE_ENV === 'production',
        `${file}: ${service} must set NODE_ENV`,
      );
      assert(hasLogRotation(definition), `${file}: ${service} must use log rotation`);
    }
    assert(
      Array.isArray(model.services.gateway.ports) && model.services.gateway.ports.length === 0,
      `${file}: gateway must not publish a host port`,
    );
    assert(
      model.services.cloudflared?.networks?.includes('edge'),
      `${file}: cloudflared must use edge network`,
    );
    assert(!model.services.cloudflared?.ports, `${file}: cloudflared must not publish a host port`);
    assert(
      hasLogRotation(model.services.cloudflared),
      `${file}: cloudflared must use log rotation`,
    );
  }

  console.log(`${file}: ${Object.keys(model.services).length} services`);
}
