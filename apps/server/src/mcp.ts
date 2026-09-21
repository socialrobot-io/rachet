import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GetSkillResultSchema,
  ListSkillsResultSchema,
  SKILLS_EXTENSION_ID,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  loadSkillDirectory,
  registerFastMcpSkills,
  skillServerInstructions,
  type LoadedSkill,
} from '@reflow/mcp-ext-skills';
import { authorizeOperation, type Operation } from './operations.js';
import type { OperationContext } from '@reflow/contracts';
import { ReflowError, errorPayload } from './domain/errors.js';
import { z } from 'zod';
import { workflowDefinitionSchema } from '@reflow/contracts';
import { actionCatalog } from './domain/action-catalog.js';

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Prefer REFLOW_SKILL_DIR, then cwd/skills/reflow, then a few parents of this module. */
export async function resolveReflowSkillDir(): Promise<string | undefined> {
  const fromEnv = process.env.REFLOW_SKILL_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const candidates = [
    path.resolve(process.cwd(), 'skills/reflow'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skills/reflow'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/reflow'),
  ];
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'SKILL.md'))) return candidate;
  }
  return undefined;
}

export async function loadReflowSkill(): Promise<LoadedSkill | undefined> {
  const directory = await resolveReflowSkillDir();
  if (!directory) return undefined;
  return loadSkillDirectory(directory);
}

export async function createMcpServer(operations: Record<string, Operation>, context: OperationContext) {
  const skill = await loadReflowSkill();
  const skills = skill ? [skill] : [];
  const server = new McpServer(
    { name: 'reflow', version: '0.1.0' },
    { instructions: skillServerInstructions(skills) },
  );

  for (const [name, operation] of Object.entries(operations)) {
    if (operation.exposeToMcp === false) continue;
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
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(Object.fromEntries(Object.entries(operations).filter(([, operation]) => operation.exposeToMcp !== false).map(([name, operation]) => [name, { description: operation.description, readOnly: operation.readOnly }]))) }],
  }));
  server.registerResource('workflow-schema', 'reflow://workflow/schema', { mimeType: 'application/schema+json', description: 'The complete validated graph schema used to author durable workflows.' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(workflowDefinitionSchema.toJSONSchema()) }],
  }));
  server.registerResource('workflow-actions', 'reflow://workflow/actions', { mimeType: 'application/json', description: 'Installed action capabilities available to authored workflows.' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(actionCatalog) }],
  }));

  if (skill) {
    registerFastMcpSkills(server, {
      skills: [skill],
      supportingFiles: 'resources',
      cacheHint: { ttlMs: 60_000, cacheScope: 'public' },
    });
  }

  server.registerPrompt('design-workflow', {
    title: 'Design a Reflow workflow',
    description: 'Turn a natural-language automation request into a validated, simulated Reflow workflow.',
    argsSchema: {
      intent: z.string().min(1).describe('What the workflow should accomplish, in natural language.'),
      workspaceId: z.string().uuid().describe('Workspace in which templates and the workflow will be created.'),
    },
  }, async ({ intent, workspaceId }) => ({ messages: [{ role: 'user', content: { type: 'text', text: [
    `Design this workflow for workspace ${workspaceId}: ${intent}`,
    'Read skill://reflow/SKILL.md (and its listed resources) when available; otherwise call skills/list / skills/get.',
    'Call system_capabilities and read agentCookbook. Read reflow://workflow/actions and reflow://workflow/schema.',
    'Call template_list and workflow_list first; reuse existing artifacts. Check examples/welcome-nudge and examples/onboarding.workflow.json before inventing a similar graph.',
    'Use only installed capabilities. Explain any missing capability instead of inventing an action.',
    'If the intent contains a clock time without a timezone, ask the user which IANA timezone they mean; offer "your own timezone" as the default. A schedule needs an explicit-offset ISO datetime and matching IANA timeZone. Confirm ambiguous DST times.',
    'Publish reviewed React Email via CLI `reflow template push ... --allow-code-execution` (upserts by --name). Avoid duplicate names / "v2" siblings. MCP template_create fails with TEMPLATE_NAME_EXISTS when the name is taken; then template_revise + template_publish.',
    'Each email.send node must pin input.templateVersionId.literal to a published template version id in this workspace.',
    'Call workflow_validate, then workflow_simulate twice: receivedEvents=[] and with the activation events the product will emit.',
    'If workflow_validate returns TEMPLATE_REFERENCE_INVALID, read hint/details, create/revise the missing templates, and retry validation.',
    'Show the traces and resolve validation errors before calling workflow_create.',
    'Do not publish or enroll contacts until the user has asked for that side effect.',
    'Do not archive templates that workflows still reference; template_archive fails with TEMPLATE_IN_USE and explains which workflows pin them.',
  ].join('\n') } }] }));
  return server;
}

export {
  GetSkillResultSchema,
  ListSkillsResultSchema,
  SKILLS_EXTENSION_ID,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
};
