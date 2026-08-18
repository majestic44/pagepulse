import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const connection = await mysql.createConnection(url);
const [lock] = await connection.query("SELECT GET_LOCK('pagepulse_migrations', 60) AS acquired");
if ((lock as Array<{ acquired: number }>)[0]?.acquired !== 1)
  throw new Error('Could not acquire migration lock');
try {
  await migrate(drizzle(connection), {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname,
  });
} finally {
  await connection.query("SELECT RELEASE_LOCK('pagepulse_migrations')");
  await connection.end();
}
