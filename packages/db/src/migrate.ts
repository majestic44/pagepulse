import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger, loadEnvironment } from '@pagepulse/config';
import { migrate as drizzleMigrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';

import { createDatabase } from './client.js';
import { schemaCompatibility } from './schema.js';

export const MIGRATION_LOCK_NAME = 'pagepulse_migrations';
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 60;

export const currentSchemaCompatibility = Object.freeze({
  schemaVersion: 1,
  migrationId: 'initial-schema',
  minimumAppVersion: '0.0.0',
});

type LockConnection = Pick<Connection, 'query'>;

export function resolveMigrationsFolder(moduleUrl: string = import.meta.url) {
  return fileURLToPath(new URL('../migrations', moduleUrl));
}

export function isMigrationEntrypoint(
  entrypoint: string | undefined,
  moduleUrl: string = import.meta.url,
) {
  return entrypoint !== undefined && fileURLToPath(moduleUrl) === resolve(entrypoint);
}

export async function acquireMigrationLock(
  connection: LockConnection,
  timeoutSeconds = MIGRATION_LOCK_TIMEOUT_SECONDS,
) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
    MIGRATION_LOCK_NAME,
    timeoutSeconds,
  ]);
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error(`Could not acquire MariaDB migration lock ${MIGRATION_LOCK_NAME}`);
  }
}

export async function releaseMigrationLock(connection: LockConnection) {
  await connection.query('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
}

export async function withMigrationLock<T>(
  connection: LockConnection,
  operation: () => Promise<T>,
) {
  await acquireMigrationLock(connection);
  try {
    return await operation();
  } finally {
    await releaseMigrationLock(connection);
  }
}

export async function recordSchemaCompatibility(
  connection: Connection,
  applicationVersion: string,
) {
  const database = createDatabase(connection);
  await database
    .insert(schemaCompatibility)
    .values({
      ...currentSchemaCompatibility,
      maximumAppVersion: null,
      recordedAppVersion: applicationVersion,
    })
    .onDuplicateKeyUpdate({
      set: {
        recordedAppVersion: applicationVersion,
        recordedAt: new Date(),
      },
    });
}

export async function migrateDatabase(
  databaseUrl: string,
  applicationVersion: string,
  migrationsFolder = resolveMigrationsFolder(),
) {
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await withMigrationLock(connection, async () => {
      await drizzleMigrate(createDatabase(connection), { migrationsFolder });
      await recordSchemaCompatibility(connection, applicationVersion);
    });
  } finally {
    await connection.end();
  }
}

export async function runMigrations() {
  const environment = loadEnvironment();
  const logger = createLogger('migration', environment.LOG_LEVEL);
  await migrateDatabase(environment.DATABASE_URL, environment.APP_VERSION);
  logger.info(
    {
      schemaVersion: currentSchemaCompatibility.schemaVersion,
      migrationId: currentSchemaCompatibility.migrationId,
      applicationVersion: environment.APP_VERSION,
    },
    'Database migrations completed',
  );
}

const entrypoint = process.argv[1];
if (isMigrationEntrypoint(entrypoint)) {
  runMigrations().catch((error: unknown) => {
    const logger = createLogger('migration');
    logger.error({ error }, 'Database migrations failed');
    process.exitCode = 1;
  });
}
