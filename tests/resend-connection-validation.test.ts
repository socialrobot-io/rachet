import { describe, expect, it } from 'vitest';
import { resendWebhookSecretInput } from '../apps/server/src/app.js';

describe('Resend webhook signing secret validation', () => {
  const standardBase64 = Buffer.from([251, 255, 255, ...Array(29).fill(255)]).toString('base64');

  it('accepts standard base64 secrets containing +, / and padding', () => {
    expect(standardBase64).toContain('+');
    expect(standardBase64).toContain('/');
    expect(standardBase64).toContain('=');
    expect(resendWebhookSecretInput.safeParse(`whsec_${standardBase64}`).success).toBe(true);
  });

  it('continues to accept URL-safe unpadded secrets', () => {
    const urlSafe = standardBase64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(resendWebhookSecretInput.safeParse(`whsec_${urlSafe}`).success).toBe(true);
  });

  it.each([
    'missing_prefix_abcdefgh',
    'whsec_short',
    'whsec_abcdefgh!ijklmnop',
    'whsec_abcdefgh ijklmnop',
    'whsec_abcdefgh=ijklmnop',
  ])('rejects malformed signing secret %s', (value) => {
    expect(resendWebhookSecretInput.safeParse(value).success).toBe(false);
  });
});
