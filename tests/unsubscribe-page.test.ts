import { describe, expect, it } from 'vitest';
import { renderUnsubscribePage } from '../apps/server/src/unsubscribe-page.js';

describe('unsubscribe page', () => {
  it('keeps one unsubscribe action and a literal support mailto', () => {
    const html = renderUnsubscribePage(
      'Unsubscribe',
      '<form method="post"><button type="submit">Unsubscribe from Acme marketing emails</button></form>',
      'support@example.com',
    );
    expect(html).toContain('Unsubscribe from Acme marketing emails');
    expect(html).toContain('<!--email_off--><a href="mailto:support@example.com">Contact support</a><!--/email_off-->');
    expect(html).not.toContain('<script');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('omits support when the address is missing or unsafe', () => {
    expect(renderUnsubscribePage('Unsubscribe', '<p>Stop?</p>')).not.toContain('mailto:');
    expect(renderUnsubscribePage('Unsubscribe', '<p>Stop?</p>', 'not an email')).not.toContain('mailto:');
    expect(renderUnsubscribePage('Unsubscribe', '<p>Stop?</p>', 'bad@example.com"><script>')).not.toContain('<script');
  });
});