import { condition, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type { FlowNode, WorkflowDefinition } from '@reflow/contracts';
import type * as activities from './activities.js';
import { cancelEnrollment, enrollmentEvent, enrollmentStatus, pauseEnrollment, resumeEnrollment, type EnrollmentWorkflowState } from './shared.js';

const activity = proxyActivities<typeof activities>({ startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '23 hours', retry: { initialInterval: '2 seconds', backoffCoefficient: 2, maximumInterval: '5 minutes', maximumAttempts: 12, nonRetryableErrorTypes: ['ValidationError', 'SuppressedError', 'SendOutcomeUnknown'] } });
export type EnrollmentWorkflowInput = { workspaceId: string; enrollmentId: string; definition: WorkflowDefinition };

export async function enrollmentWorkflow(input: EnrollmentWorkflowInput): Promise<string> {
  const nodes = new Map(input.definition.nodes.map((node) => [node.id, node]));
  const events = new Map<string, { eventId: string; data: Record<string, unknown> }>();
  let paused = false; let cancelled = false; let current = input.definition.entryNodeId;
  const state: EnrollmentWorkflowState = { state: 'running', currentStepId: current };
  setHandler(enrollmentEvent, (eventType, eventId, data) => { events.set(eventType, { eventId, data }); });
  setHandler(pauseEnrollment, () => { paused = true; state.state = 'paused'; });
  setHandler(resumeEnrollment, () => { paused = false; state.state = 'running'; });
  setHandler(cancelEnrollment, () => { cancelled = true; });
  setHandler(enrollmentStatus, () => ({ ...state }));
  if (input.definition.trigger.type === 'schedule') {
    const delay = new Date(input.definition.trigger.at).getTime() - Date.now();
    if (delay > 0) await sleep(delay);
  }
  if (input.definition.trigger.type === 'event') {
    state.state = 'waiting';
    await activity.recordEnrollmentState(input.enrollmentId, 'waiting', current);
    await condition(() => events.has(input.definition.trigger.type === 'event' ? input.definition.trigger.eventType : ''));
    state.state = 'running';
  }
  while (true) {
    if (cancelled) { state.state = 'cancelled'; state.result = 'cancelled'; await activity.recordEnrollmentState(input.enrollmentId, 'cancelled', current); return 'cancelled'; }
    if (paused) await condition(() => !paused || cancelled);
    if (cancelled) continue;
    const node = nodes.get(current); if (!node) throw new Error(`Missing workflow node ${current}`);
    state.currentStepId = current;
    await activity.recordEnrollmentState(input.enrollmentId, node.type === 'delay' || node.type === 'wait_for_event' ? 'waiting' : 'running', current);
    if (node.type === 'end') { state.state = 'completed'; state.result = node.reason; await activity.recordEnrollmentState(input.enrollmentId, 'completed', current); return node.reason; }
    current = await executeNode(node, input, events, state);
  }
}

async function executeNode(node: Exclude<FlowNode, { type: 'end' }>, input: EnrollmentWorkflowInput, events: Map<string, { eventId: string; data: Record<string, unknown> }>, state: EnrollmentWorkflowState): Promise<string> {
  if (node.type === 'action') {
    const outcome = await activity.executeAction({ workspaceId: input.workspaceId, enrollmentId: input.enrollmentId, node, eventData: Object.fromEntries(events) });
    if (outcome === 'needs_attention' || (outcome === 'failed' && node.onError === 'attention')) { state.state = 'needs_attention'; await activity.recordEnrollmentState(input.enrollmentId, 'needs_attention', node.id); await condition(() => false); }
    if (outcome === 'failed' && node.onError === 'fail') throw new Error(`Action ${node.action} failed`);
    return node.next;
  }
  if (node.type === 'delay') { await sleep(node.durationSeconds * 1000); return node.next; }
  if (node.type === 'wait_for_event') { const received = await condition(() => events.has(node.eventType), node.timeoutSeconds * 1000); return received ? node.onEvent : node.onTimeout; }
  if (node.condition.op === 'event_received') return events.has(node.condition.eventType) ? node.onTrue : node.onFalse;
  const result = await activity.evaluateCondition({ workspaceId: input.workspaceId, enrollmentId: input.enrollmentId, condition: node.condition, eventData: Object.fromEntries(events) });
  return result ? node.onTrue : node.onFalse;
}
