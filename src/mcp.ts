import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authorizeOperation, type Operation } from './operations.js';
import type { OperationContext } from './domain/contracts.js';
import { ReflowError, errorPayload } from './domain/errors.js';
import { z } from 'zod';
import { workflowDefinitionSchema } from './domain/contracts.js';
import { actionCatalog } from './domain/action-catalog.js';

export function createMcpServer(operations: Record<string, Operation>, context: OperationContext) {
  const server = new McpServer({ name: 'reflow', version: '0.1.0' });
  for (const [name, operation] of Object.entries(operations)) {
    server.registerTool(name.replaceAll('.', '_'), {
      description: operation.description,
      inputSchema: operation.input,
      annotations: {
        readOnlyHint: operation.readOnly,
        destructiveHint: name.includes('cancel') || name.includes('disable'),
        idempotentHint: operation.readOnly || name.endsWith('.create') || name === 'event.emit',
      },
    }, async (input) => {
      try {
        authorizeOperation(operation, context);
        const data = await operation.invoke(context, input as Record<string, unknown>);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'succeeded', data, requestId: context.requestId }) }], structuredContent: { status: 'succeeded', data, requestId: context.requestId } };
      } catch (error) {
        const detail = error instanceof ReflowError
          ? errorPayload(error)
          : { code: 'INTERNAL', message: 'Operation failed', retryable: false };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(detail) }], structuredContent: detail };
      }
    });
  }
  server.registerResource('operation-catalog', 'reflow://operations', { mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, { description: operation.description, readOnly: operation.readOnly }]))) }],
  }));
  server.registerResource('workflow-schema', 'reflow://workflow/schema', { mimeType: 'application/schema+json', description: 'The complete validated graph schema used to author durable workflows.' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(workflowDefinitionSchema.toJSONSchema()) }],
  }));
  server.registerResource('workflow-actions', 'reflow://workflow/actions', { mimeType: 'application/json', description: 'Installed action capabilities available to authored workflows.' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(actionCatalog) }],
  }));
  server.registerPrompt('design-workflow', {
    title: 'Design a Reflow workflow',
    description: 'Turn a natural-language automation request into a validated, simulated Reflow workflow.',
    argsSchema: {
      intent: z.string().min(1).describe('What the workflow should accomplish, in natural language.'),
      workspaceId: z.string().uuid().describe('Workspace in which templates and the workflow will be created.'),
    },
  }, async ({ intent, workspaceId }) => ({ messages: [{ role: 'user', content: { type: 'text', text: [
    `Design this workflow for workspace ${workspaceId}: ${intent}`,
    'Call system_capabilities and read agentCookbook. Read reflow://workflow/actions and reflow://workflow/schema.',
    'Call template_list and workflow_list first; reuse existing artifacts. Check examples/socialrobot-onboarding*.workflow.json and examples/welcome-nudge before inventing a similar graph.',
    'Use only installed capabilities. Explain any missing capability instead of inventing an action.',
    'Publish React Email via CLI `reflow template push` (upserts by --name). Avoid duplicate names / "v2" siblings. MCP template_create fails with TEMPLATE_NAME_EXISTS when the name is taken; then template_revise + template_publish.',
    'Each email.send node must pin input.templateVersionId.literal to a published template version id in this workspace.',
    'Call workflow_validate, then workflow_simulate twice: receivedEvents=[] and with the activation events the product will emit.',
    'If workflow_validate returns TEMPLATE_REFERENCE_INVALID, read hint/details, create/revise the missing templates, and retry validation.',
    'Show the traces and resolve validation errors before calling workflow_create.',
    'Do not publish or enroll contacts until the user has asked for that side effect.',
    'Do not archive templates that workflows still reference; template_archive fails with TEMPLATE_IN_USE and explains which workflows pin them.',
  ].join('\n') } }] }));
  return server;
}
