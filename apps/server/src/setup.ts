#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { memberships, profiles, systemSettings, workspaces } from './db/schema.js';

const { values: options } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'password-file': { type: 'string' },
    'if-needed': { type: 'boolean', default: false },
    workspace: { type: 'string', default: 'Default' },
    slug: { type: 'string', default: 'default' },
  },
});

if (!options.email || !options.name || !options['password-file']) {
  throw new Error('Usage: pnpm setup -- --email <email> --name <name> --password-file <path> [--workspace <name>] [--slug <slug>] [--if-needed]');
}
const email = options.email;
const name = options.name;
const passwordFile = options['password-file'];

async function setup() {
    const config = loadConfig();
    const database = createDatabase(config);
    const auth = createAuth(config, database.pool);
    const connection = await database.pool.connect();
    try {
      await connection.query('select pg_advisory_lock($1)', [731947201]);
      const [initialized] = await database.db.select().from(systemSettings).where(eq(systemSettings.key, 'initialized')).limit(1);
      if (initialized) {
        if (options['if-needed']) {
          console.log('Reflow is already initialized.');
          return;
        }
        throw new Error('Reflow has already been initialized');
      }
      const password = (await readFile(passwordFile, 'utf8')).trim();
      const created = await auth.api.createUser({ body: { email, name, password, role: 'admin' } });
      await connection.query('update "user" set "emailVerified" = true where id = $1', [created.user.id]);
      await database.db.transaction(async (transaction) => {
        const [workspace] = await transaction.insert(workspaces).values({ name: options.workspace, slug: options.slug }).returning();
        if (!workspace) throw new Error('Workspace creation failed');
        await transaction.insert(profiles).values({ userId: created.user.id, deploymentAdmin: true });
        await transaction.insert(memberships).values({ workspaceId: workspace.id, userId: created.user.id, role: 'owner' });
        await transaction.insert(systemSettings).values({ key: 'initialized', value: { userId: created.user.id, workspaceId: workspace.id } });
        console.log(JSON.stringify({ adminId: created.user.id, workspaceId: workspace.id }, null, 2));
      });
    } finally {
      await connection.query('select pg_advisory_unlock($1)', [731947201]).catch(() => undefined);
      connection.release();
      await database.pool.end();
    }
}

await setup();
