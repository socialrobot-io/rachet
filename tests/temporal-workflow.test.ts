import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { enrollmentWorkflow } from '../src/temporal/workflows.js';

describe('Temporal workflow interpreter', () => {
  let environment: TestWorkflowEnvironment;
  beforeAll(async () => { environment = await TestWorkflowEnvironment.createTimeSkipping(); }, 30_000);
  afterAll(async () => { await environment.teardown(); });

  it('executes an authored graph and replays its recorded history', async () => {
    const taskQueue = `test-${crypto.randomUUID()}`; const states: string[] = [];
    const worker = await Worker.create({
      connection: environment.nativeConnection, taskQueue,
      workflowsPath: new URL('../src/temporal/workflows.ts', import.meta.url).pathname,
      activities: {
        recordEnrollmentState: async (_enrollmentId: string, state: string) => { states.push(state); },
        executeAction: async () => 'succeeded' as const,
        evaluateCondition: async () => true,
      },
    });
    const handle = await environment.client.workflow.start(enrollmentWorkflow, {
      taskQueue, workflowId: `workflow-${crypto.randomUUID()}`,
      args: [{ workspaceId: crypto.randomUUID(), enrollmentId: crypto.randomUUID(), definition: {
        schemaVersion: '1', description: 'Replay test', trigger: { type: 'manual' }, purpose: 'transactional', topic: 'test', entryNodeId: 'update',
        nodes: [
          { id: 'update', type: 'action', action: 'contact.update', input: { fields: { literal: { tested: true } } }, next: 'done', onError: 'fail' },
          { id: 'done', type: 'end', reason: 'completed' },
        ],
      } }],
    });
    const result = await worker.runUntil(handle.result());
    expect(result).toBe('completed'); expect(states).toContain('completed');
    const history = await handle.fetchHistory();
    await Worker.runReplayHistory({ workflowsPath: new URL('../src/temporal/workflows.ts', import.meta.url).pathname }, history, handle.workflowId);
  }, 30_000);
});
