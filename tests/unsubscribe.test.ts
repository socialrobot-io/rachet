import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import { createApp } from '../apps/server/src/app.js';
import type { RachetAuth } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';
import { contacts, emailPolicies, enrollments, marketingConsents, marketingOptOuts, outbox, sendIntents, subscriptionEvents, suppressions, workspaces } from '../apps/server/src/db/schema.js';
import { emailEligibility } from '../apps/server/src/domain/email-policy.js';
import { RachetService } from '../apps/server/src/domain/service.js';
import { configureActivities, executeAction, resetActivities } from '../apps/server/src/temporal/activities.js';
import { createOperations } from '../apps/server/src/operations.js';
import { validUnsubscribeToken } from '../apps/server/src/security/unsubscribe-token.js';
import type { WorkflowDefinition } from '../packages/contracts/src/index.js';
import { FakeEmailProvider } from './helpers/fake-email-provider.js';
import { adminContext, probeDbRuntime, roleContext, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('marketing unsubscribe (postgres + fake provider)', () => {
  const boot = runtime as DbRuntime;
  const provider = new FakeEmailProvider();
  const admin = adminContext('unsubscribe');
  const key = Buffer.alloc(32, 9).toString('base64');
  let config: Config;
  let workspaceId = '';
  let otherWorkspaceId = '';
  let contactId = '';
  let workflowVersionId = '';
  let templateVersionId = '';
  let enrollmentId = '';
  let app: ReturnType<typeof createApp>;
  const email = `unsubscribe-${crypto.randomUUID().slice(0, 8)}@example.com`;

  beforeAll(async () => {
    config = { ...boot.config, publicUrl: 'https://rachet.example.test', unsubscribeSigningKeys: [key] } as Config;
    const [workspace] = await boot.db.insert(workspaces).values({ name: 'Acme', slug: `unsub-${crypto.randomUUID().slice(0, 8)}`, sendingEnabled: true }).returning();
    const [other] = await boot.db.insert(workspaces).values({ name: 'Other', slug: `unsub-${crypto.randomUUID().slice(0, 8)}`, sendingEnabled: true }).returning();
    if (!workspace || !other) throw new Error('workspace fixture failed');
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;
    await boot.service.emailPolicyUpdate(admin, { workspaceId, senderName: 'Acme & Co', supportEmail: 'support@example.com', marketingFromAddress: 'news@example.com' });
    const template = await boot.service.templateCreate(admin, { workspaceId, name: 'Marketing', subject: 'Hello', sourceKind: 'html', html: '<html><body><p>News</p></body></html>', body: 'News' });
    const publishedTemplate = await boot.service.templatePublish(admin, { workspaceId, templateId: template.id, expectedRevision: template.revision });
    if (!publishedTemplate) throw new Error('template fixture failed');
    templateVersionId = publishedTemplate.id;
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Marketing test', trigger: { type: 'manual' }, purpose: 'marketing', topic: 'marketing', entryNodeId: 'send',
      nodes: [
        { id: 'send', type: 'action', action: 'email.send', input: { templateVersionId: { literal: templateVersionId } }, next: 'end', onError: 'fail' },
        { id: 'end', type: 'end', reason: 'done' },
      ],
    };
    const workflow = await boot.service.workflowCreate(admin, { workspaceId, name: 'Marketing test', intent: 'Integration test', definition });
    const version = await boot.service.workflowPublish(admin, { workspaceId, workflowId: workflow.id, expectedRevision: workflow.revision });
    if (!version) throw new Error('workflow fixture failed');
    workflowVersionId = version.id;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email, fields: {} });
    contactId = contact.id;
    await boot.service.contactResubscribe(admin, { workspaceId, email, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'signup:test-request' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId, variables: {}, idempotencyKey: `test:${crypto.randomUUID()}` });
    enrollmentId = enrollment.id;
    configureActivities(config, { db: boot.db, provider });
    app = createApp({ config, auth: {} as RachetAuth, db: boot.db, service: boot.service, operations: createOperations(boot.service) });
  });

  afterAll(async () => {
    resetActivities();
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (otherWorkspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
    await boot.close();
  });

  function node(stepId: string) {
    return { id: stepId, type: 'action' as const, action: 'email.send', input: { templateVersionId: { literal: templateVersionId } }, next: 'end', onError: 'fail' as const };
  }

  it('freezes a visible link and matching one-click headers, then handles browser and mailbox POST', async () => {
    const preview = await boot.service.templateRender(admin, { workspaceId, templateVersionId, props: {}, marketingPreview: true });
    expect(preview.html).toContain('https://example.invalid/unsubscribe-preview');
    expect(preview.plainText).toContain('https://example.invalid/unsubscribe-preview');
    await expect(executeAction({ workspaceId, enrollmentId, node: node('send'), eventData: {} })).resolves.toBe('succeeded');
    expect(provider.sent).toHaveLength(1);
    const message = provider.sent[0]?.message;
    expect(message?.from).toBe('news@example.com');
    const url = message?.headers?.['List-Unsubscribe']?.slice(1, -1);
    expect(url).toMatch(/^https:\/\/rachet\.example\.test\/unsubscribe\//);
    expect(message?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(message?.headers?.['List-ID']).toBe(`Marketing <${workspaceId}.marketing.rachet.example.test>`);
    expect(message?.html).toContain('Unsubscribe from Acme &amp; Co marketing emails');
    expect(message?.text).toContain(url);
    const token = url?.split('/').at(-1) ?? '';
    expect(validUnsubscribeToken(config, token)).toBe(true);
    const [visibleMessage] = await boot.service.messageList(admin, workspaceId);
    expect(visibleMessage?.html).not.toContain(token);
    expect(visibleMessage?.plainText).not.toContain(token);
    expect(visibleMessage?.headers).toEqual({});

    const path = `/unsubscribe/${token}`;
    const before = await boot.db.select().from(marketingOptOuts).where(eq(marketingOptOuts.workspaceId, workspaceId));
    const get = await app.request(path);
    expect(get.status).toBe(200);
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(get.headers.get('content-security-policy')).toContain("default-src 'none'");
    const page = await get.text();
    expect(page).toContain('Unsubscribe from Acme &amp; Co marketing emails');
    expect(page).toContain('<!--email_off--><a href="mailto:support@example.com">Contact support</a><!--/email_off-->');
    expect(page).not.toContain('<script');
    expect(await boot.db.select().from(marketingOptOuts).where(eq(marketingOptOuts.workspaceId, workspaceId))).toEqual(before);

    const post = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=unsubscribe' });
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("You're unsubscribed");
    expect((await boot.db.select().from(marketingOptOuts).where(eq(marketingOptOuts.workspaceId, workspaceId)))).toHaveLength(1);
    const [sentIntent] = await boot.db.select().from(sendIntents).where(eq(sendIntents.enrollmentId, enrollmentId));
    const [browserEvent] = (await boot.service.subscriptionEventList(admin, workspaceId)).filter((event) => event.action === 'unsubscribe' && event.source === 'recipient');
    expect(browserEvent?.origin).toEqual({
      intentId: sentIntent?.id,
      enrollmentId,
      workflowId: expect.any(String),
      workflowVersionId,
      workflowName: 'Marketing test',
      stepId: 'send',
      templateVersionId,
      subject: 'Hello',
    });
    const [stopped] = await boot.db.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, enrollmentId));
    expect(stopped?.state).toBe('suppressed');
    expect((await boot.db.select().from(outbox).where(eq(outbox.kind, 'enrollment.unsubscribe'))).some((job) => job.aggregateId === enrollmentId)).toBe(true);

    const second = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe('');
    expect((await boot.db.select().from(marketingOptOuts).where(eq(marketingOptOuts.workspaceId, workspaceId)))).toHaveLength(1);
    const unsubscribeEvents = (await boot.db.select().from(subscriptionEvents).where(eq(subscriptionEvents.workspaceId, workspaceId))).filter((event) => event.action === 'unsubscribe');
    expect(unsubscribeEvents).toHaveLength(2);
    expect(unsubscribeEvents.find((event) => event.source === 'mailbox')?.origin).toEqual(browserEvent?.origin);

    await boot.db.insert(suppressions).values({ workspaceId, emailKey: email.toLowerCase(), reason: 'email.bounced', source: 'resend' });
    const blockedAndUnsubscribed = await app.request(path);
    expect(await blockedAndUnsubscribed.text()).toContain("You're unsubscribed");
    await boot.db.delete(suppressions).where(eq(suppressions.workspaceId, workspaceId));

    await expect(boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId, variables: {}, idempotencyKey: `after:${crypto.randomUUID()}` })).rejects.toMatchObject({ code: 'EMAIL_POLICY_BLOCKED' });
    expect((await emailEligibility(boot.db, otherWorkspaceId, email.toLowerCase(), 'marketing')).reason).toBe('consent_required');
    expect((await emailEligibility(boot.db, workspaceId, email.toLowerCase(), 'transactional')).eligible).toBe(true);

    await boot.service.contactResubscribe(admin, { workspaceId, email, eventId: `renew:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:new-request' });
    const multipart = new FormData();
    multipart.set('List-Unsubscribe', 'One-Click');
    const again = await app.request(path, { method: 'POST', body: multipart });
    expect(again.status).toBe(200);
    expect((await emailEligibility(boot.db, workspaceId, email.toLowerCase(), 'marketing')).reason).toBe('unsubscribed');
  });

  it('blocks marketing sends that use the transactional From address', async () => {
    const transactionalMailbox = config.from.match(/<([^<>]+)>\s*$/)?.[1] ?? config.from;
    const freshEmail = `same-sender-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const freshContact = await boot.service.contactUpsert(admin, { workspaceId, email: freshEmail, fields: {} });
    await boot.service.contactResubscribe(admin, { workspaceId, email: freshEmail, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'confirmed-signup:test' });
    const freshEnrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId: freshContact.id, variables: {}, idempotencyKey: `same-sender:${crypto.randomUUID()}` });
    await boot.service.emailPolicyUpdate(admin, { workspaceId, senderName: 'Acme & Co', supportEmail: 'support@example.com', marketingFromAddress: transactionalMailbox });
    try {
      await expect(executeAction({ workspaceId, enrollmentId: freshEnrollment.id, node: node('same-sender'), eventData: {} }))
        .rejects.toThrow('Marketing and transactional sender addresses must differ');
      expect(provider.sent).toHaveLength(1);
    } finally {
      await boot.service.emailPolicyUpdate(admin, { workspaceId, senderName: 'Acme & Co', supportEmail: 'support@example.com', marketingFromAddress: 'news@example.com' });
    }
  });

  it('keeps the originating email and workflow after its enrollment is deleted', async () => {
    const address = `deleted-run-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: {} });
    await boot.service.contactResubscribe(admin, { workspaceId, email: address, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'confirmed-signup:deleted-run' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `deleted-run:${crypto.randomUUID()}` });
    await expect(executeAction({ workspaceId, enrollmentId: enrollment.id, node: node('send'), eventData: {} })).resolves.toBe('succeeded');
    const url = provider.sent.at(-1)?.message.headers?.['List-Unsubscribe']?.slice(1, -1);
    if (!url) throw new Error('Missing unsubscribe link');
    const response = await app.request(new URL(url).pathname, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=unsubscribe' });
    expect(response.status).toBe(200);
    await boot.service.enrollmentDelete(admin, { workspaceId, enrollmentId: enrollment.id });
    const events = await boot.service.subscriptionEventList(admin, workspaceId);
    const event = events.find((row) => row.source === 'recipient' && row.emailKey === address);
    expect(event?.origin).toMatchObject({ enrollmentId: enrollment.id, workflowVersionId, workflowName: 'Marketing test', subject: 'Hello' });
  });

  it('rejects forged links without changing another workspace', async () => {
    const forged = await app.request('/unsubscribe/123.bad.signature', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=unsubscribe' });
    expect(forged.status).toBe(404);
    expect((await boot.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, otherWorkspaceId)))).toHaveLength(0);
    expect((await boot.db.select().from(contacts).where(eq(contacts.workspaceId, otherWorkspaceId)))).toHaveLength(0);
  });

  it('keeps a repeated opt-out request idempotent after later consent', async () => {
    const address = `repeat-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const firstId = `stop:${crypto.randomUUID()}`;
    const repeatedId = `stop:${crypto.randomUUID()}`;
    await boot.service.contactUnsubscribe(admin, { workspaceId, email: address, eventId: firstId, source: 'support' });
    await expect(boot.service.contactUnsubscribe(admin, { workspaceId, email: address, eventId: repeatedId, source: 'support' }))
      .resolves.toEqual({ changed: false, eventId: repeatedId });
    await boot.service.contactResubscribe(admin, { workspaceId, email: address, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:new-request' });
    await expect(boot.service.contactUnsubscribe(admin, { workspaceId, email: address, eventId: repeatedId, source: 'support' }))
      .resolves.toEqual({ changed: false, eventId: repeatedId });
    expect((await emailEligibility(boot.db, workspaceId, address, 'marketing')).eligible).toBe(true);
    expect((await boot.db.select().from(subscriptionEvents).where(eq(subscriptionEvents.eventId, repeatedId)))).toHaveLength(1);
    expect((await boot.db.select().from(subscriptionEvents).where(eq(subscriptionEvents.eventId, repeatedId)))[0]?.origin).toBeNull();
  });

  it('does not let an in-flight resume overwrite an unsubscribe', async () => {
    const address = `control-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: {} });
    await boot.service.contactResubscribe(admin, { workspaceId, email: address, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:control-test' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `control:${crypto.randomUUID()}` });
    await boot.db.update(enrollments).set({ state: 'paused' }).where(eq(enrollments.id, enrollment.id));

    let enteredSignal: (() => void) | undefined;
    let releaseSignal: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredSignal = resolve; });
    const release = new Promise<void>((resolve) => { releaseSignal = resolve; });
    const temporal = { workflow: { getHandle: () => ({ signal: async () => { enteredSignal?.(); await release; } }) } } as unknown as Client;
    const controller = new RachetService(boot.db, temporal, {} as RachetAuth);
    const resuming = controller.enrollmentControl(admin, { workspaceId, enrollmentId: enrollment.id }, 'resume');
    await entered;
    await boot.service.contactUnsubscribe(admin, { workspaceId, email: address, eventId: `stop:${crypto.randomUUID()}`, source: 'support' });
    releaseSignal?.();
    await expect(resuming).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_RUNNING' });
    const [stopped] = await boot.db.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, enrollment.id));
    expect(stopped?.state).toBe('suppressed');
  });

  it.each(['resume', 'cancel'] as const)('accepts %s when the worker applies the signal first', async (action) => {
    const address = `control-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: {} });
    await boot.service.contactResubscribe(admin, { workspaceId, email: address, eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:control-test' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `control:${crypto.randomUUID()}` });
    if (action === 'resume') await boot.db.update(enrollments).set({ state: 'paused' }).where(eq(enrollments.id, enrollment.id));
    const targetState = action === 'resume' ? 'running' : 'cancelled';
    const temporal = { workflow: { getHandle: () => ({ signal: async () => {
      await boot.db.update(enrollments).set({ state: targetState }).where(eq(enrollments.id, enrollment.id));
    } }) } } as unknown as Client;
    const controller = new RachetService(boot.db, temporal, {} as RachetAuth);
    await expect(controller.enrollmentControl(admin, { workspaceId, enrollmentId: enrollment.id }, action)).resolves.toMatchObject({ status: 'requested' });
    const [current] = await boot.db.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, enrollment.id));
    expect(current?.state).toBe(targetState);
  });

  it('blocks a stale worker at dispatch after the opt-out commits', async () => {
    await boot.service.contactResubscribe(admin, { workspaceId, email, eventId: `renew:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:another-request' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId, variables: {}, idempotencyKey: `stale:${crypto.randomUUID()}` });
    await boot.service.contactUnsubscribe(admin, { workspaceId, email, eventId: `stop:${crypto.randomUUID()}`, source: 'support' });
    // Simulate a lagging worker that has not applied its unsubscribe signal.
    await boot.db.update(enrollments).set({ state: 'running' }).where(eq(enrollments.id, enrollment.id));
    const sentBefore = provider.sent.length;
    await expect(executeAction({ workspaceId, enrollmentId: enrollment.id, node: node('send'), eventData: {} })).resolves.toBe('unsubscribed');
    expect(provider.sent).toHaveLength(sentBefore);
  });

  it('keeps an admitted send truthful when opt-out commits during the provider call', async () => {
    await boot.service.contactResubscribe(admin, { workspaceId, email, eventId: `renew:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:later-request' });
    const enrollment = await boot.service.enrollmentCreate(admin, { workspaceId, workflowVersionId, contactId, variables: {}, idempotencyKey: `race:${crypto.randomUUID()}` });
    const controlled = new FakeEmailProvider();
    let enteredProvider: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredProvider = resolve; });
    const release = new Promise<void>((resolve) => { releaseProvider = resolve; });
    controlled.send = async () => {
      enteredProvider?.();
      await release;
      return { kind: 'accepted', messageId: 'accepted-after-opt-out' };
    };
    configureActivities(config, { db: boot.db, provider: controlled });
    try {
      const sending = executeAction({ workspaceId, enrollmentId: enrollment.id, node: node('send'), eventData: {} });
      await entered;
      await boot.service.contactUnsubscribe(admin, { workspaceId, email, eventId: `stop:${crypto.randomUUID()}`, source: 'support' });
      releaseProvider?.();
      await expect(sending).resolves.toBe('succeeded');
      const [intent] = await boot.db.select().from(sendIntents).where(eq(sendIntents.enrollmentId, enrollment.id));
      expect(intent?.state).toBe('accepted');
      expect((await emailEligibility(boot.db, workspaceId, email.toLowerCase(), 'marketing')).reason).toBe('unsubscribed');
    } finally {
      releaseProvider?.();
      configureActivities(config, { db: boot.db, provider });
    }
  });

  it('records marketing consent and enrolls in one call', async () => {
    const address = `joined-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: {} });
    const consent = { eventId: `consent:${crypto.randomUUID()}`, source: 'product' as const, consentReference: `terms:${contact.id}` };
    await expect(boot.service.enrollmentCreate(admin, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`,
    })).rejects.toMatchObject({ code: 'EMAIL_POLICY_BLOCKED' });

    const sender = roleContext(workspaceId, 'sender');
    await expect(boot.service.enrollmentCreate(sender, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`, consent,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const sendOnly = roleContext(workspaceId, 'owner');
    sendOnly.principal.scopes = ['rachet:read', 'rachet:send'];
    await expect(boot.service.enrollmentCreate(sendOnly, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`, consent,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Missing required scope: rachet:write' });

    const owner = roleContext(workspaceId, 'owner');
    const created = await boot.service.enrollmentCreate(owner, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`, consent,
    });
    const replay = await boot.service.enrollmentCreate(owner, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`, consent,
    });
    expect(replay.id).toBe(created.id);
    expect(await emailEligibility(boot.db, workspaceId, address, 'marketing')).toMatchObject({ eligible: true });
    expect(await boot.db.select().from(subscriptionEvents).where(eq(subscriptionEvents.eventId, consent.eventId))).toHaveLength(1);

    await boot.service.contactUnsubscribe(admin, { workspaceId, email: address, eventId: `stop:${crypto.randomUUID()}`, source: 'product' });
    const unchanged = await boot.service.enrollmentCreate(owner, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`, consent,
    });
    expect(unchanged.id).toBe(created.id);
    expect((await emailEligibility(boot.db, workspaceId, address, 'marketing')).reason).toBe('unsubscribed');
    await expect(boot.service.enrollmentCreate(owner, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined:${contact.id}`,
      consent: { ...consent, eventId: `consent:${crypto.randomUUID()}` },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await emailEligibility(boot.db, workspaceId, address, 'marketing')).reason).toBe('unsubscribed');

    const renewed = { eventId: `consent:${crypto.randomUUID()}`, source: 'product' as const, consentReference: `terms:renew:${contact.id}` };
    const next = await boot.service.enrollmentCreate(owner, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `joined-again:${contact.id}`, consent: renewed,
    });
    expect(next.id).not.toBe(created.id);
    expect(await emailEligibility(boot.db, workspaceId, address, 'marketing')).toMatchObject({ eligible: true });
  });

  it('does not keep consent when enrollment stays blocked', async () => {
    const address = `blocked-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const contact = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: {} });
    await boot.db.insert(suppressions).values({ workspaceId, emailKey: address, reason: 'email.complained', source: 'resend' });
    await expect(boot.service.enrollmentCreate(admin, {
      workspaceId, workflowVersionId, contactId: contact.id, variables: {}, idempotencyKey: `blocked:${contact.id}`,
      consent: { eventId: `consent:${crypto.randomUUID()}`, source: 'product', consentReference: `terms:${contact.id}` },
    })).rejects.toMatchObject({ code: 'EMAIL_POLICY_BLOCKED' });
    expect(await boot.db.select().from(marketingConsents).where(and(eq(marketingConsents.workspaceId, workspaceId), eq(marketingConsents.emailKey, address)))).toHaveLength(0);
    expect(await boot.db.select().from(enrollments).where(eq(enrollments.contactId, contact.id))).toHaveLength(0);
  });

  it('does not clear a delivery block when recording new consent', async () => {
    await boot.db.insert(suppressions).values({ workspaceId, emailKey: email.toLowerCase(), reason: 'email.complained', source: 'resend' });
    await boot.service.contactResubscribe(admin, { workspaceId, email, eventId: `renew:${crypto.randomUUID()}`, source: 'product', consentReference: 'form:latest-request' });
    expect((await emailEligibility(boot.db, workspaceId, email.toLowerCase(), 'marketing')).reason).toBe('delivery_block');
    expect((await emailEligibility(boot.db, workspaceId, email.toLowerCase(), 'transactional')).reason).toBe('delivery_block');
  });
});
