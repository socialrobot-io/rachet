import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { workflowDefinitionSchema } from '../packages/contracts/src/index.js';
import { renderMermaidWorkflow, renderWorkflowSvg } from '../packages/cli/src/tui/workflow-graph.js';

describe('workflow diagram rendering', () => {
  const definition = workflowDefinitionSchema.parse(JSON.parse(readFileSync(new URL('../examples/onboarding.workflow.json', import.meta.url), 'utf8')));

  it('exports valid Mermaid flowchart source without using workflow IDs as Mermaid identifiers', () => {
    const diagram = renderMermaidWorkflow(definition);
    expect(diagram).toMatch(/^flowchart TD/);
    expect(diagram).toContain('n0 -->|"next"| n1');
    expect(diagram).toContain('n1 -->|"on product.activated"| n2');
  });

  it('renders generated Mermaid as a self-contained SVG', () => {
    const svg = renderWorkflowSvg(definition);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('welcome  action · email.send');
    expect(svg).toContain('product.activated');

    expect(svg).not.toContain('@import');
  });
});
