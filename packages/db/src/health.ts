import { createConnection } from 'mysql2/promise';

export async function probeDatabase(databaseUrl: string) {
  const connection = await createConnection(databaseUrl);
  try {
    await connection.ping();
  } finally {
    await connection.end();
  }
}
