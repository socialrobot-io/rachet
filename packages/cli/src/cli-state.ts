import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SavedWorkspace = { id: string; name: string; slug: string };
export type SavedOAuth = {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
};
type SavedServer = { token?: string; apiKey?: string; oauth?: SavedOAuth; workspace?: SavedWorkspace };
type CliState = { version: 2; currentUrl?: string; servers: Record<string, SavedServer> };

export type CliContext = {
  url: string;
  token?: string;
  apiKey?: string;
  oauth?: SavedOAuth;
  workspace?: SavedWorkspace;
};

function normalizeUrl(value: string): string { return value.replace(/\/$/, ''); }

export function cliStatePath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.RACHET_CONFIG_PATH) return environment.RACHET_CONFIG_PATH;
  if (environment.REFLOW_CONFIG_PATH) return environment.REFLOW_CONFIG_PATH;
  const root = environment.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(root, 'rachet', 'config.json');
}

async function readState(environment: NodeJS.ProcessEnv = process.env): Promise<CliState> {
  const path = cliStatePath(environment);
  let source = path;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    if (environment.RACHET_CONFIG_PATH || environment.REFLOW_CONFIG_PATH) return { version: 2, servers: {} };
    source = join(environment.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'reflow', 'config.json');
    try {
      raw = await readFile(source, 'utf8');
    } catch (legacyError) {
      if (legacyError instanceof Error && 'code' in legacyError && legacyError.code === 'ENOENT') return { version: 2, servers: {} };
      throw legacyError;
    }
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || !('servers' in value) || typeof value.servers !== 'object' || value.servers === null) throw new Error('invalid');
    const record = value as { currentUrl?: unknown; servers: Record<string, SavedServer> };
    return { version: 2, servers: record.servers, ...(typeof record.currentUrl === 'string' ? { currentUrl: record.currentUrl } : {}) };
  } catch (error) {
    throw new Error(`Invalid Rachet CLI state at ${source}`, { cause: error });
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
  const url = normalizeUrl(environment.RACHET_URL ?? environment.REFLOW_URL ?? state.currentUrl ?? 'https://rachet.dev');
  const saved = state.servers[url] ?? {};
  const tokenOverride = environment.RACHET_TOKEN ?? environment.REFLOW_TOKEN;
  const token = tokenOverride ?? saved.oauth?.accessToken ?? saved.token;
  const apiKey = environment.RACHET_API_KEY ?? environment.REFLOW_API_KEY ?? saved.apiKey;
  const workspaceId = environment.RACHET_WORKSPACE_ID ?? environment.REFLOW_WORKSPACE_ID;
  const workspace = workspaceId
    ? { id: workspaceId, name: workspaceId, slug: workspaceId }
    : saved.workspace;
  return {
    url,
    ...(token ? { token } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(saved.oauth && !tokenOverride ? { oauth: saved.oauth } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

export async function saveLogin(urlValue: string, oauth: SavedOAuth, workspace: SavedWorkspace, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const state = await readState(environment);
  const url = normalizeUrl(urlValue);
  state.currentUrl = url;
  const saved = { ...state.servers[url] };
  delete saved.token;
  state.servers[url] = { ...saved, oauth, workspace };
  await writeState(state, environment);
}

export async function saveRefreshedOAuth(urlValue: string, oauth: SavedOAuth, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const state = await readState(environment);
  const url = normalizeUrl(urlValue);
  state.currentUrl = url;
  const saved = { ...state.servers[url] };
  delete saved.token;
  state.servers[url] = { ...saved, oauth };
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
