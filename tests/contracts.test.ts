import { describe, expect, it } from 'vitest';
import {
  accountCreateSchema,
  credentialCreateSchema,
  contactUpsertSchema,
  templateCreateSchema,
  templateReviseSchema,
  workflowDeleteSchema,
  enrollmentDeleteSchema,
  valueSourceSchema,
  workflowDefinitionSchema,
  triggerSchema,
} from '../packages/contracts/src/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('timezone-aware operation contracts shared by CLI and MCP', () => {
  it('requires an offset and an IANA timezone for scheduled workflows', () => {
    const valid = { type: 'schedule', at: '2026-10-25T02:30:00+02:00', timeZone: 'Europe/Amsterdam' };
    expect(triggerSchema.safeParse(valid).success).toBe(true);
    expect(triggerSchema.safeParse({ ...valid, at: '2026-10-25T02:30:00' }).success).toBe(false);
    expect(triggerSchema.safeParse({ ...valid, timeZone: undefined }).success).toBe(false);
    expect(triggerSchema.safeParse({ ...valid, timeZone: 'PST' }).success).toBe(false);
    expect(triggerSchema.safeParse({ ...valid, at: '2026-10-25T02:30:00+03:00' }).success).toBe(false);
  });

  it('accepts either valid offset for a DST fold and rejects the wrong summer offset', () => {
    expect(triggerSchema.safeParse({ type: 'schedule', at: '2026-10-25T02:30:00+01:00', timeZone: 'Europe/Amsterdam' }).success).toBe(true);
    expect(triggerSchema.safeParse({ type: 'schedule', at: '2026-07-01T09:00:00+01:00', timeZone: 'Europe/Amsterdam' }).success).toBe(false);
  });

  it('validates contact timezones as IANA names', () => {
    const contact = { workspaceId, email: 'contact@example.com', timezone: 'Europe/Amsterdam' };
    expect(contactUpsertSchema.safeParse(contact).success).toBe(true);
    expect(contactUpsertSchema.safeParse({ ...contact, timezone: 'UTC+2' }).success).toBe(false);
  });
});

describe('deletion operation contracts', () => {
  it('requires an explicit dangerous workflow deletion acknowledgement', () => {
    const input = { workspaceId, workflowId: '00000000-0000-4000-8000-000000000002', dangerouslyDeleteWorkflow: true };
    expect(workflowDeleteSchema.parse(input)).toEqual(input);
    expect(() => workflowDeleteSchema.parse({ ...input, dangerouslyDeleteWorkflow: false })).toThrow();
    expect(() => workflowDeleteSchema.parse({ workspaceId, workflowId: input.workflowId })).toThrow();
  });

  it('accepts a scoped enrollment deletion request', () => {
    expect(enrollmentDeleteSchema.parse({ workspaceId, enrollmentId: '00000000-0000-4000-8000-000000000003' }))
      .toMatchObject({ workspaceId });
  });
});

describe('passwordless account and API key schemas', () => {
  it('does not accept passwords or arbitrary API-key owners', () => {
    expect(accountCreateSchema.parse({
      email: 'new@example.com',
      name: 'New User',
      password: 'this-field-is-not-part-of-the-contract',
    })).not.toHaveProperty('password');
    expect(credentialCreateSchema.parse({
      workspaceId,
      name: 'SDK',
      scopes: ['read'],
      userId: 'somebody-else',
    })).not.toHaveProperty('userId');
  });

  it('limits API keys to known scopes and at most one year', () => {
    expect(() => credentialCreateSchema.parse({ workspaceId, name: 'bad', scopes: ['admin'] })).toThrow();
    expect(() => credentialCreateSchema.parse({
      workspaceId,
      name: 'too-long',
      scopes: ['read'],
      expiresInSeconds: 366 * 24 * 60 * 60,
    })).toThrow();
  });
});

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

describe('templateReviseSchema', () => {
  const templateId = '00000000-0000-4000-8000-000000000002';

  it('accepts html revise payloads with expectedRevision', () => {
    const parsed = templateReviseSchema.parse({
      workspaceId,
      templateId,
      expectedRevision: 1,
      subject: 'Hi {{contact.firstName}}',
      sourceKind: 'html',
      html: '<p>Hello</p>',
      body: 'Hello',
    });
    expect(parsed.expectedRevision).toBe(1);
    expect(parsed.html).toContain('Hello');
  });

  it('rejects html revise missing body', () => {
    expect(() => templateReviseSchema.parse({
      workspaceId,
      templateId,
      expectedRevision: 1,
      subject: 'Hi',
      sourceKind: 'html',
      html: '<p>Hi</p>',
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
