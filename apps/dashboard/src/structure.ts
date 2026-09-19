import type { FlowNode, WorkflowDefinition } from './types';

export type ActionNode = Extract<FlowNode, { type: 'action' }>;
export type DelayNode = Extract<FlowNode, { type: 'delay' }>;
export type BranchNode = Extract<FlowNode, { type: 'branch' }>;
export type WaitNode = Extract<FlowNode, { type: 'wait_for_event' }>;
export type EndNode = Extract<FlowNode, { type: 'end' }>;

/**
 * The presentation tree: a workflow compiled from its arbitrary DAG form into
 * nested blocks. Branches are contained regions whose arms rejoin implicitly
 * when the block ends, waits nest their event arm, and exits terminate a
 * region. There are no edges to trace; the document reads top to bottom.
 */
export type Block =
  | { kind: 'action'; id: string; node: ActionNode }
  | { kind: 'delay'; id: string; node: DelayNode }
  | { kind: 'branch'; id: string; node: BranchNode; yes: Block[]; no: Block[] }
  | { kind: 'wait'; id: string; node: WaitNode; eventArm: Block[]; timeoutArm: Block[] }
  | { kind: 'exit'; id: string; node: EndNode };

export function titleize(slug: string): string {
  return slug
    .replace(/_+$/, '')
    .replaceAll('_', ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/** Longest shared prefix across ids, trimmed back to the last underscore. */
export function commonPrefix(ids: string[]): string {
  if (ids.length === 0) return '';
  let prefix = ids[0];
  for (const id of ids.slice(1)) {
    while (prefix && !id.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const boundary = prefix.lastIndexOf('_');
  return boundary > 0 ? prefix.slice(0, boundary + 1) : '';
}

function successorsOf(node: FlowNode): string[] {
  switch (node.type) {
    case 'action':
    case 'delay':
      return [node.next];
    case 'wait_for_event':
      return [node.onEvent, node.onTimeout];
    case 'branch':
      return [node.onTrue, node.onFalse];
    case 'end':
      return [];
  }
}

type Built = { blocks: Block[]; reachesStop: boolean };

/**
 * Compile a workflow definition into its document tree via post-dominator
 * analysis. Returns null only for irreducible regions (arms that rejoin
 * somewhere past the enclosing region), which the validator's constraints
 * make pathological; every current workflow structures cleanly.
 *
 * The rules that make drip sequences read as a document:
 * - A split whose arms reconverge (an immediate post-dominator exists) becomes
 *   a branch/wait block with both arms nested; the parent continues at the
 *   join. Skip guards and locale splits fall out of this naturally.
 * - A split with no rejoin continues the parent on one arm (timeout for
 *   waits, onFalse for branches, or whichever arm can still reach the
 *   enclosing region's end) and nests the other, which must terminate in an
 *   exit. That is the "wait for event, otherwise keep going" idiom.
 */
export function structureWorkflow(definition: WorkflowDefinition): Block[] | null {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  if (!nodes.has(definition.entryNodeId)) return null;

  const succ = (id: string): string[] => {
    const node = nodes.get(id);
    if (!node) return [];
    return successorsOf(node).filter((target) => nodes.has(target));
  };

  // Post-dominator sets: pdom(n) = { n } ∪ (⋂ pdom(s) over successors s).
  const pdom = new Map<string, Set<string>>();
  for (const node of definition.nodes) pdom.set(node.id, new Set([node.id]));
  let changed = true;
  let rounds = 0;
  while (changed && rounds <= definition.nodes.length + 1) {
    changed = false;
    rounds += 1;
    for (const node of definition.nodes) {
      const targets = succ(node.id);
      if (targets.length === 0) continue;
      let acc: Set<string> | undefined;
      for (const target of targets) {
        const next = pdom.get(target);
        if (!next) continue;
        if (!acc) {
          acc = new Set(next);
        } else {
          for (const x of acc) if (!next.has(x)) acc.delete(x);
        }
      }
      const computed = acc ?? new Set<string>();
      computed.add(node.id);
      const prev = pdom.get(node.id)!;
      if (computed.size !== prev.size || [...computed].some((x) => !prev.has(x))) {
        pdom.set(node.id, computed);
        changed = true;
      }
    }
  }

  /** The strict post-dominator that every other strict post-dominator post-dominates. */
  const ipdomOf = (id: string): string | undefined => {
    const set = pdom.get(id);
    if (!set) return undefined;
    const strict = [...set].filter((x) => x !== id);
    return strict.find((candidate) =>
      strict.every((other) => other === candidate || (pdom.get(candidate)?.has(other) ?? false)),
    );
  };

  const canReach = (start: string, target: string): boolean => {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...succ(id));
    }
    return false;
  };

  const build = (start: string, stop: string | null): Built | null => {
    const blocks: Block[] = [];
    let cur: string = start;
    const seen = new Set<string>();
    while (cur !== stop) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const node = nodes.get(cur);
      if (!node) return null;
      if (node.type === 'end') {
        blocks.push({ kind: 'exit', id: node.id, node });
        return { blocks, reachesStop: false };
      }
      if (node.type === 'action') {
        blocks.push({ kind: 'action', id: node.id, node });
        cur = node.next;
        continue;
      }
      if (node.type === 'delay') {
        blocks.push({ kind: 'delay', id: node.id, node });
        cur = node.next;
        continue;
      }

      const join = ipdomOf(node.id);
      if (join !== undefined) {
        if (node.type === 'branch') {
          const yes = build(node.onTrue, join);
          const no = build(node.onFalse, join);
          if (!yes || !no) return null;
          blocks.push({ kind: 'branch', id: node.id, node, yes: yes.blocks, no: no.blocks });
        } else {
          const eventArm = build(node.onEvent, join);
          const timeoutArm = build(node.onTimeout, join);
          if (!eventArm || !timeoutArm) return null;
          blocks.push({
            kind: 'wait',
            id: node.id,
            node,
            eventArm: eventArm.blocks,
            timeoutArm: timeoutArm.blocks,
          });
        }
        cur = join;
        continue;
      }

      // No rejoin: one arm continues the parent region, the other must exit.
      const armIds =
        node.type === 'branch' ? [node.onTrue, node.onFalse] : [node.onEvent, node.onTimeout];
      let continueId: string | undefined;
      if (stop !== null) {
        const reaching = armIds.filter((arm) => canReach(arm, stop));
        if (reaching.length > 1) return null;
        continueId = reaching[0];
      }
      continueId ??= node.type === 'wait_for_event' ? node.onTimeout : node.onFalse;

      const armBlocks = new Map<string, Block[]>();
      for (const arm of armIds) {
        if (arm === continueId) continue;
        const region = build(arm, stop);
        if (!region || region.reachesStop) return null;
        armBlocks.set(arm, region.blocks);
      }
      if (node.type === 'branch') {
        blocks.push({
          kind: 'branch',
          id: node.id,
          node,
          yes: node.onTrue === continueId ? [] : armBlocks.get(node.onTrue)!,
          no: node.onFalse === continueId ? [] : armBlocks.get(node.onFalse)!,
        });
      } else {
        blocks.push({
          kind: 'wait',
          id: node.id,
          node,
          eventArm: node.onEvent === continueId ? [] : armBlocks.get(node.onEvent)!,
          timeoutArm: node.onTimeout === continueId ? [] : armBlocks.get(node.onTimeout)!,
        });
      }
      cur = continueId;
    }
    return { blocks, reachesStop: true };
  };

  const top = build(definition.entryNodeId, null);
  return top?.blocks ?? null;
}
