import { createInterface } from 'node:readline/promises';

export async function promptText(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`${label} is required in a noninteractive terminal`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(`${label}: `)).trim(); }
  finally { terminal.close(); }
}

export async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error(`${label} requires --password-file in a noninteractive terminal`);
  process.stdout.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', receive);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const receive = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') { finish(); reject(new Error('Login cancelled')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(value); return; }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
        const code = character.charCodeAt(0);
        if (code > 31 && code !== 127) value += character;
      }
    };
    process.stdin.on('data', receive);
  });
}

export type WorkspaceChoice = { id: string; name: string; slug: string; role?: string };

export async function chooseWorkspace(workspaces: WorkspaceChoice[]): Promise<WorkspaceChoice> {
  if (workspaces.length === 0) throw new Error('Your account does not have access to a workspace');
  const only = workspaces[0];
  if (workspaces.length === 1 && only) return only;
  if (!process.stdin.isTTY) throw new Error('Multiple workspaces are available; run interactively or pass --workspace');
  process.stdout.write('\nAvailable workspaces:\n');
  workspaces.forEach((workspace, index) => process.stdout.write(`  ${index + 1}. ${workspace.name} (${workspace.slug})${workspace.role ? ` · ${workspace.role}` : ''}\n`));
  while (true) {
    const answer = await promptText('Select workspace');
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && workspaces[index]) return workspaces[index];
    process.stdout.write(`Enter a number from 1 to ${workspaces.length}.\n`);
  }
}
