import { createHash } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Config } from '../config.js';
import { resolveActionInput, resolveValue } from '../domain/action-catalog.js';
import type { FlowCondition, FlowNode } from '@rachet/contracts';
import { appendMarketingFooter, renderEmail } from '../domain/render.js';
import { createDatabase, type Database } from '../db/index.js';
import { contacts, emailPolicies, enrollments, resendConnections, sendIntents, sequenceVersions, sequences, templateVersions, unsubscribeTokens, workspaces } from '../db/schema.js';
import type { EmailProvider } from '../providers/email-provider.js';
import { ResendProvider } from '../providers/resend.js';
import { decryptIntegrationSecret } from '../integrations/secret.js';
import { emailEligibility, formatMailbox, lockEmailAddress, mailboxAddress } from '../domain/email-policy.js';
import { createUnsubscribeToken } from '../security/unsubscribe-token.js';

let runtime: { config: Config; db: Database; provider?: EmailProvider | undefined } | undefined;

export function configureActivities(config: Config, overrides?: { db?: Database; provider?: EmailProvider }) {
  const db = overrides?.db ?? createDatabase(config).db;
  const provider = overrides?.provider;
  runtime = { config, db, provider };
}

export function resetActivities() {
  runtime = undefined;
}

function getRuntime() {
  if (!runtime) throw new Error('Activities are not configured');
  return runtime;
}

async function executionContext(workspaceId: string, enrollmentId: string, eventData: Record<string, unknown>) {
  const { db } = getRuntime();
  const [row] = await db.select({ contact: contacts, enrollment: enrollments }).from(enrollments)
    .innerJoin(contacts, and(eq(enrollments.contactId, contacts.id), eq(enrollments.workspaceId, contacts.workspaceId)))
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.workspaceId, workspaceId))).limit(1);
  if (!row) throw ApplicationFailure.nonRetryable('Enrollment data not found', 'ValidationError');
  return { row, values: { contact: { id: row.contact.id, email: row.contact.email, timezone: row.contact.timezone, ...row.contact.fields }, variables: row.enrollment.input, event: eventData } };
}

export async function recordEnrollmentState(enrollmentId: string, state: typeof enrollments.$inferInsert.state, currentStepId: string) {
  await getRuntime().db.update(enrollments).set({ state, currentStepId, updatedAt: new Date() }).where(and(eq(enrollments.id, enrollmentId), notInArray(enrollments.state, ['suppressed', 'cancelled'])));
}

export async function executeAction(input: { workspaceId: string; enrollmentId: string; node: Extract<FlowNode, { type: 'action' }>; eventData: Record<string, unknown> }): Promise<'succeeded' | 'failed' | 'needs_attention' | 'unsubscribed' | 'suppressed' | 'paused'> {
  const context = await executionContext(input.workspaceId, input.enrollmentId, input.eventData);
  if (context.row.enrollment.state === 'suppressed') return 'unsubscribed';
  const resolved = resolveActionInput(input.node.input, context.values);
  if (input.node.action === 'email.send') return sendEmail(input, resolved, context.row);
  if (input.node.action === 'contact.update') {
    const fields = resolved.fields;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) throw ApplicationFailure.nonRetryable('contact.update fields must resolve to an object', 'ValidationError');
    await getRuntime().db.update(contacts).set({ fields: { ...context.row.contact.fields, ...(fields as Record<string, unknown>) }, updatedAt: new Date() })
      .where(and(eq(contacts.id, context.row.contact.id), eq(contacts.workspaceId, input.workspaceId)));
    return 'succeeded';
  }
  throw ApplicationFailure.nonRetryable(`Unknown action: ${input.node.action}`, 'ValidationError');
}

