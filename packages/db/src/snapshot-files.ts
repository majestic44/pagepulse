import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export class SnapshotFileError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`Snapshot file operation failed: ${message}`, { cause });
    this.name = 'SnapshotFileError';
  }
}

function resolveSnapshotPath(root: string, storageKey: string) {
  if (typeof root !== 'string' || root.trim().length === 0) {
    throw new SnapshotFileError('root is invalid');
  }
  if (
    typeof storageKey !== 'string' ||
    storageKey.length === 0 ||
    storageKey.startsWith('/') ||
    storageKey.includes('\\') ||
    storageKey.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new SnapshotFileError('storage key is invalid');
  }
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, ...storageKey.split('/'));
  const pathFromRoot = relative(rootPath, filePath);
  if (pathFromRoot.length === 0 || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
    throw new SnapshotFileError('storage key escapes root');
  }
  return filePath;
}

export async function publishSnapshotFile(root: string, storageKey: string, content: Buffer) {
  if (!Buffer.isBuffer(content) || content.length === 0) {
    throw new SnapshotFileError('content is invalid');
  }
  const filePath = resolveSnapshotPath(root, storageKey);
  const directory = dirname(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(directory, { mode: 0o700, recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        await unlink(temporaryPath);
        return false;
      }
      throw error;
    }
    await unlink(temporaryPath);
    return true;
  } catch (error) {
    try {
      await handle?.close();
      await unlink(temporaryPath);
    } catch {
      // Preserve the initial publish error.
    }
    throw new SnapshotFileError('publish failed', error);
  }
}

export async function removeSnapshotFile(root: string, storageKey: string) {
  const filePath = resolveSnapshotPath(root, storageKey);
  try {
    await unlink(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new SnapshotFileError('remove failed', error);
    }
  }
}
