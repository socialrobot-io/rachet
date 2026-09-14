#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { memberships, profiles, systemSettings, workspaces } from './db/schema.js';
import { ReflowClient, ReflowClientError } from './client.js';
import { chooseWorkspace, promptSecret, promptText, type WorkspaceChoice } from './cli-prompts.js';
import { clearLogin, resolveCliContext, saveLogin, saveWorkspace, type CliContext, type SavedWorkspace } from './cli-state.js';
import { workflowDefinitionSchema } from './domain/contracts.js';
import { renderMermaidWorkflow, renderWorkflowSvg } from './tui/workflow-graph.js';

class CliFailure extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'CliFailure';
  }
}

function headers(context: CliContext): Record<string, string> {
  const result: Record<string, string> = {
    'content-type': 'application/json',
    origin: context.url,
  };
  if (context.token) result.authorization = `Bearer ${context.token}`;
  if (context.apiKey) result['x-api-key'] = context.apiKey;
  return result;
}
async function jsonInput(value: string | undefined, file: string | undefined) {
  if (value && file) throw new Error('Use either --input or --file');
  return JSON.parse(file ? await readFile(file, 'utf8') : value ?? '{}') as Record<string, unknown>;
}
async function request(context: CliContext, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${context.url}${path}`, { method: 'POST', headers: headers(context), body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ message: response.statusText }));
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data ? String(data.message) : JSON.stringify(data);
    throw new ReflowClientError(response.status, message);
  }
  return { data, token: response.headers.get('set-auth-token') };
}

function client(context: CliContext): ReflowClient {
  return new ReflowClient({ url: context.url, ...(context.token ? { token: context.token } : {}), ...(context.apiKey ? { apiKey: context.apiKey } : {}) });
}

function requireAuthentication(context: CliContext): void {
  if (context.token || context.apiKey) return;
  throw new CliFailure(`You are not logged in to ${context.url}.`, 'Run `reflow auth login`.');
}

async function availableWorkspaces(context: CliContext): Promise<WorkspaceChoice[]> {
  requireAuthentication(context);
  return client(context).call<WorkspaceChoice[]>('workspace.list');
}

function savedWorkspace(choice: WorkspaceChoice): SavedWorkspace {
  return { id: choice.id, name: choice.name, slug: choice.slug };
}

async function resolveWorkspace(context: CliContext, selector?: string, persist = false): Promise<SavedWorkspace> {
  if (!selector && context.workspace) return context.workspace;
  if (selector && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(selector)) {
    const selected = { id: selector, name: selector, slug: selector };
    if (persist) await saveWorkspace(context.url, selected);
    return selected;
  }
  const choices = await availableWorkspaces(context);
  const choice = selector
    ? choices.find((item) => item.id === selector || item.slug === selector || item.name.toLowerCase() === selector.toLowerCase())
    : await chooseWorkspace(choices);
  if (!choice) throw new Error(`Workspace not found: ${selector}`);
  const selected = savedWorkspace(choice);
  if (persist) await saveWorkspace(context.url, selected);
  return selected;
}

async function openTui(selector?: string): Promise<void> {
  const context = await resolveCliContext();
  requireAuthentication(context);
  await availableWorkspaces(context);
  const workspace = await resolveWorkspace(context, selector, Boolean(selector) || !context.workspace);
  const { launchTui } = await import('./tui/index.js');
  await launchTui(workspace.id, client(context));
}

const program = new Command().name('reflow').description('Operate Reflow entirely from the command line.').version('0.1.0');
program.command('call').argument('<operation>', 'Operation name, such as workflow.validate').option('-i, --input <json>').option('-f, --file <path>').action(async (operation, options: { input?: string; file?: string }) => {
  const context = await resolveCliContext();
  requireAuthentication(context);
  const input = await jsonInput(options.input, options.file);
  if (!('workspaceId' in input) && context.workspace) input.workspaceId = context.workspace.id;
  console.log(JSON.stringify((await request(context, `/v1/operations/${operation}`, input)).data, null, 2));
});
const auth = program.command('auth');
auth.command('call').argument('<path>', 'Better Auth endpoint below /api/auth, such as api-key/create').option('-i, --input <json>').option('-f, --file <path>').action(async (path: string, options: { input?: string; file?: string }) => {
  const context = await resolveCliContext();
  console.log(JSON.stringify((await request(context, `/api/auth/${path.replace(/^\//, '')}`, await jsonInput(options.input, options.file))).data, null, 2));
});
auth.command('register').requiredOption('--email <email>').requiredOption('--name <name>').requiredOption('--password-file <path>').action(async (options) => {
  const context = await resolveCliContext();
  const password = (await readFile(options.passwordFile, 'utf8')).trim();
  console.log(JSON.stringify((await request(context, '/api/auth/sign-up/email', { email: options.email, name: options.name, password })).data, null, 2));
});
auth.command('login')
  .description('Sign in, select a workspace, and remember this CLI context.')
  .option('--url <url>', 'Reflow server URL')
  .option('--email <email>')
  .option('--password-file <path>')
  .option('--workspace <id-or-slug>', 'Select without prompting')
  .action(async (options: { url?: string; email?: string; passwordFile?: string; workspace?: string }) => {
    const current = await resolveCliContext();
    const context: CliContext = { url: (options.url ?? current.url).replace(/\/$/, '') };
    const email = options.email ?? await promptText('Email');
    const password = options.passwordFile ? (await readFile(options.passwordFile, 'utf8')).trim() : await promptSecret('Password');
    let result;
    try { result = await request(context, '/api/auth/sign-in/email', { email, password }); }
    catch (error) {
      if (error instanceof ReflowClientError && error.status === 401) throw new CliFailure('Login failed. Check your email and password.');
      throw error;
    }
    if (!result.token) throw new Error('The server did not return a session token');
    const authenticated: CliContext = { url: context.url, token: result.token };
    const choices = await availableWorkspaces(authenticated);
    const choice = options.workspace
      ? choices.find((item) => item.id === options.workspace || item.slug === options.workspace || item.name.toLowerCase() === options.workspace?.toLowerCase())
      : await chooseWorkspace(choices);
    if (!choice) throw new Error(`Workspace not found: ${options.workspace}`);
    await saveLogin(context.url, result.token, savedWorkspace(choice));
    console.log(`Logged in as ${email}`);
    console.log(`Workspace: ${choice.name} (${choice.slug})`);
  });
auth.command('logout').description('Remove the saved credential for the current Reflow server.').action(async () => {
  const context = await resolveCliContext();
  await clearLogin(context.url);
  console.log(`Logged out from ${context.url}`);
});
const workspaceCommand = program.command('workspace').description('List or change the active workspace.');
workspaceCommand.command('list').action(async () => {
  const context = await resolveCliContext();
  const choices = await availableWorkspaces(context);
  for (const choice of choices) console.log(`${choice.id === context.workspace?.id ? '*' : ' '} ${choice.name} (${choice.slug}) · ${choice.role ?? 'member'}`);
});
workspaceCommand.command('use').argument('[workspace]', 'Workspace ID, slug, or exact name').action(async (selector?: string) => {
  const context = await resolveCliContext();
  const choices = await availableWorkspaces(context);
  const choice = selector
    ? choices.find((item) => item.id === selector || item.slug === selector || item.name.toLowerCase() === selector.toLowerCase())
    : await chooseWorkspace(choices);
  if (!choice) throw new Error(`Workspace not found: ${selector}`);
  const selected = savedWorkspace(choice);
  await saveWorkspace(context.url, selected);
  console.log(`Workspace: ${selected.name} (${selected.slug})`);
});
type ListedWorkflow = { id: string; name: string; definition: unknown };
const workflow = program.command('workflow').description('Inspect workflows with human-readable output.');
workflow.command('show')
  .option('--workspace <id-or-slug>', 'Override the active workspace')
  .option('--id <id>', 'Workflow UUID')
  .option('--name <name>', 'Exact workflow name')
  .option('--format <format>', 'svg, mermaid, or json', 'svg')
  .action(async (options: { workspace?: string; id?: string; name?: string; format: string }) => {
    const context = await resolveCliContext();
    requireAuthentication(context);
    const selectedWorkspace = await resolveWorkspace(context, options.workspace);
    const rows = await client(context).call<ListedWorkflow[]>('workflow.list', { workspaceId: selectedWorkspace.id });
    const selected = rows.find((row) => options.id ? row.id === options.id : options.name ? row.name === options.name : rows.length === 1);
    if (!selected) throw new Error(options.id || options.name ? 'Workflow not found' : 'Specify --id or --name when the workspace has multiple workflows');
    const definition = workflowDefinitionSchema.parse(selected.definition);
    if (options.format === 'mermaid') console.log(renderMermaidWorkflow(definition));
    else if (options.format === 'svg') console.log(renderWorkflowSvg(definition));
    else if (options.format === 'json') console.log(JSON.stringify(selected, null, 2));
    else throw new Error('--format must be svg, mermaid, or json');
  });
program.command('tui')
  .description('Browse and render workflows in an interactive terminal UI.')
  .option('--workspace <id-or-slug>', 'Override and remember the active workspace')
  .action(async (options: { workspace?: string }) => {
    await openTui(options.workspace);
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

program.action(async () => { await openTui(); });

try {
  await program.parseAsync();
} catch (error) {
  let message = error instanceof Error ? error.message : 'Command failed';
  let hint = error instanceof CliFailure ? error.hint : undefined;
  if (error instanceof ReflowClientError && error.status === 401) {
    message = 'Your saved login is missing, invalid, or expired.';
    hint = 'Run `reflow auth login` again.';
  } else if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    message = 'Reflow could not reach the configured server.';
    hint = 'Check that the server is running and verify `REFLOW_URL`.';
  }
  console.error(`Error: ${message}`);
  if (hint) console.error(`Next: ${hint}`);
  process.exitCode = 1;
}
