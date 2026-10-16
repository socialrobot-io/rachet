import { describe, expect, it } from 'vitest';
import { formatMailbox, mailboxAddress } from '../apps/server/src/domain/email-policy.js';

describe('formatMailbox', () => {
  it('puts the sender name on the From line and keeps the address comparable', () => {
    const from = formatMailbox('Acme & Co', 'news@example.com');
    expect(from).toBe('"Acme & Co" <news@example.com>');
    expect(mailboxAddress(from)).toBe('news@example.com');
  });

  it('quotes a name that contains a quote and drops line breaks', () => {
    expect(formatMailbox('Acme "Team"\n', 'news@example.com')).toBe('"Acme \\"Team\\"" <news@example.com>');
  });
});