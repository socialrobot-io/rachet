import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderLocalReactEmailFile, placeholderProps } from '../packages/cli/src/cli-render-template.js';
import { interpolate, renderEmail } from '../apps/server/src/domain/render.js';

const welcomeTsx = readFileSync(new URL('../examples/welcome-nudge/emails/welcome.tsx', import.meta.url), 'utf8');

describe('html-first email templates', () => {
  it('CLI renders React Email to HTML with {{placeholders}}', async () => {
    const rendered = await renderLocalReactEmailFile(welcomeTsx, placeholderProps());
    expect(rendered.html).toContain('Welcome,');
    expect(rendered.html).toContain('{{contact.firstName}}');
    expect(rendered.html).toContain('{{variables.productUrl}}');
    expect(rendered.plainText).toContain('{{contact.firstName}}');
  });

  it('CLI can also render with real props for local previews', async () => {
    const rendered = await renderLocalReactEmailFile(welcomeTsx, {
      contact: { firstName: 'Ada' },
      variables: { productUrl: 'https://example.com/app' },
    });
    expect(rendered.html).toContain('Ada');
    expect(rendered.html).toContain('https://example.com/app');
  });

  it('server only interpolates stored HTML', async () => {
    const stored = await renderLocalReactEmailFile(welcomeTsx);
    const rendered = await renderEmail({
      subject: 'Welcome, {{contact.firstName}}',
      preheader: 'Ready',
      body: stored.plainText,
      html: stored.html,
      sourceKind: 'html',
    }, {
      contact: { firstName: 'Ada' },
      variables: { productUrl: 'https://example.com/app' },
    });
    expect(rendered.subject).toBe('Welcome, Ada');
    expect(rendered.html).toContain('Ada');
    expect(rendered.html).toContain('https://example.com/app');
    expect(rendered.html).not.toContain('{{contact.firstName}}');
  });

  it('interpolate still works for plain subjects', () => {
    expect(interpolate('Hi {{contact.firstName}}', { contact: { firstName: 'Ada' } })).toBe('Hi Ada');
  });
});
