import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [outputPath, ...inputPaths] = process.argv.slice(2);

if (!outputPath || inputPaths.length === 0) {
  throw new Error(
    'Usage: node scripts/create-release-metadata.mjs <output.json> <image-metadata.json...>',
  );
}

const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
const revision = process.env.GITHUB_SHA;

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? '')) {
  throw new Error('RELEASE_TAG must be a semantic version tag such as v1.2.3');
}
if (!repository || !revision) {
  throw new Error('GITHUB_REPOSITORY and GITHUB_SHA are required');
}
if (!/^[a-f0-9]{40}$/.test(revision)) {
  throw new Error('GITHUB_SHA must be a full lowercase commit SHA');
}

const images = {};
const expectedImages = new Set(['web', 'api', 'fetch-worker', 'browser-worker', 'control-worker']);
for (const inputPath of inputPaths) {
  const entry = JSON.parse(await readFile(inputPath, 'utf8'));
  if (
    typeof entry.name !== 'string' ||
    !/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(entry.image ?? '')
  ) {
    throw new Error(`Invalid image metadata: ${inputPath}`);
  }
  if (images[entry.name]) {
    throw new Error(`Duplicate image metadata for ${entry.name}`);
  }
  if (!expectedImages.has(entry.name)) {
    throw new Error(`Unexpected image metadata for ${entry.name}`);
  }
  images[entry.name] = entry.image;
}
if (Object.keys(images).length !== expectedImages.size) {
  throw new Error('Image metadata must include every release image exactly once');
}

const metadata = {
  schemaVersion: 1,
  version: tag,
  revision,
  repository,
  images,
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
