import { z } from 'zod';

export const workspaceIdSchema = z.uuid();
export const accountCreateSchema = z.object({ email: z.email(), name: z.string().min(1).max(120), password: z.string().min(12).max(200), deploymentAdmin: z.boolean().default(false), workspaceId: z.uuid().optional(), role: z.enum(['owner', 'admin', 'author', 'sender', 'operator', 'viewer']).default('viewer') });
export const credentialCreateSchema = z.object({ userId: z.string().min(1), name: z.string().min(1).max(120), scopes: z.array(z.enum(['read', 'write', 'send'])).min(1).default(['read']), expiresInSeconds: z.number().int().min(60).max(365 * 24 * 60 * 60).optional() });
export const credentialRevokeSchema = z.object({ keyId: z.string().min(1) });
export const templateCreateSchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(998),
  preheader: z.string().max(500).optional(),
  /** Plain-text body (always stored; used as the text/plain part). */
  body: z.string().max(200_000).optional(),
  /** Pre-rendered HTML with {{contact.*}} / {{variables.*}} placeholders. Prefer this over plain. */
  html: z.string().max(500_000).optional(),
  sourceKind: z.enum(['plain', 'html']).default('plain'),
  /** Optional authoring source for provenance only. Never executed by the server. */
  tsxSource: z.string().max(200_000).optional(),
  propsSchema: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
  if (value.sourceKind === 'html') {
    if (!value.html?.trim()) context.addIssue({ code: 'custom', message: 'html is required for html templates', path: ['html'] });
    if (!value.body?.trim()) context.addIssue({ code: 'custom', message: 'body (plain text) is required for html templates', path: ['body'] });
  } else if (!value.body?.trim()) {
    context.addIssue({ code: 'custom', message: 'body is required for plain templates', path: ['body'] });
  }
});
export const templatePublishSchema = z.object({ workspaceId: workspaceIdSchema, templateId: z.uuid(), expectedRevision: z.number().int().positive() });
export const templateArchiveSchema = z.object({ workspaceId: workspaceIdSchema, templateId: z.uuid() });
export const templateRenderSchema = z.object({ workspaceId: workspaceIdSchema, templateVersionId: z.uuid(), props: z.record(z.string(), z.unknown()).default({}) });

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('event'), eventType: z.string().min(1).max(120) }),
  z.object({ type: z.literal('schedule'), at: z.iso.datetime({ offset: true }) }),
]);
const literalValue = z.json();
export const valueSourceSchema = z.union([
  z.object({ literal: literalValue }),
  z.object({ path: z.string().regex(/^(contact|variables|event)\.[A-Za-z0-9_.-]+$/), default: literalValue.optional() }),
]);
export type ValueSource = z.infer<typeof valueSourceSchema>;
export const conditionSchema = z.union([
  z.object({ op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']), left: valueSourceSchema, right: valueSourceSchema }),
  z.object({ op: z.literal('exists'), value: valueSourceSchema }),
  z.object({ op: z.literal('event_received'), eventType: z.string().min(1).max(120) }),
]);
export type FlowCondition = z.infer<typeof conditionSchema>;

export const flowNodeSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).max(100), type: z.literal('action'), action: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/), input: z.record(z.string(), valueSourceSchema).default({}), next: z.string().min(1), onError: z.enum(['fail', 'attention', 'continue']).default('fail') }),
  z.object({ id: z.string().min(1).max(100), type: z.literal('delay'), durationSeconds: z.number().int().min(1).max(180 * 24 * 60 * 60), next: z.string().min(1) }),
  z.object({ id: z.string().min(1).max(100), type: z.literal('wait_for_event'), eventType: z.string().min(1).max(120), timeoutSeconds: z.number().int().min(1).max(180 * 24 * 60 * 60), onEvent: z.string().min(1), onTimeout: z.string().min(1) }),
  z.object({ id: z.string().min(1).max(100), type: z.literal('branch'), condition: conditionSchema, onTrue: z.string().min(1), onFalse: z.string().min(1) }),
  z.object({ id: z.string().min(1).max(100), type: z.literal('end'), reason: z.string().min(1).max(120) }),
]);
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const workflowDefinitionSchema = z.object({
  schemaVersion: z.literal('1'), description: z.string().min(1).max(2000), trigger: triggerSchema,
  entryNodeId: z.string().min(1), purpose: z.enum(['transactional', 'marketing']).default('transactional'),
  topic: z.string().min(1).default('transactional'), nodes: z.array(flowNodeSchema).min(1).max(100),
}).superRefine((definition, context) => {
  const ids = new Set<string>();
  for (const node of definition.nodes) { if (ids.has(node.id)) context.addIssue({ code: 'custom', message: `Duplicate node: ${node.id}` }); ids.add(node.id); }
  if (!ids.has(definition.entryNodeId)) context.addIssue({ code: 'custom', message: 'Entry node does not exist' });
  const edges = new Map<string, string[]>();
  for (const node of definition.nodes) {
    const targets = node.type === 'action' || node.type === 'delay' ? [node.next] : node.type === 'wait_for_event' ? [node.onEvent, node.onTimeout] : node.type === 'branch' ? [node.onTrue, node.onFalse] : [];
    edges.set(node.id, targets);
    for (const target of targets) if (!ids.has(target)) context.addIssue({ code: 'custom', message: `Missing target ${target}` });
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(id: string) { if (visiting.has(id)) { context.addIssue({ code: 'custom', message: `Cycle at ${id}; use bounded actions instead` }); return; } if (visited.has(id) || !ids.has(id)) return; visiting.add(id); for (const target of edges.get(id) ?? []) visit(target); visiting.delete(id); visited.add(id); }
  visit(definition.entryNodeId);
  for (const id of ids) if (!visited.has(id)) context.addIssue({ code: 'custom', message: `Unreachable node ${id}` });
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowCreateSchema = z.object({ workspaceId: workspaceIdSchema, name: z.string().min(1).max(120), intent: z.string().min(1).max(5000), definition: workflowDefinitionSchema });
export const workflowPublishSchema = z.object({ workspaceId: workspaceIdSchema, workflowId: z.uuid(), expectedRevision: z.number().int().positive() });
export const workflowSimulateSchema = z.object({ workspaceId: workspaceIdSchema, definition: workflowDefinitionSchema, contact: z.record(z.string(), z.unknown()).default({}), variables: z.record(z.string(), z.unknown()).default({}), receivedEvents: z.array(z.string()).default([]) });
export const contactUpsertSchema = z.object({ workspaceId: workspaceIdSchema, externalId: z.string().min(1).max(200).optional(), email: z.email(), timezone: z.string().max(100).optional(), fields: z.record(z.string(), z.unknown()).default({}) });
export const enrollmentCreateSchema = z.object({ workspaceId: workspaceIdSchema, workflowVersionId: z.uuid(), contactId: z.uuid(), variables: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(1).max(200) });
export const enrollmentControlSchema = z.object({ workspaceId: workspaceIdSchema, enrollmentId: z.uuid() });
export const eventEmitSchema = z.object({ workspaceId: workspaceIdSchema, enrollmentId: z.uuid(), eventId: z.string().min(1).max(200), eventType: z.string().min(1).max(120), data: z.record(z.string(), z.unknown()).default({}) });
export type Principal = { userId: string; workspaceIds: string[]; workspaceRoles: Record<string, 'owner' | 'admin' | 'author' | 'sender' | 'operator' | 'viewer'>; deploymentAdmin: boolean; scopes: string[] };
export type OperationContext = { principal: Principal; requestId: string };
