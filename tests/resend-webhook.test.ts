import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../apps/server/src/app.js';
import type { RachetAuth } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';
import type { RachetService } from '../apps/server/src/domain/service.js';
import { contacts, deliveryBlocks, enrollments, resendConnections, sendIntents, sequences, sequenceVersions, suppressions, webhookEvents, workspaces } from '../apps/server/src/db/schema.js';
import { encryptIntegrationSecret, fingerprintIntegrationSecret } from '../apps/server/src/integrations/secret.js';
import { ResendProvider } from '../apps/server/src/providers/resend.js';
import { probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('Resend webhook tenant correlation (postgres)', () => {
  const boot = runtime as DbRuntime;
  const key = Buffer.alloc(32, 7).toString('base64');
  let config: Config;
  const ids: Array<{ workspaceId: string; intentId: string; email: string }> = [];
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    config = { ...boot.config, integrationEncryptionKey: key } as Config;
    for (let index = 0; index < 2; index++) {
      const slug = `webhook-${crypto.randomUUID().slice(0, 8)}`;
      const email = `recipient-${slug}@example.com`;
      const [workspace] = await boot.db.insert(workspaces).values({ name: slug, slug, sendingEnabled: true }).returning();
      if (!workspace) throw new Error('workspace fixture failed');
      const [contact] = await boot.db.insert(contacts).values({ workspaceId: workspace.id, email, emailKey: email }).returning();
      const [sequence] = await boot.db.insert(sequences).values({ workspaceId: workspace.id, name: slug, definition: {} }).returning();
      if (!contact || !sequence) throw new Error('workflow fixture failed');
      const [version] = await boot.db.insert(sequenceVersions).values({ workspaceId: workspace.id, sequenceId: sequence.id, version: 1, contentHash: 'test', definition: {} }).returning();
      if (!version) throw new Error('version fixture failed');
      const [enrollment] = await boot.db.insert(enrollments).values({ workspaceId: workspace.id, contactId: contact.id, sequenceVersionId: version.id, workflowId: `test/${crypto.randomUUID()}`, idempotencyKey: crypto.randomUUID() }).returning();
      if (!enrollment) throw new Error('enrollment fixture failed');
      const [intent] = await boot.db.insert(sendIntents).values({ workspaceId: workspace.id, enrollmentId: enrollment.id, stepId: 'send', idempotencyKey: `enrollment/${enrollment.id}/send`, payloadHash: 'test', recipient: email, subject: 'Test', html: '<p>Test</p>', plainText: 'Test' }).returning();
      if (!intent) throw new Error('intent fixture failed');
      const apiKey = `re_test_${index}_abcdefgh`;
      const secret = `whsec_test_${index}_abcdefgh`;
      await boot.db.insert(resendConnections).values({
        workspaceId: workspace.id,
        apiKeyEncrypted: encryptIntegrationSecret(config, workspace.id, 'resend-api-key', apiKey),
        apiKeyFingerprint: fingerprintIntegrationSecret(config, 'resend-api-key', apiKey),
        webhookSecretEncrypted: encryptIntegrationSecret(config, workspace.id, 'resend-webhook-secret', secret),
        webhookSecretFingerprint: fingerprintIntegrationSecret(config, 'resend-webhook-secret', secret),
        fromAddress: 'sender@example.com',
      });
      ids.push({ workspaceId: workspace.id, intentId: intent.id, email });
    }
    vi.spyOn(ResendProvider.prototype, 'verifyWebhook').mockImplementation(async (raw) => JSON.parse(raw) as Record<string, unknown>);
    app = createApp({ config, auth: {} as RachetAuth, db: boot.db, service: {} as RachetService, operations: {} });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const { workspaceId } of ids) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  function payload(owner: typeof ids[number], emailId: string, legacy = false) {
    return {
      type: 'email.bounced', created_at: '2026-09-21T10:00:00Z',
      data: { email_id: emailId, to: [owner.email], tags: legacy
        ? { reflow_workspace: owner.workspaceId, reflow_intent: owner.intentId }
        : { rachet_workspace: owner.workspaceId, rachet_intent: owner.intentId } },
    };
  }

  async function post(workspaceId: string, body: unknown, eventId = crypto.randomUUID()) {
    return app.request(`/webhooks/resend/${workspaceId}`, { method: 'POST', headers: { 'svix-id': eventId, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  function fixture(index: number) {
    const value = ids[index];
    if (!value) throw new Error(`Missing workspace fixture ${index}`);
    return value;
  }

  it('processes a tagged bounce before the send response stores providerMessageId', async () => {
    const owner = fixture(0);
    const response = await post(owner.workspaceId, payload(owner, 'msg_early'));
    expect(response.status).toBe(200);
    const [intent] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, owner.intentId));
    expect(intent?.providerMessageId).toBe('msg_early');
    const [suppression] = await boot.db.select().from(suppressions).where(and(eq(suppressions.workspaceId, owner.workspaceId), eq(suppressions.emailKey, owner.email)));
    expect(suppression?.active).toBe(true);
  });

  it('retains bounce and complaint as separate delivery blocks', async () => {
    const owner = fixture(0);
    const eventId = crypto.randomUUID();
    const complaint = { ...payload(owner, 'msg_early'), type: 'email.complained' };
    expect((await post(owner.workspaceId, complaint, eventId)).status).toBe(200);
    expect((await post(owner.workspaceId, complaint, eventId)).status).toBe(200);
    const blocks = await boot.db.select().from(deliveryBlocks).where(and(eq(deliveryBlocks.workspaceId, owner.workspaceId), eq(deliveryBlocks.emailKey, owner.email)));
    expect(blocks.map((block) => block.reason).sort()).toEqual(['email.bounced', 'email.complained']);
  });

  it('correlates a bounce from a send tagged before the rename', async () => {
    const owner = fixture(1);
    const response = await post(owner.workspaceId, payload(owner, 'msg_legacy', true));
    expect(response.status).toBe(200);
    const [intent] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, owner.intentId));
    expect(intent?.providerMessageId).toBe('msg_legacy');
  });

  it('stores an opened event for a correlated send', async () => {
    const owner = fixture(0);
    const response = await post(owner.workspaceId, { ...payload(owner, 'msg_early'), type: 'email.opened' });
    expect(response.status).toBe(200);
    const events = await boot.db.select().from(webhookEvents).where(and(eq(webhookEvents.workspaceId, owner.workspaceId), eq(webhookEvents.eventType, 'email.opened')));
    expect(events).toHaveLength(1);
    expect(events[0]?.providerMessageId).toBe('msg_early');
  });

  it('ignores the same signed account event at another workspace endpoint', async () => {
    const owner = fixture(0);
    const other = fixture(1);
    const before = await boot.db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, other.workspaceId));
    const suppressionsBefore = await boot.db.select().from(suppressions).where(eq(suppressions.workspaceId, other.workspaceId));
    expect((await post(other.workspaceId, payload(owner, 'msg_early'))).status).toBe(200);
    expect(await boot.db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, other.workspaceId))).toHaveLength(before.length);
    expect(await boot.db.select().from(suppressions).where(eq(suppressions.workspaceId, other.workspaceId))).toHaveLength(suppressionsBefore.length);
  });

  it('does not acknowledge an uncorrelated legacy bounce', async () => {
    const owner = fixture(0);
    const legacy = { type: 'email.bounced', data: { email_id: 'msg_not_yet_saved', to: [owner.email] } };
    expect((await post(owner.workspaceId, legacy)).status).toBe(503);
  });

  it('rejects an oversized webhook before signature processing', async () => {
    const response = await post(fixture(0).workspaceId, { data: 'x'.repeat(256 * 1024) });
    expect(response.status).toBe(413);
  });
});
