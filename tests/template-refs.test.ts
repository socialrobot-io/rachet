import { describe, expect, it } from 'vitest';
import {
  buildTemplateRefIssues,
  collectEmailSendTemplateRefs,
  templateVersionIdsInDefinition,
  throwTemplateRefIssues,
} from '../src/domain/template-refs.js';
import { workflowDefinitionSchema } from '../src/domain/contracts.js';
import { ReflowError } from '../src/domain/errors.js';

const definition = workflowDefinitionSchema.parse({
  schemaVersion: '1',
  description: 'Test',
  trigger: { type: 'manual' },
  purpose: 'transactional',
  topic: 'onboarding',
  entryNodeId: 'send',
  nodes: [
    {
      id: 'send',
      type: 'action',
      action: 'email.send',
      input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000099' } },
      next: 'done',
      onError: 'fail',
    },
    { id: 'done', type: 'end', reason: 'completed' },
  ],
});

describe('template references', () => {
  it('collects email.send pins', () => {
    expect(collectEmailSendTemplateRefs(definition)).toEqual([
      { nodeId: 'send', templateVersionId: '00000000-0000-4000-8000-000000000099' },
    ]);
    expect(templateVersionIdsInDefinition(definition)).toEqual(['00000000-0000-4000-8000-000000000099']);
  });

  it('builds actionable missing-template and archived issues', () => {
    const missing = buildTemplateRefIssues(collectEmailSendTemplateRefs(definition), new Map());
    expect(missing).toHaveLength(1);
    expect(missing[0]?.problem).toBe('not_found');

    const archived = buildTemplateRefIssues(
      collectEmailSendTemplateRefs(definition),
      new Map([['00000000-0000-4000-8000-000000000099', { templateId: 't1', templateState: 'archived' }]]),
    );
    expect(archived[0]?.problem).toBe('archived_template');

    expect(() => throwTemplateRefIssues(missing)).toThrow(ReflowError);
    try {
      throwTemplateRefIssues(missing);
    } catch (error) {
      expect(error).toBeInstanceOf(ReflowError);
      const reflow = error as ReflowError;
      expect(reflow.code).toBe('TEMPLATE_REFERENCE_INVALID');
      expect(reflow.hint).toMatch(/template.push|template.create/i);
      expect(reflow.details?.issues).toBeTruthy();
    }
  });

  it('ignores non-literal templateVersionId pins when collecting version ids', () => {
    const withPath = workflowDefinitionSchema.parse({
      ...definition,
      nodes: [
        {
          id: 'send',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { path: 'variables.templateVersionId' } },
          next: 'done',
          onError: 'fail',
        },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    });
    expect(templateVersionIdsInDefinition(withPath)).toEqual([]);
    expect(collectEmailSendTemplateRefs(withPath)[0]?.templateVersionId).toBeUndefined();
    expect(buildTemplateRefIssues(collectEmailSendTemplateRefs(withPath), new Map())[0]?.problem).toBe('missing_literal');
  });
});
