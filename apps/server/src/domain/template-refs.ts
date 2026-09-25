import type { WorkflowDefinition } from '@reflow/contracts';
import { ReflowError } from './errors.js';

export type EmailSendTemplateRef = {
  nodeId: string;
  templateVersionId?: string;
};

export type TemplateRefIssue = {
  nodeId: string;
  templateVersionId?: string;
  problem: 'missing_literal' | 'invalid_uuid' | 'not_found' | 'archived_template';
  message: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function collectEmailSendTemplateRefs(definition: WorkflowDefinition): EmailSendTemplateRef[] {
  const refs: EmailSendTemplateRef[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'action' || node.action !== 'email.send') continue;
    const source = node.input.templateVersionId;
    if (!source || !('literal' in source) || typeof source.literal !== 'string') {
      refs.push({ nodeId: node.id });
      continue;
    }
    refs.push({ nodeId: node.id, templateVersionId: source.literal });
  }
  return refs;
}

export function templateVersionIdsInDefinition(definition: unknown): string[] {
  if (!definition || typeof definition !== 'object') return [];
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const ids: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const record = node as { type?: unknown; action?: unknown; input?: { templateVersionId?: { literal?: unknown } } };
    if (record.type !== 'action' || record.action !== 'email.send') continue;
    const literal = record.input?.templateVersionId?.literal;
    if (typeof literal === 'string' && UUID_RE.test(literal)) ids.push(literal);
  }
  return ids;
}

export function buildTemplateRefIssues(
  refs: EmailSendTemplateRef[],
  existing: Map<string, { templateId: string; templateState: string }>,
): TemplateRefIssue[] {
  const issues: TemplateRefIssue[] = [];
  for (const ref of refs) {
    if (!ref.templateVersionId) {
      issues.push({
        nodeId: ref.nodeId,
        problem: 'missing_literal',
        message: `Node "${ref.nodeId}" (email.send) is missing input.templateVersionId.literal. Publish a template first, then set the returned version id as a string literal.`,
      });
      continue;
    }
    if (!UUID_RE.test(ref.templateVersionId)) {
      issues.push({
        nodeId: ref.nodeId,
        templateVersionId: ref.templateVersionId,
        problem: 'invalid_uuid',
        message: `Node "${ref.nodeId}" references templateVersionId "${ref.templateVersionId}", which is not a UUID.`,
      });
      continue;
    }
    const found = existing.get(ref.templateVersionId);
    if (!found) {
      issues.push({
        nodeId: ref.nodeId,
        templateVersionId: ref.templateVersionId,
        problem: 'not_found',
        message: `Node "${ref.nodeId}" references templateVersionId "${ref.templateVersionId}", which does not exist in this workspace.`,
      });
      continue;
    }
    if (found.templateState === 'archived') {
      issues.push({
        nodeId: ref.nodeId,
        templateVersionId: ref.templateVersionId,
        problem: 'archived_template',
        message: `Node "${ref.nodeId}" references archived template version "${ref.templateVersionId}". Use an active published template version instead.`,
      });
    }
  }
  return issues;
}

export function throwTemplateRefIssues(issues: TemplateRefIssue[]): never {
  const summary = issues.map((issue) => issue.message).join(' ');
  throw new ReflowError(
    'TEMPLATE_REFERENCE_INVALID',
    summary,
    422,
    false,
    {
      hint: 'Create and publish templates with template.create (sourceKind=html, html, and a plain-text body) then template.publish. Set each email.send node input.templateVersionId.literal to the published version id.',
      details: {
        issues,
        nextSteps: [
          'Call template_list to see existing templates and published versions.',
          'Call template_create + template_publish for each missing email.',
          'Replace placeholder or missing templateVersionId literals in the workflow graph.',
          'Re-run workflow_validate before workflow_create or workflow_publish.',
        ],
      },
    },
  );
}
