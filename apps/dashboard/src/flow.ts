import type { Enrollment, FlowNode, ReceivedEvent, WorkflowDefinition } from './types';

const ACTIVE_STATES = new Set(['pending_start', 'running', 'waiting', 'paused', 'needs_attention']);

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `+${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `+${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `+${seconds / 60}m`;
  return `+${seconds}s`;
}

export function nodeGlyph(node: FlowNode): string {
  switch (node.type) {
    case 'action':
      return node.action === 'email.send' ? '✉' : '▸';
    case 'delay':
      return '◷';
    case 'wait_for_event':
      return '◷';
    case 'branch':
      return '◆';
    case 'end':
      return '■';
  }
}

const OP_SYMBOL: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
};

function valueSourceLabel(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const record = source as Record<string, unknown>;
  if (typeof record.path === 'string') {
    return record.path.replace(/^(contact|variables|event)\./, '');
  }
  if ('literal' in record) {
    return typeof record.literal === 'string' ? record.literal : JSON.stringify(record.literal);
  }
  return undefined;
}

/** Human-readable form of a branch condition, e.g. `locale = "es"?`. */
export function conditionLabel(condition: { op: string; [key: string]: unknown }): string | undefined {
  if (condition.op === 'event_received' && typeof condition.eventType === 'string') {
    return `${condition.eventType}?`;
  }
  if (condition.op === 'exists') {
    const value = valueSourceLabel(condition.value);
    return value ? `${value}?` : undefined;
  }
  const symbol = OP_SYMBOL[condition.op];
  if (symbol) {
    const left = valueSourceLabel(condition.left);
    const right = valueSourceLabel(condition.right);
    if (left && right) return `${left} ${symbol} ${right}?`;
  }
  return undefined;
}

export function nodeLabel(node: FlowNode): string {
  switch (node.type) {
    case 'action':
      return node.action === 'email.send' ? humanizeId(node.id) : node.action;
    case 'delay':
      return `wait ${formatDuration(node.durationSeconds).slice(1)}`;
    case 'wait_for_event':
      return `${node.eventType}?`;
    case 'branch':
      return conditionLabel(node.condition) ?? humanizeId(node.id);
    case 'end':
      return node.reason;
  }
}

