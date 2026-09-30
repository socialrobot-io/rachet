import { render } from 'ink';
import { RachetClient } from '../client.js';
import { RachetTui } from './app.js';

export async function launchTui(workspaceId: string, client = new RachetClient()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI requires an interactive terminal');
  const instance = render(<RachetTui client={client} workspaceId={workspaceId} />, { exitOnCtrlC: true });
  await instance.waitUntilExit();
}
