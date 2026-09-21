#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists('.env'))) {
  await copyFile('.env.dev.example', '.env');
  await chmod('.env', 0o600);
  console.log('Created .env from .env.dev.example');
}

// Load optional provider credentials first; .env supplies defaults for values
// that are still absent. Local infrastructure settings below stay deterministic.
if (await exists('.env.local')) process.loadEnvFile('.env.local');
process.loadEnvFile('.env');

async function saveLocalEnvironmentValue(key: string, value: string): Promise<void> {
  const path = '.env.local';
  const current = (await exists(path)) ? await readFile(path, 'utf8') : '';
  const assignment = `${key}=${JSON.stringify(value)}`;
  const lines = current.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = assignment;
  else lines.push(assignment);
  await writeFile(path, `${lines.filter((line, lineIndex) => line.length > 0 || lineIndex < lines.length - 1).join('\n')}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

const localEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3000',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://reflow:reflow@127.0.0.1:5433/reflow',
  BETTER_AUTH_SECRET: 'dev-only-change-me-to-at-least-32-chars',
  TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
  // Cursor's current MCP OAuth flow uses its reviewed web callback rather
  // than the cursor: private-use scheme. Production stays explicitly configured.
  OAUTH_PUBLIC_REDIRECT_ORIGINS: process.env.OAUTH_PUBLIC_REDIRECT_ORIGINS || 'https://www.cursor.com',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'reflow',
  TEMPORAL_TASK_QUEUE: 'reflow-enrollments',
};

if (!localEnvironment.REFLOW_SETUP_SECRET || localEnvironment.REFLOW_SETUP_SECRET.length < 32) {
  localEnvironment.REFLOW_SETUP_SECRET = randomBytes(32).toString('base64url');
  await saveLocalEnvironmentValue('REFLOW_SETUP_SECRET', localEnvironment.REFLOW_SETUP_SECRET);
  console.log('Generated a strong REFLOW_SETUP_SECRET in .env.local');
}

if (!localEnvironment.INTEGRATION_ENCRYPTION_KEY) {
  localEnvironment.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await saveLocalEnvironmentValue('INTEGRATION_ENCRYPTION_KEY', localEnvironment.INTEGRATION_ENCRYPTION_KEY);
  console.log('Generated an INTEGRATION_ENCRYPTION_KEY in .env.local');
}

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

await run('docker', ['compose', '-f', 'compose.dev.yaml', 'up', '-d']);
await run('docker', ['compose', '-f', 'compose.dev.yaml', 'run', '--rm', 'temporal-namespace']);
await run('node', ['--env-file-if-exists=.env.local', '--env-file=.env', '--import', 'tsx', 'apps/server/src/db/migrate.ts']);

console.log('\nReflow is ready:');
console.log('  Dashboard: http://localhost:5173');
console.log('  API + MCP: http://localhost:3000');
console.log('  Fresh DB:  enter REFLOW_SETUP_SECRET from .env.local or .env');
console.log('  Sign-in:   configure AUTH_RESEND_API_KEY or GitHub credentials in .env.local');
console.log('  Stop:      Ctrl+C, then pnpm dev:infra:down when you want to stop Docker\n');

const commands: Array<[string, string[]]> = [
  // Node 24.18+ native watch mode sends WATCH_REPORT_DEPENDENCIES messages
  // through worker_threads. Temporal also uses that channel and currently
  // treats those messages as workflow activation callbacks. Keep watching in
  // the parent process instead of enabling Node's native watcher.
  ['node', ['node_modules/tsx/dist/cli.mjs', 'watch', 'apps/server/src/server.ts']],
  ['node', ['node_modules/tsx/dist/cli.mjs', 'watch', 'apps/server/src/worker.ts']],
  ['node', ['node_modules/tsx/dist/cli.mjs', 'watch', 'apps/server/src/dispatcher.ts']],
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
