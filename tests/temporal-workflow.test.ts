import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { WorkflowDefinition } from '../packages/contracts/src/index.js';
import {
  cancelEnrollment,
  enrollmentEvent,
  enrollmentStatus,
  pauseEnrollment,
  resumeEnrollment,
} from '../apps/server/src/temporal/shared.js';
import { enrollmentWorkflow } from '../apps/server/src/temporal/workflows.js';

const workflowsPath = new URL('../apps/server/src/temporal/workflows.ts', import.meta.url).pathname;

type ActionOutcome = 'succeeded' | 'failed' | 'needs_attention';

async function runWithWorker(
  environment: TestWorkflowEnvironment,
  definition: WorkflowDefinition,
  activities: {
    recordEnrollmentState?: (enrollmentId: string, state: string, stepId: string) => Promise<void>;
    executeAction?: () => Promise<ActionOutcome>;
    evaluateCondition?: () => Promise<boolean>;
  } = {},
) {
  const taskQueue = `test-${crypto.randomUUID()}`;
  const states: Array<{ state: string; stepId: string }> = [];
  const actions: string[] = [];
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      recordEnrollmentState: async (_id: string, state: string, stepId: string) => {
        states.push({ state, stepId });
        await activities.recordEnrollmentState?.(_id, state, stepId);
      },
      executeAction: async (input: { node: { id: string } }) => {
        actions.push(input.node.id);
        return activities.executeAction ? activities.executeAction() : 'succeeded';
      },
      evaluateCondition: async () => (activities.evaluateCondition ? activities.evaluateCondition() : true),
    },
  });
  const handle = await environment.client.workflow.start(enrollmentWorkflow, {
    taskQueue,
    workflowId: `workflow-${crypto.randomUUID()}`,
    args: [{
      workspaceId: crypto.randomUUID(),
      enrollmentId: crypto.randomUUID(),
      definition,
    }],
  });
  return { worker, handle, states, actions };
}

