import { generateKeyPairSync, sign } from 'node:crypto';
import { SESv2Client, SESv2ServiceException, SendEmailCommand, TooManyRequestsException } from '@aws-sdk/client-sesv2';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import type { RachetAuth } from '../apps/server/src/auth.js';
import { auditEvents, contacts, deliveryBlocks, enrollments, resendConnections, sendIntents, sequences, sequenceVersions, sesConnections, webhookEvents, workspaces } from '../apps/server/src/db/schema.js';
import { rotateIntegrationKey } from '../apps/server/src/integrations/rotate.js';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../apps/server/src/integrations/secret.js';
import { ResendProvider } from '../apps/server/src/providers/resend.js';
import { SesProvider } from '../apps/server/src/providers/ses.js';
import { dispatchEmail } from '../apps/server/src/domain/delivery.js';
import { probeDbRuntime, roleContext, type DbRuntime } from './helpers/db-runtime.js';
import { FakeEmailProvider } from './helpers/fake-email-provider.js';

const region = 'eu-west-1';
const configurationSet = 'test';
const topicArn = `arn:aws:sns:${region}:123456789012:rachet-test`;
const credentials = { accessKeyId: 'AKIAEXAMPLEACCESSKEY', secretAccessKey: 'Z'.repeat(40) };
const from = 'sender@example.test';
const timestamp = '2026-11-11T11:30:00.000Z';
const certificateUrl = `https://sns.${region}.amazonaws.com/SimpleNotificationService-deadbeef.pem`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Amazon SES adapter', () => {
  it('submits both bodies, UTF-8 headers, configuration set and correlation tags', async () => {
    const send = vi.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({ MessageId: 'ses-id' } as never);
    const provider = new SesProvider(region, configurationSet, credentials);
    await expect(provider.send({
      from: 'Équipe <sender@example.test>', to: 'recipient@example.test', subject: 'Bienvenue ☀', text: 'Hi', html: '<p>Hi</p>',
      headers: { 'List-Unsubscribe': '<https://example.test/unsubscribe/token>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: [{ name: 'rachet_intent', value: 'intent-id' }],
    })).resolves.toEqual({ kind: 'accepted', messageId: 'ses-id' });
    const command = send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input).toMatchObject({
      FromEmailAddress: '=?UTF-8?B?w4lxdWlwZQ==?= <sender@example.test>',
      Destination: { ToAddresses: ['recipient@example.test'] },
      ConfigurationSetName: configurationSet,
      EmailTags: [{ Name: 'rachet_intent', Value: 'intent-id' }],
      Content: { Simple: {
        Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' }, Text: { Data: 'Hi', Charset: 'UTF-8' } },
        Headers: [
          { Name: 'List-Unsubscribe', Value: '<https://example.test/unsubscribe/token>' },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
        ],
      } },
    });
    expect(command.input.Content?.Simple?.Subject?.Data).toMatch(/^=\?UTF-8\?B\?/);
    const client = send.mock.contexts[0] as SESv2Client;
    expect(await client.config.maxAttempts()).toBe(1);
  });

  it.each([
    [new TooManyRequestsException({ message: 'rate limited', $metadata: { httpStatusCode: 429 } }), { kind: 'rejected', retryable: true }],
    [new SESv2ServiceException({ name: 'BadRequestException', $fault: 'client', $metadata: { httpStatusCode: 400 } }), { kind: 'rejected', retryable: false }],
    [new SESv2ServiceException({ name: 'ServiceUnavailable', $fault: 'server', $metadata: { httpStatusCode: 503 } }), { kind: 'unknown' }],
    [new Error('timeout'), { kind: 'unknown' }],
  ])('classifies an SES failure before dispatch retries', async (error, expected) => {
    vi.spyOn(SESv2Client.prototype, 'send').mockRejectedValue(error);
    const provider = new SesProvider(region, configurationSet, credentials);
    await expect(provider.send({ from, to: 'recipient@example.test', subject: 'Test', text: 'Hi', html: '<p>Hi</p>' })).resolves.toMatchObject(expected);
  });
});

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('Amazon SES connection and feedback (PostgreSQL)', () => {
  const boot = runtime as DbRuntime;
  const key = Buffer.alloc(32, 14).toString('base64');
  const config = { ...boot?.config, integrationEncryptionKey: key } as DbRuntime['config'];
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certificate = publicKey.export({ type: 'spki', format: 'pem' });
  let workspaceId: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const slug = `ses-${crypto.randomUUID()}`;
    const [workspace] = await boot.db.insert(workspaces).values({ name: slug, slug }).returning();
    if (!workspace) throw new Error('Could not create the test workspace');
    workspaceId = workspace.id;
    const auth = { api: { getSession: async () => ({ user: { id: 'ses-test-admin', email: 'admin@example.test' } }) } } as unknown as RachetAuth;
    vi.spyOn(boot.service, 'principalFor').mockResolvedValue(roleContext(workspaceId, 'admin').principal);
    app = createApp({ config, auth, db: boot.db, service: boot.service, operations: {} });
  });

  afterAll(async () => {
    if (workspaceId) {
      await boot.db.delete(sendIntents).where(eq(sendIntents.workspaceId, workspaceId));
      await boot.db.delete(enrollments).where(eq(enrollments.workspaceId, workspaceId));
      await boot.db.delete(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));
      await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    await boot.close();
  });

  function envelope(type: 'Notification' | 'SubscriptionConfirmation', message: string) {
    const fields = {
      Message: message, MessageId: crypto.randomUUID(), Timestamp: timestamp, TopicArn: topicArn, Type: type,
      ...(type === 'SubscriptionConfirmation' ? { SubscribeURL: 'https://example.invalid/untrusted', Token: 'test-token' } : {}),
    };
    const canonical = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}\n${value}\n`).join('');
    return { ...fields, SigningCertURL: certificateUrl, SignatureVersion: '2', Signature: sign('RSA-SHA256', Buffer.from(canonical), privateKey).toString('base64') };
  }

  function post(path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: { origin: config.trustedOrigins[0] ?? '', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  it('activates only after signed confirmation, reconciles an ambiguous send, and blocks a permanent bounce once', async () => {
    const provider = new FakeEmailProvider();
    const fetchAws = vi.fn(async (url: URL) => {
      if (url.href === certificateUrl) return new Response(certificate);
      expect(url.origin).toBe(`https://sns.${region}.amazonaws.com`);
      expect(url.searchParams.get('Action')).toBe('ConfirmSubscription');
      expect(url.searchParams.get('Token')).toBe('test-token');
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchAws);
    const callback = `/webhooks/ses/${workspaceId}`;
    expect((await post('/api/integrations/ses', { workspaceId, from, region, configurationSet, topicArn, ...credentials })).status).toBe(200);
    expect((await post('/api/integrations/ses/test', { workspaceId })).status).toBe(422);
    const confirmation = envelope('SubscriptionConfirmation', 'Confirm');
    expect((await post(callback, { ...confirmation, SigningCertURL: 'https://example.invalid/cert.pem' })).status).toBe(400);
    expect(fetchAws).not.toHaveBeenCalled();
    expect((await post(callback, { ...confirmation, Message: 'Tampered' })).status).toBe(400);
    expect((await post(callback, confirmation)).status).toBe(200);
    const send = vi.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({ MessageId: 'ses-test' } as never);
    expect((await post('/api/integrations/ses/test', { workspaceId, simulator: true })).status).toBe(200);
    expect((send.mock.calls[0]?.[0] as SendEmailCommand).input.Destination?.ToAddresses).toEqual(['success@simulator.amazonses.com']);
    const status = await app.request(`/api/integrations/ses?workspaceId=${workspaceId}`);
    const body = await status.text();
    expect(JSON.parse(body)).toMatchObject({ active: true, connection: { topicConfirmedAt: expect.any(String) } });
    expect(body).not.toContain(credentials.accessKeyId);
    expect(body).not.toContain(credentials.secretAccessKey);

    const recipient = 'recipient@example.test';
    const [contact] = await boot.db.insert(contacts).values({ workspaceId, email: recipient, emailKey: recipient }).returning();
    const [sequence] = await boot.db.insert(sequences).values({ workspaceId, name: 'Test workflow', definition: {} }).returning();
    if (!contact || !sequence) throw new Error('Could not create the workflow fixtures');
    const [version] = await boot.db.insert(sequenceVersions).values({
      workspaceId, sequenceId: sequence.id, version: 1, contentHash: 'test', definition: {},
    }).returning();
    if (!version) throw new Error('Could not create the workflow version');
    const [enrollment] = await boot.db.insert(enrollments).values({
      workspaceId, contactId: contact.id, sequenceVersionId: version.id, state: 'running',
      workflowId: `test/${crypto.randomUUID()}`, idempotencyKey: crypto.randomUUID(),
    }).returning();
    if (!enrollment) throw new Error('Could not create the enrollment');

    const enrollmentId = enrollment.id;
    async function prepare(stepId: string, to: string) {
      const [intent] = await boot.db.insert(sendIntents).values({
        workspaceId, enrollmentId, stepId, idempotencyKey: crypto.randomUUID(),
        provider: 'ses', feedbackTopic: topicArn, connectionVersion: 1, fromAddress: from,
        recipient: to, payloadHash: 'test', subject: 'Account', html: '<p>Your account is ready.</p>',
        plainText: 'Your account is ready.',
      }).returning();
      if (!intent) throw new Error('Could not prepare a test send');
      return intent;
    }
    const dispatch = (intent: Awaited<ReturnType<typeof prepare>>, name: 'resend' | 'ses' = 'ses') =>
      dispatchEmail(boot.db, provider, intent, { fromAddress: from, connectionVersion: 1, provider: name }, 'transactional');

    const intent = await prepare('send', recipient);
    const { id } = intent;
    provider.nextOutcome = { kind: 'unknown', code: 'timeout' };
    await Promise.all([dispatch(intent), dispatch(intent)]);
    await expect(dispatch(intent)).resolves.toMatchObject({ status: 'needs_attention' });
    expect(provider.sent).toHaveLength(1);
    const [unknown] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, id));
    expect(unknown).toMatchObject({ state: 'unknown', provider: 'ses', feedbackTopic: topicArn });

    const bounce = (bounceType: string) => envelope('Notification', JSON.stringify({
      eventType: 'Bounce', mail: {
        source: from, timestamp, messageId: 'ses-workflow-send-id', destination: [recipient],
        tags: { rachet_workspace: [workspaceId], rachet_intent: [id] },
      },
      bounce: { timestamp, bounceType, bouncedRecipients: [{ emailAddress: recipient }] },
    }));
    expect((await post(callback, bounce('Transient'))).status).toBe(200);
    expect(await boot.db.select().from(deliveryBlocks).where(eq(deliveryBlocks.workspaceId, workspaceId))).toHaveLength(0);
    const permanent = bounce('Permanent');
    expect((await post(callback, permanent)).status).toBe(200);
    expect((await post(callback, permanent)).status).toBe(200);
    const [accepted] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, id));
    expect(accepted).toMatchObject({ state: 'accepted', providerMessageId: 'ses-workflow-send-id' });
    expect(await boot.db.select().from(webhookEvents).where(and(eq(webhookEvents.workspaceId, workspaceId), eq(webhookEvents.provider, 'ses')))).toHaveLength(2);
    expect(await boot.db.select().from(deliveryBlocks).where(eq(deliveryBlocks.workspaceId, workspaceId))).toHaveLength(1);
    const blocked = await prepare('after-bounce', recipient);
    await expect(dispatch(blocked)).resolves.toMatchObject({ status: 'suppressed' });
    expect(provider.sent).toHaveLength(1);

    const retry = await prepare('retry-throttle', 'another@example.test');
    provider.nextOutcome = { kind: 'rejected', code: 'TooManyRequestsException', retryable: true };
    await expect(dispatch(retry)).resolves.toMatchObject({ status: 'retryable' });
    provider.nextOutcome = { kind: 'accepted', messageId: 'ses-after-throttle' };
    await expect(dispatch(retry)).resolves.toMatchObject({ status: 'succeeded' });
    expect(provider.sent).toHaveLength(3);
    expect(provider.sent[1]).toEqual(provider.sent[2]);

    const queued = await prepare('before-switch', 'another@example.test');
    await boot.db.insert(resendConnections).values({
      workspaceId, fromAddress: from, version: 1,
      apiKeyEncrypted: encryptIntegrationSecret(config, workspaceId, 'resend-api-key', 're_test_amazon_ses'),
      webhookSecretEncrypted: 'unused',
      apiKeyFingerprint: workspaceId, webhookSecretFingerprint: workspaceId,
    });
    vi.spyOn(ResendProvider.prototype, 'send').mockResolvedValue({ kind: 'accepted', messageId: 'resend-test' });
    expect((await post('/api/integrations/resend/test', { workspaceId })).status).toBe(200);
    await expect(dispatch(queued, 'resend')).resolves.toMatchObject({ status: 'needs_attention' });
    expect(provider.sent).toHaveLength(3);
    const [parked] = await boot.db.select().from(sendIntents).where(eq(sendIntents.id, queued.id));
    expect(parked).toMatchObject({ state: 'unknown', errorCode: 'connection_changed' });
    await boot.db.delete(resendConnections).where(eq(resendConnections.workspaceId, workspaceId));

    const newKey = Buffer.alloc(32, 15).toString('base64');
    expect(await rotateIntegrationKey(boot.pool, key, newKey, true, [workspaceId])).toBe(1);
    const [rotated] = await boot.db.select().from(sesConnections).where(eq(sesConnections.workspaceId, workspaceId));
    if (!rotated) throw new Error('SES connection missing');
    expect(JSON.parse(decryptIntegrationSecret({ ...config, integrationEncryptionKey: newKey }, workspaceId, 'ses-credentials', rotated.credentialsEncrypted))).toEqual(credentials);
  });
});
