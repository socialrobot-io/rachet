import { z } from 'zod';
import type { FlowNode, ValueSource } from './contracts.js';
import { ReflowError } from './errors.js';

export type ActionDefinition = {
  description: string;
  sideEffect: boolean;
  input: Record<string, { description: string; required: boolean; example?: unknown }>;
};

export const actionCatalog = {
  'email.send': {
    description: 'Send a published template (stored HTML + plain text) through the configured email provider after interpolating {{placeholders}}.',
    sideEffect: true,
    input: {
      templateVersionId: { description: 'Published template version UUID.', required: true },
      props: { description: 'Additional template properties. Contact and enrollment variables are always available.', required: false, example: { plan: 'pro' } },
    },
  },
  'contact.update': {
    description: 'Merge fields into the enrolled contact record.',
    sideEffect: true,
    input: {
      fields: { description: 'Object of contact fields to merge.', required: true, example: { lifecycle: 'activated' } },
    },
  },
} satisfies Record<string, ActionDefinition>;

export type ActionKey = keyof typeof actionCatalog;

export function validateActionNodes(nodes: FlowNode[]): void {
  for (const node of nodes) {
    if (node.type !== 'action') continue;
    const action = actionCatalog[node.action as ActionKey];
    if (!action) throw new ReflowError('VALIDATION_FAILED', `Unknown action capability: ${node.action}`, 422);
    for (const [name, field] of Object.entries(action.input)) {
      if (field.required && !(name in node.input)) {
        throw new ReflowError('VALIDATION_FAILED', `Action ${node.action} requires input.${name}`, 422);
      }
    }
  }
}

export const resolvedActionInputSchema = z.record(z.string(), z.json());

export function valueAtPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, root);
}

export function resolveValue(source: ValueSource, root: Record<string, unknown>): unknown {
  if ('literal' in source) return source.literal;
  return valueAtPath(root, source.path) ?? source.default;
}

export function resolveActionInput(input: Record<string, ValueSource>, root: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([name, source]) => [name, resolveValue(source, root)]));
}
