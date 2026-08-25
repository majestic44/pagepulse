import {
  bigint,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 512 }),
    emailVerifiedAt: timestamp('email_verified_at'),
    passwordChangedAt: timestamp('password_changed_at'),
    role: mysqlEnum('role', ['owner', 'member']).notNull().default('member'),
    status: mysqlEnum('status', ['invited', 'active', 'suspended', 'deleting'])
      .notNull()
      .default('invited'),
    deletionRequestedAt: timestamp('deletion_requested_at'),
    deletionDeadline: timestamp('deletion_deadline'),
    monitorLimit: int('monitor_limit').notNull().default(50),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('users_deletion_deadline_idx').on(table.status, table.deletionDeadline)],
);

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

export const invitations = mysqlTable(
  'invitations',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    invitedByUserId: varchar('invited_by_user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    redeemedAt: timestamp('redeemed_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('invitations_email_state_idx').on(table.email, table.redeemedAt, table.revokedAt),
  ],
);

export const accountTokens = mysqlTable(
  'account_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', [
      'email_verification',
      'password_reset',
      'account_deletion_recovery',
    ]).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('account_tokens_user_type_state_idx').on(
      table.userId,
      table.type,
      table.usedAt,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    deviceLabel: varchar('device_label', { length: 160 }).notNull(),
    lastUsedAt: timestamp('last_used_at').notNull(),
    idleExpiresAt: timestamp('idle_expires_at').notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_active_idx').on(
      table.userId,
      table.revokedAt,
      table.idleExpiresAt,
      table.absoluteExpiresAt,
      table.lastUsedAt,
    ),
  ],
);

export const totpMethods = mysqlTable('totp_methods', {
  userId: varchar('user_id', { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretCiphertext: varchar('secret_ciphertext', { length: 512 }).notNull(),
  lastVerifiedTimeStep: bigint('last_verified_time_step', { mode: 'number' }),
  enabledAt: timestamp('enabled_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const totpEnrollments = mysqlTable('totp_enrollments', {
  userId: varchar('user_id', { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretCiphertext: varchar('secret_ciphertext', { length: 512 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const totpRecoveryCodes = mysqlTable(
  'totp_recovery_codes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('totp_recovery_codes_user_state_idx').on(table.userId, table.usedAt),
    index('totp_recovery_codes_user_hash_idx').on(table.userId, table.codeHash),
  ],
);

export const totpLoginChallenges = mysqlTable(
  'totp_login_challenges',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('totp_login_challenges_user_state_idx').on(
      table.userId,
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
    scheduleType: mysqlEnum('schedule_type', ['hourly', 'daily', 'custom'])
      .notNull()
      .default('custom'),
    timeZone: varchar('time_zone', { length: 64 }).notNull().default('UTC'),
    hourlyMinute: int('hourly_minute'),
    dailyTime: varchar('daily_time', { length: 5 }),
    customIntervalMinutes: int('custom_interval_minutes'),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('monitor_schedules_revision_idx').on(table.monitorRevision)],
);

export const monitorTargets = mysqlTable('monitor_targets', {
  monitorId: varchar('monitor_id', { length: 36 })
    .primaryKey()
    .references(() => monitors.id, { onDelete: 'cascade' }),
  targetType: mysqlEnum('target_type', ['whole_page', 'css_selector'])
    .notNull()
    .default('whole_page'),
  selector: varchar('selector', { length: 512 }),
  itemSelector: varchar('item_selector', { length: 512 }),
  identitySelector: varchar('identity_selector', { length: 512 }),
  ignoreSelectors: json('ignore_selectors').$type<ReadonlyArray<string>>(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const monitorRules = mysqlTable('monitor_rules', {
  monitorId: varchar('monitor_id', { length: 36 })
    .primaryKey()
    .references(() => monitors.id, { onDelete: 'cascade' }),
  monitorRevision: int('monitor_revision').notNull(),
  configuration: json('configuration').notNull(),
  baselineState: mysqlEnum('baseline_state', ['pending', 'established'])
    .notNull()
    .default('pending'),
  baselineRevision: int('baseline_revision').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const checks = mysqlTable(
  'checks',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    monitorId: varchar('monitor_id', { length: 36 })
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    monitorRevision: int('monitor_revision').notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    result: mysqlEnum('result', ['succeeded', 'failed']).notNull(),
    failureCode: varchar('failure_code', { length: 64 }),
    contentHash: varchar('content_hash', { length: 64 }),
    startedAt: timestamp('started_at').notNull(),
    completedAt: timestamp('completed_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    index('checks_monitor_completed_idx').on(table.monitorId, table.completedAt),
    index('checks_expiry_idx').on(table.expiresAt, table.id),
  ],
);

export const snapshots = mysqlTable(
  'snapshots',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    checkId: varchar('check_id', { length: 36 })
      .notNull()
      .unique()
      .references(() => checks.id, { onDelete: 'cascade' }),
    monitorId: varchar('monitor_id', { length: 36 })
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    storageKey: varchar('storage_key', { length: 512 }).notNull().unique(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    byteSize: int('byte_size').notNull(),
    mediaType: varchar('media_type', { length: 128 }).notNull(),
    confidential: mysqlEnum('confidential', ['yes', 'no']).notNull().default('yes'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('snapshots_expiry_idx').on(table.expiresAt, table.id),
    index('snapshots_monitor_created_idx').on(table.monitorId, table.createdAt),
  ],
);

export const changes = mysqlTable(
  'changes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    monitorId: varchar('monitor_id', { length: 36 })
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    previousSnapshotId: varchar('previous_snapshot_id', { length: 36 })
      .notNull()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    currentSnapshotId: varchar('current_snapshot_id', { length: 36 })
      .notNull()
      .unique()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    summary: varchar('summary', { length: 160 }).notNull(),
    state: mysqlEnum('state', ['pending', 'expected', 'ignored']).notNull().default('pending'),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('changes_monitor_state_created_idx').on(table.monitorId, table.state, table.createdAt),
  ],
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

export const auditEvents = mysqlTable(
  'audit_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    actorUserId: varchar('actor_user_id', { length: 36 }),
    action: varchar('action', { length: 96 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: varchar('target_id', { length: 128 }),
    requesterIpHash: varchar('requester_ip_hash', { length: 64 }),
    requestId: varchar('request_id', { length: 128 }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_expiry_idx').on(table.expiresAt, table.id),
    index('audit_events_created_idx').on(table.createdAt, table.id),
    index('audit_events_target_idx').on(table.targetType, table.targetId, table.createdAt),
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
