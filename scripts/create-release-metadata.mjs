import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { releaseImageNames } from './release-images.mjs';

class ReleaseMetadataUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseMetadataUsageError';
  }
}

class ReleaseMetadataValidationError extends Error {
  constructor(field, value, expectation) {
    super(`${field} must ${expectation}; received ${JSON.stringify(value)}`);
    this.name = 'ReleaseMetadataValidationError';
  }
}

const [outputPath, ...inputPaths] = process.argv.slice(2);

if (!outputPath || inputPaths.length === 0) {
  throw new ReleaseMetadataUsageError(
    'Usage: node scripts/create-release-metadata.mjs <output.json> <image-metadata.json...>',
  );
}

const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
const revision = process.env.GITHUB_SHA;

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? '')) {
  throw new ReleaseMetadataValidationError(
    'RELEASE_TAG',
    tag,
    'be a semantic version tag such as v1.2.3',
  );
}
if (!repository || !revision) {
  throw new ReleaseMetadataValidationError(
    'release environment',
    { GITHUB_REPOSITORY: repository, GITHUB_SHA: revision },
    'include GITHUB_REPOSITORY and GITHUB_SHA',
  );
}
if (!/^[a-f0-9]{40}$/.test(revision)) {
  throw new ReleaseMetadataValidationError(
    'GITHUB_SHA',
    revision,
    'be a full lowercase commit SHA',
  );
}

const images = {};
for (const inputPath of inputPaths) {
  let entry;
  try {
    entry = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    throw new ReleaseMetadataValidationError(
      `image metadata file ${inputPath}`,
      error instanceof Error ? error.message : error,
      'contain valid JSON',
    );
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ReleaseMetadataValidationError(
      `image metadata entry in ${inputPath}`,
      entry,
      'be a JSON object',
    );
  }
  if (typeof entry.name !== 'string') {
    throw new ReleaseMetadataValidationError(
      `image metadata name in ${inputPath}`,
      entry.name,
      'be a string',
    );
  }
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(entry.image ?? '')) {
    throw new ReleaseMetadataValidationError(
      `image metadata image in ${inputPath}`,
      entry.image,
      'be an immutable ghcr.io image digest reference',
    );
  }
  if (images[entry.name]) {
    throw new ReleaseMetadataValidationError(
      `image metadata name in ${inputPath}`,
      entry.name,
      'occur only once',
    );
  }
  if (!releaseImageNames.has(entry.name)) {
    throw new ReleaseMetadataValidationError(
      `image metadata name in ${inputPath}`,
      entry.name,
      `be one of ${JSON.stringify([...releaseImageNames])}`,
    );
  }
  images[entry.name] = entry.image;
}
const missingImages = [...releaseImageNames].filter((name) => !images[name]);
if (missingImages.length > 0) {
  throw new ReleaseMetadataValidationError(
    'image metadata',
    missingImages,
    'include every configured release image exactly once',
  );
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
