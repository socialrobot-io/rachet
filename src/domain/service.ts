import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import type { ReflowAuth } from '../auth.js';
import type { Database } from '../db/index.js';
import {
  auditEvents, contacts, enrollments, memberships, outbox, profiles, sendIntents,
  sequences, sequenceVersions, templates, templateVersions, webhookEvents, workspaces,
} from '../db/schema.js';
import type { OperationContext, Principal, WorkflowDefinition } from './contracts.js';
import { validateActionNodes } from './action-catalog.js';
import { simulateWorkflow } from './simulate.js';
import { ReflowError, isUniqueViolation } from './errors.js';
import { renderEmail } from './render.js';
import {
  buildTemplateRefIssues,
  collectEmailSendTemplateRefs,
  templateVersionIdsInDefinition,
  throwTemplateRefIssues,
} from './template-refs.js';
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

  async templateCreate(context: OperationContext, input: {
    workspaceId: string;
    name: string;
    subject: string;
    preheader?: string | undefined;
    body?: string | undefined;
    html?: string | undefined;
    sourceKind?: 'plain' | 'html' | undefined;
    tsxSource?: string | undefined;
    propsSchema?: Record<string, unknown> | undefined;
  }) {
    this.workspace(context, input.workspaceId, 'author');
    const sourceKind = input.html?.trim() ? 'html' : (input.sourceKind ?? 'plain');
    const body = input.body?.trim() ?? '';
    const html = input.html?.trim() || null;
    if (sourceKind === 'html') {
      if (!html) throw new ReflowError('VALIDATION_FAILED', 'html is required for html templates', 422);
      if (!body) throw new ReflowError('VALIDATION_FAILED', 'body (plain text) is required for html templates', 422);
    } else if (!body) {
      throw new ReflowError('VALIDATION_FAILED', 'body is required for plain templates', 422);
    }
    const [created] = await this.db.insert(templates).values({
      workspaceId: input.workspaceId,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader,
      body,
      html,
      sourceKind,
      tsxSource: input.tsxSource?.trim() || null,
      propsSchema: input.propsSchema ?? {},
    }).returning();
    if (!created) throw new Error('Template creation failed');
    await this.audit(context, 'template.create', input.workspaceId, 'template', created.id);
    return created;
  }

  async templateList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    const rows = await this.db.select().from(templates).where(eq(templates.workspaceId, workspaceId)).orderBy(asc(templates.name));
    const versions = await this.db.select({
      id: templateVersions.id,
      templateId: templateVersions.templateId,
      version: templateVersions.version,
      createdAt: templateVersions.createdAt,
    }).from(templateVersions).where(eq(templateVersions.workspaceId, workspaceId));
    return rows.map((row) => ({
      ...row,
      versions: versions.filter((version) => version.templateId === row.id).sort((a, b) => a.version - b.version),
    }));
  }

  async templateArchive(context: OperationContext, input: { workspaceId: string; templateId: string }) {
    this.workspace(context, input.workspaceId, 'author');
    const [draft] = await this.db.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.workspaceId, input.workspaceId))).limit(1);
    if (!draft) throw new ReflowError('NOT_FOUND', 'Template not found', 404);
    if (draft.state === 'archived') return draft;

    const versionRows = await this.db.select({ id: templateVersions.id, version: templateVersions.version })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, draft.id), eq(templateVersions.workspaceId, input.workspaceId)));
    const versionIds = new Set(versionRows.map((row) => row.id));
    if (versionIds.size > 0) {
      const refs = await this.findTemplateVersionUsages(input.workspaceId, versionIds);
      if (refs.length > 0) {
        throw new ReflowError(
          'TEMPLATE_IN_USE',
          `Template "${draft.name}" cannot be archived because published version(s) are referenced by workflow(s): ${refs.map((ref) => `${ref.workflowName} (${ref.scope})`).join(', ')}.`,
          409,
          false,
          {
            hint: 'Remove or replace the email.send templateVersionId pins in those workflows, publish a new workflow version if needed, then archive the template. Templates that workflows still pin are kept so historical enrollments stay reproducible.',
            details: {
              templateId: draft.id,
              templateName: draft.name,
              referencedBy: refs,
              nextSteps: [
                'Call workflow_list and inspect definitions for this templateVersionId.',
                'Update those email.send nodes to another published template version.',
                'Call workflow_publish for updated drafts.',
                'Retry template_archive.',
              ],
            },
          },
        );
      }
    }

    const [archived] = await this.db.update(templates).set({ state: 'archived', updatedAt: new Date() }).where(eq(templates.id, draft.id)).returning();
    await this.audit(context, 'template.archive', input.workspaceId, 'template', draft.id);
    return archived;
  }

  private async findTemplateVersionUsages(workspaceId: string, versionIds: Set<string>) {
    const refs: Array<{ workflowId: string; workflowName: string; scope: string; templateVersionId: string }> = [];
    const drafts = await this.db.select({ id: sequences.id, name: sequences.name, definition: sequences.definition })
      .from(sequences).where(eq(sequences.workspaceId, workspaceId));
    for (const draft of drafts) {
      for (const versionId of templateVersionIdsInDefinition(draft.definition)) {
        if (!versionIds.has(versionId)) continue;
        refs.push({ workflowId: draft.id, workflowName: draft.name, scope: 'draft', templateVersionId: versionId });
      }
    }
    const published = await this.db.select({
      sequenceId: sequenceVersions.sequenceId,
      version: sequenceVersions.version,
      definition: sequenceVersions.definition,
    }).from(sequenceVersions).where(eq(sequenceVersions.workspaceId, workspaceId));
    const names = new Map(drafts.map((row) => [row.id, row.name]));
    for (const row of published) {
      for (const versionId of templateVersionIdsInDefinition(row.definition)) {
        if (!versionIds.has(versionId)) continue;
        refs.push({
          workflowId: row.sequenceId,
          workflowName: names.get(row.sequenceId) ?? row.sequenceId,
          scope: `published:v${row.version}`,
          templateVersionId: versionId,
        });
      }
    }
    return refs;
  }

  private async assertTemplateRefs(workspaceId: string, definition: WorkflowDefinition) {
    const refs = collectEmailSendTemplateRefs(definition);
    if (refs.length === 0) return;
    const ids = [...new Set(refs.map((ref) => ref.templateVersionId).filter((id): id is string => Boolean(id)))];
    const existing = new Map<string, { templateId: string; templateState: string }>();
    if (ids.length > 0) {
      const rows = await this.db.select({
        id: templateVersions.id,
        templateId: templateVersions.templateId,
        templateState: templates.state,
      }).from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(and(eq(templateVersions.workspaceId, workspaceId), inArray(templateVersions.id, ids)));
      for (const row of rows) existing.set(row.id, { templateId: row.templateId, templateState: row.templateState });
    }
    const issues = buildTemplateRefIssues(refs, existing);
    if (issues.length > 0) throwTemplateRefIssues(issues);
  }

  async templatePublish(context: OperationContext, input: { workspaceId: string; templateId: string; expectedRevision: number }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new ReflowError('NOT_FOUND', 'Template not found', 404);
      if (draft.revision !== input.expectedRevision) throw new ReflowError('REVISION_CONFLICT', 'Template revision changed', 409);
      if (draft.state === 'archived') throw new ReflowError('VALIDATION_FAILED', 'Archived templates cannot be published; create a new template instead', 409);
      if (draft.sourceKind === 'html' && !draft.html?.trim()) {
        throw new ReflowError('VALIDATION_FAILED', 'html template is missing html content; re-push with `reflow template push`', 422);
      }
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(templateVersions).where(eq(templateVersions.templateId, draft.id));
      const version = Number(countRows[0]?.count ?? 0) + 1;
      const [published] = await tx.insert(templateVersions).values({
        workspaceId: input.workspaceId, templateId: draft.id, version,
        contentHash: hash({
          subject: draft.subject,
          preheader: draft.preheader,
          body: draft.body,
          html: draft.html,
          sourceKind: draft.sourceKind,
          propsSchema: draft.propsSchema,
        }),
        subject: draft.subject, preheader: draft.preheader, body: draft.body, html: draft.html,
        sourceKind: draft.sourceKind, tsxSource: draft.tsxSource, propsSchema: draft.propsSchema,
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
    await this.assertTemplateRefs(input.workspaceId, input.definition);
    const [created] = await this.db.insert(sequences).values({ workspaceId: input.workspaceId, name: input.name, definition: { ...input.definition, intent: input.intent } }).returning();
    if (!created) throw new Error('Workflow creation failed');
    await this.audit(context, 'workflow.create', input.workspaceId, 'workflow', created.id);
    return created;
  }

  async workspaceList(context: OperationContext) {
    if (context.principal.deploymentAdmin) {
      const rows = await this.db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug }).from(workspaces).orderBy(asc(workspaces.name));
      return rows.map((row) => ({ ...row, role: context.principal.workspaceRoles[row.id] ?? 'deployment_admin' }));
    }
    return this.db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: memberships.role })
      .from(workspaces)
      .innerJoin(memberships, and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, context.principal.userId)))
      .orderBy(asc(workspaces.name));
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
      await this.assertTemplateRefs(input.workspaceId, definition);
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(sequenceVersions).where(eq(sequenceVersions.sequenceId, draft.id));
      const [version] = await tx.insert(sequenceVersions).values({ workspaceId: input.workspaceId, sequenceId: draft.id, version: Number(countRows[0]?.count ?? 0) + 1, contentHash: hash(definition), definition }).returning();
      await tx.update(sequences).set({ state: 'published', updatedAt: new Date() }).where(eq(sequences.id, draft.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'workflow.publish', targetType: 'workflow_version', targetId: version?.id });
      return version;
    });
  }

  async workflowValidate(context: OperationContext, input: { workspaceId: string; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author');
    validateActionNodes(input.definition.nodes);
    await this.assertTemplateRefs(input.workspaceId, input.definition);
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
