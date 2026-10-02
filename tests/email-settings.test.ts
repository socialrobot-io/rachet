import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../apps/server/src/app.js';
import type { RachetAuth } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';
import { auditEvents, emailPolicies, resendConnections, workspaces } from '../apps/server/src/db/schema.js';
import type { RachetService } from '../apps/server/src/domain/service.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('combined email settings (postgres)', () => {
  const boot = runtime as DbRuntime;
  let workspaceId = '';
  let app: ReturnType<typeof createApp>;
  const origin = 'https://rachet.example.test';
  const key = Buffer.alloc(32, 15).toString('base64');
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const apiKey = `re_${suffix}`;
  const webhookSecret = `whsec_${suffix}`;

  beforeAll(async () => {
    const [workspace] = await boot.db.insert(workspaces).values({ name: 'Email settings', slug: `email-settings-${suffix.slice(0, 12)}` }).returning();
    if (!workspace) throw new Error('workspace fixture failed');
    workspaceId = workspace.id;
    const config = { ...boot.config, integrationEncryptionKey: key, publicUrl: origin, trustedOrigins: [origin] } as Config;
    const auth = { api: { getSession: async () => ({ user: { id: 'email-settings-owner', email: 'owner@example.com' } }) } } as unknown as RachetAuth;
    const service = { principalFor: async () => ({ workspaceRoles: { [workspaceId]: 'owner' } }) } as unknown as RachetService;
    app = createApp({ config, auth, db: boot.db, service, operations: {} });
  });

  afterAll(async () => {
    if (workspaceId) {
      await boot.db.delete(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));
      await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    await boot.close();
  });

  function save(input: Record<string, unknown>) {
    return app.request('/api/integrations/resend', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, ...input }),
    });
  }

  it('allows transactional-only setup and preserves a tested connection when marketing details change', async () => {
    const first = await save({ from: 'Team <hello@example.com>', apiKey, webhookSecret });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ connectionChanged: true, marketingConfigured: false });
    expect(await boot.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, workspaceId))).toHaveLength(0);

    const acceptedAt = new Date();
    await boot.db.update(resendConnections).set({ lastTestAcceptedAt: acceptedAt }).where(eq(resendConnections.workspaceId, workspaceId));
    await boot.db.update(workspaces).set({ sendingEnabled: true }).where(eq(workspaces.id, workspaceId));
    const [before] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));

    const marketing = await save({
      from: 'Team <hello@example.com>', senderName: 'Acme', supportEmail: 'help@example.com', marketingFromAddress: 'news@example.com',
    });
    expect(marketing.status).toBe(200);
    expect(await marketing.json()).toMatchObject({ connectionChanged: false, marketingConfigured: true });
    const [after] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    const [workspace] = await boot.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    const [policy] = await boot.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, workspaceId));
    expect(after?.version).toBe(before?.version);
    expect(after?.apiKeyEncrypted).toBe(before?.apiKeyEncrypted);
    expect(after?.webhookSecretEncrypted).toBe(before?.webhookSecretEncrypted);
    expect(after?.lastTestAcceptedAt).toEqual(acceptedAt);
    expect(workspace?.sendingEnabled).toBe(true);
    expect(policy).toMatchObject({ senderName: 'Acme', supportEmail: 'help@example.com', marketingFromAddress: 'news@example.com' });
    expect((await boot.db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId))).some((event) => event.action === 'email_policy.update')).toBe(true);
  });

  it('rejects an invalid marketing sender without changing either setting', async () => {
    const [before] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    const invalid = await save({
      from: 'Team <news@example.com>', apiKey: `re_${crypto.randomUUID().replaceAll('-', '')}`, webhookSecret: `whsec_${crypto.randomUUID().replaceAll('-', '')}`,
      senderName: 'Changed', supportEmail: 'changed@example.com', marketingFromAddress: 'news@example.com',
    });
    expect(invalid.status).toBe(422);
    const [after] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    const [policy] = await boot.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, workspaceId));
    expect(after?.version).toBe(before?.version);
    expect(after?.fromAddress).toBe(before?.fromAddress);
    expect(policy?.senderName).toBe('Acme');
  });

  it('requires both secrets when changing the transactional sender', async () => {
    const response = await save({ from: 'Team <other@example.com>' });
    expect(response.status).toBe(422);
    const [connection] = await boot.db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));
    expect(connection?.fromAddress).toBe('Team <hello@example.com>');
  });

  it('applies the same sender separation to the CLI and MCP email policy operation', async () => {
    await expect(boot.service.emailPolicyUpdate(adminContext(), {
      workspaceId, senderName: 'Acme', supportEmail: 'help@example.com', marketingFromAddress: 'hello@example.com',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const [policy] = await boot.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, workspaceId));
    expect(policy?.marketingFromAddress).toBe('news@example.com');
  });
});
