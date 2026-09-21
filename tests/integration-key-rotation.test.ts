import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Config } from '../apps/server/src/config.js';
import { resendConnections, workspaces } from '../apps/server/src/db/schema.js';
import { rotateIntegrationKey } from '../apps/server/src/integrations/rotate.js';
import { decryptIntegrationSecret, encryptIntegrationSecret, fingerprintIntegrationSecret } from '../apps/server/src/integrations/secret.js';
import { probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('integration encryption key rotation (postgres)', () => {
  const boot = runtime as DbRuntime;
  const oldKey = Buffer.alloc(32, 11).toString('base64');
  const newKey = Buffer.alloc(32, 12).toString('base64');
  const oldConfig = { integrationEncryptionKey: oldKey } as Config;
  const newConfig = { integrationEncryptionKey: newKey } as Config;
  let workspaceId = '';

  beforeAll(async () => {
    const slug = `rotate-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({ name: slug, slug }).returning();
    if (!workspace) throw new Error('workspace fixture failed');
    workspaceId = workspace.id;
    await boot.db.insert(resendConnections).values({
      workspaceId,
      apiKeyEncrypted: encryptIntegrationSecret(oldConfig, workspaceId, 'resend-api-key', 're_rotation_fixture'),
      apiKeyFingerprint: fingerprintIntegrationSecret(oldConfig, 'resend-api-key', 're_rotation_fixture'),
      webhookSecretEncrypted: encryptIntegrationSecret(oldConfig, workspaceId, 'resend-webhook-secret', 'whsec_rotation_fixture'),
      webhookSecretFingerprint: fingerprintIntegrationSecret(oldConfig, 'resend-webhook-secret', 'whsec_rotation_fixture'),
      fromAddress: 'sender@example.com',
    });
  });

  afterAll(async () => {
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  it('dry-runs without changing secrets, then atomically re-encrypts them', async () => {
    const [before] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    expect(before).toBeDefined();
    await expect(rotateIntegrationKey(boot.pool, Buffer.alloc(32, 9).toString('base64'), newKey, true, [workspaceId])).rejects.toThrow();
    expect(await rotateIntegrationKey(boot.pool, oldKey, newKey, false, [workspaceId])).toBe(1);
    const [afterDryRun] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    expect(afterDryRun?.apiKeyEncrypted).toBe(before?.apiKeyEncrypted);
    expect(await rotateIntegrationKey(boot.pool, oldKey, newKey, true, [workspaceId])).toBe(1);
    const [after] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    if (!after) throw new Error('connection fixture disappeared');
    expect(decryptIntegrationSecret(newConfig, workspaceId, 'resend-api-key', after.apiKeyEncrypted)).toBe('re_rotation_fixture');
    expect(decryptIntegrationSecret(newConfig, workspaceId, 'resend-webhook-secret', after.webhookSecretEncrypted)).toBe('whsec_rotation_fixture');
    expect(() => decryptIntegrationSecret(oldConfig, workspaceId, 'resend-api-key', after.apiKeyEncrypted)).toThrow();
  });
});
