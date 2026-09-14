import { render } from 'ink';
import { ReflowClient } from '../client.js';
import { ReflowTui } from './app.js';

export async function launchTui(workspaceId: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI requires an interactive terminal');
  const instance = render(<ReflowTui client={new ReflowClient()} workspaceId={workspaceId} />, { exitOnCtrlC: true });
  await instance.waitUntilExit();
}
