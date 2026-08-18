import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { releaseImages } from './release-images.mjs';

const run = promisify(execFile);

test('creates a complete immutable deployment manifest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepulse-release-metadata-'));
  t.after(() => rm(directory, { force: true, recursive: true }));

  const inputs = await Promise.all(
    releaseImages.map(async ({ name }, index) => {
      const path = join(directory, `${name}.json`);
      const digest = String(index).padStart(64, 'a');
      await writeFile(
        path,
        JSON.stringify({ name, image: `ghcr.io/majestic44/pagepulse-${name}@sha256:${digest}` }),
      );
      return path;
    }),
  );
  const output = join(directory, 'deployment-metadata.json');
  await run(process.execPath, ['scripts/create-release-metadata.mjs', output, ...inputs], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELEASE_TAG: 'v1.2.3',
      GITHUB_REPOSITORY: 'majestic44/pagepulse',
      GITHUB_SHA: 'a'.repeat(40),
    },
  });

  const metadata = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    version: 'v1.2.3',
    revision: 'a'.repeat(40),
    repository: 'majestic44/pagepulse',
    images: Object.fromEntries(
      releaseImages.map(({ name }, index) => [
        name,
        `ghcr.io/majestic44/pagepulse-${name}@sha256:${String(index).padStart(64, 'a')}`,
      ]),
    ),
  });
});

test('reports the invalid release tag in a typed validation error', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepulse-release-metadata-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const input = join(directory, 'web.json');
  await writeFile(
    input,
    JSON.stringify({
      name: 'web',
      image: `ghcr.io/majestic44/pagepulse-web@sha256:${'a'.repeat(64)}`,
    }),
  );

  await assert.rejects(
    run(
      process.execPath,
      ['scripts/create-release-metadata.mjs', join(directory, 'output.json'), input],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RELEASE_TAG: 'release-candidate',
          GITHUB_REPOSITORY: 'majestic44/pagepulse',
          GITHUB_SHA: 'a'.repeat(40),
        },
      },
    ),
    (error) => {
      const stderr = String(error.stderr);
      return (
        stderr.includes('ReleaseMetadataValidationError: RELEASE_TAG') &&
        stderr.includes('received "release-candidate"')
      );
    },
  );
});

test('exports the release workflow matrix from the shared image configuration', async () => {
  const { stdout } = await run(process.execPath, ['scripts/release-images.mjs'], {
    cwd: process.cwd(),
  });
  assert.deepEqual(JSON.parse(stdout), { include: releaseImages });
});
