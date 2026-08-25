import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishSnapshotFile, removeSnapshotFile, SnapshotFileError } from './snapshot-files.js';

describe('snapshot file publishing', () => {
  it('writes private snapshot content through an atomic same-directory rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pagepulse-snapshot-'));
    const key = 'monitor-1/snapshot-1.json';

    await expect(
      publishSnapshotFile(root, key, Buffer.from('{"state":"ok"}', 'utf8')),
    ).resolves.toBe(true);

    await expect(readFile(join(root, 'monitor-1', 'snapshot-1.json'), 'utf8')).resolves.toBe(
      '{"state":"ok"}',
    );
    await expect(readdir(join(root, 'monitor-1'))).resolves.toEqual(['snapshot-1.json']);
    await expect(
      publishSnapshotFile(root, key, Buffer.from('{"state":"new"}', 'utf8')),
    ).resolves.toBe(false);
    await expect(readFile(join(root, 'monitor-1', 'snapshot-1.json'), 'utf8')).resolves.toBe(
      '{"state":"ok"}',
    );
    await removeSnapshotFile(root, key);
    await expect(readdir(join(root, 'monitor-1'))).resolves.toEqual([]);
  });

  it('rejects traversal attempts and never writes outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pagepulse-snapshot-'));

    await expect(
      publishSnapshotFile(root, '../outside.json', Buffer.from('x')),
    ).rejects.toBeInstanceOf(SnapshotFileError);
    await expect(
      publishSnapshotFile(root, '..\\outside.json', Buffer.from('x')),
    ).rejects.toBeInstanceOf(SnapshotFileError);
    await expect(removeSnapshotFile(root, '/outside.json')).rejects.toBeInstanceOf(
      SnapshotFileError,
    );
  });
});
