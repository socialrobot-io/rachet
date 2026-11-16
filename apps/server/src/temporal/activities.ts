import { createHash } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import { resolveActionInput, resolveValue } from '../domain/action-catalog.js';
import type { FlowCondition, FlowNode } from '@rachet/contracts';
import { renderEmail } from '../domain/render.js';
import { createDatabase, type Database } from '../db/index.js';
import { contacts, emailPolicies, enrollments, sendIntents, sequenceVersions, sequences, templateVersions, unsubscribeTokens } from '../db/schema.js';
import type { EmailProvider } from '../providers/email-provider.js';
import { activeEmailConnection, emailProvider } from '../integrations/email-sender.js';
import { formatMailbox, mailboxAddress } from '../domain/email-policy.js';
import { dispatchEmail, prepareMarketingEmail } from '../domain/delivery.js';

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
  const connection = await activeEmailConnection(db, input.workspaceId);
  const provider = overrideProvider ?? (connection && emailProvider(config, connection));
  if (!provider) throw ApplicationFailure.nonRetryable('Connect an email provider before sending', 'ValidationError');
  const providerName = connection?.provider ?? 'resend';
  const feedbackTopic = connection?.provider === 'ses' ? connection.topicArn : null;
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
    const marketing = policy ? prepareMarketingEmail(config, input.workspaceId, rendered, policy.senderName) : undefined;
    if (marketing) rendered = marketing.rendered;
    const headers = marketing?.headers ?? {};
    const token = marketing?.token;
    const intentId = crypto.randomUUID();
    const payloadHash = createHash('sha256').update(JSON.stringify({ fromAddress, recipient: row.contact.email, rendered, headers, connectionVersion, tags: [input.workspaceId, intentId] })).digest('hex');
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(sendIntents).values({ id: intentId, workspaceId: input.workspaceId, provider: providerName, feedbackTopic, enrollmentId: input.enrollmentId, stepId: input.node.id, idempotencyKey, payloadHash, connectionVersion, fromAddress, recipient: row.contact.email, subject: rendered.subject, html: rendered.html, plainText: rendered.plainText, headers }).onConflictDoNothing().returning({ id: sendIntents.id });
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
  const outcome = await dispatchEmail(db, provider, intent, { fromAddress, connectionVersion, provider: providerName }, purpose);
  if (outcome.status === 'unknown' || outcome.status === 'retryable') {
    throw ApplicationFailure.create({ message: outcome.code, type: 'ProviderTransientError' });
  }
  if (outcome.status === 'rejected') throw ApplicationFailure.nonRetryable(outcome.code, 'ValidationError');
  return outcome.status;
}

export async function deliverStandaloneEmail(intentId: string) {
  const { db, config, provider: overrideProvider } = getRuntime();
  const [intent] = await db.select().from(sendIntents).where(and(eq(sendIntents.id, intentId), isNull(sendIntents.enrollmentId))).limit(1);
  if (!intent?.standalonePurpose || intent.state === 'accepted' || intent.state === 'abandoned' || intent.state === 'rejected') return;

  const connection = await activeEmailConnection(db, intent.workspaceId);
  const [policy] = intent.standalonePurpose === 'marketing'
    ? await db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, intent.workspaceId)).limit(1)
    : [];
  const fromAddress = intent.standalonePurpose === 'marketing' ? policy?.marketingFromAddress : connection?.fromAddress;
  if (!connection || !fromAddress || (policy && mailboxAddress(fromAddress) === mailboxAddress(connection.fromAddress))) {
    await finishStandaloneEmail(intentId, 'sender_unavailable');
    return;
  }
  const provider = overrideProvider ?? emailProvider(config, connection);
  const outcome = await dispatchEmail(db, provider, intent, {
    fromAddress, connectionVersion: connection.version, provider: connection.provider,
  }, intent.standalonePurpose);
  if (outcome.status === 'needs_attention' && connection.provider === 'resend') {
    await finishStandaloneEmail(intentId, 'delivery_outcome_unknown');
  }
  if (outcome.status === 'unknown' || outcome.status === 'retryable') {
    throw ApplicationFailure.create({ message: outcome.code, type: 'ProviderTransientError' });
  }
}

export async function finishStandaloneEmail(intentId: string, code: string) {
  await getRuntime().db.update(sendIntents).set({
    state: sql`CASE WHEN ${sendIntents.firstAttemptAt} IS NULL THEN 'abandoned'::send_state ELSE 'unknown'::send_state END`,
    errorCode: code,
    updatedAt: new Date(),
  }).where(and(eq(sendIntents.id, intentId), isNull(sendIntents.enrollmentId), inArray(sendIntents.state, ['prepared', 'dispatching', 'retryable'])));
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
