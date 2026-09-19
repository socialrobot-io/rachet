import { describe, expect, it } from 'vitest';
import { structureWorkflow, type Block } from './structure';
import { onboardingDefinition } from './test/onboarding';
import type { FlowNode, WorkflowDefinition } from './types';

function definition(nodes: FlowNode[], entryNodeId = nodes[0]?.id ?? ''): WorkflowDefinition {
  return {
    schemaVersion: '1',
    description: 'test',
    trigger: { type: 'manual' },
    entryNodeId,
    nodes,
  };
}

function kinds(blocks: Block[]): string[] {
  return blocks.map((block) => block.kind);
}

/** Every definition node appears in the tree at least once; no unknown ids. */
function collectIds(blocks: Block[]): Map<string, number> {
  const seen = new Map<string, number>();
  const walk = (list: Block[]): void => {
    for (const block of list) {
      seen.set(block.id, (seen.get(block.id) ?? 0) + 1);
      if (block.kind === 'branch') {
        walk(block.yes);
        walk(block.no);
      }
      if (block.kind === 'wait') {
        walk(block.eventArm);
        walk(block.timeoutArm);
      }
    }
  };
  walk(blocks);
  return seen;
}

describe('structureWorkflow', () => {
  it('structures a linear sequence as flat blocks', () => {
    const tree = structureWorkflow(
      definition([
        { id: 'send_a', type: 'action', action: 'email.send', input: {}, next: 'pause' },
        { id: 'pause', type: 'delay', durationSeconds: 60, next: 'send_b' },
        { id: 'send_b', type: 'action', action: 'email.send', input: {}, next: 'done' },
        { id: 'done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    expect(kinds(tree!)).toEqual(['action', 'delay', 'action', 'exit']);
    expect(tree![3]).toMatchObject({ kind: 'exit', id: 'done' });
  });

  it('renders an entry exit-guard as a branch with one exit arm', () => {
    const tree = structureWorkflow(
      definition([
        {
          id: 'guard',
          type: 'branch',
          condition: { op: 'event_received', eventType: 'posts.queued' },
          onTrue: 'end_early',
          onFalse: 'send_a',
        },
        { id: 'end_early', type: 'end', reason: 'posts_queued' },
        { id: 'send_a', type: 'action', action: 'email.send', input: {}, next: 'end_done' },
        { id: 'end_done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    expect(kinds(tree!)).toEqual(['branch', 'action', 'exit']);
    const guard = tree![0];
    expect(guard).toMatchObject({ kind: 'branch', id: 'guard' });
    if (guard.kind !== 'branch') throw new Error('unreachable');
    expect(kinds(guard.yes)).toEqual(['exit']);
    expect(guard.no).toEqual([]);
  });

  it('nests a skip guard and continues at the join', () => {
    const tree = structureWorkflow(
      definition([
        {
          id: 'guard',
          type: 'branch',
          condition: { op: 'field_equals', field: 'connected' },
          onTrue: 'wait',
          onFalse: 'send_a',
        },
        { id: 'send_a', type: 'action', action: 'email.send', input: {}, next: 'wait' },
        {
          id: 'wait',
          type: 'wait_for_event',
          eventType: 'posts.queued',
          timeoutSeconds: 86_400,
          onEvent: 'end_early',
          onTimeout: 'end_done',
        },
        { id: 'end_early', type: 'end', reason: 'posts_queued' },
        { id: 'end_done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    expect(kinds(tree!)).toEqual(['branch', 'wait', 'exit']);
    const guard = tree![0];
    if (guard.kind !== 'branch') throw new Error('unreachable');
    expect(guard.yes).toEqual([]);
    expect(kinds(guard.no)).toEqual(['action']);
    const wait = tree![1];
    if (wait.kind !== 'wait') throw new Error('unreachable');
    expect(kinds(wait.eventArm)).toEqual(['exit']);
    expect(wait.timeoutArm).toEqual([]);
  });

  it('keeps a locale split as a two-arm branch of single actions', () => {
    const tree = structureWorkflow(
      definition([
        {
          id: 'locale',
          type: 'branch',
          condition: { op: 'field_equals', field: 'locale' },
          onTrue: 'send_es',
          onFalse: 'send_en',
        },
        { id: 'send_es', type: 'action', action: 'email.send', input: {}, next: 'done' },
        { id: 'send_en', type: 'action', action: 'email.send', input: {}, next: 'done' },
        { id: 'done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    const branch = tree![0];
    if (branch.kind !== 'branch') throw new Error('unreachable');
    expect(kinds(branch.yes)).toEqual(['action']);
    expect(kinds(branch.no)).toEqual(['action']);
    expect(tree![1]).toMatchObject({ kind: 'exit', id: 'done' });
  });

  it('nests guard chains three levels deep', () => {
    const tree = structureWorkflow(
      definition([
        {
          id: 'g1',
          type: 'branch',
          condition: { op: 'field_equals', field: 'a' },
          onTrue: 'wait',
          onFalse: 'g2',
        },
        {
          id: 'g2',
          type: 'branch',
          condition: { op: 'field_equals', field: 'b' },
          onTrue: 'wait',
          onFalse: 'loc',
        },
        {
          id: 'loc',
          type: 'branch',
          condition: { op: 'field_equals', field: 'locale' },
          onTrue: 'send_es',
          onFalse: 'send_en',
        },
        { id: 'send_es', type: 'action', action: 'email.send', input: {}, next: 'wait' },
        { id: 'send_en', type: 'action', action: 'email.send', input: {}, next: 'wait' },
        {
          id: 'wait',
          type: 'wait_for_event',
          eventType: 'posts.queued',
          timeoutSeconds: 86_400,
          onEvent: 'end_early',
          onTimeout: 'end_done',
        },
        { id: 'end_early', type: 'end', reason: 'posts_queued' },
        { id: 'end_done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    expect(kinds(tree!)).toEqual(['branch', 'wait', 'exit']);
    const g1 = tree![0];
    if (g1.kind !== 'branch') throw new Error('unreachable');
    expect(g1.yes).toEqual([]);
    const g2 = g1.no[0];
    if (g2.kind !== 'branch') throw new Error('unreachable');
    expect(g2.yes).toEqual([]);
    const loc = g2.no[0];
    if (loc.kind !== 'branch') throw new Error('unreachable');
    expect(kinds(loc.yes)).toEqual(['action']);
    expect(kinds(loc.no)).toEqual(['action']);
  });

  it('nests both wait arms when they reconverge with content', () => {
    const tree = structureWorkflow(
      definition([
        { id: 'send_a', type: 'action', action: 'email.send', input: {}, next: 'wait' },
        {
          id: 'wait',
          type: 'wait_for_event',
          eventType: 'email.opened',
          timeoutSeconds: 3_600,
          onEvent: 'join',
          onTimeout: 'send_b',
        },
        { id: 'send_b', type: 'action', action: 'email.send', input: {}, next: 'join' },
        { id: 'join', type: 'delay', durationSeconds: 60, next: 'done' },
        { id: 'done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    const wait = tree![1];
    if (wait.kind !== 'wait') throw new Error('unreachable');
    expect(wait.eventArm).toEqual([]);
    expect(kinds(wait.timeoutArm)).toEqual(['action']);
    expect(kinds(tree!.slice(2))).toEqual(['delay', 'exit']);
  });

  it('closes the region when both branch arms terminate at different exits', () => {
    const tree = structureWorkflow(
      definition([
        {
          id: 'final',
          type: 'branch',
          condition: { op: 'field_equals', field: 'active' },
          onTrue: 'end_active',
          onFalse: 'send_restart',
        },
        { id: 'end_active', type: 'end', reason: 'activated' },
        { id: 'send_restart', type: 'action', action: 'email.send', input: {}, next: 'end_done' },
        { id: 'end_done', type: 'end', reason: 'completed' },
      ]),
    );
    expect(tree).not.toBeNull();
    expect(kinds(tree!)).toEqual(['branch', 'action', 'exit']);
    const branch = tree![0];
    if (branch.kind !== 'branch') throw new Error('unreachable');
    expect(kinds(branch.yes)).toEqual(['exit']);
    expect(branch.no).toEqual([]);
  });

  it('returns null for a cycle', () => {
    const tree = structureWorkflow(
      definition([
        { id: 'a', type: 'delay', durationSeconds: 60, next: 'b' },
        { id: 'b', type: 'delay', durationSeconds: 60, next: 'a' },
      ]),
    );
    expect(tree).toBeNull();
  });

  it('returns null for a dangling target', () => {
    const tree = structureWorkflow(
      definition([{ id: 'a', type: 'action', action: 'email.send', input: {}, next: 'missing' }]),
    );
    expect(tree).toBeNull();
  });

  describe('real onboarding workflow', () => {
    const tree = structureWorkflow(onboardingDefinition);
    expect(tree).not.toBeNull();
    const blocks = tree!;

    it('covers every definition node', () => {
      const seen = collectIds(blocks);
      for (const node of onboardingDefinition.nodes) {
        expect(seen.has(node.id), `missing ${node.id}`).toBe(true);
      }
    });

    it('reads as the expected document shape', () => {
      expect(kinds(blocks)).toEqual([
        'branch', // entry exit guard
        'branch', // welcome guard chain
        'wait',
        'branch', // day 1 guards
        'wait',
        'branch', // day 3 guards
        'wait',
        'branch', // day 5 locale
        'wait',
        'branch', // day 8 locale
        'wait',
        'branch', // day 14 active/restart
        'exit',
      ]);
    });

    it('nests the welcome chain under its two guards', () => {
      const welcome = blocks[1];
      if (welcome.kind !== 'branch') throw new Error('unreachable');
      expect(welcome.id).toBe('check_already_connected');
      expect(welcome.yes).toEqual([]);
      const field = welcome.no[0];
      if (field.kind !== 'branch') throw new Error('unreachable');
      const locale = field.no[0];
      if (locale.kind !== 'branch') throw new Error('unreachable');
      expect(locale.yes).toMatchObject([{ kind: 'action', id: 'send_welcome_es' }]);
      expect(locale.no).toMatchObject([{ kind: 'action', id: 'send_welcome_en' }]);
    });

    it('turns every wait event arm into an exit', () => {
      const waits = blocks.filter((block) => block.kind === 'wait');
      expect(waits).toHaveLength(5);
      for (const wait of waits) {
        if (wait.kind !== 'wait') throw new Error('unreachable');
        expect(kinds(wait.eventArm)).toEqual(['exit']);
        expect(wait.timeoutArm).toEqual([]);
      }
    });

    it('splits day 14 into active and restart locale arms', () => {
      const day14 = blocks[blocks.length - 2];
      if (day14.kind !== 'branch') throw new Error('unreachable');
      expect(day14.id).toBe('check_active_day14');
      const yes = day14.yes[0];
      const no = day14.no[0];
      if (yes.kind !== 'branch' || no.kind !== 'branch') throw new Error('unreachable');
      expect(kinds(yes.yes)).toEqual(['action']);
      expect(kinds(no.no)).toEqual(['action']);
    });
  });
});
