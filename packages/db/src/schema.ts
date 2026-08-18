import { int, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

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

export const monitors = mysqlTable('monitors', {
  id: varchar('id', { length: 36 }).primaryKey(),
  ownerId: varchar('owner_id', { length: 36 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  url: varchar('url', { length: 2048 }).notNull(),
  state: mysqlEnum('state', ['active', 'paused', 'blocked', 'authentication_required'])
    .notNull()
    .default('active'),
  revision: int('revision').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
