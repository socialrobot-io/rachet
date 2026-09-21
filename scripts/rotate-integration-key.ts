import { Pool } from 'pg';
import { rotateIntegrationKey } from '../apps/server/src/integrations/rotate.js';

const databaseUrl = process.env.DATABASE_URL;
const oldKey = process.env.OLD_INTEGRATION_ENCRYPTION_KEY;
const newKey = process.env.NEW_INTEGRATION_ENCRYPTION_KEY;
const apply = process.argv.includes('--apply');
if (!databaseUrl || !oldKey || !newKey) {
  throw new Error('DATABASE_URL, OLD_INTEGRATION_ENCRYPTION_KEY, and NEW_INTEGRATION_ENCRYPTION_KEY are required');
}
if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply')) throw new Error('Only --apply is supported');
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const count = await rotateIntegrationKey(pool, oldKey, newKey, apply);
  console.log(apply ? `Re-encrypted ${count} organization connections.` : `Dry run: ${count} organization connections can be re-encrypted. No changes were made.`);
} finally {
  await pool.end();
}
