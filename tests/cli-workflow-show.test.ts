import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import workflow from '../examples/onboarding.workflow.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const workspaceId = '00000000-0000-4000-8000-000000000010';
const workflowId = '00000000-0000-4000-8000-000000000020';

describe('workflow show CLI', () => {
  const server = createServer((request, response) => {
    expect(request.url).toBe('/v1/operations/workflow.list');
    expect(request.headers.authorization).toBe('Bearer test-token');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'succeeded', data: [{ id: workflowId, name: 'Onboarding', state: 'draft', revision: 1, definition: workflow }] }));
  });
  let url = '';

  beforeAll(async () => {
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
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function run(format: 'mermaid' | 'svg') {
    return execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'workflow', 'show', '--workspace', workspaceId, '--id', workflowId, '--format', format], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, REFLOW_URL: url, REFLOW_TOKEN: 'test-token' },
    });
  }

  it('queries through the operation API and renders Mermaid and SVG formats', async () => {
    const mermaid = await run('mermaid');
    expect(mermaid.stdout).toMatch(/^flowchart TD/);
    const svg = await run('svg');
    expect(svg.stdout).toMatch(/^<svg/);
    expect(svg.stdout).toContain('welcome  action · email.send');
  }, 15_000);
});
