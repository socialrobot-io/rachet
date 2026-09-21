import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../apps/server/src/config.js';
import type { Database } from '../apps/server/src/db/index.js';
import { authorizeRegistrationIntent, registrationIntentSchema, registrationStatus } from '../apps/server/src/registration.js';
import { isGitHubCallback } from '../apps/server/src/auth.js';

const config = {
  allowRegistration: false,
  setupSecret: 'a-high-entropy-setup-secret-for-tests',
  authResendApiKey: 're_auth_test',
  githubClientId: undefined,
  githubClientSecret: undefined,
} as Config;

function databaseResults(...results: Array<{ rows?: unknown[]; rowCount?: number }>) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce({ rows: [], rowCount: 0, ...result });
  return { db: { execute } as unknown as Database, execute };
}

const registration = {
  email: 'Admin@Example.com ',
  name: 'Admin',
  organizationName: 'Example',
  method: 'magic-link' as const,
};

describe('registration authorization', () => {
  it('does not offer magic links without an explicit authentication sender', async () => {
    const { db } = databaseResults({ rows: [{ initialized: false, userCount: '0' }] });
    await expect(registrationStatus(db, config)).resolves.toMatchObject({
      methods: { magicLink: false, github: false },
      magicLinkConfigurationWarning: expect.stringContaining('AUTH_EMAIL_FROM'),
    });
  });

  it('offers magic links when the key and sender are configured', async () => {
    const { db } = databaseResults({ rows: [{ initialized: false, userCount: '0' }] });
    await expect(registrationStatus(db, { ...config, authFrom: 'Reflow <login@auth.example.com>' })).resolves.toMatchObject({
      methods: { magicLink: true, github: false },
    });
  });

  it('matches Better Auth GitHub callback route parameters, not a concrete path', () => {
    expect(isGitHubCallback({ path: '/callback/:id', params: { id: 'github' } })).toBe(true);
    expect(isGitHubCallback({ path: '/callback/:id', params: { id: 'google' } })).toBe(false);
    expect(isGitHubCallback({ path: '/callback/github' })).toBe(false);
  });
  it('validates normalized product registration fields', () => {
    expect(registrationIntentSchema.parse({ ...registration, organizationSlug: 'example-team' }).organizationSlug).toBe('example-team');
    expect(() => registrationIntentSchema.parse({ ...registration, organizationSlug: '../example' })).toThrow();
  });

  it('does not require an email before GitHub OAuth', () => {
    expect(registrationIntentSchema.parse({
      method: 'github',
      name: 'GitHub user',
      organizationName: 'Example',
    })).not.toHaveProperty('email');
  });

  it('requires the deployment setup secret for the first user', async () => {
    const { db, execute } = databaseResults({ rows: [{ initialized: false, userCount: '0' }] }, { rowCount: 0 });
    await expect(authorizeRegistrationIntent(db, config, { ...registration, setupSecret: 'wrong' }))
      .rejects.toThrow('setup code is invalid');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('creates a short-lived bootstrap intent after valid setup authorization', async () => {
    const { db, execute } = databaseResults(
      { rows: [{ initialized: false, userCount: '0' }] },
      { rowCount: 0 },
      { rowCount: 0 },
      { rowCount: 1, rows: [{ id: 'magic-link-intent' }] },
    );
    await expect(authorizeRegistrationIntent(db, config, { ...registration, setupSecret: config.setupSecret }))
      .resolves.toEqual({ accepted: true, requiresSetup: true });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('creates a server-bindable GitHub intent without collecting an email', async () => {
    const githubConfig = { ...config, githubClientId: 'github-id', githubClientSecret: 'github-secret' } as Config;
    const { db, execute } = databaseResults(
      { rows: [{ initialized: false, userCount: '0' }] },
      { rowCount: 0 },
      { rowCount: 1, rows: [{ id: 'github-intent' }] },
    );
    await expect(authorizeRegistrationIntent(db, githubConfig, {
      method: 'github',
      name: 'GitHub user',
      organizationName: 'Example',
      setupSecret: config.setupSecret,
    })).resolves.toEqual({ accepted: true, requiresSetup: true, intentId: 'github-intent' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not create an intent when public registration is disabled', async () => {
    const { db, execute } = databaseResults({ rows: [{ initialized: true, userCount: '1' }] }, { rowCount: 0 });
    await expect(authorizeRegistrationIntent(db, config, registration))
      .resolves.toEqual({ accepted: true, requiresSetup: false });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('allows existing users without creating a new registration intent', async () => {
    const { db, execute } = databaseResults({ rows: [{ initialized: true, userCount: '1' }] }, { rowCount: 1 });
    await expect(authorizeRegistrationIntent(db, config, registration))
      .resolves.toEqual({ accepted: true, requiresSetup: false });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
