import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection, Pool } from 'mysql2/promise';

import * as schema from './schema.js';

export function createDatabase(connection: Connection | Pool) {
  return drizzle(connection, { schema, mode: 'default' });
}

export type Database = ReturnType<typeof createDatabase>;
