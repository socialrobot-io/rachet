import { and, eq, inArray } from 'drizzle-orm';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditEvents, outbox, resendConnections, sendIntents, unsubscribeTokens, workspaces } from '../apps/server/src/db/schema.js';
import { configureActivities, deliverStandaloneEmail, finishStandaloneEmail, resetActivities } from '../apps/server/src/temporal/activities.js';
import { standaloneEmailWorkflow } from '../apps/server/src/temporal/workflows.js';
import { adminContext, probeDbRuntime, roleContext, type DbRuntime } from './helpers/db-runtime.js';
import { FakeEmailProvider } from './helpers/fake-email-provider.js';

vi.stubEnv('UNSUBSCRIBE_SIGNING_KEYS', Buffer.alloc(32).toString('base64'));
const runtime = await probeDbRuntime();
vi.unstubAllEnvs();

describe.skipIf(!runtime)('one-off email (PostgreSQL and fake provider)', () => {
  const boot = runtime as DbRuntime;
  const admin = adminContext();
  const provider = new FakeEmailProvider();
  let workspaceId: string;

  beforeAll(async () => {
    const slug = `one-off-${crypto.randomUUID()}`;
    const [workspace] = await boot.db.insert(workspaces).values({ name: slug, slug, sendingEnabled: true }).returning();
    if (!workspace) throw new Error('Workspace was not created');
    workspaceId = workspace.id;
    await boot.db.insert(resendConnections).values({
      workspaceId, fromAddress: 'support@example.com',
      apiKeyEncrypted: 'unused', webhookSecretEncrypted: 'unused', apiKeyFingerprint: slug, webhookSecretFingerprint: slug,
    });
    configureActivities(boot.config, { db: boot.db, provider });
  });

  afterAll(async () => {
    resetActivities();
    if (workspaceId) {
      const rows = await boot.db.select({ id: sendIntents.id }).from(sendIntents).where(eq(sendIntents.workspaceId, workspaceId));
      if (rows.length) await boot.db.delete(outbox).where(inArray(outbox.aggregateId, rows.map(({ id }) => id)));
      await boot.db.delete(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));
      await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    await boot.close();
  });

  const draft = {
    to: 'USER@example.com', subject: 'Your account', body: 'Hi {{name}},\n\nYour account is ready. <3',
    purpose: 'transactional', idempotencyKey: 'welcome-user',
  } as const;

  it('queues once across concurrent requests and retries identical bytes after an unknown outcome', async () => {
    const input = { ...draft, workspaceId };
    await expect(boot.service.messageSend(roleContext(workspaceId, 'viewer'), input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sender = roleContext(workspaceId, 'sender');
    const receipts = await Promise.all([boot.service.messageSend(sender, input), boot.service.messageSend(sender, input)]);
    const [{ id }] = receipts;
    expect(receipts).toEqual(expect.arrayContaining([
      { id, state: 'prepared', duplicate: false },
      { id, state: 'prepared', duplicate: true },
    ]));
    await expect(boot.service.messageSend(sender, { ...input, body: 'Different body' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const jobs = await boot.db.select().from(outbox).where(and(eq(outbox.kind, 'message.send'), eq(outbox.aggregateId, id)));
    expect(jobs).toHaveLength(1);
    const records = await boot.db.select().from(auditEvents).where(eq(auditEvents.targetId, id));
    expect(records).toHaveLength(1);

    provider.sent.length = 0;
    provider.nextOutcome = { kind: 'accepted', messageId: 'one-off-accepted' };
    const send = provider.send.bind(provider);
    const firstAttempt = vi.spyOn(provider, 'send').mockImplementationOnce(async (message, key) => {
      await send(message, key);
      return { kind: 'unknown', code: 'timeout' };
    });
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const workflowsPath = new URL('../apps/server/src/temporal/workflows.ts', import.meta.url).pathname;
      const taskQueue = `test-message-${id}`;
      const worker = await Worker.create({
        connection: environment.nativeConnection, taskQueue, workflowsPath,
        activities: { deliverStandaloneEmail, finishStandaloneEmail },
      });
      const handle = await environment.client.workflow.start(standaloneEmailWorkflow, {
        taskQueue, workflowId: `message/${id}`, args: [id],
        workflowIdConflictPolicy: 'USE_EXISTING', workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
      await worker.runUntil(handle.result());
      await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory(), handle.workflowId);
    } finally {
      firstAttempt.mockRestore();
      await environment.teardown();
    }
    await deliverStandaloneEmail(id);
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[1]).toEqual(provider.sent[0]);
    expect(provider.sent[0]?.message).toMatchObject({
      from: 'support@example.com', to: draft.to, text: draft.body,
      html: expect.stringContaining('Hi {{name}},<br><br>Your account is ready. &lt;3'),
    });
    await expect(boot.service.messageSend(sender, input)).resolves.toEqual({ id, state: 'accepted', duplicate: true });
  });

  it('requires consent and rechecks an opt-out before dispatch', async () => {
    const input = { ...draft, workspaceId, purpose: 'marketing', idempotencyKey: 'marketing' } as const;
    await expect(boot.service.messageSend(admin, input)).rejects.toMatchObject({ code: 'EMAIL_POLICY_BLOCKED' });
    await boot.service.emailPolicyUpdate(admin, { workspaceId, senderName: 'Test', marketingFromAddress: 'news@example.com', supportEmail: 'support@example.com' });
    await boot.service.contactResubscribe(admin, { workspaceId, email: draft.to, eventId: 'test-consent', source: 'support', consentReference: 'test' });
    const { id } = await boot.service.messageSend(admin, input);
    const [intent] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, id));
    expect(intent?.headers).toMatchObject({
      'List-Unsubscribe': expect.stringContaining('/unsubscribe/'),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(intent?.plainText).toContain('Unsubscribe from Test marketing emails');
    const [token] = await boot.db.select().from(unsubscribeTokens).where(eq(unsubscribeTokens.intentId, id));
    expect(token?.origin).toEqual({ kind: 'standalone', intentId: id, subject: draft.subject });

    await boot.service.contactUnsubscribe(admin, { workspaceId, email: draft.to, eventId: 'test-opt-out', source: 'support' });
    provider.sent.length = 0;
    await deliverStandaloneEmail(id);
    expect(provider.sent).toHaveLength(0);
    await expect(boot.service.messageSend(admin, input)).resolves.toEqual({ id, state: 'abandoned', duplicate: true });
  });
});
