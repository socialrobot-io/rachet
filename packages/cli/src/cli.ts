#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { ReflowClient, ReflowClientError } from './client.js';
import { chooseWorkspace, type WorkspaceChoice } from './cli-prompts.js';
import { clearLogin, resolveCliContext, saveLogin, saveRefreshedOAuth, saveWorkspace, type CliContext, type SavedWorkspace } from './cli-state.js';
import { loginWithBrowser, refreshOAuth } from './oauth.js';
import { workflowDefinitionSchema } from '../../contracts/src/index.js';
import { renderMermaidWorkflow, renderWorkflowSvg } from './tui/workflow-graph.js';
import { registerTemplateCommands } from './cli-templates.js';

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
  const data = await response.json().catch(() => ({ message: response.statusText })) as unknown;
  if (!response.ok) {
    const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(data);
    throw new ReflowClientError(response.status, message, {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
      ...(record.details && typeof record.details === 'object' ? { details: record.details as Record<string, unknown> } : {}),
    });
  }
  return data;
}

function client(context: CliContext): ReflowClient {
  return new ReflowClient({ url: context.url, ...(context.token ? { token: context.token } : {}), ...(context.apiKey ? { apiKey: context.apiKey } : {}) });
}

function requireAuthentication(context: CliContext): void {
  if (context.token || context.apiKey) return;
  throw new CliFailure(`You are not logged in to ${context.url}.`, 'Run `rachet auth login`.');
}

async function resolveAuthenticatedCliContext(): Promise<CliContext> {
  const context = await resolveCliContext();
  if (context.oauth && context.oauth.expiresAt <= Date.now() + 30_000) {
    try {
      const oauth = await refreshOAuth(context.url, context.oauth);
      await saveRefreshedOAuth(context.url, oauth);
      return { ...context, token: oauth.accessToken, oauth };
    } catch {
    throw new CliFailure('Your Rachet authorization expired or was revoked.', 'Run `rachet auth login` again.');
    }
  }
  requireAuthentication(context);
  return context;
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
  const context = await resolveAuthenticatedCliContext();
  await availableWorkspaces(context);
  const workspace = await resolveWorkspace(context, selector, Boolean(selector) || !context.workspace);
  const { launchTui } = await import('./tui/index.js');
  await launchTui(workspace.id, client(context));
}

const program = new Command().name('rachet').description('Operate Rachet entirely from the command line.').version('0.1.0');
program.command('call').argument('<operation>', 'Operation name, such as workflow.validate').option('-i, --input <json>').option('-f, --file <path>').action(async (operation, options: { input?: string; file?: string }) => {
  const context = await resolveAuthenticatedCliContext();
  const input = await jsonInput(options.input, options.file);
  if (!('workspaceId' in input) && context.workspace) input.workspaceId = context.workspace.id;
  console.log(JSON.stringify(await request(context, `/v1/operations/${operation}`, input), null, 2));
});
const auth = program.command('auth');
auth.command('login')
  .description('Authorize this CLI in the Rachet dashboard using OAuth 2.1 + PKCE.')
  .option('--url <url>', 'Rachet server URL')
  .option('--workspace <id-or-slug>', 'Select without prompting')
  .option('--no-open', 'Print the authorization URL without opening a browser')
  .action(async (options: { url?: string; workspace?: string; open: boolean }) => {
    const context: CliContext = { url: (options.url ?? process.env.REFLOW_URL ?? 'https://rachet.dev').replace(/\/$/, '') };
    const result = await loginWithBrowser({
      url: context.url,
      openBrowser: options.open,
      onAuthorize: (url) => console.log(`Authorize Rachet CLI in your browser:\n${url}`),
    });
    const authenticated: CliContext = { url: context.url, token: result.oauth.accessToken, oauth: result.oauth };
    const choices = await availableWorkspaces(authenticated);
    const choice = options.workspace
      ? choices.find((item) => item.id === options.workspace || item.slug === options.workspace || item.name.toLowerCase() === options.workspace?.toLowerCase())
      : await chooseWorkspace(choices);
    if (!choice) throw new Error(`Workspace not found: ${options.workspace}`);
    await saveLogin(context.url, result.oauth, savedWorkspace(choice));
    console.log('Rachet CLI authorized.');
    console.log(`Workspace: ${choice.name} (${choice.slug})`);
  });
auth.command('logout').description('Remove the saved credential for the current Rachet server.').action(async () => {
  const context = await resolveCliContext();
  await clearLogin(context.url);
  console.log(`Logged out from ${context.url}`);
});
const workspaceCommand = program.command('workspace').description('List or change the active workspace.');
workspaceCommand.command('list').action(async () => {
  const context = await resolveAuthenticatedCliContext();
  const choices = await availableWorkspaces(context);
  for (const choice of choices) console.log(`${choice.id === context.workspace?.id ? '*' : ' '} ${choice.name} (${choice.slug}) · ${choice.role ?? 'member'}`);
});
workspaceCommand.command('use').argument('[workspace]', 'Workspace ID, slug, or exact name').action(async (selector?: string) => {
  const context = await resolveAuthenticatedCliContext();
  const choices = await availableWorkspaces(context);
  const choice = selector
    ? choices.find((item) => item.id === selector || item.slug === selector || item.name.toLowerCase() === selector.toLowerCase())
    : await chooseWorkspace(choices);
  if (!choice) throw new Error(`Workspace not found: ${selector}`);
  const selected = savedWorkspace(choice);
  await saveWorkspace(context.url, selected);
  console.log(`Workspace: ${selected.name} (${selected.slug})`);
});

registerTemplateCommands(program, { resolveCliContext: resolveAuthenticatedCliContext, requireAuthentication, resolveWorkspace, client });

type ListedWorkflow = { id: string; name: string; definition: unknown };
const workflow = program.command('workflow').description('Inspect workflows with human-readable output.');
workflow.command('show')
  .option('--workspace <id-or-slug>', 'Override the active workspace')
  .option('--id <id>', 'Workflow UUID')
  .option('--name <name>', 'Exact workflow name')
  .option('--format <format>', 'svg, mermaid, or json', 'svg')
  .action(async (options: { workspace?: string; id?: string; name?: string; format: string }) => {
    const context = await resolveAuthenticatedCliContext();
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
program.action(async () => { await openTui(); });

try {
  await program.parseAsync();
} catch (error) {
  let message = error instanceof Error ? error.message : 'Command failed';
  let hint = error instanceof CliFailure ? error.hint : undefined;
  if (error instanceof ReflowClientError) {
    if (error.status === 401) {
      message = 'Your saved login is missing, invalid, or expired.';
      hint = 'Run `rachet auth login` again.';
    } else {
      if (error.code) message = `${error.code}: ${message}`;
      hint = error.hint ?? hint;
      if (error.details) console.error(JSON.stringify({ details: error.details }, null, 2));
    }
  } else if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    message = 'Rachet could not reach the configured server.';
    hint = 'Check that the server is running and verify `REFLOW_URL`.';
  }
  console.error(`Error: ${message}`);
  if (hint) console.error(`Next: ${hint}`);
  process.exitCode = 1;
}
