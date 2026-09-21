import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/server/src/config.js';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../apps/server/src/integrations/secret.js';

const config = loadConfig({
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: '12345678901234567890123456789012',
  INTEGRATION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
});

describe('organization integration encryption', () => {
  it('round-trips without storing plaintext and uses randomized ciphertext', () => {
    const first = encryptIntegrationSecret(config, 'org-one', 'resend-api-key', 're_sample_secret');
    const second = encryptIntegrationSecret(config, 'org-one', 'resend-api-key', 're_sample_secret');
    expect(first).not.toContain('re_sample_secret');
    expect(first).not.toBe(second);
    expect(decryptIntegrationSecret(config, 'org-one', 'resend-api-key', first)).toBe('re_sample_secret');
  });

  it('rejects cross-organization or cross-purpose decryption', () => {
    const encrypted = encryptIntegrationSecret(config, 'org-one', 'resend-api-key', 're_sample_secret');
    expect(() => decryptIntegrationSecret(config, 'org-two', 'resend-api-key', encrypted)).toThrow();
    expect(() => decryptIntegrationSecret(config, 'org-one', 'resend-webhook-secret', encrypted)).toThrow();
  });
});
