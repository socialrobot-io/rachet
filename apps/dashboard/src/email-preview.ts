import { ApiError } from './api';
import { titleize } from './structure';
import type { RenderedEmail } from './types';

export type RenderTemplate = (props: Record<string, unknown>) => Promise<RenderedEmail>;

const SAMPLE_VALUES: Record<string, unknown> = {
  email: 'ada@example.com',
  firstname: 'Ada',
  lastname: 'Lovelace',
  name: 'Ada Lovelace',
  locale: 'en',
  plan: 'pro',
};

function sampleFor(path: string, origin: string): unknown {
  const key = path.split('.').at(-1)?.toLowerCase() ?? '';
  const base = origin.replace(/\/$/, '');
  if (key === 'logourl') return `${base}/brand/rachet-logo.png`;
  if (key === 'signatureurl') return `${base}/brand/founder-signature.png`;
  if (key === 'workflowsurl') return `${base}/workflows`;
  if (key === 'integrationsurl') return `${base}/settings/integrations`;
  if (key === 'replymailto') return 'mailto:hello@example.com';
  return SAMPLE_VALUES[key] ?? titleize(path.split('.').at(-1) ?? key) ?? 'Sample';
}

function setPathValue(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

const MISSING_PROP = /Missing template property: ([\w.-]+)/;

/**
 * Render a template for preview without knowing its props schema: start with
 * the given base props, and each time the renderer reports a missing
 * {{placeholder}}, fill that path with a sample value and retry.
 */
export async function renderWithSamples(
  render: RenderTemplate,
  baseProps: Record<string, unknown> = {},
  options: { origin?: string } = {},
): Promise<RenderedEmail> {
  const origin = options.origin
    ?? (typeof window !== 'undefined' ? window.location.origin : 'https://rachet.dev');
  const props = structuredClone(baseProps);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await render(props);
    } catch (error) {
      const match = error instanceof ApiError ? MISSING_PROP.exec(error.message) : null;
      if (!match) throw error;
      setPathValue(props, match[1], sampleFor(match[1], origin));
    }
  }
  throw new Error('Template preview needs more properties than expected');
}

/** Extract the pinned template version id from an email.send node's input. */
export function templateVersionIdOf(input: Record<string, unknown>): string | undefined {
  const source = input.templateVersionId;
  if (typeof source !== 'object' || source === null) return undefined;
  const literal = (source as { literal?: unknown }).literal;
  return typeof literal === 'string' ? literal : undefined;
}
