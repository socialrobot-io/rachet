import { readFile, readdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';

const config = loadConfig(); const { pool } = createDatabase(config); const client = await pool.connect();
try {
  await client.query('select pg_advisory_lock($1)', [731947200]);
  await client.query('create table if not exists reflow_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = [
    ...(await readdir(new URL('migrations/auth/', `file://${process.cwd()}/`))).filter((name) => name.endsWith('.sql')).map((name) => new URL(`migrations/auth/${name}`, `file://${process.cwd()}/`)),
    ...(await readdir(new URL('migrations/reflow/', `file://${process.cwd()}/`))).filter((name) => name.endsWith('.sql')).map((name) => new URL(`migrations/reflow/${name}`, `file://${process.cwd()}/`)),
  ];
  for (const file of files) {
    const name = file.pathname.split('/').slice(-2).join('/');
    const exists = await client.query('select 1 from reflow_migrations where name = $1', [name]); if (exists.rowCount) continue;
    await client.query('begin'); try { await client.query(await readFile(file, 'utf8')); await client.query('insert into reflow_migrations(name) values ($1)', [name]); await client.query('commit'); } catch (error) { await client.query('rollback'); throw error; }
    console.log(`Applied ${name}`);
  }
} finally { await client.query('select pg_advisory_unlock($1)', [731947200]).catch(() => undefined); client.release(); await pool.end(); }
