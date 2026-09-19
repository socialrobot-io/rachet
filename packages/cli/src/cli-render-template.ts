import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { render, toPlainText } from 'react-email';

/** Props where every nested get returns a {{path}} token for server-side interpolate. */
export function placeholderProps(): Record<string, unknown> {
  const nest = (prefix: string): Record<string, unknown> => new Proxy({}, {
    get: (_target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;
      return `{{${prefix}.${key}}}`;
    },
  });
  return {
    contact: nest('contact'),
    variables: nest('variables'),
    event: nest('event'),
  };
}

/** Compile and render a local React Email .tsx file to HTML + plain text (CLI only). */
export async function renderLocalReactEmailFile(
  tsxSource: string,
  props: Record<string, unknown> = placeholderProps(),
  options: { resolveDir?: string } = {},
) {
  const resolveDir = options.resolveDir ?? process.cwd();
  const dir = await mkdtemp(join(resolveDir, '.reflow-render-'));
  const file = join(dir, `template-${createHash('sha256').update(tsxSource).digest('hex').slice(0, 16)}.mjs`);
  try {
    const transformed = await esbuild.build({
      stdin: {
        contents: tsxSource,
        loader: 'tsx',
        resolveDir,
        sourcefile: 'template.tsx',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      jsx: 'automatic',
      packages: 'external',
      logLevel: 'silent',
    });
    const code = transformed.outputFiles?.[0]?.text;
    if (!code) throw new Error('Failed to compile React Email template');
    await writeFile(file, code, 'utf8');
    const module = await import(`${pathToFileURL(file).href}?t=${Date.now()}`) as { default?: ComponentType<Record<string, unknown>> };
    if (typeof module.default !== 'function') {
      throw new Error('React Email template must export a default component function');
    }
    const html = await render(createElement(module.default, props));
    const plainText = alignPlaceholderCasing(html, toPlainText(html));
    return { html, plainText };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Keep {{paths}} casing from HTML when plain-text extraction uppercases CSS-transformed text. */
function alignPlaceholderCasing(html: string, plainText: string): string {
  const fromHtml = [...html.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)]
    .map((match) => match[1])
    .filter((key): key is string => Boolean(key));
  const byLower = new Map(fromHtml.map((key) => [key.toLowerCase(), key]));
  return plainText.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => `{{${byLower.get(key.toLowerCase()) ?? key}}}`);
}
