#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { memberships, profiles, systemSettings, workspaces } from './db/schema.js';

function endpoint() { return (process.env.REFLOW_URL ?? 'http://localhost:3000').replace(/\/$/, ''); }
function headers(): Record<string, string> {
  const result: Record<string, string> = {
    'content-type': 'application/json',
    origin: endpoint(),
  };
  if (process.env.REFLOW_TOKEN) result.authorization = `Bearer ${process.env.REFLOW_TOKEN}`;
  if (process.env.REFLOW_API_KEY) result['x-api-key'] = process.env.REFLOW_API_KEY;
  return result;
}
async function jsonInput(value: string | undefined, file: string | undefined) {
  if (value && file) throw new Error('Use either --input or --file');
  return JSON.parse(file ? await readFile(file, 'utf8') : value ?? '{}') as Record<string, unknown>;
}
async function request(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${endpoint()}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ message: response.statusText }));
  if (!response.ok) throw new Error(JSON.stringify(data));
  return { data, token: response.headers.get('set-auth-token') };
}

const program = new Command().name('reflow').description('Operate Reflow entirely from the command line.').version('0.1.0');
program.command('call').argument('<operation>', 'Operation name, such as workflow.validate').option('-i, --input <json>').option('-f, --file <path>').action(async (operation, options: { input?: string; file?: string }) => {
  console.log(JSON.stringify((await request(`/v1/operations/${operation}`, await jsonInput(options.input, options.file))).data, null, 2));
});
const auth = program.command('auth');
auth.command('call').argument('<path>', 'Better Auth endpoint below /api/auth, such as api-key/create').option('-i, --input <json>').option('-f, --file <path>').action(async (path: string, options: { input?: string; file?: string }) => {
  console.log(JSON.stringify((await request(`/api/auth/${path.replace(/^\//, '')}`, await jsonInput(options.input, options.file))).data, null, 2));
});
auth.command('register').requiredOption('--email <email>').requiredOption('--name <name>').requiredOption('--password-file <path>').action(async (options) => {
  const password = (await readFile(options.passwordFile, 'utf8')).trim();
  console.log(JSON.stringify((await request('/api/auth/sign-up/email', { email: options.email, name: options.name, password })).data, null, 2));
});
auth.command('login').requiredOption('--email <email>').requiredOption('--password-file <path>').action(async (options) => {
  const password = (await readFile(options.passwordFile, 'utf8')).trim();
  const result = await request('/api/auth/sign-in/email', { email: options.email, password });
  console.log(JSON.stringify({ ...result.data as object, token: result.token }, null, 2));
});
program.command('setup').description('Create the one-time deployment administrator and initial workspace.').requiredOption('--email <email>').requiredOption('--name <name>').requiredOption('--password-file <path>').option('--workspace <name>', 'Initial workspace name', 'Default').option('--slug <slug>', 'Initial workspace slug', 'default').action(async (options) => {
  const config = loadConfig(); const database = createDatabase(config); const localAuth = createAuth(config, database.pool);
  const client = await database.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [731947201]);
    const [initialized] = await database.db.select().from(systemSettings).where(eq(systemSettings.key, 'initialized')).limit(1);
    if (initialized) throw new Error('Reflow has already been initialized');
    const password = (await readFile(options.passwordFile, 'utf8')).trim();
    const created = await localAuth.api.createUser({ body: { email: options.email, name: options.name, password, role: 'admin' } });
    await client.query('update "user" set "emailVerified" = true where id = $1', [created.user.id]);
    await database.db.transaction(async (tx) => {
      const [workspace] = await tx.insert(workspaces).values({ name: options.workspace, slug: options.slug }).returning();
      if (!workspace) throw new Error('Workspace creation failed');
      await tx.insert(profiles).values({ userId: created.user.id, deploymentAdmin: true });
      await tx.insert(memberships).values({ workspaceId: workspace.id, userId: created.user.id, role: 'owner' });
      await tx.insert(systemSettings).values({ key: 'initialized', value: { userId: created.user.id, workspaceId: workspace.id } });
      console.log(JSON.stringify({ adminId: created.user.id, workspaceId: workspace.id }, null, 2));
    });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [731947201]).catch(() => undefined); client.release(); await database.pool.end();
  }
});

await program.parseAsync();
