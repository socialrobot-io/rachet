import { z } from 'zod';
import {
  accountCreateSchema, credentialCreateSchema, credentialListSchema, credentialRevokeSchema, contactUpsertSchema, enrollmentControlSchema, enrollmentCreateSchema,
  eventEmitSchema, eventTypeDefineSchema, workflowCreateSchema, workflowDeleteSchema, workflowPublishSchema, workflowSimulateSchema, workflowDefinitionSchema, templateCreateSchema,
  templateArchiveSchema, templatePublishSchema, templateReviseSchema, templateRenderSchema, workspaceIdSchema,
  enrollmentDeleteSchema,
  type OperationContext,
} from '@reflow/contracts';
import type { ReflowService } from './domain/service.js';
import { actionCatalog } from './domain/action-catalog.js';
import { ReflowError } from './domain/errors.js';

type AnySchema = z.ZodType<Record<string, unknown>>;
export type Operation = {
  description: string;
  input: AnySchema;
  readOnly: boolean;
  exposeToMcp?: boolean;
  requiredScope?: 'rachet:read' | 'rachet:write' | 'rachet:send';
  invoke: (context: OperationContext, input: Record<string, unknown>) => Promise<unknown>;
};

export function authorizeOperation(operation: Operation, context: OperationContext): void {
  const required = operation.requiredScope ?? (operation.readOnly ? 'rachet:read' : 'rachet:write');
  if (!context.principal.scopes.includes(required)) throw new ReflowError('FORBIDDEN', `Missing required scope: ${required}`, 403);
}

const workspaceOnly = z.object({ workspaceId: workspaceIdSchema });

