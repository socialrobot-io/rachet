import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { interpolate, renderEmail } from '../apps/server/src/domain/render.js';

describe('interpolate', () => {
  it('replaces nested scalar paths and tolerates whitespace', () => {
    expect(interpolate('Hi {{ contact.firstName }}', { contact: { firstName: 'Ada' } })).toBe('Hi Ada');
  });

  it('looks up path segments case-insensitively', () => {
    expect(interpolate('Hi {{CONTACT.FIRSTNAME}}', { contact: { firstName: 'Ada' } })).toBe('Hi Ada');
  });

  it('rejects missing and non-scalar values', () => {
    expect(() => interpolate('{{contact.missing}}', { contact: {} })).toThrow(/Missing template property/);
    expect(() => interpolate('{{contact}}', { contact: { firstName: 'Ada' } })).toThrow(/must be scalar/);
    expect(() => interpolate('{{contact.constructor}}', { contact: {} })).toThrow(/Missing template property/);
  });

  it('escapes inserted values when rendering HTML', async () => {
    const rendered = await renderEmail({
      subject: 'Hello {{contact.name}}', preheader: null,
      body: 'Hello {{contact.name}}', html: '<p>{{contact.name}}</p>', sourceKind: 'html',
    }, { contact: { name: '<img src=x onerror="alert(1)">&\'' } });
    expect(rendered.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
    expect(rendered.html).not.toContain('<img src=x');
  });
});

describe('renderEmail', () => {
  it('interpolates stored HTML without wrapping', async () => {
    const rendered = await renderEmail({
      subject: 'Hello {{contact.firstName}}',
      preheader: 'Pre {{variables.plan}}',
      body: 'Text {{contact.firstName}}',
      html: '<p>Hello {{contact.firstName}} — {{variables.plan}}</p>',
      sourceKind: 'html',
    }, {
      contact: { firstName: 'Ada' },
      variables: { plan: 'pro' },
    });
    expect(rendered).toEqual({
      subject: 'Hello Ada',
      preheader: 'Pre pro',
      html: '<p>Hello Ada — pro</p>',
      plainText: 'Text Ada',
    });
  });

  it('wraps plain-text templates into HTML', async () => {
    const rendered = await renderEmail({
      subject: 'Hello {{contact.firstName}}',
      preheader: 'Ready',
      body: 'Line one\nLine two {{variables.plan}}',
      sourceKind: 'plain',
    }, {
      contact: { firstName: 'Ada' },
      variables: { plan: 'pro' },
    });
    expect(rendered.subject).toBe('Hello Ada');
    expect(rendered.html).toContain('Line one');
    expect(rendered.html).toContain('Line two pro');
    expect(rendered.plainText.toLowerCase()).toContain('line one');
  });

  it('wraps plain-text templates under the development tsx loader', () => {
    const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
    const script = [
      "const { renderEmail } = await import('./apps/server/src/domain/render.tsx');",
      "const result = await renderEmail({ subject: 'Hello', preheader: null, body: 'Line one', sourceKind: 'plain' }, {});",
      "if (!result.html.includes('Line one')) process.exit(1);",
    ].join(' ');
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    })).not.toThrow();
  });
});
