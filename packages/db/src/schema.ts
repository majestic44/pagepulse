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

export const ownerSetupTokens = mysqlTable(
  'owner_setup_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    ownerId: varchar('owner_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('owner_setup_tokens_owner_state_idx').on(
      table.ownerId,
      table.usedAt,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

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

export const monitorSchedules = mysqlTable(
  'monitor_schedules',
  {
    monitorId: varchar('monitor_id', { length: 36 })
      .primaryKey()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    monitorRevision: int('monitor_revision').notNull(),
    intervalMs: int('interval_ms').notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('monitor_schedules_revision_idx').on(table.monitorRevision)],
);

export const outboxEvents = mysqlTable(
  'outbox_events',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    subjectType: varchar('subject_type', { length: 64 }).notNull(),
    subjectId: varchar('subject_id', { length: 128 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('outbox_events_pending_idx').on(table.publishedAt, table.availableAt, table.createdAt),
    index('outbox_events_subject_idx').on(table.subjectType, table.subjectId),
  ],
);

export const schemaCompatibility = mysqlTable('schema_compatibility', {
  schemaVersion: int('schema_version').primaryKey(),
  migrationId: varchar('migration_id', { length: 128 }).notNull().unique(),
  minimumAppVersion: varchar('minimum_app_version', { length: 128 }).notNull(),
  maximumAppVersion: varchar('maximum_app_version', { length: 128 }),
  recordedAppVersion: varchar('recorded_app_version', { length: 128 }).notNull(),
  recordedAt: timestamp('recorded_at').notNull().defaultNow(),
});
