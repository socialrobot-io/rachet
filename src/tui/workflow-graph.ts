import type { FlowNode, WorkflowDefinition } from '../domain/contracts.js';
import { Resvg } from '@resvg/resvg-js';
import { renderMermaidSVG } from 'beautiful-mermaid';

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
    case 'action': return `${node.id}  action · ${node.action}`;
    case 'delay': return `${node.id}  delay · ${duration(node.durationSeconds)}`;
    case 'wait_for_event': return `${node.id}  wait · ${node.eventType} / ${duration(node.timeoutSeconds)}`;
    case 'branch': return `${node.id}  branch · ${node.condition.op}`;
    case 'end': return `${node.id}  end · ${node.reason}`;
  }
}

function mermaidText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

export function renderMermaidWorkflow(definition: WorkflowDefinition): string {
  const names = new Map(definition.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ['flowchart TD'];
  for (const node of definition.nodes) {
    const name = names.get(node.id) ?? node.id;
    const label = mermaidText(nodeLabel(node));
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

export function renderWorkflowSvg(definition: WorkflowDefinition): string {
  return renderMermaidSVG(renderMermaidWorkflow(definition), {
    bg: '#090f1d',
    fg: '#e6edf7',
    line: '#64748b',
    accent: '#22d3ee',
    muted: '#a8b3c7',
    surface: '#111b2e',
    border: '#3c4b63',
    padding: 32,
    nodeSpacing: 36,
    layerSpacing: 56,
  }).replace(/^[ \t]*@import[^\n]*\n/gm, '');
}

export function renderWorkflowPng(definition: WorkflowDefinition, widthPixels: number): Buffer {
  const svg = renderWorkflowSvg(definition);
  const rasterSvg = svg
    .replaceAll('var(--_text-sec)', '#a8b3c7')
    .replaceAll('var(--_text-muted)', '#7d899d')
    .replaceAll('var(--_text-faint)', '#536075')
    .replaceAll('var(--_text)', '#e6edf7')
    .replaceAll('var(--_line)', '#64748b')
    .replaceAll('var(--_arrow)', '#22d3ee')
    .replaceAll('var(--_node-fill)', '#111b2e')
    .replaceAll('var(--_node-stroke)', '#3c4b63')
    .replaceAll('var(--_group-fill)', '#090f1d')
    .replaceAll('var(--_group-hdr)', '#111b2e')
    .replaceAll('var(--_inner-stroke)', '#26354c')
    .replaceAll('var(--_key-badge)', '#1d2a40')
    .replaceAll('var(--bg)', '#090f1d');
  const renderer = new Resvg(rasterSvg, {
    fitTo: { mode: 'width', value: Math.max(320, Math.round(widthPixels)) },
    background: '#090f1d',
  });
  return renderer.render().asPng();
}
