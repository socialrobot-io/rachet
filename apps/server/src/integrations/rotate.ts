import type { Pool } from 'pg';
import type { Config } from '../config.js';
import { decryptIntegrationSecret, encryptIntegrationSecret, fingerprintIntegrationSecret } from './secret.js';

function keyConfig(key: string): Config {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32) {
    throw new Error('Integration encryption keys must each be base64-encoded 32-byte values');
  }
  return { integrationEncryptionKey: key } as Config;
}

/** Re-encrypt every saved organization connection in one transaction. The
 * caller must stop app/worker/dispatcher before running an --apply rotation. */
export async function rotateIntegrationKey(pool: Pool, oldKey: string, newKey: string, apply: boolean, workspaceIds?: string[]): Promise<number> {
  if (oldKey === newKey) throw new Error('Old and new integration encryption keys must differ');
  const oldConfig = keyConfig(oldKey);
  const newConfig = keyConfig(newKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      workspace_id: string; api_key_encrypted: string; webhook_secret_encrypted: string;
    }>(workspaceIds
      ? 'SELECT workspace_id, api_key_encrypted, webhook_secret_encrypted FROM resend_connections WHERE workspace_id = ANY($1::uuid[]) FOR UPDATE'
      : 'SELECT workspace_id, api_key_encrypted, webhook_secret_encrypted FROM resend_connections FOR UPDATE',
    workspaceIds ? [workspaceIds] : []);
    const updates = result.rows.map((row) => {
      const apiKey = decryptIntegrationSecret(oldConfig, row.workspace_id, 'resend-api-key', row.api_key_encrypted);
      const webhookSecret = decryptIntegrationSecret(oldConfig, row.workspace_id, 'resend-webhook-secret', row.webhook_secret_encrypted);
      return {
        workspaceId: row.workspace_id,
        apiKeyEncrypted: encryptIntegrationSecret(newConfig, row.workspace_id, 'resend-api-key', apiKey),
        apiKeyFingerprint: fingerprintIntegrationSecret(newConfig, 'resend-api-key', apiKey),
        webhookSecretEncrypted: encryptIntegrationSecret(newConfig, row.workspace_id, 'resend-webhook-secret', webhookSecret),
        webhookSecretFingerprint: fingerprintIntegrationSecret(newConfig, 'resend-webhook-secret', webhookSecret),
      };
    });
    if (apply) {
      for (const row of updates) {
        await client.query(`UPDATE resend_connections SET api_key_encrypted = $2, api_key_fingerprint = $3,
          webhook_secret_encrypted = $4, webhook_secret_fingerprint = $5, updated_at = now()
          WHERE workspace_id = $1`, [row.workspaceId, row.apiKeyEncrypted, row.apiKeyFingerprint, row.webhookSecretEncrypted, row.webhookSecretFingerprint]);
      }
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    return updates.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