describe('Temporal enrollment complex flows', () => {
  let environment: TestWorkflowEnvironment;
  beforeAll(async () => { environment = await TestWorkflowEnvironment.createTimeSkipping(); }, 30_000);
  afterAll(async () => { await environment.teardown(); });

  it('replays a simple completed history', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Replay', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'update',
      nodes: [
        { id: 'update', type: 'action', action: 'contact.update', input: { fields: { literal: { tested: true } } }, next: 'done', onError: 'fail' },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const { worker, handle, states } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(handle.result());
    expect(result).toBe('completed');
    expect(states.map((row) => row.state)).toContain('completed');
    const history = await handle.fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history, handle.workflowId);
  }, 30_000);

  it('takes wait_for_event timeout when no signal arrives', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Timeout', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'wait',
      nodes: [
        { id: 'wait', type: 'wait_for_event', eventType: 'product.activated', timeoutSeconds: 60, onEvent: 'activated', onTimeout: 'nudge' },
        { id: 'activated', type: 'end', reason: 'activated' },
        { id: 'nudge', type: 'end', reason: 'nudged' },
      ],
    };
    const { worker, handle, states } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(handle.result());
    expect(result).toBe('nudged');
    expect(states.some((row) => row.state === 'waiting' && row.stepId === 'wait')).toBe(true);
  }, 30_000);

  it('takes wait_for_event onEvent after enrollmentEvent signal', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Signal', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'wait',
      nodes: [
        { id: 'wait', type: 'wait_for_event', eventType: 'product.activated', timeoutSeconds: 3600, onEvent: 'activated', onTimeout: 'nudge' },
        { id: 'activated', type: 'end', reason: 'activated' },
        { id: 'nudge', type: 'end', reason: 'nudged' },
      ],
    };
    const { worker, handle } = await runWithWorker(environment, definition);
    const resultPromise = worker.runUntil(async () => {
      await environment.sleep('1s');
      await handle.signal(enrollmentEvent, 'product.activated', 'evt-1', { source: 'test' });
      return handle.result();
    });
    await expect(resultPromise).resolves.toBe('activated');
  }, 30_000);

  it('supports pause / resume around a delay', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Pause', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'delay',
      nodes: [
        { id: 'delay', type: 'delay', durationSeconds: 30, next: 'done' },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const { worker, handle } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(async () => {
      await environment.sleep('1s');
      await handle.signal(pauseEnrollment);
      await expect(handle.query(enrollmentStatus)).resolves.toMatchObject({ state: 'paused' });
      await handle.signal(resumeEnrollment);
      return handle.result();
    });
    expect(result).toBe('completed');
  }, 30_000);

  it('cancels while waiting for an event', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Cancel', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'wait',
      nodes: [
        { id: 'wait', type: 'wait_for_event', eventType: 'never', timeoutSeconds: 3600, onEvent: 'yes', onTimeout: 'no' },
        { id: 'yes', type: 'end', reason: 'yes' },
        { id: 'no', type: 'end', reason: 'no' },
      ],
    };
    const { worker, handle, states } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(async () => {
      await environment.sleep('1s');
      await handle.signal(cancelEnrollment);
      return handle.result();
    });
    expect(result).toBe('cancelled');
    expect(states.map((row) => row.state)).toContain('cancelled');
  }, 30_000);

  it('parks in needs_attention when action returns needs_attention', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Attention', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'send',
      nodes: [
        { id: 'send', type: 'action', action: 'email.send', input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' } }, next: 'done', onError: 'fail' },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const { worker, handle } = await runWithWorker(environment, definition, {
      executeAction: async () => 'needs_attention',
    });
    await worker.runUntil(async () => {
      await environment.sleep('2s');
      await expect(handle.query(enrollmentStatus)).resolves.toMatchObject({
        state: 'needs_attention',
        currentStepId: 'send',
      });
    });
    await handle.terminate('stop parked workflow');
  }, 30_000);

  it('continues after failed action when onError=continue', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Continue', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'send',
      nodes: [
        { id: 'send', type: 'action', action: 'email.send', input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' } }, next: 'done', onError: 'continue' },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const { worker, handle, actions } = await runWithWorker(environment, definition, {
      executeAction: async () => 'failed',
    });
    await expect(worker.runUntil(handle.result())).resolves.toBe('completed');
    expect(actions).toEqual(['send']);
  }, 30_000);

  it('branches on event_received after a prior signal', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Branch event', trigger: { type: 'manual' }, purpose: 'marketing', topic: 'test', entryNodeId: 'wait',
      nodes: [
        { id: 'wait', type: 'wait_for_event', eventType: 'social.connected', timeoutSeconds: 60, onEvent: 'check', onTimeout: 'check' },
        {
          id: 'check',
          type: 'branch',
          condition: { op: 'event_received', eventType: 'social.connected' },
          onTrue: 'connected',
          onFalse: 'missing',
        },
        { id: 'connected', type: 'end', reason: 'connected' },
        { id: 'missing', type: 'end', reason: 'missing' },
      ],
    };
    const { worker, handle } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(async () => {
      await environment.sleep('1s');
      await handle.signal(enrollmentEvent, 'social.connected', 'evt-2', {});
      return handle.result();
    });
    expect(result).toBe('connected');
  }, 30_000);

  it('runs welcome → wait → nudge timeout path as one graph', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1', description: 'Welcome nudge', trigger: { type: 'manual' }, purpose: 'marketing', topic: 'onboarding', entryNodeId: 'welcome',
      nodes: [
        { id: 'welcome', type: 'action', action: 'email.send', input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000001' } }, next: 'wait', onError: 'fail' },
        { id: 'wait', type: 'wait_for_event', eventType: 'product.activated', timeoutSeconds: 20, onEvent: 'activated', onTimeout: 'nudge' },
        { id: 'activated', type: 'end', reason: 'activated' },
        { id: 'nudge', type: 'action', action: 'email.send', input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000002' } }, next: 'done', onError: 'fail' },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const { worker, handle, actions, states } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(handle.result());
    expect(result).toBe('completed');
    expect(actions).toEqual(['welcome', 'nudge']);
    expect(states.map((row) => row.stepId)).toEqual(expect.arrayContaining(['welcome', 'wait', 'nudge', 'done']));
  }, 30_000);

  it('waits for trigger event before entering the graph', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1',
      description: 'Event trigger',
      trigger: { type: 'event', eventType: 'signup.completed' },
      purpose: 'transactional',
      topic: 'test',
      entryNodeId: 'go',
      nodes: [
        { id: 'go', type: 'end', reason: 'started' },
      ],
    };
    const { worker, handle, states } = await runWithWorker(environment, definition);
    const result = await worker.runUntil(async () => {
      await expect.poll(() => states.some((row) => row.state === 'waiting')).toBe(true);
      await handle.signal(enrollmentEvent, 'signup.completed', 'evt-3', {});
      return handle.result();
    });
    expect(result).toBe('started');
  }, 30_000);
});
