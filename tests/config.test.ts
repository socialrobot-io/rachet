import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/server/src/config.js';

const base = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://reflow.example.com',
  TRUSTED_ORIGINS: 'https://reflow.example.com',
  BETTER_AUTH_SECRET: '12345678901234567890123456789012',
};

describe('production configuration', () => {
  it('rejects an insecure public URL', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'http://reflow.example.com' })).toThrow(/PUBLIC_URL/);
  });

  it('rejects insecure trusted origins', () => {
    expect(() => loadConfig({ ...base, TRUSTED_ORIGINS: 'http://reflow.example.com' })).toThrow(/TRUSTED_ORIGINS/);
  });

  it('accepts HTTPS origins and a strong secret', () => {
    const config = loadConfig(base);
    expect(config.publicUrl).toBe('https://reflow.example.com');
    expect(config.dashboardDir).toBe('apps/dashboard/dist');
    expect(config.oauthPublicRedirectSchemes).toEqual(['cursor:']);
  });
});
