import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearLogin, resolveCliContext, saveLogin, saveWorkspace, type SavedOAuth } from '../packages/cli/src/cli-state.js';

describe('CLI context state', () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  it('securely remembers credentials and the active workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rachet-cli-'));
    directories.push(directory);
    const path = join(directory, 'config.json');
    const environment = { RACHET_CONFIG_PATH: path };
    expect(await resolveCliContext(environment)).toEqual({ url: 'https://rachet.dev' });
    const first = { id: '00000000-0000-4000-8000-000000000010', name: 'Social Robot', slug: 'social-robot' };
    const second = { id: '00000000-0000-4000-8000-000000000011', name: 'Labs', slug: 'labs' };

    const oauth: SavedOAuth = { clientId: 'cli', accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 60_000, scope: 'rachet:read', tokenType: 'Bearer' };
    await saveLogin('https://rachet.example/', oauth, first, environment);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await resolveCliContext(environment)).toMatchObject({ url: 'https://rachet.example', token: 'access-token', oauth, workspace: first });

    await saveWorkspace('https://rachet.example', second, environment);
    expect((await resolveCliContext(environment)).workspace).toEqual(second);
    await clearLogin('https://rachet.example', environment);
    expect(await resolveCliContext(environment)).toEqual({ url: 'https://rachet.example', workspace: second });
  });

  it('lets environment variables temporarily override saved context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rachet-cli-'));
    directories.push(directory);
    const environment = { RACHET_CONFIG_PATH: join(directory, 'config.json') };
    await saveLogin('https://saved.example', { clientId: 'cli', accessToken: 'saved-token', expiresAt: Date.now() + 60_000, scope: 'rachet:read', tokenType: 'Bearer' }, { id: 'saved', name: 'Saved', slug: 'saved' }, environment);
    expect(await resolveCliContext({ ...environment, RACHET_URL: 'https://other.example/', RACHET_TOKEN: 'override', RACHET_WORKSPACE_ID: 'other' }))
      .toEqual({ url: 'https://other.example', token: 'override', workspace: { id: 'other', name: 'other', slug: 'other' } });
  });

  it('reads an existing legacy config and saves it under the Rachet path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rachet-cli-'));
    directories.push(directory);
    const legacyDirectory = join(directory, 'reflow');
    await mkdir(legacyDirectory);
    await writeFile(join(legacyDirectory, 'config.json'), JSON.stringify({
      version: 2,
      currentUrl: 'https://rachet.example',
      servers: { 'https://rachet.example': { token: 'saved-token' } },
    }));
    const environment = { XDG_CONFIG_HOME: directory };

    expect(await resolveCliContext(environment)).toMatchObject({ url: 'https://rachet.example', token: 'saved-token' });
    await saveWorkspace('https://rachet.example', { id: 'workspace', name: 'Workspace', slug: 'workspace' }, environment);
    expect((await stat(join(directory, 'rachet', 'config.json'))).mode & 0o777).toBe(0o600);
    expect(await resolveCliContext(environment)).toMatchObject({ url: 'https://rachet.example', token: 'saved-token' });
  });
});
