import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '../src/domain/contracts.js';
import { validateActionNodes } from '../src/domain/action-catalog.js';
import { simulateWorkflow } from '../src/domain/simulate.js';

const workflow = {
  schemaVersion: '1', description: 'Welcome and wait for activation', trigger: { type: 'manual' }, purpose: 'marketing', topic: 'onboarding', entryNodeId: 'welcome',
  nodes: [
    { id: 'welcome', type: 'action', action: 'email.send', input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' }, props: { literal: { greeting: 'Hello' } } }, next: 'wait', onError: 'attention' },
    { id: 'wait', type: 'wait_for_event', eventType: 'product.activated', timeoutSeconds: 86400, onEvent: 'activated', onTimeout: 'nudge' },
    { id: 'activated', type: 'end', reason: 'activated' },
    { id: 'nudge', type: 'action', action: 'contact.update', input: { fields: { literal: { status: 'needs_nudge' } } }, next: 'done', onError: 'fail' },
    { id: 'done', type: 'end', reason: 'completed' },
  ],
} as const;

describe('workflow authoring contract', () => {
  it('validates installed actions and simulates the event path without side effects', () => {
    const parsed = workflowDefinitionSchema.parse(workflow); validateActionNodes(parsed.nodes);
    const result = simulateWorkflow(parsed, { email: 'person@example.com' }, {}, ['product.activated']);
    expect(result.status).toBe('completed'); expect(result.result).toBe('activated');
    expect(result.trace[0]).toMatchObject({ action: 'email.send', sideEffects: 'not_executed' });
  });
  it('rejects cycles and unknown capabilities', () => {
    expect(() => workflowDefinitionSchema.parse({ ...workflow, nodes: [{ id: 'loop', type: 'delay', durationSeconds: 1, next: 'loop' }], entryNodeId: 'loop' })).toThrow(/Cycle/);
    const parsed = workflowDefinitionSchema.parse({ ...workflow, nodes: [{ id: 'bad', type: 'action', action: 'crm.mutate', input: {}, next: 'done', onError: 'fail' }, { id: 'done', type: 'end', reason: 'done' }], entryNodeId: 'bad' });
    expect(() => validateActionNodes(parsed.nodes)).toThrow(/Unknown action capability/);
  });
});
