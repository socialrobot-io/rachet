import { z } from 'zod';
import {
  accountCreateSchema, credentialCreateSchema, credentialRevokeSchema, contactUpsertSchema, enrollmentControlSchema, enrollmentCreateSchema,
  eventEmitSchema, workflowCreateSchema, workflowPublishSchema, workflowSimulateSchema, workflowDefinitionSchema, templateCreateSchema,
  templateArchiveSchema, templatePublishSchema, templateReviseSchema, templateRenderSchema, workspaceIdSchema,
  type OperationContext,
} from './domain/contracts.js';
import type { ReflowService } from './domain/service.js';
import { actionCatalog } from './domain/action-catalog.js';
import { ReflowError } from './domain/errors.js';

type AnySchema = z.ZodType<Record<string, unknown>>;
export type Operation = {
  description: string;
  input: AnySchema;
  readOnly: boolean;
  requiredScope?: 'reflow:read' | 'reflow:write' | 'reflow:send';
  invoke: (context: OperationContext, input: Record<string, unknown>) => Promise<unknown>;
};

export function authorizeOperation(operation: Operation, context: OperationContext): void {
  const required = operation.requiredScope ?? (operation.readOnly ? 'reflow:read' : 'reflow:write');
  if (!context.principal.scopes.includes(required)) throw new ReflowError('FORBIDDEN', `Missing required scope: ${required}`, 403);
}

const workspaceOnly = z.object({ workspaceId: workspaceIdSchema });

export function createOperations(service: ReflowService): Record<string, Operation> {
  return {
    'system.capabilities': {
      description: 'Describe the implemented Reflow operations and runtime capabilities.', input: z.object({}), readOnly: true,
      invoke: async () => ({
        version: '0.1.0',
        emailProvider: 'resend',
        durableExecution: 'temporal',
        templateRenderer: 'react-email',
        workflowModel: 'validated-capability-graph',
        actions: actionCatalog,
        operations: Object.keys(createOperations(service)),
        agentCookbook: {
          beforeAuthoring: [
            'Call template.list and workflow.list in the target workspace; reuse before inventing.',
            'Check examples/ (welcome-nudge, socialrobot-onboarding*.workflow.json) for graph patterns.',
            'Prefer `reflow template push` for React Email; it upserts by --name (revise + publish).',
          ],
          simulate: [
            'Always simulate at least two paths: no events (timeout/false branches) and with key activation events received.',
            'Use a fast-test twin (seconds, not days) when validating long delay sequences live.',
          ],
          sideEffects: [
            'workflow.publish does not enroll. enrollment.create sends mail.',
            'Keep idempotencyKey stable across retries (welcome-first-week-<userId>).',
            'event.emit needs enrollmentId + stable eventId; product hooks must signal the enrollment.',
          ],
          eventVocabularyHint: [
            'Prefer dotted product events: social.account_connected, social.post_scheduled, social.posts_queued.',
            'Align names with the product analytics vocabulary when wiring hooks.',
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
      description: 'Create an account as a deployment administrator.', input: accountCreateSchema, readOnly: false,
      invoke: (context, input) => service.accountCreate(context, accountCreateSchema.parse(input)),
    },
    'credential.create': {
      description: 'Create a user-bound machine API key as a deployment administrator. The secret is returned once.', input: credentialCreateSchema, readOnly: false,
      invoke: (context, input) => service.credentialCreate(context, credentialCreateSchema.parse(input)),
    },
    'credential.revoke': {
      description: 'Revoke a machine API key as a deployment administrator.', input: credentialRevokeSchema, readOnly: false,
      invoke: (context, input) => service.credentialRevoke(context, credentialRevokeSchema.parse(input)),
    },
    'template.create': {
      description: 'Create a template draft. Prefer sourceKind=html with pre-rendered html + plain-text body (CLI: `reflow template push` renders React Email locally). Subject/preheader/html/body use {{contact.*}} / {{variables.*}} placeholders. The server never executes TSX. Fails with TEMPLATE_NAME_EXISTS when the name is taken; use template.revise or `reflow template push` (upserts by name).', input: templateCreateSchema, readOnly: false,
      invoke: (context, input) => service.templateCreate(context, templateCreateSchema.parse(input)),
    },
    'template.list': {
      description: 'List templates in a workspace, including published version ids for email.send pins.', input: workspaceOnly, readOnly: true,
      invoke: (context, input) => service.templateList(context, workspaceIdSchema.parse(input.workspaceId)),
    },
    'template.revise': {
      description: 'Update draft content for an existing template (optimistic lock via expectedRevision). Call template.publish afterward for a new immutable version. Prefer `reflow template push --name` which revise+publish by name.', input: templateReviseSchema, readOnly: false,
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
      description: 'List workflow drafts and publication state.', input: workspaceOnly, readOnly: true,
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
      requiredScope: 'reflow:send',
      invoke: (context, input) => service.enrollmentCreate(context, enrollmentCreateSchema.parse(input)),
    },
    'enrollment.list': {
      description: 'List durable workflow enrollments.', input: workspaceOnly, readOnly: true,
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
    'event.emit': {
      description: 'Emit an idempotently named domain event into an enrollment.', input: eventEmitSchema, readOnly: false,
      requiredScope: 'reflow:send',
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
