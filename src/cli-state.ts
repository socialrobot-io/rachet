import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SavedWorkspace = { id: string; name: string; slug: string };
type SavedServer = { token?: string; apiKey?: string; workspace?: SavedWorkspace };
type CliState = { version: 1; currentUrl?: string; servers: Record<string, SavedServer> };

export type CliContext = {
  url: string;
  token?: string;
  apiKey?: string;
  workspace?: SavedWorkspace;
};

function normalizeUrl(value: string): string { return value.replace(/\/$/, ''); }

export function cliStatePath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.REFLOW_CONFIG_PATH) return environment.REFLOW_CONFIG_PATH;
  const root = environment.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(root, 'reflow', 'config.json');
}

async function readState(environment: NodeJS.ProcessEnv = process.env): Promise<CliState> {
  try {
    const value = JSON.parse(await readFile(cliStatePath(environment), 'utf8')) as unknown;
    if (typeof value !== 'object' || value === null || !('servers' in value) || typeof value.servers !== 'object' || value.servers === null) throw new Error('invalid');
    const record = value as { currentUrl?: unknown; servers: Record<string, SavedServer> };
    return { version: 1, servers: record.servers, ...(typeof record.currentUrl === 'string' ? { currentUrl: record.currentUrl } : {}) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { version: 1, servers: {} };
    throw new Error(`Invalid Reflow CLI state at ${cliStatePath(environment)}`, { cause: error });
  }
}

async function writeState(state: CliState, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = cliStatePath(environment);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function resolveCliContext(environment: NodeJS.ProcessEnv = process.env): Promise<CliContext> {
  const state = await readState(environment);
  const url = normalizeUrl(environment.REFLOW_URL ?? state.currentUrl ?? 'http://localhost:3000');
  const saved = state.servers[url] ?? {};
  const token = environment.REFLOW_TOKEN ?? saved.token;
  const apiKey = environment.REFLOW_API_KEY ?? saved.apiKey;
  const workspaceId = environment.REFLOW_WORKSPACE_ID;
  const workspace = workspaceId
    ? { id: workspaceId, name: workspaceId, slug: workspaceId }
    : saved.workspace;
  return {
    url,
    ...(token ? { token } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

export async function saveLogin(urlValue: string, token: string, workspace: SavedWorkspace, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const state = await readState(environment);
  const url = normalizeUrl(urlValue);
  state.currentUrl = url;
  state.servers[url] = { ...state.servers[url], token, workspace };
  await writeState(state, environment);
}

export async function saveWorkspace(urlValue: string, workspace: SavedWorkspace, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const state = await readState(environment);
  const url = normalizeUrl(urlValue);
  state.currentUrl = url;
  state.servers[url] = { ...state.servers[url], workspace };
  await writeState(state, environment);
}

export async function clearLogin(urlValue: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const state = await readState(environment);
  const url = normalizeUrl(urlValue);
  const saved = state.servers[url];
  if (saved) state.servers[url] = saved.workspace ? { workspace: saved.workspace } : {};
  await writeState(state, environment);
}
