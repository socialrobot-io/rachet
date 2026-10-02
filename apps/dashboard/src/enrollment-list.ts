import type { Enrollment } from './types';

export type EnrollmentGroup = 'all' | 'in_progress' | 'needs_attention' | 'exited';

export function enrollmentGroup(enrollment: Enrollment): Exclude<EnrollmentGroup, 'all'> {
  if (enrollment.state === 'needs_attention') return 'needs_attention';
  if (['completed', 'cancelled', 'suppressed', 'failed'].includes(enrollment.state)) return 'exited';
  return 'in_progress';
}

export function enrollmentExitReason(enrollment: Enrollment): string | null {
  if (enrollment.state === 'completed') {
    const node = enrollment.definition.nodes.find((candidate) => candidate.id === enrollment.currentStepId);
    return node?.type === 'end' ? node.reason : 'Reached an end';
  }
  if (enrollment.state === 'suppressed') return 'Stopped by email policy';
  if (enrollment.state === 'cancelled') return 'Cancelled';
  if (enrollment.state === 'failed') return 'Failed';
  return null;
}

export function enrollmentCounts(enrollments: Enrollment[]) {
  return {
    total: enrollments.length,
    inProgress: enrollments.filter((row) => enrollmentGroup(row) === 'in_progress').length,
    needsAttention: enrollments.filter((row) => enrollmentGroup(row) === 'needs_attention').length,
    exited: enrollments.filter((row) => enrollmentGroup(row) === 'exited').length,
  };
}