export function humanizeId(id: string): string {
  return id
    .replace(/^(send_|branch_|delay_|wait_|check_|locale_)/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isActiveEnrollment(enrollment: Enrollment): boolean {
  return ACTIVE_STATES.has(enrollment.state);
}

export function countsByStep(enrollments: Enrollment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const enrollment of enrollments) {
    if (!isActiveEnrollment(enrollment) || !enrollment.currentStepId) continue;
    counts.set(enrollment.currentStepId, (counts.get(enrollment.currentStepId) ?? 0) + 1);
  }
  return counts;
}

export function compactPreview(definition: WorkflowDefinition, maxNodes = 5): string {
  const spine: string[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  let current: string | undefined = definition.entryNodeId;
  const seen = new Set<string>();
  while (current && spine.length < maxNodes && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node) break;
    if (node.type !== 'delay') spine.push(`${nodeGlyph(node)} ${nodeLabel(node)}`);
    if (node.type === 'action' || node.type === 'delay') current = node.next;
    else if (node.type === 'wait_for_event') current = node.onTimeout;
    else if (node.type === 'branch') current = node.onFalse;
    else break;
  }
  return spine.join(' → ');
}

export type TraceItem = {
  id: string;
  status: 'past' | 'current' | 'future';
  title: string;
  detail?: string;
  timestamp?: string;
  remainingLabel?: string;
  progress?: number;
  nodeType?: string;
};

export type SeenEvent = {
  type: string;
  receivedAt?: string;
};

export type ExecutionTrace = {
  items: TraceItem[];
  eventsSeen: SeenEvent[];
};

export function buildExecutionTrace(
  definition: WorkflowDefinition,
  enrollment: Enrollment,
  messages: { stepId: string; state: string; subject: string; createdAt: string; acceptedAt: string | null }[],
  receivedEvents: ReceivedEvent[] = enrollment.receivedEvents ?? [],
): ExecutionTrace {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const sent = new Map(messages.map((message) => [message.stepId, message]));
  const items: TraceItem[] = [];
  const pathEvents: string[] = [];
  const currentId = enrollment.currentStepId;

  const markEventSeen = (eventType: string) => {
    if (!pathEvents.includes(eventType)) pathEvents.push(eventType);
  };

  items.push({
    id: 'entered',
    status: 'past',
    title: `Entered ${enrollment.workflowName}`,
    detail: enrollment.definition.trigger.type === 'manual' ? 'Manual trigger' : enrollment.definition.trigger.type,
    timestamp: enrollment.createdAt,
  });

  const visited = new Set<string>();
  let cursor: string | undefined = definition.entryNodeId;
  let reachedCurrent = false;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node = nodes.get(cursor);
    if (!node) break;

    const isCurrent = cursor === currentId;
    if (isCurrent) reachedCurrent = true;

    const message = sent.get(node.id);

    if (isCurrent) {
      const waiting = enrollment.state === 'waiting' || node.type === 'delay' || node.type === 'wait_for_event';
      let remainingLabel: string | undefined;
      let progress: number | undefined;
      let detail = node.id;
      let title = nodeLabel(node);

      if (node.type === 'delay') {
        title = `Wait · ${humanizeId(node.id)}`;
        const started = new Date(enrollment.updatedAt).getTime();
        const ends = started + node.durationSeconds * 1000;
        const now = Date.now();
        const remainingMs = Math.max(0, ends - now);
        remainingLabel = formatRemaining(remainingMs);
        progress = Math.min(100, Math.max(0, ((now - started) / (node.durationSeconds * 1000)) * 100));
        detail = `Resumes ${formatWhen(new Date(ends).toISOString())}`;
      } else if (node.type === 'wait_for_event') {
        title = `Wait for ${node.eventType}`;
        detail = `Timeout ${formatDuration(node.timeoutSeconds).slice(1)}`;
      } else if (node.type === 'action' && message) {
        title = node.action === 'email.send' ? `Email · ${humanizeId(node.id)}` : nodeLabel(node);
        detail = `Sent · ${message.subject}`;
      } else if (waiting) {
        title = 'Waiting';
        detail = `${enrollment.state} · ${node.id}`;
      }

      items.push({
        id: node.id,
        status: 'current',
        title,
        detail,
        remainingLabel,
        progress,
        nodeType: node.type,
      });
    } else if (node.type === 'action' && message) {
      items.push({
        id: node.id,
        status: 'past',
        title: 'Email sent',
        detail: `${nodeLabel(node)} · ${message.subject}`,
        timestamp: message.acceptedAt ?? message.createdAt,
        nodeType: node.type,
      });
    } else if (reachedCurrent) {
      items.push({
        id: node.id,
        status: 'future',
        title: futureTitle(node),
        nodeType: node.type,
      });
    } else if (node.type === 'branch') {
      items.push({
        id: node.id,
        status: 'past',
        title: 'Condition evaluated',
        detail: nodeLabel(node),
        nodeType: node.type,
      });
    } else if (node.type === 'delay') {
      items.push({
        id: node.id,
        status: 'past',
        title: 'Wait completed',
        detail: humanizeId(node.id),
        nodeType: node.type,
      });
    }

    if (isCurrent && enrollment.state !== 'completed') {
      let next: string | undefined;
      if (node.type === 'action' || node.type === 'delay') next = node.next;
      else if (node.type === 'wait_for_event') next = node.onTimeout;
      else if (node.type === 'branch') next = node.onFalse;
      cursor = next;
      reachedCurrent = true;
      continue;
    }

    if (node.type === 'end') break;
    if (node.type === 'action' || node.type === 'delay') cursor = node.next;
    else if (node.type === 'wait_for_event') {
      const towardEvent = pathContains(nodes, node.onEvent, currentId);
      if (towardEvent) markEventSeen(node.eventType);
      cursor = towardEvent ? node.onEvent : node.onTimeout;
    } else if (node.type === 'branch') {
      const towardTrue = pathContains(nodes, node.onTrue, currentId);
      if (towardTrue && node.condition.op === 'event_received' && typeof node.condition.eventType === 'string') {
        markEventSeen(node.condition.eventType);
      }
      cursor = towardTrue ? node.onTrue : node.onFalse;
    } else break;
  }

  const eventItems: TraceItem[] = receivedEvents.map((event) => ({
    id: `event:${event.eventId}`,
    status: 'past',
    title: `Event · ${event.eventType}`,
    detail: event.eventId,
    timestamp: event.receivedAt,
  }));

  const past = items.filter((item) => item.status === 'past');
  const nonPast = items.filter((item) => item.status !== 'past');
  const stamped = [...past.filter((item) => item.timestamp), ...eventItems].sort(
    (left, right) => Date.parse(left.timestamp ?? '') - Date.parse(right.timestamp ?? ''),
  );
  const unstamped = past.filter((item) => !item.timestamp);
  const merged = [...stamped, ...unstamped, ...nonPast];

  const eventsSeen: SeenEvent[] = [];
  for (const event of receivedEvents) {
    if (!eventsSeen.some((seen) => seen.type === event.eventType)) {
      eventsSeen.push({ type: event.eventType, receivedAt: event.receivedAt });
    }
  }
  if (eventsSeen.length === 0) {
    for (const eventType of pathEvents) eventsSeen.push({ type: eventType });
  }

  return { items: merged, eventsSeen };
}

