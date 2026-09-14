import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { workflowDefinitionSchema } from '../src/domain/contracts.js';
import { renderMermaidTerminal, renderMermaidWorkflow, renderTerminalWorkflow } from '../src/tui/workflow-graph.js';

describe('workflow terminal rendering', () => {
  const definition = workflowDefinitionSchema.parse(JSON.parse(readFileSync(new URL('../examples/onboarding.workflow.json', import.meta.url), 'utf8')));

  it('renders every branch and marks converging nodes as references', () => {
    const diagram = renderTerminalWorkflow(definition, 120);
    expect(diagram).toContain('● welcome  action · email.send');
    expect(diagram).toContain('product.activated');
    expect(diagram).toContain('on timeout');
    expect(diagram).toContain('■ converted  end · activated');
  });

  it('exports valid Mermaid flowchart source without using workflow IDs as Mermaid identifiers', () => {
    const diagram = renderMermaidWorkflow(definition);
    expect(diagram).toMatch(/^flowchart TD/);
    expect(diagram).toContain('n0 -->|"next"| n1');
    expect(diagram).toContain('n1 -->|"on product.activated"| n2');
  });

  it('renders generated Mermaid as a Unicode terminal diagram', () => {
    const diagram = renderMermaidTerminal(definition, 100);
    expect(diagram).toContain('┌');
    expect(diagram).toContain('welcome  action · email.send');
    expect(diagram).toContain('product.activated');
    expect(diagram).toContain('▼');
  });
});
