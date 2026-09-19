import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Config } from '../config.js';
import * as schema from './schema.js';

export function createDatabase(config: Config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return { db: drizzle(pool, { schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
