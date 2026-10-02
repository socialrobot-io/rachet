import { describe, expect, it } from 'vitest';
import { enrollmentCounts, enrollmentExitReason, enrollmentGroup } from './enrollment-list';
import type { Enrollment } from './types';

const base = {
  id: 'enrollment-1', workspaceId: 'workspace-1', sequenceVersionId: 'version-1', contactId: 'contact-1',
  state: 'waiting', currentStepId: 'wait', workflowId: 'workflow-1', input: {}, idempotencyKey: 'test',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contactEmail: 'person@example.com',
  contactFields: {}, sequenceId: 'sequence-1', workflowName: 'Welcome', workflowVersion: 1,
  definition: {
    schemaVersion: '1' as const, description: 'Test', trigger: { type: 'manual' as const },
    purpose: 'marketing' as const, topic: 'marketing', entryNodeId: 'wait',
    nodes: [
      { id: 'wait', type: 'delay' as const, durationSeconds: 1, next: 'end' },
      { id: 'end', type: 'end' as const, reason: 'No project created' },
    ],
  },
} satisfies Enrollment;

describe('enrollment list outcomes', () => {
  it('counts active, attention, and exited enrollments separately', () => {
    const rows: Enrollment[] = [
      base,
      { ...base, id: '2', state: 'needs_attention' },
      { ...base, id: '3', state: 'completed', currentStepId: 'end' },
      { ...base, id: '4', state: 'suppressed' },
    ];
    expect(enrollmentCounts(rows)).toEqual({ total: 4, inProgress: 1, needsAttention: 1, exited: 2 });
    expect(enrollmentGroup(rows[2]!)).toBe('exited');
  });

  it('shows the end node reason without calling every exit a success', () => {
    expect(enrollmentExitReason({ ...base, state: 'completed', currentStepId: 'end' })).toBe('No project created');
    expect(enrollmentExitReason({ ...base, state: 'suppressed' })).toBe('Stopped by email policy');
    expect(enrollmentExitReason(base)).toBeNull();
  });
});