function futureTitle(node: FlowNode): string {
  switch (node.type) {
    case 'action':
      return node.action === 'email.send' ? `Email · ${humanizeId(node.id)}` : `Action · ${node.action}`;
    case 'delay':
      return `Wait · ${humanizeId(node.id)}`;
    case 'wait_for_event':
      return `Wait for ${node.eventType}`;
    case 'branch':
      return `Condition · ${nodeLabel(node)}`;
    case 'end':
      return `End · ${node.reason}`;
  }
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function formatElapsed(fromIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(fromIso).getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${totalMinutes}m`;
}

export function pathContains(nodes: Map<string, FlowNode>, start: string, target: string | null): boolean {
  if (!target) return false;
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    if (id === target) return true;
    seen.add(id);
    const node = nodes.get(id);
    if (!node || node.type === 'end') continue;
    if (node.type === 'action' || node.type === 'delay') queue.push(node.next);
    else if (node.type === 'wait_for_event') queue.push(node.onEvent, node.onTimeout);
    else if (node.type === 'branch') queue.push(node.onTrue, node.onFalse);
  }
  return false;
}

export type EnrollmentPath = {
  /** Nodes the enrollment has visited, including the current node. */
  nodeIds: Set<string>;
  currentId: string | null;
  /** `source->target` keys for the edges the enrollment actually took. */
  edgeKeys: Set<string>;
};

/**
 * Walk the definition from the entry node toward the enrollment's current node,
 * resolving each branch by which side can still reach the current node.
 */
export function computeEnrollmentPath(
  definition: WorkflowDefinition,
  enrollment: Pick<Enrollment, 'currentStepId'>,
): EnrollmentPath {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const currentId = enrollment.currentStepId;
  const path: string[] = [];
  const edgeKeys = new Set<string>();
  const visited = new Set<string>();

  let cursor: string | undefined = definition.entryNodeId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node = nodes.get(cursor);
    if (!node) break;
    path.push(cursor);
    if (cursor === currentId) break;

    let next: string | undefined;
    if (node.type === 'action' || node.type === 'delay') next = node.next;
    else if (node.type === 'wait_for_event') {
      next = pathContains(nodes, node.onEvent, currentId) ? node.onEvent : node.onTimeout;
    } else if (node.type === 'branch') {
      next = pathContains(nodes, node.onTrue, currentId) ? node.onTrue : node.onFalse;
    }
    if (!next) break;
    edgeKeys.add(`${cursor}->${next}`);
    cursor = next;
  }

  return { nodeIds: new Set(path), currentId, edgeKeys };
}

export function formatWhen(value: string): string {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function contactDisplayName(fields: Record<string, unknown>, email: string): string {
  const first = typeof fields.firstName === 'string' ? fields.firstName : undefined;
  const last = typeof fields.lastName === 'string' ? fields.lastName : undefined;
  const name = [first, last].filter(Boolean).join(' ');
  return name || email.split('@')[0] || email;
}
