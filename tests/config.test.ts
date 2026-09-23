import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/server/src/config.js';

const base = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://reflow.example.com',
  TRUSTED_ORIGINS: 'https://reflow.example.com',
  BETTER_AUTH_SECRET: '12345678901234567890123456789012',
  REFLOW_SETUP_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
  INTEGRATION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
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

  it('accepts a Google Analytics measurement ID', () => {
    expect(loadConfig({ ...base, GOOGLE_ANALYTICS_ID: 'G-X7CL1NYLSM' }).googleAnalyticsId).toBe('G-X7CL1NYLSM');
    expect(() => loadConfig({ ...base, GOOGLE_ANALYTICS_ID: 'UA-123' })).toThrow(/GOOGLE_ANALYTICS_ID/);
  });

  it('defaults registration off but accepts an explicit opt-in', () => {
    expect(loadConfig(base).allowRegistration).toBe(false);
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: 'true' }).allowRegistration).toBe(true);
  });

  it('requires a strong setup secret', () => {
    expect(() => loadConfig({ ...base, REFLOW_SETUP_SECRET: 'short' })).toThrow(/REFLOW_SETUP_SECRET/);
  });

  it('requires a 32-byte integration encryption key in production', () => {
    expect(() => loadConfig({ ...base, INTEGRATION_ENCRYPTION_KEY: '' })).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...base, INTEGRATION_ENCRYPTION_KEY: 'short' })).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it('requires both GitHub credentials', () => {
    expect(() => loadConfig({ ...base, GITHUB_CLIENT_ID: 'client-id' })).toThrow(/GITHUB_CLIENT_ID/);
  });

  it('rejects reuse of the workflow-delivery Resend credential for auth', () => {
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 're_same', AUTH_RESEND_API_KEY: 're_same' }))
      .toThrow(/separate credential/);
  });

  it('does not assume a default sender for authentication email', () => {
    expect(loadConfig({ ...base, AUTH_RESEND_API_KEY: 're_auth_test' }).authFrom).toBeUndefined();
  });

  it('accepts an explicit authentication sender', () => {
    expect(loadConfig({
      ...base,
      AUTH_RESEND_API_KEY: 're_auth_test',
      AUTH_EMAIL_FROM: 'Reflow <login@auth.example.com>',
    }).authFrom).toBe('Reflow <login@auth.example.com>');
  });

  it('rejects a malformed authentication sender', () => {
    expect(() => loadConfig({ ...base, AUTH_EMAIL_FROM: 'not-an-address' }))
      .toThrow(/AUTH_EMAIL_FROM/);
  });
});
