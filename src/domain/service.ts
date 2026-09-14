import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import type { ReflowAuth } from '../auth.js';
import type { Database } from '../db/index.js';
import {
  auditEvents, contacts, enrollments, memberships, outbox, profiles, sendIntents,
  sequences, sequenceVersions, templates, templateVersions, webhookEvents,
} from '../db/schema.js';
import type { OperationContext, Principal, WorkflowDefinition } from './contracts.js';
import { validateActionNodes } from './action-catalog.js';
import { simulateWorkflow } from './simulate.js';
import { ReflowError, isUniqueViolation } from './errors.js';
import { renderEmail } from './render.js';
import { cancelEnrollment, enrollmentEvent, pauseEnrollment, resumeEnrollment } from '../temporal/shared.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ReflowService {
  constructor(
    private readonly db: Database,
    private readonly temporal: Client,
    private readonly auth: ReflowAuth,
  ) {}

  async principalFor(userId: string): Promise<Principal> {
    const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (profile?.disabled) throw new ReflowError('FORBIDDEN', 'Account is disabled', 403);
    const rows = await this.db.select({ workspaceId: memberships.workspaceId, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
    return { userId, workspaceIds: rows.map((row) => row.workspaceId), workspaceRoles: Object.fromEntries(rows.map((row) => [row.workspaceId, row.role])), deploymentAdmin: profile?.deploymentAdmin ?? false, scopes: ['reflow:read', 'reflow:write', 'reflow:send'] };
  }

  private workspace(context: OperationContext, workspaceId: string, permission: 'read' | 'author' | 'send' | 'operate' = 'read') {
    if (context.principal.deploymentAdmin) return;
    const role = context.principal.workspaceRoles[workspaceId];
    const allowed = permission === 'read'
      ? ['owner', 'admin', 'author', 'sender', 'operator', 'viewer']
      : permission === 'author' ? ['owner', 'admin', 'author']
      : permission === 'send' ? ['owner', 'admin', 'sender']
      : ['owner', 'admin', 'sender', 'operator'];
    if (!role || !allowed.includes(role)) throw new ReflowError('FORBIDDEN', `Workspace ${permission} permission denied`, 403);
  }

  private async audit(context: OperationContext, action: string, workspaceId: string | null, targetType?: string, targetId?: string) {
    await this.db.insert(auditEvents).values({ workspaceId, actorId: context.principal.userId, action, targetType, targetId });
  }

  async accountCreate(context: OperationContext, input: { email: string; name: string; password: string; deploymentAdmin: boolean; workspaceId?: string | undefined; role: typeof memberships.$inferInsert.role }) {
    if (!context.principal.deploymentAdmin) throw new ReflowError('FORBIDDEN', 'Deployment administrator required', 403);
    const result = await this.auth.api.createUser({ body: { email: input.email, name: input.name, password: input.password, role: input.deploymentAdmin ? 'admin' : 'user' } });
    await this.db.transaction(async (tx) => {
      await tx.insert(profiles).values({ userId: result.user.id, deploymentAdmin: input.deploymentAdmin }).onConflictDoUpdate({ target: profiles.userId, set: { deploymentAdmin: input.deploymentAdmin } });
      if (input.workspaceId) await tx.insert(memberships).values({ workspaceId: input.workspaceId, userId: result.user.id, role: input.role }).onConflictDoNothing();
      await tx.insert(auditEvents).values({ actorId: context.principal.userId, action: 'account.create', targetType: 'account', targetId: result.user.id });
    });
    return { id: result.user.id, email: result.user.email, deploymentAdmin: input.deploymentAdmin };
  }

  async credentialCreate(context: OperationContext, input: { userId: string; name: string; scopes: ('read' | 'write' | 'send')[]; expiresInSeconds?: number | undefined }) {
    if (!context.principal.deploymentAdmin) throw new ReflowError('FORBIDDEN', 'Deployment administrator required', 403);
    const api = this.auth.api as unknown as { createApiKey(args: { body: { userId: string; name: string; permissions: Record<string, string[]>; expiresIn?: number } }): Promise<Record<string, unknown>> };
    const base = { userId: input.userId, name: input.name, permissions: { reflow: input.scopes } };
    const body = input.expiresInSeconds === undefined ? base : { ...base, expiresIn: input.expiresInSeconds };
    const result = await api.createApiKey({ body });
    await this.audit(context, 'credential.create', null, 'account', input.userId);
    return result;
  }

  async credentialRevoke(context: OperationContext, input: { keyId: string }) {
    if (!context.principal.deploymentAdmin) throw new ReflowError('FORBIDDEN', 'Deployment administrator required', 403);
    const api = this.auth.api as unknown as { deleteApiKey(args: { body: { keyId: string } }): Promise<Record<string, unknown>> };
    const result = await api.deleteApiKey({ body: input });
    await this.audit(context, 'credential.revoke', null, 'api_key', input.keyId);
    return result;
  }

  async templateCreate(context: OperationContext, input: typeof templates.$inferInsert) {
    this.workspace(context, input.workspaceId, 'author');
    const [created] = await this.db.insert(templates).values(input).returning();
    if (!created) throw new Error('Template creation failed');
    await this.audit(context, 'template.create', input.workspaceId, 'template', created.id);
    return created;
  }

  async templateList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(templates).where(eq(templates.workspaceId, workspaceId)).orderBy(asc(templates.name));
  }

  async templatePublish(context: OperationContext, input: { workspaceId: string; templateId: string; expectedRevision: number }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new ReflowError('NOT_FOUND', 'Template not found', 404);
      if (draft.revision !== input.expectedRevision) throw new ReflowError('REVISION_CONFLICT', 'Template revision changed', 409);
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(templateVersions).where(eq(templateVersions.templateId, draft.id));
      const version = Number(countRows[0]?.count ?? 0) + 1;
      const [published] = await tx.insert(templateVersions).values({
        workspaceId: input.workspaceId, templateId: draft.id, version,
        contentHash: hash({ subject: draft.subject, preheader: draft.preheader, body: draft.body, propsSchema: draft.propsSchema }),
        subject: draft.subject, preheader: draft.preheader, body: draft.body, propsSchema: draft.propsSchema,
      }).returning();
      await tx.update(templates).set({ state: 'published', updatedAt: new Date() }).where(eq(templates.id, draft.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'template.publish', targetType: 'template_version', targetId: published?.id });
      return published;
    });
  }

  async templateRender(context: OperationContext, input: { workspaceId: string; templateVersionId: string; props: Record<string, unknown> }) {
    this.workspace(context, input.workspaceId);
    const [version] = await this.db.select().from(templateVersions).where(and(eq(templateVersions.id, input.templateVersionId), eq(templateVersions.workspaceId, input.workspaceId))).limit(1);
    if (!version) throw new ReflowError('NOT_FOUND', 'Template version not found', 404);
    return renderEmail(version, input.props);
  }

  async workflowCreate(context: OperationContext, input: { workspaceId: string; name: string; intent: string; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author');
    validateActionNodes(input.definition.nodes);
    const [created] = await this.db.insert(sequences).values({ workspaceId: input.workspaceId, name: input.name, definition: { ...input.definition, intent: input.intent } }).returning();
    if (!created) throw new Error('Workflow creation failed');
    await this.audit(context, 'workflow.create', input.workspaceId, 'workflow', created.id);
    return created;
  }

  async workflowList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(sequences).where(eq(sequences.workspaceId, workspaceId)).orderBy(asc(sequences.name));
  }

  async workflowPublish(context: OperationContext, input: { workspaceId: string; workflowId: string; expectedRevision: number }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(sequences).where(and(eq(sequences.id, input.workflowId), eq(sequences.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new ReflowError('NOT_FOUND', 'Workflow not found', 404);
      if (draft.revision !== input.expectedRevision) throw new ReflowError('REVISION_CONFLICT', 'Workflow revision changed', 409);
      const definition = draft.definition as WorkflowDefinition;
      validateActionNodes(definition.nodes);
      for (const node of definition.nodes) if (node.type === 'action' && node.action === 'email.send') {
        const source = node.input.templateVersionId;
        if (!source || !('literal' in source) || typeof source.literal !== 'string') throw new ReflowError('VALIDATION_FAILED', `email.send ${node.id} requires a literal published templateVersionId`, 422);
        const [version] = await tx.select({ id: templateVersions.id }).from(templateVersions).where(and(eq(templateVersions.id, source.literal), eq(templateVersions.workspaceId, input.workspaceId))).limit(1);
        if (!version) throw new ReflowError('VALIDATION_FAILED', `Template version ${source.literal} not found`, 422);
      }
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(sequenceVersions).where(eq(sequenceVersions.sequenceId, draft.id));
      const [version] = await tx.insert(sequenceVersions).values({ workspaceId: input.workspaceId, sequenceId: draft.id, version: Number(countRows[0]?.count ?? 0) + 1, contentHash: hash(definition), definition }).returning();
      await tx.update(sequences).set({ state: 'published', updatedAt: new Date() }).where(eq(sequences.id, draft.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'workflow.publish', targetType: 'workflow_version', targetId: version?.id });
      return version;
    });
  }

  workflowValidate(context: OperationContext, input: { workspaceId: string; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author'); validateActionNodes(input.definition.nodes);
    return { valid: true, nodeCount: input.definition.nodes.length };
  }

  workflowSimulate(context: OperationContext, input: { workspaceId: string; definition: WorkflowDefinition; contact: Record<string, unknown>; variables: Record<string, unknown>; receivedEvents: string[] }) {
    this.workspace(context, input.workspaceId, 'author'); validateActionNodes(input.definition.nodes);
    return simulateWorkflow(input.definition, input.contact, input.variables, input.receivedEvents);
  }

  async contactUpsert(context: OperationContext, input: { workspaceId: string; email: string; externalId?: string | undefined; timezone?: string | undefined; fields: Record<string, unknown> }) {
    this.workspace(context, input.workspaceId, 'send');
    const emailKey = input.email.trim().toLowerCase();
    const [row] = await this.db.insert(contacts).values({ ...input, email: input.email.trim(), emailKey }).onConflictDoUpdate({
      target: [contacts.workspaceId, contacts.emailKey],
      set: { externalId: input.externalId, email: input.email.trim(), timezone: input.timezone, fields: input.fields, updatedAt: new Date() },
    }).returning();
    if (!row) throw new Error('Contact upsert failed');
    await this.audit(context, 'contact.upsert', input.workspaceId, 'contact', row.id);
    return row;
  }

  async contactList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)).orderBy(asc(contacts.email));
  }

  async enrollmentCreate(context: OperationContext, input: { workspaceId: string; workflowVersionId: string; contactId: string; variables: Record<string, unknown>; idempotencyKey: string }) {
    this.workspace(context, input.workspaceId, 'send');
    const id = crypto.randomUUID();
    const workflowId = `workspace/${input.workspaceId}/enrollment/${id}`;
    try {
      const [created] = await this.db.transaction(async (tx) => {
        const rows = await tx.insert(enrollments).values({ id, workspaceId: input.workspaceId, sequenceVersionId: input.workflowVersionId, contactId: input.contactId, workflowId, input: input.variables, idempotencyKey: input.idempotencyKey }).returning();
        await tx.insert(outbox).values({ kind: 'enrollment.start', aggregateId: id, payload: { enrollmentId: id } });
        await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'enrollment.create', targetType: 'enrollment', targetId: id });
        return rows;
      });
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [existing] = await this.db.select().from(enrollments).where(and(eq(enrollments.workspaceId, input.workspaceId), eq(enrollments.idempotencyKey, input.idempotencyKey))).limit(1);
      if (!existing || existing.contactId !== input.contactId || existing.sequenceVersionId !== input.workflowVersionId) throw new ReflowError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
      return existing;
    }
  }

  async enrollmentList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(enrollments).where(eq(enrollments.workspaceId, workspaceId)).orderBy(asc(enrollments.createdAt));
  }

  async enrollmentControl(context: OperationContext, input: { workspaceId: string; enrollmentId: string }, action: 'pause' | 'resume' | 'cancel') {
    this.workspace(context, input.workspaceId, 'operate');
    const [row] = await this.db.select().from(enrollments).where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
    if (!row) throw new ReflowError('NOT_FOUND', 'Enrollment not found', 404);
    const handle = this.temporal.workflow.getHandle(row.workflowId);
    await handle.signal(action === 'pause' ? pauseEnrollment : action === 'resume' ? resumeEnrollment : cancelEnrollment);
    await this.audit(context, `enrollment.${action}`, input.workspaceId, 'enrollment', row.id);
    return { id: row.id, control: action, status: 'requested' };
  }

  async eventEmit(context: OperationContext, input: { workspaceId: string; enrollmentId: string; eventId: string; eventType: string; data: Record<string, unknown> }) {
    this.workspace(context, input.workspaceId, 'operate');
    const [row] = await this.db.select().from(enrollments).where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
    if (!row) throw new ReflowError('NOT_FOUND', 'Enrollment not found', 404);
    await this.temporal.workflow.getHandle(row.workflowId).signal(enrollmentEvent, input.eventType, input.eventId, input.data);
    await this.audit(context, 'event.emit', input.workspaceId, 'enrollment', row.id);
    return { accepted: true, eventId: input.eventId };
  }

  async messageList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(sendIntents).where(eq(sendIntents.workspaceId, workspaceId)).orderBy(asc(sendIntents.createdAt));
  }

  async webhookEventList(context: OperationContext) {
    if (!context.principal.deploymentAdmin) throw new ReflowError('FORBIDDEN', 'Deployment administrator required', 403);
    return this.db.select().from(webhookEvents).orderBy(asc(webhookEvents.createdAt));
  }
}
