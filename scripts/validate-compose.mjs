import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const files = ['compose.yaml', 'compose.dev.yaml', 'compose.production.yaml'];
for (const file of files) {
  const model = parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), {
    merge: true,
  });
  if (!model?.services || Object.keys(model.services).length === 0)
    throw new Error(`${file}: no services`);

  if (file === 'compose.yaml') {
    for (const service of [
      'gateway',
      'api',
      'scheduler',
      'fetch-worker',
      'browser-worker',
      'change-worker',
      'notification-worker',
      'maintenance-worker',
    ]) {
      if (!model.services[service]?.healthcheck?.test)
        throw new Error(`${file}: ${service} must define a health check`);
    }
  }

  if (file === 'compose.dev.yaml' && !model.services.devtools?.healthcheck?.test)
    throw new Error(`${file}: devtools must define a health check`);

  console.log(`${file}: ${Object.keys(model.services).length} services`);
}
