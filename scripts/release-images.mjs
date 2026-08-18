import { fileURLToPath } from 'node:url';

export const releaseImages = Object.freeze([
  { name: 'web', dockerfile: 'apps/web/Dockerfile' },
  { name: 'api', dockerfile: 'apps/api/Dockerfile' },
  { name: 'fetch-worker', dockerfile: 'apps/fetch-worker/Dockerfile' },
  { name: 'browser-worker', dockerfile: 'apps/browser-worker/Dockerfile' },
  { name: 'control-worker', dockerfile: 'apps/control-worker/Dockerfile' },
]);

export const releaseImageNames = new Set(releaseImages.map(({ name }) => name));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify({ include: releaseImages })}\n`);
}
