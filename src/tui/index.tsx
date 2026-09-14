import { render } from 'ink';
import { InkPictureProvider } from 'ink-picture';
import { ReflowClient } from '../client.js';
import { ReflowTui } from './app.js';

export async function launchTui(workspaceId: string, client = new ReflowClient()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI requires an interactive terminal');
  const instance = render(<InkPictureProvider><ReflowTui client={client} workspaceId={workspaceId} /></InkPictureProvider>, { exitOnCtrlC: true });
  await instance.waitUntilExit();
}
