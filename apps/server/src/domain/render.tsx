import React from 'react';
import { Body, Container, Head, Html, Preview, Text } from 'react-email';
import { render, toPlainText } from 'react-email';
import { RachetError } from './errors.js';

export type TemplateRenderable = {
  subject: string;
  preheader: string | null;
  body: string;
  html?: string | null;
  sourceKind?: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

export function interpolate(input: string, props: Record<string, unknown>, options?: { escapeHtml?: boolean }): string {
  return input.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (typeof current !== 'object' || current === null) return undefined;
      const record = current as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(record, part)) return record[part];
      // Plain-text extraction can uppercase placeholders when CSS uses text-transform.
      const found = Object.keys(record).find((candidate) => candidate.toLowerCase() === part.toLowerCase());
      return found === undefined ? undefined : record[found];
    }, props);
    if (value === undefined || value === null) {
      throw new RachetError('VALIDATION_FAILED', `Missing template property: ${key}`, 422);
    }
    if (typeof value === 'object') {
      throw new RachetError('VALIDATION_FAILED', `Template property must be scalar: ${key}`, 422);
    }
    const rendered = String(value);
    return options?.escapeHtml ? escapeHtml(rendered) : rendered;
  });
}

async function wrapPlainBody(body: string, preheader: string) {
  const markup = (
    <Html lang="en">
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body style={{ backgroundColor: '#f6f7f9', fontFamily: 'Arial, sans-serif', margin: 0, padding: '32px 12px' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: '8px', margin: '0 auto', maxWidth: '600px', padding: '32px' }}>
          {body.split('\n').map((line, index) => <Text key={index} style={{ color: '#18181b', fontSize: '15px', lineHeight: '24px' }}>{line || '\u00a0'}</Text>)}
        </Container>
      </Body>
    </Html>
  );
  const html = await render(markup);
  return { html, plainText: toPlainText(html) };
}

/** Server-side personalization only: interpolate {{paths}} in stored subject/html/text. No TSX execution. */
export async function renderEmail(template: TemplateRenderable, props: Record<string, unknown>) {
  const subject = interpolate(template.subject, props);
  const preheader = template.preheader ? interpolate(template.preheader, props) : '';
  if (template.html?.trim()) {
    return {
      subject,
      preheader,
      html: interpolate(template.html, props, { escapeHtml: true }),
      plainText: interpolate(template.body, props),
    };
  }
  const body = interpolate(template.body, props);
  const wrapped = await wrapPlainBody(body, preheader);
  return { subject, preheader, html: wrapped.html, plainText: wrapped.plainText };
}

/** The managed footer is added after template rendering, so customer markup cannot remove it. */
export function appendMarketingFooter(rendered: Awaited<ReturnType<typeof renderEmail>>, senderName: string, url: string) {
  const label = `Unsubscribe from ${senderName} marketing emails`;
  const footer = `<p style="font:13px Arial,sans-serif;color:#555;margin:24px 0"><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
  return {
    ...rendered,
    html: /<\/body\s*>/i.test(rendered.html) ? rendered.html.replace(/<\/body\s*>/i, `${footer}</body>`) : `${rendered.html}${footer}`,
    plainText: `${rendered.plainText.trimEnd()}\n\n${label}: ${url}\n`,
  };
}
