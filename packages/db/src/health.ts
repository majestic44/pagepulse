import { createConnection } from 'mysql2/promise';

export const DATABASE_READINESS_TIMEOUT_MS = 1_000;

class DatabaseHealthTimeoutError extends Error {
  constructor() {
    super('Database health check timed out');
    this.name = 'DatabaseHealthTimeoutError';
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new DatabaseHealthTimeoutError()), timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function probeDatabase(
  databaseUrl: string,
  timeoutMs = DATABASE_READINESS_TIMEOUT_MS,
) {
  const connection = await withTimeout(
    createConnection({ uri: databaseUrl, connectTimeout: timeoutMs }),
    timeoutMs,
  );
  try {
    await withTimeout(connection.ping(), timeoutMs);
  } finally {
    connection.destroy();
  }
}
