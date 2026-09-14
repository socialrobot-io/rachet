import { createHash } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import { resolveActionInput, resolveValue } from '../domain/action-catalog.js';
import type { FlowCondition, FlowNode } from '../domain/contracts.js';
import { renderEmail } from '../domain/render.js';
import { createDatabase } from '../db/index.js';
import { contacts, enrollments, sendIntents, suppressions, templateVersions } from '../db/schema.js';
import { ResendProvider } from '../providers/resend.js';

let runtime: { config: Config; db: ReturnType<typeof createDatabase>['db']; provider: ResendProvider } | undefined;

export function configureActivities(config: Config) {
  const { db } = createDatabase(config);
  runtime = { config, db, provider: new ResendProvider(config.resendApiKey ?? 'not-configured', config.resendWebhookSecret) };
}

function getRuntime() {
  if (!runtime) throw new Error('Activities are not configured');
  return runtime;
}

async function executionContext(workspaceId: string, enrollmentId: string, eventData: Record<string, unknown>) {
  const { db } = getRuntime();
  const [row] = await db.select({ contact: contacts, enrollment: enrollments }).from(enrollments)
    .innerJoin(contacts, eq(enrollments.contactId, contacts.id))
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.workspaceId, workspaceId))).limit(1);
  if (!row) throw ApplicationFailure.nonRetryable('Enrollment data not found', 'ValidationError');
  return { row, values: { contact: { id: row.contact.id, email: row.contact.email, timezone: row.contact.timezone, ...row.contact.fields }, variables: row.enrollment.input, event: eventData } };
}

export async function recordEnrollmentState(enrollmentId: string, state: typeof enrollments.$inferInsert.state, currentStepId: string) {
  await getRuntime().db.update(enrollments).set({ state, currentStepId, updatedAt: new Date() }).where(eq(enrollments.id, enrollmentId));
}

export async function executeAction(input: { workspaceId: string; enrollmentId: string; node: Extract<FlowNode, { type: 'action' }>; eventData: Record<string, unknown> }): Promise<'succeeded' | 'failed' | 'needs_attention'> {
  const context = await executionContext(input.workspaceId, input.enrollmentId, input.eventData);
  const resolved = resolveActionInput(input.node.input, context.values);
  if (input.node.action === 'email.send') return sendEmail(input, resolved, context.row);
  if (input.node.action === 'contact.update') {
    const fields = resolved.fields;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) throw ApplicationFailure.nonRetryable('contact.update fields must resolve to an object', 'ValidationError');
    await getRuntime().db.update(contacts).set({ fields: { ...context.row.contact.fields, ...(fields as Record<string, unknown>) }, updatedAt: new Date() }).where(eq(contacts.id, context.row.contact.id));
    return 'succeeded';
  }
  throw ApplicationFailure.nonRetryable(`Unknown action: ${input.node.action}`, 'ValidationError');
}

async function sendEmail(input: { workspaceId: string; enrollmentId: string; node: Extract<FlowNode, { type: 'action' }> }, resolved: Record<string, unknown>, row: { contact: typeof contacts.$inferSelect; enrollment: typeof enrollments.$inferSelect }): Promise<'succeeded' | 'needs_attention'> {
  const { config, db, provider } = getRuntime();
  if (!config.resendApiKey) throw ApplicationFailure.nonRetryable('Resend is not configured', 'ValidationError');
  if (typeof resolved.templateVersionId !== 'string') throw ApplicationFailure.nonRetryable('templateVersionId must resolve to a UUID', 'ValidationError');
  const [template] = await db.select().from(templateVersions).where(and(eq(templateVersions.id, resolved.templateVersionId), eq(templateVersions.workspaceId, input.workspaceId))).limit(1);
  if (!template) throw ApplicationFailure.nonRetryable('Template version not found', 'ValidationError');
  const [blocked] = await db.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.workspaceId, input.workspaceId), eq(suppressions.emailKey, row.contact.emailKey), eq(suppressions.active, true))).limit(1);
  if (blocked) throw ApplicationFailure.nonRetryable('Recipient is suppressed', 'SuppressedError');
  const extraProps = typeof resolved.props === 'object' && resolved.props !== null && !Array.isArray(resolved.props) ? resolved.props as Record<string, unknown> : {};
  const rendered = await renderEmail(template, { contact: { email: row.contact.email, ...row.contact.fields }, variables: row.enrollment.input, ...extraProps });
  const payloadHash = createHash('sha256').update(JSON.stringify(rendered)).digest('hex');
  const idempotencyKey = `enrollment/${input.enrollmentId}/${input.node.id}`;
  await db.insert(sendIntents).values({ workspaceId: input.workspaceId, enrollmentId: input.enrollmentId, stepId: input.node.id, idempotencyKey, payloadHash, recipient: row.contact.email, subject: rendered.subject, html: rendered.html, plainText: rendered.plainText }).onConflictDoNothing();
  const [intent] = await db.select().from(sendIntents).where(eq(sendIntents.idempotencyKey, idempotencyKey)).limit(1);
  if (!intent) throw new Error('Send intent disappeared');
  if (intent.payloadHash !== payloadHash) throw ApplicationFailure.nonRetryable('Send payload changed', 'ValidationError');
  if (intent.state === 'accepted') return 'succeeded';
  if (intent.firstAttemptAt && Date.now() - intent.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000) {
    await db.update(sendIntents).set({ state: 'unknown', errorCode: 'idempotency_window_expired' }).where(eq(sendIntents.id, intent.id));
    return 'needs_attention';
  }
  await db.update(sendIntents).set({ state: 'dispatching', firstAttemptAt: intent.firstAttemptAt ?? new Date(), updatedAt: new Date() }).where(eq(sendIntents.id, intent.id));
  const outcome = await provider.send({ from: config.from, to: intent.recipient, subject: intent.subject, html: intent.html, text: intent.plainText }, idempotencyKey);
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
