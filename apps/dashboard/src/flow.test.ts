import { describe, expect, it } from 'vitest';
import { buildExecutionTrace, contactUpdateSummary } from './flow';
import type { Enrollment, WorkflowDefinition } from './types';

const definition: WorkflowDefinition = {
  schemaVersion: '1',
  description: 'test',
  trigger: { type: 'manual' },
  entryNodeId: 'send_welcome',
  nodes: [
    {
      id: 'send_welcome',
      type: 'action',
      action: 'email.send',
      input: {},
      next: 'delay_day_1',
    },
    { id: 'delay_day_1', type: 'delay', durationSeconds: 86_400, next: 'branch_has_post' },
    {
      id: 'branch_has_post',
      type: 'branch',
      condition: { op: 'event_received', eventType: 'social_post_created' },
      onTrue: 'end_active',
      onFalse: 'end_nudge',
    },
    { id: 'end_active', type: 'end', reason: 'activated' },
    { id: 'end_nudge', type: 'end', reason: 'nudge' },
  ],
};

const enrollment: Enrollment = {
  id: 'enr_1',
  workspaceId: 'ws_1',
  sequenceVersionId: 'sv_1',
  contactId: 'c_1',
  state: 'waiting',
  currentStepId: 'delay_day_1',
  workflowId: 'wf/enr_1',
  input: {},
  idempotencyKey: 'key',
  createdAt: '2026-09-19T12:00:00.000Z',
  updatedAt: '2026-09-19T12:00:00.000Z',
  contactEmail: 'user@example.com',
  contactFields: {},
  sequenceId: 'seq_1',
  workflowName: 'Onboarding',
  workflowVersion: 1,
  definition,
};

describe('contactUpdateSummary', () => {
  it('lists literal fields the step merges', () => {
    expect(contactUpdateSummary({
      fields: { literal: { onboardingStatus: 'needs_nudge', tested: true } },
    })).toBe('onboardingStatus = needs_nudge · tested = true');
  });

  it('names a path when the fields are copied from an event', () => {
    expect(contactUpdateSummary({
      fields: { path: 'event["social.posted"].data', default: { status: 'unknown' } },
    })).toBe('from event["social.posted"].data (default {"status":"unknown"})');
  });

  it('returns nothing when the step has no fields', () => {
    expect(contactUpdateSummary({})).toBeUndefined();
    expect(contactUpdateSummary({ fields: { literal: {} } })).toBeUndefined();
  });
});

describe('buildExecutionTrace received events', () => {
  it('shows emitted events in Events seen before the branch is taken', () => {
    const { eventsSeen, items } = buildExecutionTrace(definition, enrollment, [], [
      {
        eventType: 'social_post_created',
        eventId: 'post:1',
        receivedAt: '2026-09-19T13:00:00.000Z',
        data: {},
      },
    ]);

    expect(eventsSeen).toEqual([
      { type: 'social_post_created', receivedAt: '2026-09-19T13:00:00.000Z' },
    ]);
    expect(items.some((item) => item.id === 'event:post:1' && item.title === 'Event · social_post_created')).toBe(true);
  });

  it('falls back to path inference when no durable events exist', () => {
    const advanced: Enrollment = {
      ...enrollment,
      currentStepId: 'end_active',
      state: 'completed',
    };
    const { eventsSeen } = buildExecutionTrace(definition, advanced, []);
    expect(eventsSeen).toEqual([{ type: 'social_post_created' }]);
  });

  it('explains when an event arrived after a false branch was already taken', () => {
    const advanced: Enrollment = {
      ...enrollment,
      currentStepId: 'end_nudge',
      state: 'completed',
      receivedEvents: [{
        eventType: 'social_post_created',
        eventId: 'post:late',
        receivedAt: '2026-09-20T13:00:00.000Z',
        data: {},
      }],
    };
    const { items } = buildExecutionTrace(definition, advanced, []);
    expect(items.find((item) => item.id === 'branch_has_post')?.detail)
      .toBe('social_post_created? · No · matching event arrived after this decision');
  });
});
