import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowDefinition } from '../domain/contracts.js';
import { renderWorkflowSvg } from './workflow-graph.js';

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

function openFile(path: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function openWorkflowSvg(id: string, definition: WorkflowDefinition): Promise<string> {
  const directory = join(tmpdir(), 'reflow-workflows');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${safeName(id)}.svg`);
  await writeFile(path, renderWorkflowSvg(definition), { encoding: 'utf8', mode: 0o600 });
  await openFile(path);
  return path;
}
