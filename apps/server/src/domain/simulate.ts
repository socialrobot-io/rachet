import { resolveActionInput, resolveValue } from './action-catalog.js';
import type { FlowCondition, SimulatedEvent, WorkflowDefinition } from '@reflow/contracts';

function evaluate(condition: FlowCondition, root: Record<string, unknown>, receivedEvents: Set<string>): boolean {
  if (condition.op === 'event_received') return receivedEvents.has(condition.eventType);
  if (condition.op === 'exists') return resolveValue(condition.value, root) !== undefined;
  const left = resolveValue(condition.left, root); const right = resolveValue(condition.right, root);
  switch (condition.op) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'gt': return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lt': return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte': return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains': return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : Array.isArray(left) && left.includes(right);
  }
}

export function simulateWorkflow(definition: WorkflowDefinition, contact: Record<string, unknown>, variables: Record<string, unknown>, events: SimulatedEvent[]) {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const normalizedEvents = events.map((event, index) => ({ eventType: event.eventType, eventId: `simulation:${index}`, data: event.data }));
  const received = new Set(normalizedEvents.map((event) => event.eventType)); const trace: Record<string, unknown>[] = [];
  const root = { contact, variables, event: Object.fromEntries(normalizedEvents.map((event) => [event.eventType, { eventId: event.eventId, data: event.data }])) };
  let current = definition.entryNodeId;
  for (let count = 0; count < definition.nodes.length + 1; count += 1) {
    const node = nodes.get(current); if (!node) throw new Error(`Missing node ${current}`);
    if (node.type === 'end') { trace.push({ nodeId: node.id, type: node.type, reason: node.reason }); return { status: 'completed', trace, result: node.reason }; }
    if (node.type === 'action') { trace.push({ nodeId: node.id, type: node.type, action: node.action, resolvedInput: resolveActionInput(node.input, root), sideEffects: 'not_executed' }); current = node.next; continue; }
    if (node.type === 'delay') { trace.push({ nodeId: node.id, type: node.type, durationSeconds: node.durationSeconds, simulated: true }); current = node.next; continue; }
    if (node.type === 'wait_for_event') { const matched = received.has(node.eventType); trace.push({ nodeId: node.id, type: node.type, eventType: node.eventType, outcome: matched ? 'event' : 'timeout' }); current = matched ? node.onEvent : node.onTimeout; continue; }
    const matched = evaluate(node.condition, root, received); trace.push({ nodeId: node.id, type: node.type, outcome: matched }); current = matched ? node.onTrue : node.onFalse;
  }
  throw new Error('Simulation exceeded validated graph size');
}
