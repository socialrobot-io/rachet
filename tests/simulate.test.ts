import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '../src/domain/contracts.js';
import { simulateWorkflow } from '../src/domain/simulate.js';

const base = {
  schemaVersion: '1' as const,
  description: 'Simulate paths',
  trigger: { type: 'manual' as const },
  purpose: 'transactional' as const,
  topic: 'test',
};

describe('simulateWorkflow', () => {
  it('follows wait_for_event timeout when the event is absent', () => {
    const definition = workflowDefinitionSchema.parse({
      ...base,
      entryNodeId: 'wait',
      nodes: [
        {
          id: 'wait',
          type: 'wait_for_event',
          eventType: 'product.activated',
          timeoutSeconds: 60,
          onEvent: 'activated',
          onTimeout: 'timed_out',
        },
        { id: 'activated', type: 'end', reason: 'activated' },
        { id: 'timed_out', type: 'end', reason: 'timed_out' },
      ],
    });
    const result = simulateWorkflow(definition, { email: 'a@example.com' }, {}, []);
    expect(result.result).toBe('timed_out');
    expect(result.trace[0]).toMatchObject({ type: 'wait_for_event', outcome: 'timeout' });
  });

  it('evaluates branch conditions against variables', () => {
    const definition = workflowDefinitionSchema.parse({
      ...base,
      entryNodeId: 'check',
      nodes: [
        {
          id: 'check',
          type: 'branch',
          condition: { op: 'eq', left: { path: 'variables.plan' }, right: { literal: 'pro' } },
          onTrue: 'pro',
          onFalse: 'free',
        },
        { id: 'pro', type: 'end', reason: 'pro' },
        { id: 'free', type: 'end', reason: 'free' },
      ],
    });
    expect(simulateWorkflow(definition, {}, { plan: 'pro' }, []).result).toBe('pro');
    expect(simulateWorkflow(definition, {}, { plan: 'free' }, []).result).toBe('free');
  });

  it('supports numeric and contains conditions plus delays', () => {
    const definition = workflowDefinitionSchema.parse({
      ...base,
      entryNodeId: 'delay',
      nodes: [
        { id: 'delay', type: 'delay', durationSeconds: 30, next: 'score' },
        {
          id: 'score',
          type: 'branch',
          condition: { op: 'gte', left: { path: 'variables.score' }, right: { literal: 10 } },
          onTrue: 'tags',
          onFalse: 'low',
        },
        {
          id: 'tags',
          type: 'branch',
          condition: { op: 'contains', left: { path: 'variables.tags' }, right: { literal: 'vip' } },
          onTrue: 'vip',
          onFalse: 'normal',
        },
        { id: 'vip', type: 'end', reason: 'vip' },
        { id: 'normal', type: 'end', reason: 'normal' },
        { id: 'low', type: 'end', reason: 'low' },
      ],
    });
    const result = simulateWorkflow(definition, {}, { score: 12, tags: ['vip', 'beta'] }, []);
    expect(result.trace.map((step) => step.type)).toEqual(['delay', 'branch', 'branch', 'end']);
    expect(result.result).toBe('vip');
  });

  it('treats event_received conditions as matched when listed', () => {
    const definition = workflowDefinitionSchema.parse({
      ...base,
      entryNodeId: 'check',
      nodes: [
        {
          id: 'check',
          type: 'branch',
          condition: { op: 'event_received', eventType: 'product.activated' },
          onTrue: 'yes',
          onFalse: 'no',
        },
        { id: 'yes', type: 'end', reason: 'yes' },
        { id: 'no', type: 'end', reason: 'no' },
      ],
    });
    expect(simulateWorkflow(definition, {}, {}, ['product.activated']).result).toBe('yes');
    expect(simulateWorkflow(definition, {}, {}, []).result).toBe('no');
  });
});
