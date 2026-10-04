import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import { WorkflowNotFoundError } from '@temporalio/common';
import type { RachetAuth } from '../auth.js';
import type { Database } from '../db/index.js';
import {
  auditEvents, contacts, enrollmentEvents, enrollments, eventTypes, memberships, outbox, profiles, sendIntents,
  sequences, sequenceVersions, templates, templateVersions, webhookEvents, workspaces, emailPolicies, subscriptionEvents, resendConnections,
} from '../db/schema.js';
import type { EnrollmentCreateInput, OperationContext, Principal, SimulatedEvent, WorkflowDefinition } from '@rachet/contracts';
import { validateActionNodes } from './action-catalog.js';
import { simulateWorkflow } from './simulate.js';
import { RachetError, isUniqueViolation } from './errors.js';
import { compileEventSchema, validateEventData } from './event-types.js';
import { appendMarketingFooter, renderEmail } from './render.js';
import {
  buildTemplateRefIssues,
  collectEmailSendTemplateRefs,
  templateVersionIdsInDefinition,
  throwTemplateRefIssues,
} from './template-refs.js';
import { cancelEnrollment, enrollmentEvent, pauseEnrollment, resumeEnrollment } from '../temporal/shared.js';
import { runWelcomeWorkflowCreated } from '../welcome.js';
import { changePreference, emailEligibility, emailKey, lockEmailAddress, mailboxAddress, recordPreference } from './email-policy.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export class RachetService {
  constructor(
    private readonly db: Database,
    private readonly temporal: Client,
    private readonly auth: RachetAuth,
  ) {}

  async principalFor(userId: string): Promise<Principal> {
    const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (profile?.disabled) throw new RachetError('FORBIDDEN', 'Account is disabled', 403);
    const rows = await this.db.select({ workspaceId: memberships.workspaceId, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
    const activeRows = profile?.defaultWorkspaceId
      ? rows.filter((row) => row.workspaceId === profile.defaultWorkspaceId)
      : rows.slice(0, 1);
    const deploymentAdmin = profile?.deploymentAdmin ?? false;
    const roles = new Set(activeRows.map((row) => row.role));
    const scopes = [
      ...(deploymentAdmin || activeRows.length > 0 ? ['rachet:read'] : []),
      ...(deploymentAdmin || [...roles].some((role) => ['owner', 'admin', 'author', 'operator'].includes(role)) ? ['rachet:write'] : []),
      ...(deploymentAdmin || [...roles].some((role) => ['owner', 'admin', 'sender'].includes(role)) ? ['rachet:send'] : []),
    ];
    return {
      userId,
      workspaceIds: activeRows.map((row) => row.workspaceId),
      workspaceRoles: Object.fromEntries(activeRows.map((row) => [row.workspaceId, row.role])),
      deploymentAdmin,
      scopes,
    };
  }

  private workspace(context: OperationContext, workspaceId: string, permission: 'read' | 'author' | 'send' | 'operate' = 'read') {
    if (context.principal.deploymentAdmin) return;
    const role = context.principal.workspaceRoles[workspaceId];
    const allowed = permission === 'read'
      ? ['owner', 'admin', 'author', 'sender', 'operator', 'viewer']
      : permission === 'author' ? ['owner', 'admin', 'author']
      : permission === 'send' ? ['owner', 'admin', 'sender']
      : ['owner', 'admin', 'sender', 'operator'];
    if (!role || !allowed.includes(role)) throw new RachetError('FORBIDDEN', `Workspace ${permission} permission denied`, 403);
  }

  private hasScope(context: OperationContext, scope: 'rachet:read' | 'rachet:write' | 'rachet:send') {
    return context.principal.scopes.includes(scope) || context.principal.scopes.includes(scope.replace('rachet:', 'reflow:'));
  }

  private async assertEnrollmentReplay(db: Database, existing: { id: string; contactId: string; sequenceVersionId: string; input: Record<string, unknown> }, input: EnrollmentCreateInput, address: string) {
    if (existing.contactId !== input.contactId || existing.sequenceVersionId !== input.workflowVersionId || stableHash(existing.input) !== stableHash(input.variables)) {
      throw new RachetError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
    }
    if (!input.consent) return;
    const [audit] = await db.select({ details: auditEvents.details }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, input.workspaceId), eq(auditEvents.action, 'enrollment.create'), eq(auditEvents.targetId, existing.id),
    )).orderBy(asc(auditEvents.createdAt)).limit(1);
    if (audit?.details.consentEventId !== input.consent.eventId) throw new RachetError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
    const [event] = await db.select({
      emailKey: subscriptionEvents.emailKey, action: subscriptionEvents.action, source: subscriptionEvents.source, consentReference: subscriptionEvents.consentReference,
    }).from(subscriptionEvents).where(and(eq(subscriptionEvents.workspaceId, input.workspaceId), eq(subscriptionEvents.eventId, input.consent.eventId))).limit(1);
    if (!event || event.emailKey !== address || event.action !== 'consent' || event.source !== input.consent.source || event.consentReference !== input.consent.consentReference) {
      throw new RachetError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
    }
  }

  private async audit(
    context: OperationContext,
    action: string,
    workspaceId: string | null,
    targetType?: string,
    targetId?: string,
    details: Record<string, unknown> = {},
  ) {
    await this.db.insert(auditEvents).values({
      workspaceId,
      actorId: context.principal.userId,
      action,
      targetType,
      targetId,
      details,
    });
  }

  async accountCreate(context: OperationContext, input: { email: string; name: string; method: 'magic-link' | 'github'; organizationName: string }) {
    if (!context.principal.deploymentAdmin) throw new RachetError('FORBIDDEN', 'Deployment administrator required', 403);
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.db.execute(sql`select id from "user" where lower(trim(email)) = ${normalizedEmail} limit 1`);
    if (existing.rowCount) throw new RachetError('ACCOUNT_EXISTS', 'An account with this email already exists', 409);
    await this.db.execute(sql`delete from registration_intents where consumed_at is null and expires_at <= now()`);
    await this.db.execute(sql`
      insert into registration_intents (
        email_key, name, organization_name, method, kind, created_by, expires_at
      ) values (
        ${normalizedEmail}, ${input.name}, ${input.organizationName}, ${input.method}, 'invite',
        ${context.principal.userId}, now() + interval '7 days'
      )
      on conflict (email_key) where consumed_at is null do update set
        name = excluded.name,
        organization_name = excluded.organization_name,
        method = excluded.method,
        kind = excluded.kind,
        created_by = excluded.created_by,
        expires_at = excluded.expires_at
    `);
    await this.audit(context, 'account.invite', null, 'account_email', normalizedEmail, { method: input.method });
    return { email: normalizedEmail, method: input.method, expiresInSeconds: 7 * 24 * 60 * 60 };
  }

  async credentialCreate(context: OperationContext, input: { workspaceId: string; name: string; scopes: ('read' | 'write' | 'send')[]; expiresInSeconds: number }) {
    this.workspace(context, input.workspaceId);
    for (const scope of input.scopes) {
      if (!context.principal.scopes.includes(`rachet:${scope}`)) {
        throw new RachetError('FORBIDDEN', `Cannot grant unavailable scope: ${scope}`, 403);
      }
    }
    const result = await (this.auth.api as unknown as { createApiKey(args: { body: Record<string, unknown> }): Promise<Record<string, unknown>> }).createApiKey({
      body: {
        userId: context.principal.userId,
        name: input.name,
        prefix: 'rf',
        permissions: { rachet: [...new Set(input.scopes)] },
        metadata: { workspaceId: input.workspaceId },
        expiresIn: input.expiresInSeconds,
      },
    });
    await this.audit(context, 'credential.create', input.workspaceId, 'account', context.principal.userId, { scopes: input.scopes });
    return result;
  }

  async credentialList(context: OperationContext, input: { workspaceId: string }) {
    this.workspace(context, input.workspaceId);
    const result = await this.db.execute<{
      id: string; name: string | null; start: string | null; prefix: string | null; enabled: boolean;
      permissions: string | null; expiresAt: Date | null; createdAt: Date; updatedAt: Date; lastRequest: Date | null;
    }>(sql`
      select id, name, start, prefix, enabled, permissions,
        "expiresAt" as "expiresAt", "createdAt" as "createdAt", "updatedAt" as "updatedAt", "lastRequest" as "lastRequest"
      from apikey
      where "referenceId" = ${context.principal.userId}
        and coalesce(metadata, '{}')::jsonb ->> 'workspaceId' = ${input.workspaceId}
      order by "createdAt" desc
    `);
    return result.rows.map((row) => ({
      ...row,
      scopes: (() => {
        try {
          const parsed = JSON.parse(row.permissions ?? '{}') as { rachet?: unknown };
          return Array.isArray(parsed.rachet) ? parsed.rachet.filter((scope): scope is string => typeof scope === 'string') : [];
        } catch { return []; }
      })(),
      permissions: undefined,
    }));
  }

  async credentialRevoke(context: OperationContext, input: { workspaceId: string; keyId: string }) {
    this.workspace(context, input.workspaceId);
    const result = await this.db.execute<{ id: string }>(sql`
      delete from apikey
      where id = ${input.keyId}
        and "referenceId" = ${context.principal.userId}
        and coalesce(metadata, '{}')::jsonb ->> 'workspaceId' = ${input.workspaceId}
      returning id
    `);
    if (!result.rows[0]) throw new RachetError('NOT_FOUND', 'API key not found', 404);
    await this.audit(context, 'credential.revoke', input.workspaceId, 'api_key', input.keyId);
    return { success: true };
  }

  async templateCreate(context: OperationContext, input: {
    workspaceId: string;
    name: string;
    subject: string;
    preheader?: string | undefined;
    body?: string | undefined;
    html?: string | undefined;
    sourceKind?: 'plain' | 'html' | undefined;
    propsSchema?: Record<string, unknown> | undefined;
  }) {
    this.workspace(context, input.workspaceId, 'author');
    const sourceKind = input.html?.trim() ? 'html' : (input.sourceKind ?? 'plain');
    const body = input.body?.trim() ?? '';
    const html = input.html?.trim() || null;
    if (sourceKind === 'html') {
      if (!html) throw new RachetError('VALIDATION_FAILED', 'html is required for html templates', 422);
      if (!body) throw new RachetError('VALIDATION_FAILED', 'body (plain text) is required for html templates', 422);
    } else if (!body) {
      throw new RachetError('VALIDATION_FAILED', 'body is required for plain templates', 422);
    }
    try {
      const [created] = await this.db.insert(templates).values({
        workspaceId: input.workspaceId,
        name: input.name,
        subject: input.subject,
        preheader: input.preheader,
        body,
        html,
        sourceKind,
        propsSchema: input.propsSchema ?? {},
      }).returning();
      if (!created) throw new Error('Template creation failed');
      await this.audit(context, 'template.create', input.workspaceId, 'template', created.id);
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new RachetError(
        'TEMPLATE_NAME_EXISTS',
        `A template named "${input.name}" already exists in this workspace.`,
        409,
        false,
        {
          hint: 'Call template.revise with the existing templateId (from template.list), then template.publish. Do not create a second template with a "v2" suffix.',
          details: {
            workspaceId: input.workspaceId,
            name: input.name,
            nextSteps: [
              'template.list → find the row with this name',
              'template.revise (update draft content) → template.publish',
            ],
          },
        },
      );
    }
  }

  async templateRevise(context: OperationContext, input: {
    workspaceId: string;
    templateId: string;
    expectedRevision: number;
    subject: string;
    preheader?: string | undefined;
    body?: string | undefined;
    html?: string | undefined;
    sourceKind?: 'plain' | 'html' | undefined;
    propsSchema?: Record<string, unknown> | undefined;
  }) {
    this.workspace(context, input.workspaceId, 'author');
    const sourceKind = input.html?.trim() ? 'html' : (input.sourceKind ?? 'plain');
    const body = input.body?.trim() ?? '';
    const html = input.html?.trim() || null;
    if (sourceKind === 'html') {
      if (!html) throw new RachetError('VALIDATION_FAILED', 'html is required for html templates', 422);
      if (!body) throw new RachetError('VALIDATION_FAILED', 'body (plain text) is required for html templates', 422);
    } else if (!body) {
      throw new RachetError('VALIDATION_FAILED', 'body is required for plain templates', 422);
    }
    const [draft] = await this.db.select().from(templates).where(and(
      eq(templates.id, input.templateId),
      eq(templates.workspaceId, input.workspaceId),
    )).limit(1);
    if (!draft) throw new RachetError('NOT_FOUND', 'Template not found', 404);
    if (draft.revision !== input.expectedRevision) {
      throw new RachetError('REVISION_CONFLICT', 'Template revision changed', 409);
    }
    if (draft.state === 'archived') {
      throw new RachetError(
        'VALIDATION_FAILED',
        'Archived templates cannot be revised; create a new template with a different name',
        409,
      );
    }
    const [updated] = await this.db.update(templates).set({
      subject: input.subject,
      preheader: input.preheader,
      body,
      html,
      sourceKind,
      propsSchema: input.propsSchema ?? {},
      revision: draft.revision + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(templates.id, draft.id),
      eq(templates.revision, input.expectedRevision),
    )).returning();
    if (!updated) throw new RachetError('REVISION_CONFLICT', 'Template revision changed', 409);
    await this.audit(context, 'template.revise', input.workspaceId, 'template', updated.id);
    return updated;
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
    if (!draft) throw new RachetError('NOT_FOUND', 'Template not found', 404);
    if (draft.state === 'archived') return draft;

    const versionRows = await this.db.select({ id: templateVersions.id, version: templateVersions.version })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, draft.id), eq(templateVersions.workspaceId, input.workspaceId)));
    const versionIds = new Set(versionRows.map((row) => row.id));
    if (versionIds.size > 0) {
      const refs = await this.findTemplateVersionUsages(input.workspaceId, versionIds);
      if (refs.length > 0) {
        throw new RachetError(
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

  private async assertEventTypes(workspaceId: string, definition: WorkflowDefinition) {
    const names = new Set<string>();
    if (definition.trigger.type === 'event') names.add(definition.trigger.eventType);
    for (const node of definition.nodes) {
      if (node.type === 'wait_for_event') names.add(node.eventType);
      if (node.type === 'branch' && node.condition.op === 'event_received') names.add(node.condition.eventType);
    }
    if (names.size === 0) return;
    const rows = await this.db.select().from(eventTypes).where(and(
      eq(eventTypes.workspaceId, workspaceId),
      inArray(eventTypes.eventType, [...names]),
    ));
    const schemas = new Map(rows.map((row) => [row.eventType, row.schema]));
    const missing = [...names].filter((name) => !schemas.has(name));
    if (missing.length > 0) {
      throw new RachetError('EVENT_TYPE_NOT_FOUND', `Define event types before using them: ${missing.join(', ')}`, 422, false, {
        hint: 'Call event_type_define with a JSON Schema for each event type.', details: { eventTypes: missing },
      });
    }
    for (const [eventType, schema] of schemas) compileEventSchema(eventType, schema);
  }

  private async assertEventData(workspaceId: string, eventType: string, data: Record<string, unknown>) {
    const [registered] = await this.db.select().from(eventTypes).where(and(
      eq(eventTypes.workspaceId, workspaceId), eq(eventTypes.eventType, eventType),
    )).limit(1);
    if (!registered) {
      throw new RachetError('EVENT_TYPE_NOT_FOUND', `Event type ${eventType} is not registered`, 422, false, {
        hint: 'Call event_type_define before emitting this event.', details: { eventType },
      });
    }
    validateEventData(eventType, registered.schema, data);
  }

  async templatePublish(context: OperationContext, input: { workspaceId: string; templateId: string; expectedRevision: number }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new RachetError('NOT_FOUND', 'Template not found', 404);
      if (draft.revision !== input.expectedRevision) throw new RachetError('REVISION_CONFLICT', 'Template revision changed', 409);
      if (draft.state === 'archived') throw new RachetError('VALIDATION_FAILED', 'Archived templates cannot be published; create a new template instead', 409);
      if (draft.sourceKind === 'html' && !draft.html?.trim()) {
        throw new RachetError('VALIDATION_FAILED', 'html template is missing html content; revise it with template.revise before publishing', 422);
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
        sourceKind: draft.sourceKind, propsSchema: draft.propsSchema,
      }).returning();
      await tx.update(templates).set({ state: 'published', updatedAt: new Date() }).where(eq(templates.id, draft.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'template.publish', targetType: 'template_version', targetId: published?.id });
      return published;
    });
  }

  async templateRender(context: OperationContext, input: { workspaceId: string; templateVersionId: string; props: Record<string, unknown>; marketingPreview?: boolean }) {
    this.workspace(context, input.workspaceId);
    const [version] = await this.db.select().from(templateVersions).where(and(eq(templateVersions.id, input.templateVersionId), eq(templateVersions.workspaceId, input.workspaceId))).limit(1);
    if (!version) throw new RachetError('NOT_FOUND', 'Template version not found', 404);
    const rendered = await renderEmail(version, input.props);
    if (!input.marketingPreview) return rendered;
    const [policy] = await this.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, input.workspaceId)).limit(1);
    if (!policy) return rendered;
    return appendMarketingFooter(rendered, policy.senderName, 'https://example.invalid/unsubscribe-preview');
  }

  async workflowCreate(context: OperationContext, input: { workspaceId: string; name: string; intent: string; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author');
    validateActionNodes(input.definition.nodes);
    await this.assertEventTypes(input.workspaceId, input.definition);
    await this.assertTemplateRefs(input.workspaceId, input.definition);
    const [created] = await this.db.insert(sequences).values({ workspaceId: input.workspaceId, name: input.name, definition: { ...input.definition, intent: input.intent } }).returning();
    if (!created) throw new Error('Workflow creation failed');
    await this.audit(context, 'workflow.create', input.workspaceId, 'workflow', created.id);
    await runWelcomeWorkflowCreated(context.principal.userId, created.id);
    return created;
  }

  async workflowRevise(context: OperationContext, input: { workspaceId: string; workflowId: string; expectedRevision: number; intent?: string | undefined; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author');
    validateActionNodes(input.definition.nodes);
    await this.assertEventTypes(input.workspaceId, input.definition);
    await this.assertTemplateRefs(input.workspaceId, input.definition);
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(sequences)
        .where(and(eq(sequences.id, input.workflowId), eq(sequences.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new RachetError('NOT_FOUND', 'Workflow not found', 404);
      if (draft.revision !== input.expectedRevision) throw new RachetError('REVISION_CONFLICT', 'Workflow revision changed', 409);
      if (draft.state === 'archived') throw new RachetError('VALIDATION_FAILED', 'Archived workflows cannot be revised', 409);
      const intent = input.intent ?? (draft.definition as { intent?: string }).intent;
      const [updated] = await tx.update(sequences).set({
        definition: { ...input.definition, intent },
        state: 'draft',
        revision: draft.revision + 1,
        updatedAt: new Date(),
      }).where(and(eq(sequences.id, draft.id), eq(sequences.workspaceId, input.workspaceId), eq(sequences.revision, input.expectedRevision))).returning();
      if (!updated) throw new RachetError('REVISION_CONFLICT', 'Workflow revision changed', 409);
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'workflow.revise', targetType: 'workflow', targetId: updated.id });
      return updated;
    });
  }

  async workspaceList(context: OperationContext) {
    const [profile] = await this.db.select({ defaultWorkspaceId: profiles.defaultWorkspaceId })
      .from(profiles).where(eq(profiles.userId, context.principal.userId)).limit(1);
    if (profile?.defaultWorkspaceId) {
      if (!context.principal.deploymentAdmin && !context.principal.workspaceRoles[profile.defaultWorkspaceId]) return [];
      const [workspace] = await this.db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces).where(eq(workspaces.id, profile.defaultWorkspaceId)).limit(1);
      if (!workspace) return [];
      return [{ ...workspace, role: context.principal.workspaceRoles[workspace.id] ?? 'deployment_admin' }];
    }
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
    const rows = await this.db.select().from(sequences).where(eq(sequences.workspaceId, workspaceId)).orderBy(asc(sequences.name));
    const versions = await this.db.select({
      id: sequenceVersions.id,
      sequenceId: sequenceVersions.sequenceId,
      version: sequenceVersions.version,
      definition: sequenceVersions.definition,
      createdAt: sequenceVersions.createdAt,
    }).from(sequenceVersions).where(eq(sequenceVersions.workspaceId, workspaceId)).orderBy(asc(sequenceVersions.version));
    const bySequence = new Map<string, typeof versions>();
    for (const version of versions) {
      const list = bySequence.get(version.sequenceId) ?? [];
      list.push(version);
      bySequence.set(version.sequenceId, list);
    }
    return rows.map((row) => ({
      ...row,
      publishedVersions: bySequence.get(row.id) ?? [],
    }));
  }

  async workflowPublish(context: OperationContext, input: { workspaceId: string; workflowId: string; expectedRevision: number }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(sequences).where(and(eq(sequences.id, input.workflowId), eq(sequences.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!draft) throw new RachetError('NOT_FOUND', 'Workflow not found', 404);
      if (draft.revision !== input.expectedRevision) throw new RachetError('REVISION_CONFLICT', 'Workflow revision changed', 409);
      const definition = draft.definition as WorkflowDefinition;
      if (definition.purpose !== 'marketing' && definition.purpose !== 'transactional') throw new RachetError('VALIDATION_FAILED', 'Choose an explicit email purpose before publishing', 422);
      if (definition.purpose === 'marketing') {
        const [policy] = await tx.select({ marketingFromAddress: emailPolicies.marketingFromAddress }).from(emailPolicies).where(eq(emailPolicies.workspaceId, input.workspaceId)).limit(1);
        if (!policy?.marketingFromAddress) throw new RachetError('EMAIL_POLICY_REQUIRED', 'Configure the marketing sender and unsubscribe settings before publishing marketing email', 422);
      }
      validateActionNodes(definition.nodes);
      await this.assertEventTypes(input.workspaceId, definition);
      await this.assertTemplateRefs(input.workspaceId, definition);
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(sequenceVersions).where(eq(sequenceVersions.sequenceId, draft.id));
      const [version] = await tx.insert(sequenceVersions).values({ workspaceId: input.workspaceId, sequenceId: draft.id, version: Number(countRows[0]?.count ?? 0) + 1, contentHash: hash(definition), definition, purposeReviewedAt: new Date() }).returning();
      await tx.update(sequences).set({ state: 'published', updatedAt: new Date() }).where(eq(sequences.id, draft.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'workflow.publish', targetType: 'workflow_version', targetId: version?.id });
      return version;
    });
  }

  async workflowDelete(context: OperationContext, input: { workspaceId: string; workflowId: string; dangerouslyDeleteWorkflow: true }) {
    this.workspace(context, input.workspaceId, 'author');
    return this.db.transaction(async (tx) => {
      const [workflow] = await tx.select().from(sequences)
        .where(and(eq(sequences.id, input.workflowId), eq(sequences.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!workflow) throw new RachetError('NOT_FOUND', 'Workflow not found', 404);

      const versions = await tx.select({ id: sequenceVersions.id }).from(sequenceVersions)
        .where(and(eq(sequenceVersions.sequenceId, workflow.id), eq(sequenceVersions.workspaceId, input.workspaceId))).for('update');
      const versionIds = versions.map((version) => version.id);
      const activeEnrollments = versionIds.length === 0 ? [] : await tx.select({ id: enrollments.id }).from(enrollments)
        .where(and(eq(enrollments.workspaceId, input.workspaceId), inArray(enrollments.sequenceVersionId, versionIds), inArray(enrollments.state, ['pending_start', 'running', 'waiting', 'paused', 'needs_attention']))).for('update');
      if (activeEnrollments.length > 0) {
        throw new RachetError(
          'WORKFLOW_HAS_ACTIVE_ENROLLMENTS',
          'Workflow has enrollments in progress and cannot be deleted.',
          409,
          false,
          { hint: 'Cancel or let every active enrollment finish before deleting this workflow.', details: { activeEnrollmentCount: activeEnrollments.length } },
        );
      }

      const enrollmentRows = versionIds.length === 0 ? [] : await tx.select({ id: enrollments.id }).from(enrollments)
        .where(and(eq(enrollments.workspaceId, input.workspaceId), inArray(enrollments.sequenceVersionId, versionIds))).for('update');
      await this.deleteEnrollmentRecords(tx, input.workspaceId, enrollmentRows.map((row) => row.id));
      if (versionIds.length > 0) await tx.delete(sequenceVersions).where(inArray(sequenceVersions.id, versionIds));
      await tx.delete(sequences).where(eq(sequences.id, workflow.id));
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'workflow.delete', targetType: 'workflow', targetId: workflow.id });
      return { id: workflow.id, deleted: true };
    });
  }

  async workflowValidate(context: OperationContext, input: { workspaceId: string; definition: WorkflowDefinition }) {
    this.workspace(context, input.workspaceId, 'author');
    validateActionNodes(input.definition.nodes);
    await this.assertEventTypes(input.workspaceId, input.definition);
    await this.assertTemplateRefs(input.workspaceId, input.definition);
    return { valid: true, nodeCount: input.definition.nodes.length };
  }

  async workflowSimulate(context: OperationContext, input: { workspaceId: string; definition: WorkflowDefinition; contact: Record<string, unknown>; variables: Record<string, unknown>; receivedEvents: SimulatedEvent[] }) {
    this.workspace(context, input.workspaceId, 'author'); validateActionNodes(input.definition.nodes);
    await this.assertEventTypes(input.workspaceId, input.definition);
    for (const event of input.receivedEvents) await this.assertEventData(input.workspaceId, event.eventType, event.data);
    return simulateWorkflow(input.definition, input.contact, input.variables, input.receivedEvents);
  }

  async eventTypeDefine(context: OperationContext, input: { workspaceId: string; eventType: string; schema: Record<string, unknown> }) {
    this.workspace(context, input.workspaceId, 'author');
    compileEventSchema(input.eventType, input.schema);
    try {
      const [created] = await this.db.insert(eventTypes).values(input).returning();
      if (!created) throw new Error('Event type creation failed');
      await this.audit(context, 'event_type.define', input.workspaceId, 'event_type', created.id, { eventType: input.eventType });
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new RachetError('EVENT_TYPE_EXISTS', `Event type ${input.eventType} already exists`, 409, false, {
        hint: 'Event types are immutable. Define a new versioned name for a schema change.', details: { eventType: input.eventType },
      });
    }
  }

  async eventTypeList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(eventTypes).where(eq(eventTypes.workspaceId, workspaceId)).orderBy(asc(eventTypes.eventType));
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

  async emailPolicyGet(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    const [policy] = await this.db.select().from(emailPolicies).where(eq(emailPolicies.workspaceId, workspaceId)).limit(1);
    return policy ?? null;
  }

  async emailPolicyUpdate(context: OperationContext, input: { workspaceId: string; senderName: string; supportEmail: string; marketingFromAddress: string }) {
    if (!context.principal.deploymentAdmin && !['owner', 'admin'].includes(context.principal.workspaceRoles[input.workspaceId] ?? '')) {
      throw new RachetError('FORBIDDEN', 'Workspace owner or admin permission required', 403);
    }
    const policy = await this.db.transaction(async (tx) => {
      const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).for('update').limit(1);
      if (!workspace) throw new RachetError('NOT_FOUND', 'Organization not found', 404);
      const [connection] = await tx.select({ fromAddress: resendConnections.fromAddress }).from(resendConnections).where(eq(resendConnections.workspaceId, input.workspaceId)).limit(1);
      if (connection && mailboxAddress(connection.fromAddress) === mailboxAddress(input.marketingFromAddress)) {
        throw new RachetError('VALIDATION_FAILED', 'Marketing and transactional sender addresses must differ', 422);
      }
      const [updated] = await tx.insert(emailPolicies).values(input).onConflictDoUpdate({
        target: emailPolicies.workspaceId,
        set: { senderName: input.senderName, supportEmail: input.supportEmail, marketingFromAddress: input.marketingFromAddress, updatedAt: new Date() },
      }).returning();
      return updated;
    });
    await this.audit(context, 'email_policy.update', input.workspaceId, 'email_policy', input.workspaceId);
    return policy;
  }

  async contactPreferencesGet(context: OperationContext, input: { workspaceId: string; email: string }) {
    this.workspace(context, input.workspaceId);
    const address = emailKey(input.email);
    const [marketing, delivery] = await Promise.all([
      emailEligibility(this.db, input.workspaceId, address, 'marketing'),
      emailEligibility(this.db, input.workspaceId, address, 'transactional'),
    ]);
    return { email: address, marketing, delivery };
  }

  async contactUnsubscribe(context: OperationContext, input: { workspaceId: string; email: string; eventId: string; source: 'support' | 'product' | 'import' }) {
    this.workspace(context, input.workspaceId, 'operate');
    return changePreference(this.db, { workspaceId: input.workspaceId, address: input.email, eventId: input.eventId, source: input.source, actorId: context.principal.userId, action: 'unsubscribe' });
  }

  async contactResubscribe(context: OperationContext, input: { workspaceId: string; email: string; eventId: string; source: 'product' | 'support'; consentReference: string }) {
    this.workspace(context, input.workspaceId, 'author');
    return changePreference(this.db, { workspaceId: input.workspaceId, address: input.email, eventId: input.eventId, source: input.source, actorId: context.principal.userId, action: 'consent', consentReference: input.consentReference });
  }

  async subscriptionEventList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    return this.db.select().from(subscriptionEvents).where(eq(subscriptionEvents.workspaceId, workspaceId)).orderBy(asc(subscriptionEvents.createdAt));
  }

  async enrollmentCreate(context: OperationContext, input: EnrollmentCreateInput) {
    this.workspace(context, input.workspaceId, 'send');
    if (input.consent) {
      this.workspace(context, input.workspaceId, 'author');
      if (!this.hasScope(context, 'rachet:write')) throw new RachetError('FORBIDDEN', 'Missing required scope: rachet:write', 403);
    }
    const [contact, version] = await Promise.all([
      this.db.select({ id: contacts.id, emailKey: contacts.emailKey }).from(contacts)
        .where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, input.workspaceId))).limit(1),
      this.db.select({ id: sequenceVersions.id, definition: sequenceVersions.definition, purposeReviewedAt: sequenceVersions.purposeReviewedAt }).from(sequenceVersions)
        .where(and(eq(sequenceVersions.id, input.workflowVersionId), eq(sequenceVersions.workspaceId, input.workspaceId))).limit(1),
    ]);
    if (!contact[0] || !version[0]) throw new RachetError('NOT_FOUND', 'Contact or workflow version not found in this organization', 404);
    const contactRow = contact[0];
    const versionRow = version[0];
    const id = crypto.randomUUID();
    const workflowId = `workspace/${input.workspaceId}/enrollment/${id}`;
    try {
      const created = await this.db.transaction(async (tx) => {
        // Serialize admission per workspace across API replicas. A single
        // organization must not flood the shared Temporal queue.
        await tx.execute(sql`SELECT id FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE`);
        if (!versionRow.purposeReviewedAt) throw new RachetError('PURPOSE_REVIEW_REQUIRED', 'Republish this workflow after reviewing its email purpose', 422);
        const purpose = versionRow.definition.purpose;
        if (purpose !== 'marketing' && purpose !== 'transactional') throw new RachetError('PURPOSE_REVIEW_REQUIRED', 'Workflow email purpose is missing', 422);
        await lockEmailAddress(tx as unknown as Database, input.workspaceId, contactRow.emailKey);
        const [existing] = await tx.select().from(enrollments).where(and(eq(enrollments.workspaceId, input.workspaceId), eq(enrollments.idempotencyKey, input.idempotencyKey))).limit(1);
        if (existing) {
          await this.assertEnrollmentReplay(tx as unknown as Database, existing, input, contactRow.emailKey);
          return existing;
        }
        if (input.consent) {
          try {
            await recordPreference(tx as unknown as Database, {
              workspaceId: input.workspaceId, address: contactRow.emailKey, eventId: input.consent.eventId,
              source: input.consent.source, actorId: context.principal.userId, action: 'consent', consentReference: input.consent.consentReference,
            });
          } catch (error) {
            if (isUniqueViolation(error)) throw new RachetError('IDEMPOTENCY_CONFLICT', 'Event ID was used for another preference change', 409);
            throw error;
          }
        }
        const eligibility = await emailEligibility(tx as unknown as Database, input.workspaceId, contactRow.emailKey, purpose);
        if (!eligibility.eligible) throw new RachetError('EMAIL_POLICY_BLOCKED', `Enrollment blocked: ${eligibility.reason}`, 422);
        const [recent] = await tx.select({ count: sql<number>`count(*)` }).from(enrollments)
          .where(and(eq(enrollments.workspaceId, input.workspaceId), sql`${enrollments.createdAt} >= now() - interval '1 minute'`));
        if (Number(recent?.count ?? 0) >= 100) throw new RachetError('WORKSPACE_RATE_LIMIT', 'This organization can start at most 100 workflows per minute', 429, true);
        const [active] = await tx.select({ count: sql<number>`count(*)` }).from(enrollments)
          .where(and(eq(enrollments.workspaceId, input.workspaceId), inArray(enrollments.state, ['pending_start', 'running', 'waiting', 'paused', 'needs_attention'])));
        if (Number(active?.count ?? 0) >= 1000) throw new RachetError('WORKSPACE_CAPACITY', 'This organization has reached 1000 active workflows', 429, true);
        const rows = await tx.insert(enrollments).values({ id, workspaceId: input.workspaceId, sequenceVersionId: input.workflowVersionId, contactId: input.contactId, workflowId, input: input.variables, idempotencyKey: input.idempotencyKey }).returning();
        await tx.insert(outbox).values({ kind: 'enrollment.start', aggregateId: id, payload: { enrollmentId: id } });
        await tx.insert(auditEvents).values({
          workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'enrollment.create', targetType: 'enrollment', targetId: id,
          ...(input.consent ? { details: { consentEventId: input.consent.eventId } } : {}),
        });
        return rows[0];
      });
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [existing] = await this.db.select().from(enrollments).where(and(eq(enrollments.workspaceId, input.workspaceId), eq(enrollments.idempotencyKey, input.idempotencyKey))).limit(1);
      if (!existing) throw new RachetError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
      await this.assertEnrollmentReplay(this.db, existing, input, contactRow.emailKey);
      return existing;
    }
  }

  async enrollmentList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    const rows = await this.db.select({
      id: enrollments.id,
      workspaceId: enrollments.workspaceId,
      sequenceVersionId: enrollments.sequenceVersionId,
      contactId: enrollments.contactId,
      state: enrollments.state,
      currentStepId: enrollments.currentStepId,
      workflowId: enrollments.workflowId,
      input: enrollments.input,
      idempotencyKey: enrollments.idempotencyKey,
      createdAt: enrollments.createdAt,
      updatedAt: enrollments.updatedAt,
      contactEmail: contacts.email,
      contactFields: contacts.fields,
      sequenceId: sequenceVersions.sequenceId,
      workflowName: sequences.name,
      workflowVersion: sequenceVersions.version,
      definition: sequenceVersions.definition,
    })
      .from(enrollments)
      .innerJoin(contacts, eq(contacts.id, enrollments.contactId))
      .innerJoin(sequenceVersions, eq(sequenceVersions.id, enrollments.sequenceVersionId))
      .innerJoin(sequences, eq(sequences.id, sequenceVersions.sequenceId))
      .where(eq(enrollments.workspaceId, workspaceId))
      .orderBy(asc(enrollments.createdAt));

    const enrollmentIds = rows.map((row) => row.id);
    const receivedByEnrollment = new Map<string, Array<{
      eventType: string;
      eventId: string;
      receivedAt: string;
      data: Record<string, unknown>;
    }>>();
    if (enrollmentIds.length > 0) {
      const emits = await this.db.select({
        enrollmentId: enrollmentEvents.enrollmentId,
        eventType: enrollmentEvents.eventType,
        eventId: enrollmentEvents.eventId,
        data: enrollmentEvents.data,
        deliveredAt: enrollmentEvents.deliveredAt,
      })
        .from(enrollmentEvents)
        .where(and(
          eq(enrollmentEvents.workspaceId, workspaceId),
          inArray(enrollmentEvents.enrollmentId, enrollmentIds),
        ))
        .orderBy(asc(enrollmentEvents.createdAt));
      for (const emit of emits) {
        if (!emit.deliveredAt) continue;
        const list = receivedByEnrollment.get(emit.enrollmentId) ?? [];
        list.push({
          eventType: emit.eventType,
          eventId: emit.eventId,
          receivedAt: emit.deliveredAt.toISOString(),
          data: emit.data,
        });
        receivedByEnrollment.set(emit.enrollmentId, list);
      }
    }

    return rows.map((row) => ({
      ...row,
      receivedEvents: receivedByEnrollment.get(row.id) ?? [],
    }));
  }

  async enrollmentControl(context: OperationContext, input: { workspaceId: string; enrollmentId: string }, action: 'pause' | 'resume' | 'cancel') {
    this.workspace(context, input.workspaceId, 'operate');
    const [row] = await this.db.select().from(enrollments).where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
    if (!row) throw new RachetError('NOT_FOUND', 'Enrollment not found', 404);
    if (!['pending_start', 'running', 'waiting', 'paused', 'needs_attention'].includes(row.state)) {
      throw new RachetError('ENROLLMENT_NOT_RUNNING', 'Enrollment is no longer active', 409);
    }
    if (action === 'resume' && row.state !== 'paused') {
      throw new RachetError('ENROLLMENT_NOT_PAUSED', 'Enrollment is not paused', 409);
    }
    try {
      await this.withEnrollmentExecution(row, (handle) =>
        handle.signal(action === 'pause' ? pauseEnrollment : action === 'resume' ? resumeEnrollment : cancelEnrollment),
      );
    } catch (error) {
      if (!(error instanceof RachetError && error.code === 'ENROLLMENT_NOT_RUNNING') || action !== 'cancel') throw error;
      // Temporal has no execution for this enrollment (e.g. a dev Temporal reset while
      // Postgres kept data). The guarded update below reconciles the row.
    }
    const activeStates = ['pending_start', 'running', 'waiting', 'paused', 'needs_attention'] as const;
    const [updated] = await this.db.update(enrollments).set({
      state: action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running',
      updatedAt: new Date(),
    }).where(and(
      eq(enrollments.id, row.id), eq(enrollments.workspaceId, input.workspaceId),
      action === 'resume' ? eq(enrollments.state, 'paused') : inArray(enrollments.state, activeStates),
    )).returning({ id: enrollments.id });
    if (!updated) {
      const [current] = await this.db.select({ state: enrollments.state }).from(enrollments)
        .where(and(eq(enrollments.id, row.id), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
      const requestedState = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running';
      if (current?.state !== requestedState) throw new RachetError('ENROLLMENT_NOT_RUNNING', 'Enrollment stopped while the control request was in progress', 409);
    }
    await this.audit(context, `enrollment.${action}`, input.workspaceId, 'enrollment', row.id);
    return { id: row.id, control: action, status: 'requested' };
  }

  async enrollmentDelete(context: OperationContext, input: { workspaceId: string; enrollmentId: string }) {
    this.workspace(context, input.workspaceId, 'operate');
    const [row] = await this.db.select().from(enrollments)
      .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
    if (!row) throw new RachetError('NOT_FOUND', 'Enrollment not found', 404);
    if (['pending_start', 'running', 'waiting', 'paused', 'needs_attention'].includes(row.state)) {
      try {
        await this.temporal.workflow.getHandle(row.workflowId).terminate('Enrollment deleted from Rachet');
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error;
      }
    }
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select({ id: enrollments.id }).from(enrollments)
        .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).for('update').limit(1);
      if (!current) throw new RachetError('NOT_FOUND', 'Enrollment not found', 404);
      await this.deleteEnrollmentRecords(tx, input.workspaceId, [current.id]);
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorId: context.principal.userId, action: 'enrollment.delete', targetType: 'enrollment', targetId: current.id });
      return { id: current.id, deleted: true };
    });
  }

  private async deleteEnrollmentRecords(tx: Pick<Database, 'select' | 'delete'>, workspaceId: string, enrollmentIds: string[]) {
    if (enrollmentIds.length === 0) return;
    const events = await tx.select({ id: enrollmentEvents.id }).from(enrollmentEvents)
      .where(and(eq(enrollmentEvents.workspaceId, workspaceId), inArray(enrollmentEvents.enrollmentId, enrollmentIds)));
    const aggregateIds = [...enrollmentIds, ...events.map((event) => event.id)];
    await tx.delete(outbox).where(inArray(outbox.aggregateId, aggregateIds));
    await tx.delete(sendIntents).where(and(eq(sendIntents.workspaceId, workspaceId), inArray(sendIntents.enrollmentId, enrollmentIds)));
    await tx.delete(enrollments).where(and(eq(enrollments.workspaceId, workspaceId), inArray(enrollments.id, enrollmentIds)));
  }

  /** Run against an enrollment execution, mapping a missing Temporal workflow to a clean conflict. */
  private async withEnrollmentExecution<T>(
    row: typeof enrollments.$inferSelect,
    run: (handle: ReturnType<Client['workflow']['getHandle']>) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(this.temporal.workflow.getHandle(row.workflowId));
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        throw new RachetError(
          'ENROLLMENT_NOT_RUNNING',
          `Temporal has no execution for enrollment ${row.id}; its database state is stale.`,
          409,
          false,
          { hint: 'This happens when the Temporal server was reset while Postgres kept its data. Cancel the enrollment row or re-enroll the contact.' },
        );
      }
      throw error;
    }
  }

  async eventEmit(context: OperationContext, input: { workspaceId: string; enrollmentId: string; eventId: string; eventType: string; data: Record<string, unknown> }) {
    this.workspace(context, input.workspaceId, 'operate');
    const [row] = await this.db.select().from(enrollments).where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.workspaceId, input.workspaceId))).limit(1);
    if (!row) throw new RachetError('NOT_FOUND', 'Enrollment not found', 404);
    const payloadHash = stableHash({ eventType: input.eventType, data: input.data });
    const [existing] = await this.db.select().from(enrollmentEvents).where(and(
      eq(enrollmentEvents.enrollmentId, row.id),
      eq(enrollmentEvents.eventId, input.eventId),
    )).limit(1);
    if (existing) {
      const existingHash = stableHash({ eventType: existing.eventType, data: existing.data });
      if (existingHash !== payloadHash) {
        throw new RachetError('IDEMPOTENCY_CONFLICT', 'Event ID was already used with a different event type or payload', 409);
      }
      return {
        accepted: false,
        eventId: input.eventId,
        duplicate: true,
        delivery: existing.deliveredAt ? 'delivered' : 'queued',
      };
    }
    await this.assertEventData(input.workspaceId, input.eventType, input.data);
    if (!['pending_start', 'running', 'waiting', 'paused', 'needs_attention'].includes(row.state)) {
      throw new RachetError('ENROLLMENT_NOT_RUNNING', `Enrollment ${row.id} is ${row.state} and cannot accept events.`, 409);
    }

    const created = await this.db.transaction(async (tx) => {
      const [receipt] = await tx.insert(enrollmentEvents).values({
        workspaceId: input.workspaceId,
        enrollmentId: row.id,
        eventId: input.eventId,
        eventType: input.eventType,
        data: input.data,
        payloadHash,
      }).onConflictDoNothing().returning();
      if (!receipt) return null;
      await tx.insert(outbox).values({
        kind: 'enrollment.event',
        aggregateId: receipt.id,
        payload: { enrollmentEventId: receipt.id },
      });
      await tx.insert(auditEvents).values({
        workspaceId: input.workspaceId,
        actorId: context.principal.userId,
        action: 'event.emit',
        targetType: 'enrollment',
        targetId: row.id,
        details: { eventType: input.eventType, eventId: input.eventId, data: input.data },
      });
      return receipt;
    });

    const [receipt] = created ? [created] : await this.db.select().from(enrollmentEvents).where(and(
      eq(enrollmentEvents.enrollmentId, row.id),
      eq(enrollmentEvents.eventId, input.eventId),
    )).limit(1);
    if (!receipt) throw new Error('Event receipt disappeared after insert conflict');
    const existingHash = stableHash({ eventType: receipt.eventType, data: receipt.data });
    if (existingHash !== payloadHash) {
      throw new RachetError('IDEMPOTENCY_CONFLICT', 'Event ID was already used with a different event type or payload', 409);
    }

    let deliveredAt = receipt.deliveredAt;
    if (!deliveredAt) {
      try {
        await this.withEnrollmentExecution(row, (handle) =>
          handle.signal(enrollmentEvent, input.eventType, input.eventId, input.data),
        );
        const deliveryTime = new Date();
        deliveredAt = deliveryTime;
        await this.db.transaction(async (tx) => {
          await tx.update(enrollmentEvents).set({ deliveredAt: deliveryTime, updatedAt: deliveryTime }).where(eq(enrollmentEvents.id, receipt.id));
          await tx.update(outbox).set({ completedAt: deliveryTime, claimedUntil: null, lastError: null }).where(and(
            eq(outbox.kind, 'enrollment.event'),
            eq(outbox.aggregateId, receipt.id),
          ));
        });
      } catch (error) {
        if (error instanceof RachetError && error.code === 'ENROLLMENT_NOT_RUNNING') throw error;
        // The receipt and outbox job are durable. The dispatcher will retry a
        // transient Temporal failure, and the workflow deduplicates by eventId.
      }
    }

    return {
      accepted: created !== null,
      eventId: input.eventId,
      duplicate: created === null,
      delivery: deliveredAt ? 'delivered' : 'queued',
    };
  }

  async messageList(context: OperationContext, workspaceId: string) {
    this.workspace(context, workspaceId);
    const rows = await this.db.select().from(sendIntents).where(eq(sendIntents.workspaceId, workspaceId)).orderBy(asc(sendIntents.createdAt));
    const redact = (content: string) => content.replace(/https?:\/\/[^\s"'<>]+\/unsubscribe\/[A-Za-z0-9._-]+/g, 'https://example.invalid/unsubscribe-preview');
    return rows.map((row) => ({ ...row, html: redact(row.html), plainText: redact(row.plainText), headers: {} }));
  }

  async webhookEventList(context: OperationContext) {
    if (!context.principal.deploymentAdmin) throw new RachetError('FORBIDDEN', 'Deployment administrator required', 403);
    return this.db.select().from(webhookEvents).orderBy(asc(webhookEvents.createdAt));
  }

  async accountList(context: OperationContext) {
    if (!context.principal.deploymentAdmin) throw new RachetError('FORBIDDEN', 'Deployment administrator required', 403);
    const result = await this.db.execute<{
      id: string;
      name: string;
      email: string;
      createdAt: Date | string;
      disabled: boolean;
      workflowCount: number;
      enrolledCount: number;
      organizations: Array<{ id: string; name: string }> | string;
    }>(sql`
      select
        u.id,
        u.name,
        u.email,
        u."createdAt" as "createdAt",
        coalesce(p.disabled, false) as disabled,
        coalesce(stats.workflow_count, 0)::int as "workflowCount",
        coalesce(stats.enrolled_count, 0)::int as "enrolledCount",
        coalesce(stats.organizations, '[]'::jsonb) as organizations
      from "user" u
      left join profiles p on p.user_id = u.id
      left join lateral (
        select
          count(distinct s.id)::int as workflow_count,
          count(distinct e.contact_id)::int as enrolled_count,
          coalesce(
            jsonb_agg(distinct jsonb_build_object('id', w.id, 'name', w.name)) filter (where w.id is not null),
            '[]'::jsonb
          ) as organizations
        from memberships m
        join workspaces w on w.id = m.workspace_id
        left join sequences s on s.workspace_id = w.id
        left join enrollments e on e.workspace_id = w.id
        where m.user_id = u.id
      ) stats on true
      order by u."createdAt" asc
    `);
    return result.rows.map((row) => {
      const organizations = typeof row.organizations === 'string'
        ? JSON.parse(row.organizations) as Array<{ id: string; name: string }>
        : row.organizations;
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
        disabled: row.disabled,
        workflowCount: Number(row.workflowCount),
        enrolledCount: Number(row.enrolledCount),
        organizations: [...organizations].sort((left, right) => left.name.localeCompare(right.name)),
      };
    });
  }
}
