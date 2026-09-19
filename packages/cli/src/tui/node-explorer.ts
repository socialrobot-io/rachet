import type { FlowCondition, FlowNode, ValueSource, WorkflowDefinition } from '../../../contracts/src/index.js';

export type NodeRoute = { label: string; target: string };
export type DetailRow = { label: string; value: string };

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? '' : 's'}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function valueSource(source: ValueSource): string {
  if ('path' in source) {
    const fallback = source.default === undefined ? '' : ` (default: ${JSON.stringify(source.default)})`;
    return `${source.path}${fallback}`;
  }
  return JSON.stringify(source.literal);
}

export function formatCondition(condition: FlowCondition): string {
  if (condition.op === 'event_received') return `event “${condition.eventType}” was received`;
  if (condition.op === 'exists') return `${valueSource(condition.value)} exists`;
  return `${valueSource(condition.left)} ${condition.op} ${valueSource(condition.right)}`;
}

export function nodeTitle(node: FlowNode): string {
  switch (node.type) {
    case 'action': return node.action;
    case 'delay': return `Wait ${formatDuration(node.durationSeconds)}`;
    case 'wait_for_event': return `Wait for ${node.eventType}`;
    case 'branch': return 'Evaluate condition';
    case 'end': return node.reason;
  }
}

export function nodeDetails(node: FlowNode): DetailRow[] {
  switch (node.type) {
    case 'action': return [
      { label: 'Action', value: node.action },
      { label: 'On error', value: node.onError },
      ...Object.entries(node.input).map(([name, source]) => ({ label: `Input · ${name}`, value: valueSource(source) })),
    ];
    case 'delay': return [{ label: 'Duration', value: formatDuration(node.durationSeconds) }];
    case 'wait_for_event': return [
      { label: 'Event', value: node.eventType },
      { label: 'Timeout', value: formatDuration(node.timeoutSeconds) },
    ];
    case 'branch': return [{ label: 'Condition', value: formatCondition(node.condition) }];
    case 'end': return [{ label: 'Result', value: node.reason }];
  }
}

export function nodeRoutes(node: FlowNode): NodeRoute[] {
  switch (node.type) {
    case 'action': return [{ label: 'Continue', target: node.next }];
    case 'delay': return [{ label: 'After the delay', target: node.next }];
    case 'wait_for_event': return [
      { label: `Event received · ${node.eventType}`, target: node.onEvent },
      { label: `Timed out · ${formatDuration(node.timeoutSeconds)}`, target: node.onTimeout },
    ];
    case 'branch': return [
      { label: 'Condition is true', target: node.onTrue },
      { label: 'Condition is false', target: node.onFalse },
    ];
    case 'end': return [];
  }
}

export function findNode(definition: WorkflowDefinition, id: string | undefined): FlowNode | undefined {
  return definition.nodes.find((node) => node.id === id);
}
