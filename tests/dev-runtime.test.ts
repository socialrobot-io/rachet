import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('development runtime compatibility', () => {
  it('does not run the Temporal worker under Node native watch mode', async () => {
    const project = JSON.parse(await readFile('apps/server/project.json', 'utf8')) as {
      targets: Record<string, { options?: { command?: string } }>;
    };
    const command = project.targets['dev-worker']?.options?.command ?? '';
    expect(command).toContain('tsx/dist/cli.mjs watch');
    expect(command).not.toMatch(/node .*--watch/);
  });

  it('does not silently move the dashboard to a different port', async () => {
    const viteConfig = await readFile('apps/dashboard/vite.config.ts', 'utf8');
    expect(viteConfig).toContain('strictPort: true');
  });

  it('honors strong development setup secrets and replaces short ones', async () => {
    const devScript = await readFile('scripts/dev.ts', 'utf8');
    expect(devScript).toContain('!localEnvironment.REFLOW_SETUP_SECRET || localEnvironment.REFLOW_SETUP_SECRET.length < 32');
    expect(devScript).toContain("saveLocalEnvironmentValue('REFLOW_SETUP_SECRET'");
    expect(devScript).not.toContain('REFLOW_SETUP_SECRET_FILE');
    expect(devScript).not.toContain('dev-setup-secret');
  });

  it('passes the configured registration policy to the server', async () => {
    const devScript = await readFile('scripts/dev.ts', 'utf8');
    expect(devScript).not.toMatch(/ALLOW_REGISTRATION\s*:/);
    expect(devScript).toContain('...process.env');
  });
});
