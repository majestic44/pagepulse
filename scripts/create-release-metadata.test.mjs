import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const images = ['web', 'api', 'fetch-worker', 'browser-worker', 'control-worker'];

test('creates a complete immutable deployment manifest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pagepulse-release-metadata-'));
  t.after(() => rm(directory, { force: true, recursive: true }));

  const inputs = await Promise.all(
    images.map(async (name, index) => {
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
      images.map((name, index) => [
        name,
        `ghcr.io/majestic44/pagepulse-${name}@sha256:${String(index).padStart(64, 'a')}`,
      ]),
    ),
  });
});
