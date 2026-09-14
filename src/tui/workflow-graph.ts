import type { FlowNode, WorkflowDefinition } from '../domain/contracts.js';

type Edge = { label: string; target: string };

function edges(node: FlowNode): Edge[] {
  switch (node.type) {
    case 'action': return [{ label: 'next', target: node.next }];
    case 'delay': return [{ label: 'after delay', target: node.next }];
    case 'wait_for_event': return [
      { label: `on ${node.eventType}`, target: node.onEvent },
      { label: 'on timeout', target: node.onTimeout },
    ];
    case 'branch': return [{ label: 'true', target: node.onTrue }, { label: 'false', target: node.onFalse }];
    case 'end': return [];
  }
}

function duration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function nodeLabel(node: FlowNode): string {
  switch (node.type) {
    case 'action': return `● ${node.id}  action · ${node.action}`;
    case 'delay': return `◷ ${node.id}  delay · ${duration(node.durationSeconds)}`;
    case 'wait_for_event': return `◉ ${node.id}  wait · ${node.eventType} / ${duration(node.timeoutSeconds)}`;
    case 'branch': return `◇ ${node.id}  branch · ${node.condition.op}`;
    case 'end': return `■ ${node.id}  end · ${node.reason}`;
  }
}

function fit(value: string, width: number): string {
  if (value.length <= width) return value;
  return width <= 1 ? '…' : `${value.slice(0, width - 1)}…`;
}

export function renderTerminalWorkflow(definition: WorkflowDefinition, width = 100): string {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const expanded = new Set<string>();
  const lines = [
    `trigger: ${definition.trigger.type}  purpose: ${definition.purpose}  topic: ${definition.topic}`,
    '',
  ];

  function walk(id: string, prefix: string, connector: string): void {
    const node = byId.get(id);
    if (!node) {
      lines.push(fit(`${prefix}${connector}? ${id}  missing`, width));
      return;
    }
    const repeated = expanded.has(id);
    lines.push(fit(`${prefix}${connector}${nodeLabel(node)}${repeated ? '  ↩' : ''}`, width));
    if (repeated) return;
    expanded.add(id);
    const outgoing = edges(node);
    outgoing.forEach((edge, index) => {
      const last = index === outgoing.length - 1;
      walk(edge.target, `${prefix}${connector ? (connector.startsWith('└') ? '   ' : '│  ') : ''}`, `${last ? '└─' : '├─'} ${edge.label} → `);
    });
  }

  walk(definition.entryNodeId, '', '');
  return lines.join('\n');
}

function mermaidText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

export function renderMermaidWorkflow(definition: WorkflowDefinition): string {
  const names = new Map(definition.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ['flowchart TD'];
  for (const node of definition.nodes) {
    const name = names.get(node.id) ?? node.id;
    const label = mermaidText(nodeLabel(node).replace(/^[●◷◉◇■] /u, ''));
    if (node.type === 'branch') lines.push(`  ${name}{"${label}"}`);
    else if (node.type === 'end') lines.push(`  ${name}(["${label}"])`);
    else lines.push(`  ${name}["${label}"]`);
  }
  for (const node of definition.nodes) {
    const from = names.get(node.id) ?? node.id;
    for (const edge of edges(node)) {
      const to = names.get(edge.target) ?? edge.target;
      lines.push(`  ${from} -->|"${mermaidText(edge.label)}"| ${to}`);
    }
  }
  return lines.join('\n');
}