export function createOperations(service: ReflowService): Record<string, Operation> {
  return {
    'system.capabilities': {
      description: 'Describe the implemented Rachet operations and runtime capabilities.', input: z.object({}), readOnly: true,
      invoke: async () => ({
        version: '0.1.0',
        emailProvider: 'resend',
        durableExecution: 'temporal',
        templateRenderer: 'react-email',
        workflowModel: 'validated-capability-graph',
        actions: actionCatalog,
        operations: Object.keys(createOperations(service)).filter((name) => name !== 'credential.create'),
        agentCookbook: {
          beforeAuthoring: [
            'Follow skill://reflow/SKILL.md. Use MCP. Do not use the CLI or write template files.',
            'Call auth.whoami, then template.list and workflow.list. Reuse a live template. Skip archived templates.',
            'Include only emails, waits, and branches the user named. Do not add contact.update unless they asked to store a contact field. contact.update merges contact fields. It does not change the email.',
            'Do not insert an extra wait. timeoutSeconds is elapsed seconds. Two days is 172800.',
            'Before new HTML, read one existing template from template.list and any design notes the project already has. Do not assume a file path. Match that look. Then template.create with HTML (sourceKind=html) plus a plain-text body. Do not upload .tsx. TEMPLATE_NAME_EXISTS means template.revise then template.publish. Do not create a v2 name.',
          ],
          simulate: [
            'workflow.validate, then workflow.simulate twice: receivedEvents=[] and with the activation event. Fix errors before workflow.create.',
            'receivedEvents is a set for the whole trace. It cannot show a timeout followed by the same event on a later wait.',
          ],
          sideEffects: [
            'After workflow.create, ask whether to connect the workflow to the app. If yes, workflow.publish, then wire enrollment.create where the journey should start and event.emit for each waited event. If no, leave the draft and warn that waited events must be emitted manually. workflow.publish does not send mail. enrollment.create can.',
            'Keep idempotencyKey stable across retries. event.emit needs enrollmentId and a stable eventId.',
          ],
        },
      }),
    },
    'auth.whoami': {
      description: 'Return the authenticated principal and workspace access.', input: z.object({}), readOnly: true,
      invoke: async (context) => context.principal,
    },
    'workspace.list': {
      description: 'List workspaces available to the authenticated principal, including names, slugs, and roles.', input: z.object({}), readOnly: true,
      invoke: (context) => service.workspaceList(context),
    },
    'account.create': {
      description: 'Authorize a passwordless account registration as a deployment administrator.', input: accountCreateSchema, readOnly: false,
      invoke: (context, input) => service.accountCreate(context, accountCreateSchema.parse(input)),
    },
    'credential.create': {
      description: 'Create an organization-bound SDK API key for the authenticated user. The secret is returned once.', input: credentialCreateSchema, readOnly: false,
      exposeToMcp: false,
      invoke: (context, input) => service.credentialCreate(context, credentialCreateSchema.parse(input)),
    },
    'credential.list': {
      description: 'List the authenticated user’s SDK API keys without returning secrets.', input: credentialListSchema, readOnly: true,
      invoke: (context, input) => service.credentialList(context, credentialListSchema.parse(input)),
    },
    'credential.revoke': {
      description: 'Revoke one of the authenticated user’s organization-bound SDK API keys.', input: credentialRevokeSchema, readOnly: false,
      invoke: (context, input) => service.credentialRevoke(context, credentialRevokeSchema.parse(input)),
    },
    'template.create': {
      description: 'Create a template draft from HTML (sourceKind=html, with a plain-text body) or plain text. Subject, preheader, html, and body use {{contact.*}} and {{variables.*}} placeholders. Do not upload .tsx. Fails with TEMPLATE_NAME_EXISTS when the name is taken; use template.revise.', input: templateCreateSchema, readOnly: false,
      invoke: (context, input) => service.templateCreate(context, templateCreateSchema.parse(input)),
    },
    'template.list': {
      description: 'List templates in a workspace, including published version ids for email.send pins.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.templateList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'template.revise': {
      description: 'Update draft HTML or plain text for an existing template (optimistic lock via expectedRevision). Call template.publish afterward for a new immutable version.', input: templateReviseSchema, readOnly: false,
      invoke: (context, input) => service.templateRevise(context, templateReviseSchema.parse(input)),
    },
    'template.publish': {
      description: 'Publish an immutable template version. Use the returned id as email.send input.templateVersionId.literal.', input: templatePublishSchema, readOnly: false,
      invoke: (context, input) => service.templatePublish(context, templatePublishSchema.parse(input)),
    },
    'template.archive': {
      description: 'Archive a template that is not referenced by any workflow draft or published workflow version. Fails with TEMPLATE_IN_USE and a hint when still referenced.', input: templateArchiveSchema, readOnly: false,
      invoke: (context, input) => service.templateArchive(context, templateArchiveSchema.parse(input)),
    },
    'template.render': {
      description: 'Render an immutable template without sending. Useful to preview HTML before enrollment.', input: templateRenderSchema, readOnly: true,
      invoke: (context, input) => service.templateRender(context, templateRenderSchema.parse(input)),
    },
    'workflow.actions': {
      description: 'List installed workflow action capabilities and their required inputs.', input: z.object({}), readOnly: true,
      invoke: async () => actionCatalog,
    },
    'workflow.create': {
      description: 'Create a workflow draft from an agent-authored, validated capability graph and preserve the natural-language intent.', input: workflowCreateSchema, readOnly: false,
      invoke: (context, input) => service.workflowCreate(context, workflowCreateSchema.parse(input)),
    },
    'workflow.list': {
      description: 'List workflow drafts and publication state, including published version ids.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.workflowList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'workflow.validate': {
      description: 'Validate a proposed workflow graph, installed actions, and email.send template pins. Fails with TEMPLATE_REFERENCE_INVALID (and a hint) when a node points at a missing template version.', input: z.object({ workspaceId: workspaceIdSchema, definition: workflowDefinitionSchema }), readOnly: true,
      invoke: async (context, input) => service.workflowValidate(context, z.object({ workspaceId: workspaceIdSchema, definition: workflowDefinitionSchema }).parse(input)),
    },
    'workflow.simulate': {
      description: 'Trace a workflow with sample data without waiting or performing side effects.', input: workflowSimulateSchema, readOnly: true,
      invoke: async (context, input) => service.workflowSimulate(context, workflowSimulateSchema.parse(input)),
    },
    'workflow.publish': {
      description: 'Publish an immutable workflow version after resolving installed actions and templates. Fails with TEMPLATE_REFERENCE_INVALID when email.send pins are missing.', input: workflowPublishSchema, readOnly: false,
      invoke: (context, input) => service.workflowPublish(context, workflowPublishSchema.parse(input)),
    },
    'workflow.delete': {
      description: 'Permanently delete a workflow, all published versions, and completed enrollment history. Before calling, ask the user to confirm the exact workflow. Set dangerouslyDeleteWorkflow to true. Fails with WORKFLOW_HAS_ACTIVE_ENROLLMENTS when people are still in progress.', input: workflowDeleteSchema, readOnly: false,
      invoke: (context, input) => service.workflowDelete(context, workflowDeleteSchema.parse(input)),
    },
    'contact.upsert': {
      description: 'Create or update a contact by normalized email.', input: contactUpsertSchema, readOnly: false,
      invoke: (context, input) => service.contactUpsert(context, contactUpsertSchema.parse(input)),
    },
    'contact.list': {
      description: 'List contacts in a workspace.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.contactList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'enrollment.create': {
      description: 'Durably enroll a contact into a published workflow. This can perform side effects.', input: enrollmentCreateSchema, readOnly: false,
      requiredScope: 'rachet:send',
      invoke: (context, input) => service.enrollmentCreate(context, enrollmentCreateSchema.parse(input)),
    },
    'enrollment.list': {
      description: 'List durable workflow enrollments with contact email, workflow name/version, and the published definition used for that enrollment.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.enrollmentList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'enrollment.pause': {
      description: 'Request pause before the next email dispatch.', input: enrollmentControlSchema, readOnly: false,
      invoke: (context, input) => service.enrollmentControl(context, enrollmentControlSchema.parse(input), 'pause'),
    },
    'enrollment.resume': {
      description: 'Resume a paused enrollment.', input: enrollmentControlSchema, readOnly: false,
      invoke: (context, input) => service.enrollmentControl(context, enrollmentControlSchema.parse(input), 'resume'),
    },
    'enrollment.cancel': {
      description: 'Cancel an enrollment; an already admitted email cannot be recalled.', input: enrollmentControlSchema, readOnly: false,
      invoke: (context, input) => service.enrollmentControl(context, enrollmentControlSchema.parse(input), 'cancel'),
    },
    'enrollment.delete': {
      description: 'Permanently delete one enrollment and its event, send, and queued-job records. Before calling, ask the user to confirm the exact enrollment. An active Temporal execution is terminated first; an accepted email cannot be recalled.', input: enrollmentDeleteSchema, readOnly: false,
      invoke: (context, input) => service.enrollmentDelete(context, enrollmentDeleteSchema.parse(input)),
    },
    'event_type.define': {
      description: 'Define an immutable JSON Schema for one workspace event type. Use a new versioned event name for any schema change.', input: eventTypeDefineSchema, readOnly: false,
      invoke: (context, input) => service.eventTypeDefine(context, eventTypeDefineSchema.parse(input)),
    },
    'event_type.list': {
      description: 'List the immutable event types and JSON Schemas registered in a workspace.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.eventTypeList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'event.emit': {
      description: 'Durably emit an idempotently named domain event into an enrollment. Returns whether it was newly accepted or an existing duplicate, and whether Temporal delivery is complete or queued.', input: eventEmitSchema, readOnly: false,
      requiredScope: 'rachet:send',
      invoke: (context, input) => service.eventEmit(context, eventEmitSchema.parse(input)),
    },
    'message.list': {
      description: 'List message submission and delivery state.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.messageList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'webhook_event.list': {
      description: 'List verified Resend webhook events as a deployment administrator.', input: z.object({}), readOnly: true,
      invoke: (context) => service.webhookEventList(context),
    },
  };
}
