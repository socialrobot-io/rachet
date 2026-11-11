import { verify } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { deliveryBlocks, sendIntents, webhookEvents } from '../db/schema.js';
import { emailKey, lockEmailAddress, mailboxAddress } from '../domain/email-policy.js';

export const snsTopicPattern = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d):\d{12}:[A-Za-z0-9_-]{1,256}$/;

const snsFields = z.object({
  Message: z.string(),
  MessageId: z.uuid(),
  Timestamp: z.iso.datetime(),
  TopicArn: z.string().regex(snsTopicPattern),
  SignatureVersion: z.literal('2'),
  Signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(1024),
  SigningCertURL: z.url().max(512),
});

export const snsEnvelope = z.discriminatedUnion('Type', [
  snsFields.extend({ Type: z.literal('Notification'), Subject: z.string().optional() }),
  snsFields.extend({
    Type: z.literal('SubscriptionConfirmation'),
    SubscribeURL: z.url(),
    Token: z.string().min(1).max(4096),
  }),
]);

type SnsEnvelope = z.infer<typeof snsEnvelope>;

function snsOrigin(topicArn: string) {
  const region = snsTopicPattern.exec(topicArn)?.[1];
  if (!region) throw new Error('Invalid SNS topic');
  return `https://sns.${region}.amazonaws.com`;
}

export async function verifySns(message: SnsEnvelope): Promise<boolean> {
  const certificate = new URL(message.SigningCertURL);
  if (certificate.origin !== snsOrigin(message.TopicArn) || certificate.username || certificate.password ||
      certificate.search || certificate.hash || !/^\/SimpleNotificationService-[a-fA-F0-9]+\.pem$/.test(certificate.pathname)) {
    return false;
  }
  const fields = message.Type === 'Notification'
    ? { Message: message.Message, MessageId: message.MessageId, Subject: message.Subject }
    : { Message: message.Message, MessageId: message.MessageId, SubscribeURL: message.SubscribeURL };
  const signedFields = {
    ...fields, Timestamp: message.Timestamp,
    ...(message.Type === 'SubscriptionConfirmation' ? { Token: message.Token } : {}),
    TopicArn: message.TopicArn, Type: message.Type,
  };
  const canonical = Object.entries(signedFields).filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}\n${value}\n`).join('');
  const response = await fetch(certificate, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Could not fetch SNS certificate');
  return verify('RSA-SHA256', Buffer.from(canonical), await response.text(), Buffer.from(message.Signature, 'base64'));
}

export async function confirmSns(message: Extract<SnsEnvelope, { Type: 'SubscriptionConfirmation' }>) {
  // Use the signed token and topic on the AWS endpoint. Never follow the callback URL.
  const url = new URL(snsOrigin(message.TopicArn));
  url.search = new URLSearchParams({ Action: 'ConfirmSubscription', TopicArn: message.TopicArn, Token: message.Token, Version: '2010-03-31' }).toString();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Could not confirm SNS subscription');
  await response.body?.cancel();
}

const addresses = z.array(z.object({ emailAddress: z.string() }));
const eventTime = z.object({ timestamp: z.iso.datetime() }).optional();
const sesEvent = z.object({
  eventType: z.enum(['Send', 'Delivery', 'Bounce', 'Complaint', 'Reject', 'DeliveryDelay', 'Open', 'Click']),
  mail: z.object({
    timestamp: z.iso.datetime(),
    messageId: z.string().min(1).max(255),
    source: z.string(),
    commonHeaders: z.object({ from: z.tuple([z.string()]).optional() }).optional(),
    destination: z.tuple([z.string()]),
    tags: z.object({ rachet_workspace: z.tuple([z.uuid()]), rachet_intent: z.tuple([z.uuid()]) }),
  }),
  bounce: z.object({ timestamp: z.iso.datetime(), bounceType: z.string(), bouncedRecipients: addresses }).optional(),
  complaint: z.object({ timestamp: z.iso.datetime(), complainedRecipients: addresses }).optional(),
  delivery: eventTime,
  deliveryDelay: eventTime,
  open: eventTime,
  click: eventTime,
});

export function readSesEvent(raw: string) {
  try { return sesEvent.parse(JSON.parse(raw)); }
  catch { return undefined; }
}

export async function recordSesEvent(
  db: Database,
  workspaceId: string,
  message: Extract<SnsEnvelope, { Type: 'Notification' }>,
  event: z.infer<typeof sesEvent>,
) {
  if (event.mail.tags.rachet_workspace[0] !== workspaceId) return;
  const intentId = event.mail.tags.rachet_intent[0];
  const address = emailKey(event.mail.destination[0]);
  await db.transaction(async (tx) => {
    await lockEmailAddress(tx as unknown as Database, workspaceId, address);
    const [intent] = await tx.select().from(sendIntents).where(and(
      eq(sendIntents.id, intentId), eq(sendIntents.workspaceId, workspaceId), eq(sendIntents.provider, 'ses'),
      eq(sendIntents.feedbackTopic, message.TopicArn),
    )).for('update').limit(1);
    if (!intent?.firstAttemptAt || emailKey(intent.recipient) !== address ||
        mailboxAddress(event.mail.commonHeaders?.from?.[0] ?? event.mail.source) !== mailboxAddress(intent.fromAddress ?? '') ||
        (intent.providerMessageId && intent.providerMessageId !== event.mail.messageId)) return;

    const eventType = {
      Send: 'email.sent', Delivery: 'email.delivered', Bounce: 'email.bounced',
      Complaint: 'email.complained', Reject: 'email.failed', DeliveryDelay: 'email.delivery_delayed',
      Open: 'email.opened', Click: 'email.clicked',
    }[event.eventType];
    const details = {
      Bounce: event.bounce, Complaint: event.complaint, Delivery: event.delivery, DeliveryDelay: event.deliveryDelay,
      Open: event.open, Click: event.click, Send: undefined, Reject: undefined,
    }[event.eventType];
    const occurredAt = new Date(details?.timestamp ?? message.Timestamp);
    const [created] = await tx.insert(webhookEvents).values({
      workspaceId, provider: 'ses', eventId: message.MessageId, eventType, providerMessageId: event.mail.messageId,
      occurredAt, processedAt: new Date(),
      // SES events can contain the original unsubscribe URL in their headers.
      payload: { intentId, bounceType: event.bounce?.bounceType },
    }).onConflictDoNothing().returning({ id: webhookEvents.id });
    if (!created) return;

    if (!intent.providerMessageId || intent.state !== 'accepted') {
      await tx.update(sendIntents).set({
        state: 'accepted', providerMessageId: event.mail.messageId, errorCode: null,
        acceptedAt: intent.acceptedAt ?? new Date(event.mail.timestamp), updatedAt: new Date(),
      }).where(eq(sendIntents.id, intent.id));
    }

    const hardBounce = event.eventType === 'Bounce' && event.bounce?.bounceType === 'Permanent' &&
      event.bounce.bouncedRecipients.some(({ emailAddress }) => emailKey(emailAddress) === address);
    const complaint = event.eventType === 'Complaint' && event.complaint?.complainedRecipients.some(
      ({ emailAddress }) => emailKey(emailAddress) === address,
    );
    if (hardBounce || complaint) {
      await tx.insert(deliveryBlocks).values({
        workspaceId, emailKey: address, eventId: `ses:${message.MessageId}`, reason: eventType, source: 'ses',
      }).onConflictDoNothing();
    }
  });
}
