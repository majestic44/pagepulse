import { index, int, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  role: mysqlEnum('role', ['owner', 'member']).notNull().default('member'),
  status: mysqlEnum('status', ['invited', 'active', 'suspended', 'deleting'])
    .notNull()
    .default('invited'),
  monitorLimit: int('monitor_limit').notNull().default(50),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const monitors = mysqlTable(
  'monitors',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    ownerId: varchar('owner_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    state: mysqlEnum('state', ['active', 'paused', 'blocked', 'authentication_required'])
      .notNull()
      .default('active'),
    revision: int('revision').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('monitors_owner_state_idx').on(table.ownerId, table.state)],
);

export const schemaCompatibility = mysqlTable('schema_compatibility', {
  schemaVersion: int('schema_version').primaryKey(),
  migrationId: varchar('migration_id', { length: 128 }).notNull().unique(),
  minimumAppVersion: varchar('minimum_app_version', { length: 128 }).notNull(),
  maximumAppVersion: varchar('maximum_app_version', { length: 128 }),
  recordedAppVersion: varchar('recorded_app_version', { length: 128 }).notNull(),
  recordedAt: timestamp('recorded_at').notNull().defaultNow(),
});
