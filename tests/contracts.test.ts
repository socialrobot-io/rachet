import { describe, expect, it } from 'vitest';
import {
  templateCreateSchema,
  valueSourceSchema,
  workflowDefinitionSchema,
} from '../src/domain/contracts.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('templateCreateSchema', () => {
  it('accepts html templates with html + plain body', () => {
    const parsed = templateCreateSchema.parse({
      workspaceId,
      name: 'Welcome',
      subject: 'Hi {{contact.firstName}}',
      sourceKind: 'html',
      html: '<p>Hello {{contact.firstName}}</p>',
      body: 'Hello {{contact.firstName}}',
    });
    expect(parsed.sourceKind).toBe('html');
    expect(parsed.html).toContain('Hello');
  });

  it('accepts plain templates with body only', () => {
    const parsed = templateCreateSchema.parse({
      workspaceId,
      name: 'Plain',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(parsed.sourceKind).toBe('plain');
  });

  it('rejects html templates missing html or plain body', () => {
    expect(() => templateCreateSchema.parse({
      workspaceId,
      name: 'Bad',
      subject: 'Hi',
      sourceKind: 'html',
      body: 'Hello',
    })).toThrow(/html/i);

    expect(() => templateCreateSchema.parse({
      workspaceId,
      name: 'Bad',
      subject: 'Hi',
      sourceKind: 'html',
      html: '<p>Hi</p>',
    })).toThrow(/body/i);
  });

  it('rejects plain templates without body', () => {
    expect(() => templateCreateSchema.parse({
      workspaceId,
      name: 'Bad',
      subject: 'Hi',
    })).toThrow(/body/i);
  });
});

describe('valueSourceSchema', () => {
  it('accepts literals and rooted paths', () => {
    expect(valueSourceSchema.parse({ literal: 'x' })).toEqual({ literal: 'x' });
    expect(valueSourceSchema.parse({ path: 'contact.firstName', default: 'friend' })).toEqual({
      path: 'contact.firstName',
      default: 'friend',
    });
  });

  it('rejects paths outside contact/variables/event', () => {
    expect(() => valueSourceSchema.parse({ path: 'secrets.token' })).toThrow();
  });
});

describe('workflowDefinitionSchema graph rules', () => {
  const base = {
    schemaVersion: '1' as const,
    description: 'Graph rules',
    trigger: { type: 'manual' as const },
    purpose: 'transactional' as const,
    topic: 'test',
    entryNodeId: 'a',
  };

  it('rejects duplicate ids, missing entry, unreachable nodes, and broken edges', () => {
    expect(() => workflowDefinitionSchema.parse({
      ...base,
      nodes: [
        { id: 'a', type: 'end', reason: 'done' },
        { id: 'a', type: 'end', reason: 'again' },
      ],
    })).toThrow(/Duplicate/);

    expect(() => workflowDefinitionSchema.parse({
      ...base,
      entryNodeId: 'missing',
      nodes: [{ id: 'a', type: 'end', reason: 'done' }],
    })).toThrow(/Entry node/);

    expect(() => workflowDefinitionSchema.parse({
      ...base,
      nodes: [
        { id: 'a', type: 'end', reason: 'done' },
        { id: 'orphan', type: 'end', reason: 'unused' },
      ],
    })).toThrow(/Unreachable/);

    expect(() => workflowDefinitionSchema.parse({
      ...base,
      nodes: [
        { id: 'a', type: 'delay', durationSeconds: 1, next: 'gone' },
        { id: 'done', type: 'end', reason: 'done' },
      ],
    })).toThrow(/Missing target/);
  });

  it('accepts a valid branch graph', () => {
    const parsed = workflowDefinitionSchema.parse({
      ...base,
      nodes: [
        {
          id: 'a',
          type: 'branch',
          condition: { op: 'eq', left: { path: 'variables.plan' }, right: { literal: 'pro' } },
          onTrue: 'yes',
          onFalse: 'no',
        },
        { id: 'yes', type: 'end', reason: 'pro' },
        { id: 'no', type: 'end', reason: 'other' },
      ],
    });
    expect(parsed.nodes).toHaveLength(3);
  });
});
