import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('CLI errors before login', () => {
  let directory = '';
  let environment: NodeJS.ProcessEnv;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'reflow-errors-'));
    environment = { ...process.env, REFLOW_CONFIG_PATH: join(directory, 'missing.json'), REFLOW_URL: 'http://127.0.0.1:1' };
    // Nx sets FORCE_COLOR for task output; do not leak it into the child CLI's
    // exact stderr contract, especially when the host also sets NO_COLOR.
    delete environment.FORCE_COLOR;
    delete environment.REFLOW_TOKEN;
    delete environment.REFLOW_API_KEY;
    delete environment.REFLOW_WORKSPACE_ID;
  });
  afterAll(async () => rm(directory, { recursive: true, force: true }));

  async function run(...arguments_: string[]) {
    try {
      await execFileAsync(process.execPath, ['--import', 'tsx', 'packages/cli/src/cli.ts', ...arguments_], { cwd: new URL('..', import.meta.url), env: environment });
      throw new Error('Expected command to fail');
    } catch (error) {
      return error as Error & { code: number; stderr: string; stdout: string };
    }
  }

  it.each([
    ['plain Reflow', []],
    ['generic operation', ['call', 'workflow.list']],
    ['workflow view', ['workflow', 'show', '--name', 'Onboarding']],
  ])('%s gives one actionable error without contacting the server', async (_name, arguments_) => {
    const error = await run(...arguments_);
    expect(error.code).toBe(1);
    expect(error.stderr).toBe('Error: You are not logged in to http://127.0.0.1:1.\nNext: Run `reflow auth login`.\n');
    expect(error.stderr).not.toContain('at ');
    expect(error.stdout).toBe('');
  }, 15_000);
});
