import { describe, expect, it } from 'vitest';
import {
  resolveActionInput,
  resolveValue,
  validateActionNodes,
  valueAtPath,
} from '../apps/server/src/domain/action-catalog.js';
import { ReflowError } from '../apps/server/src/domain/errors.js';
import type { FlowNode } from '../packages/contracts/src/index.js';

describe('action catalog value resolution', () => {
  const root = {
    contact: { email: 'ada@example.com', firstName: 'Ada' },
    variables: { plan: 'pro' },
    event: { 'product.activated': {} },
  };

  it('reads nested paths and falls back to defaults', () => {
    expect(valueAtPath(root, 'contact.firstName')).toBe('Ada');
    expect(valueAtPath(root, 'contact.missing')).toBeUndefined();
    expect(resolveValue({ literal: 42 }, root)).toBe(42);
    expect(resolveValue({ path: 'variables.plan' }, root)).toBe('pro');
    expect(resolveValue({ path: 'variables.missing', default: 'free' }, root)).toBe('free');
  });

  it('resolves action input maps', () => {
    expect(resolveActionInput({
      templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' },
      props: { path: 'variables.plan' },
    }, root)).toEqual({
      templateVersionId: '00000000-0000-4000-8000-000000000001',
      props: 'pro',
    });
  });
});

describe('validateActionNodes', () => {
  it('accepts known actions with required inputs', () => {
    const nodes: FlowNode[] = [
      {
        id: 'send',
        type: 'action',
        action: 'email.send',
        input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' } },
        next: 'done',
        onError: 'fail',
      },
      { id: 'done', type: 'end', reason: 'completed' },
    ];
    expect(() => validateActionNodes(nodes)).not.toThrow();
  });

  it('rejects unknown actions and missing required fields', () => {
    expect(() => validateActionNodes([
      { id: 'bad', type: 'action', action: 'crm.mutate', input: {}, next: 'done', onError: 'fail' },
      { id: 'done', type: 'end', reason: 'done' },
    ])).toThrow(ReflowError);

    expect(() => validateActionNodes([
      { id: 'send', type: 'action', action: 'email.send', input: {}, next: 'done', onError: 'fail' },
      { id: 'done', type: 'end', reason: 'done' },
    ])).toThrow(/templateVersionId/);
  });
});
