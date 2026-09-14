import { defineQuery, defineSignal } from '@temporalio/workflow';

export const enrollmentEvent = defineSignal<[eventType: string, eventId: string, data: Record<string, unknown>]>('event');
export const pauseEnrollment = defineSignal('pause');
export const resumeEnrollment = defineSignal('resume');
export const cancelEnrollment = defineSignal('cancel');
export const enrollmentStatus = defineQuery<EnrollmentWorkflowState>('status');

export type EnrollmentWorkflowState = {
  state: 'running' | 'waiting' | 'paused' | 'cancelled' | 'completed' | 'needs_attention';
  currentStepId: string;
  result?: string;
};