async function sendEmail(input: { workspaceId: string; enrollmentId: string; node: Extract<FlowNode, { type: 'action' }> }, resolved: Record<string, unknown>, row: { contact: typeof contacts.$inferSelect; enrollment: typeof enrollments.$inferSelect }): Promise<'succeeded' | 'needs_attention' | 'unsubscribed' | 'suppressed' | 'paused'> {
  const { config, db, provider: overrideProvider } = getRuntime();
  const idempotencyKey = `enrollment/${input.enrollmentId}/${input.node.id}`;
  let [intent] = await db.select().from(sendIntents).where(eq(sendIntents.idempotencyKey, idempotencyKey)).limit(1);
  if (intent?.state === 'accepted') return 'succeeded';
  if (intent?.state === 'abandoned') return 'suppressed';
  const [connection] = overrideProvider ? [] : await db.select().from(resendConnections)
    .where(eq(resendConnections.workspaceId, input.workspaceId)).limit(1);
  let provider = overrideProvider;
  if (!provider) {
    if (!connection) throw ApplicationFailure.nonRetryable('Connect Resend before sending', 'ValidationError');
    provider = new ResendProvider(
      decryptIntegrationSecret(config, input.workspaceId, 'resend-api-key', connection.apiKeyEncrypted), undefined,
    );
  }
  const transactionalFromAddress = connection?.fromAddress ?? config.from;
  const connectionVersion = connection?.version ?? null;
  const [version] = await db.select({ definition: sequenceVersions.definition, purposeReviewedAt: sequenceVersions.purposeReviewedAt, workflowId: sequences.id, workflowName: sequences.name }).from(sequenceVersions)
    .innerJoin(sequences, and(eq(sequences.id, sequenceVersions.sequenceId), eq(sequences.workspaceId, sequenceVersions.workspaceId)))
    .where(and(eq(sequenceVersions.id, row.enrollment.sequenceVersionId), eq(sequenceVersions.workspaceId, input.workspaceId))).limit(1);
  if (!version?.purposeReviewedAt) throw ApplicationFailure.nonRetryable('Workflow email purpose must be reviewed and republished', 'ValidationError');
  const purpose = version.definition.purpose;
  if (purpose !== 'marketing' && purpose !== 'transactional') throw ApplicationFailure.nonRetryable('Workflow email purpose is invalid', 'ValidationError');
  const [policy] = purpose === 'marketing'
    ? await db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, input.workspaceId)).limit(1)
    : [];
  if (purpose === 'marketing' && !policy?.marketingFromAddress) throw ApplicationFailure.nonRetryable('Marketing sender and unsubscribe settings are not configured', 'ValidationError');
  const fromAddress = purpose === 'marketing' && policy?.marketingFromAddress ? formatMailbox(policy.senderName, policy.marketingFromAddress) : transactionalFromAddress;
  if (purpose === 'marketing' && mailboxAddress(fromAddress) === mailboxAddress(transactionalFromAddress)) {
    throw ApplicationFailure.nonRetryable('Marketing and transactional sender addresses must differ', 'ValidationError');
  }
  if (!intent) {
    if (typeof resolved.templateVersionId !== 'string') throw ApplicationFailure.nonRetryable('templateVersionId must resolve to a UUID', 'ValidationError');
    const [template] = await db.select().from(templateVersions).where(and(eq(templateVersions.id, resolved.templateVersionId), eq(templateVersions.workspaceId, input.workspaceId))).limit(1);
    if (!template) throw ApplicationFailure.nonRetryable('Template version not found', 'ValidationError');
    const extraProps = typeof resolved.props === 'object' && resolved.props !== null && !Array.isArray(resolved.props) ? resolved.props as Record<string, unknown> : {};
    let rendered = await renderEmail(template, { contact: { email: row.contact.email, ...row.contact.fields }, variables: row.enrollment.input, ...extraProps });
    let headers: Record<string, string> = {};
    let token: ReturnType<typeof createUnsubscribeToken> | undefined;
    if (purpose === 'marketing') {
      if (!policy) throw ApplicationFailure.nonRetryable('Email policy is not configured', 'ValidationError');
      token = createUnsubscribeToken(config);
      const url = `${config.publicUrl}/unsubscribe/${token.token}`;
      rendered = appendMarketingFooter(rendered, policy.senderName, url);
      headers = {
        'List-ID': `Marketing <${input.workspaceId}.marketing.${new URL(config.publicUrl).hostname}>`,
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }
    const intentId = crypto.randomUUID();
    const payloadHash = createHash('sha256').update(JSON.stringify({ fromAddress, recipient: row.contact.email, rendered, headers, connectionVersion, tags: [input.workspaceId, intentId] })).digest('hex');
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(sendIntents).values({ id: intentId, workspaceId: input.workspaceId, enrollmentId: input.enrollmentId, stepId: input.node.id, idempotencyKey, payloadHash, connectionVersion, fromAddress, recipient: row.contact.email, subject: rendered.subject, html: rendered.html, plainText: rendered.plainText, headers }).onConflictDoNothing().returning({ id: sendIntents.id });
      if (created && token) await tx.insert(unsubscribeTokens).values({
        id: token.id, workspaceId: input.workspaceId, intentId, emailKey: row.contact.emailKey, tokenDigest: token.digest,
        origin: {
          intentId, enrollmentId: input.enrollmentId, workflowId: version.workflowId,
          workflowVersionId: row.enrollment.sequenceVersionId, workflowName: version.workflowName,
          stepId: input.node.id, templateVersionId: resolved.templateVersionId as string, subject: rendered.subject,
        },
      });
    });
    [intent] = await db.select().from(sendIntents).where(eq(sendIntents.idempotencyKey, idempotencyKey)).limit(1);
  }
  if (!intent) throw new Error('Send intent disappeared');
  if (intent.state === 'accepted') return 'succeeded';
  if (intent.connectionVersion !== connectionVersion || mailboxAddress(intent.fromAddress ?? '') !== mailboxAddress(fromAddress)) {
    await db.update(sendIntents).set({ state: 'unknown', errorCode: 'connection_changed', updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
    return 'needs_attention';
  }
  if (intent.fromAddress !== fromAddress) {
    await db.update(sendIntents).set({ fromAddress, updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
    intent = { ...intent, fromAddress };
  }
  if (intent.firstAttemptAt && Date.now() - intent.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000) {
    await db.update(sendIntents).set({ state: 'unknown', errorCode: 'idempotency_window_expired' }).where(eq(sendIntents.id, intent.id));
    return 'needs_attention';
  }
  const gate = await db.transaction(async (tx) => {
    await lockEmailAddress(tx as unknown as Database, input.workspaceId, intent.recipient.trim().toLowerCase());
    const [current] = await tx.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, input.enrollmentId)).limit(1);
    const [sender] = await tx.select({ sendingEnabled: workspaces.sendingEnabled }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    const eligible = await emailEligibility(tx as unknown as Database, input.workspaceId, intent.recipient.trim().toLowerCase(), purpose);
    const reason = current?.state === 'paused' ? 'paused'
      : !current || !['pending_start', 'running', 'waiting'].includes(current.state) ? 'enrollment_stopped'
      : !sender?.sendingEnabled ? 'sender_disabled' : eligible.eligible ? null : eligible.reason;
    if (reason) {
      if (reason !== 'paused') await tx.update(sendIntents).set({ state: intent.firstAttemptAt ? 'unknown' : 'abandoned', errorCode: reason, updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
      return reason;
    }
    await tx.update(sendIntents).set({ state: 'dispatching', firstAttemptAt: intent.firstAttemptAt ?? new Date(), updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
    return null;
  });
  if (gate) return gate === 'paused' ? 'paused' : intent.firstAttemptAt ? 'needs_attention' : gate === 'unsubscribed' ? 'unsubscribed' : 'suppressed';
  const outcome = await provider.send({
    from: intent.fromAddress ?? fromAddress, to: intent.recipient, subject: intent.subject,
    html: intent.html, text: intent.plainText, headers: intent.headers,
    tags: [{ name: 'rachet_workspace', value: input.workspaceId }, { name: 'rachet_intent', value: intent.id }],
  }, idempotencyKey);
  if (outcome.kind === 'accepted') {
    await db.update(sendIntents).set({ state: 'accepted', providerMessageId: outcome.messageId, acceptedAt: new Date(), updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
    return 'succeeded';
  }
  await db.update(sendIntents).set({ state: outcome.kind === 'unknown' ? 'unknown' : outcome.retryable ? 'retryable' : 'rejected', errorCode: outcome.code, updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
  if (outcome.kind === 'unknown' || outcome.retryable) throw ApplicationFailure.create({ message: outcome.code, type: 'ProviderTransientError' });
  throw ApplicationFailure.nonRetryable(outcome.code, 'ValidationError');
}

export async function evaluateCondition(input: { workspaceId: string; enrollmentId: string; condition: FlowCondition; eventData: Record<string, unknown> }): Promise<boolean> {
  const { values } = await executionContext(input.workspaceId, input.enrollmentId, input.eventData);
  if (input.condition.op === 'event_received') return input.condition.eventType in input.eventData;
  if (input.condition.op === 'exists') return resolveValue(input.condition.value, values) !== undefined;
  const left = resolveValue(input.condition.left, values); const right = resolveValue(input.condition.right, values);
  switch (input.condition.op) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'gt': return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lt': return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte': return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains': return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : Array.isArray(left) && left.includes(right);
  }
}
