import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceId = '00000000-0000-4000-8000-000000000010';

describe('CLI login context', () => {
  let directory = '';
  let url = '';
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/auth/sign-in/email') {
        expect(body).toEqual({ email: 'admin@example.com', password: 'correct horse battery staple' });
        response.setHeader('set-auth-token', 'saved-session-token');
        response.end(JSON.stringify({ user: { email: 'admin@example.com' } }));
        return;
      }
      expect(request.headers.authorization).toBe('Bearer saved-session-token');
      if (request.url === '/v1/operations/workspace.list') {
        response.end(JSON.stringify({ status: 'succeeded', data: [{ id: workspaceId, name: 'Social Robot', slug: 'social-robot', role: 'owner' }] }));
        return;
      }
      if (request.url === '/v1/operations/workflow.list') {
        expect(body.workspaceId).toBe(workspaceId);
        response.end(JSON.stringify({ status: 'succeeded', data: [] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'not found' }));
    });
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'reflow-login-'));
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => { server.off('error', fail); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to start');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('logs in, saves the selected workspace, and scopes later calls', async () => {
    const passwordFile = join(directory, 'password');
    const configFile = join(directory, 'config.json');
    await writeFile(passwordFile, 'correct horse battery staple\n', { mode: 0o600 });
    const environment: NodeJS.ProcessEnv = { ...process.env, REFLOW_CONFIG_PATH: configFile };
    delete environment.REFLOW_URL;
    delete environment.REFLOW_TOKEN;
    delete environment.REFLOW_API_KEY;
    delete environment.REFLOW_WORKSPACE_ID;
    const login = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'auth', 'login', '--url', url, '--email', 'admin@example.com', '--password-file', passwordFile, '--workspace', 'social-robot'], { cwd: new URL('..', import.meta.url), env: environment });
    expect(login.stdout).toContain('Workspace: Social Robot (social-robot)');
    expect(login.stdout).not.toContain('saved-session-token');
    expect(JSON.parse(await readFile(configFile, 'utf8'))).toMatchObject({ currentUrl: url, servers: { [url]: { token: 'saved-session-token', workspace: { id: workspaceId } } } });

    const list = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'workspace', 'list'], { cwd: new URL('..', import.meta.url), env: environment });
    expect(list.stdout).toContain('* Social Robot (social-robot) · owner');
    await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'call', 'workflow.list'], { cwd: new URL('..', import.meta.url), env: environment });
  }, 15_000);
});
