#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const localEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3000',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://reflow:reflow@127.0.0.1:5433/reflow',
  BETTER_AUTH_SECRET: 'dev-only-change-me-to-at-least-32-chars',
  ALLOW_REGISTRATION: 'false',
  TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'reflow',
  TEMPORAL_TASK_QUEUE: 'reflow-enrollments',
};

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: localEnvironment });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

if (!(await exists('.env'))) {
  await copyFile('.env.dev.example', '.env');
  await chmod('.env', 0o600);
  console.log('Created .env from .env.dev.example');
}

await run('docker', ['compose', '-f', 'compose.dev.yaml', 'up', '-d']);
await run('docker', ['compose', '-f', 'compose.dev.yaml', 'run', '--rm', 'temporal-namespace']);
await run('node', ['--env-file-if-exists=.env.local', '--env-file=.env', '--import', 'tsx', 'apps/server/src/db/migrate.ts']);

await mkdir('.reflow', { recursive: true, mode: 0o700 });
const passwordPath = '.reflow/dev-admin-password';
let generatedPassword = false;
if (!(await exists(passwordPath))) {
  await writeFile(passwordPath, `${randomBytes(18).toString('base64url')}\n`, { mode: 0o600 });
  generatedPassword = true;
}
await run('node', [
  '--env-file-if-exists=.env.local',
  '--env-file=.env',
  '--import',
  'tsx',
  'apps/server/src/setup.ts',
  '--email',
  'admin@localhost',
  '--name',
  'Admin',
  '--password-file',
  passwordPath,
  '--if-needed',
]);

console.log('\nReflow is ready:');
console.log('  Dashboard: http://localhost:5173');
console.log('  API + MCP: http://localhost:3000');
console.log('  Fresh DB:  admin@localhost');
console.log(`  Password:  ${passwordPath}${generatedPassword ? ' (created now; used only when initializing)' : ''}`);
console.log('  Stop:      Ctrl+C, then pnpm dev:infra:down when you want to stop Docker\n');

const commands: Array<[string, string[]]> = [
  ['node', ['--import', 'tsx', '--watch', 'apps/server/src/server.ts']],
  ['node', ['--import', 'tsx', '--watch', 'apps/server/src/worker.ts']],
  ['node', ['--import', 'tsx', '--watch', 'apps/server/src/dispatcher.ts']],
  ['pnpm', ['nx', 'dev', 'dashboard']],
];
const children = commands.map(([command, args]) => spawn(command, args, { stdio: 'inherit', env: localEnvironment }));
let stopping = false;
function stop(signal: NodeJS.Signals = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
const result = await Promise.race(children.map((child) => new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
})));
stop();
process.exitCode = result;
