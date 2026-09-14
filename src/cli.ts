#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { memberships, profiles, systemSettings, workspaces } from './db/schema.js';
import { ReflowClient } from './client.js';
import { workflowDefinitionSchema } from './domain/contracts.js';
import { renderMermaidWorkflow, renderTerminalWorkflow } from './tui/workflow-graph.js';

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
type ListedWorkflow = { id: string; name: string; definition: unknown };
const workflow = program.command('workflow').description('Inspect workflows with human-readable output.');
workflow.command('show')
  .requiredOption('--workspace <id>', 'Workspace UUID')
  .option('--id <id>', 'Workflow UUID')
  .option('--name <name>', 'Exact workflow name')
  .option('--format <format>', 'terminal, mermaid, or json', 'terminal')
  .action(async (options: { workspace: string; id?: string; name?: string; format: string }) => {
    const rows = await new ReflowClient().call<ListedWorkflow[]>('workflow.list', { workspaceId: options.workspace });
    const selected = rows.find((row) => options.id ? row.id === options.id : options.name ? row.name === options.name : rows.length === 1);
    if (!selected) throw new Error(options.id || options.name ? 'Workflow not found' : 'Specify --id or --name when the workspace has multiple workflows');
    const definition = workflowDefinitionSchema.parse(selected.definition);
    if (options.format === 'terminal') console.log(renderTerminalWorkflow(definition, process.stdout.columns ?? 100));
    else if (options.format === 'mermaid') console.log(renderMermaidWorkflow(definition));
    else if (options.format === 'json') console.log(JSON.stringify(selected, null, 2));
    else throw new Error('--format must be terminal, mermaid, or json');
  });
program.command('tui')
  .description('Browse and render workflows in an interactive terminal UI.')
  .option('--workspace <id>', 'Workspace UUID', process.env.REFLOW_WORKSPACE_ID)
  .action(async (options: { workspace?: string }) => {
    if (!options.workspace) throw new Error('Pass --workspace or set REFLOW_WORKSPACE_ID');
    const { launchTui } = await import('./tui/index.js');
    await launchTui(options.workspace);
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
