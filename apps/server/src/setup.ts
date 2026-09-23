#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { systemSettings } from './db/schema.js';

const { values: options } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'if-needed': { type: 'boolean', default: false },
    method: { type: 'string', default: 'magic-link' },
    workspace: { type: 'string', default: 'Default' },
    slug: { type: 'string', default: 'default' },
  },
});

if (!options.email || !options.name || !['magic-link', 'github'].includes(options.method ?? '')) {
  throw new Error('Usage: pnpm setup -- --email <email> --name <name> [--method magic-link|github] [--workspace <name>] [--slug <slug>] [--if-needed]');
}
const email = options.email;
const name = options.name;

async function setup() {
    const config = loadConfig();
    const database = createDatabase(config);
    const connection = await database.pool.connect();
    try {
      await connection.query('select pg_advisory_lock($1)', [731947201]);
      const [initialized] = await database.db.select().from(systemSettings).where(eq(systemSettings.key, 'initialized')).limit(1);
      if (initialized) {
        if (options['if-needed']) {
          console.log('Rachet is already initialized.');
          return;
        }
        throw new Error('Rachet has already been initialized');
      }
      await connection.query(
        `insert into registration_intents (
          email_key, name, organization_name, organization_slug, method, kind, expires_at
        ) values (lower(trim($1)), $2, $3, $4, $5, 'bootstrap', now() + interval '15 minutes')
        on conflict (email_key) where consumed_at is null do update set
          name = excluded.name,
          organization_name = excluded.organization_name,
          organization_slug = excluded.organization_slug,
          method = excluded.method,
          kind = excluded.kind,
          expires_at = excluded.expires_at`,
        [email, name, options.workspace, options.slug, options.method],
      );
      console.log(JSON.stringify({ email, method: options.method, expiresInSeconds: 900 }, null, 2));
    } finally {
      await connection.query('select pg_advisory_unlock($1)', [731947201]).catch(() => undefined);
      connection.release();
      await database.pool.end();
    }
}

await setup();
