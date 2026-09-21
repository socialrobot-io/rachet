import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  ALLOW_REGISTRATION: z.enum(['true', 'false']).default('false'),
  TRUSTED_ORIGINS: z.string().default('http://localhost:3000'),
  REFLOW_DASHBOARD_DIR: z.string().min(1).default('apps/dashboard/dist'),
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('reflow'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('reflow-enrollments'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  REFLOW_FROM: z.string().default('Reflow <onboarding@resend.dev>'),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  AUTH_RESEND_API_KEY: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().trim().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  REFLOW_SETUP_SECRET: z.string().optional(),
  OAUTH_PROVIDER_ID: z.string().optional(),
  OAUTH_DISCOVERY_URL: z.union([z.literal(''), z.url()]).optional(),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_PUBLIC_REDIRECT_ORIGINS: z.string().default(''),
  OAUTH_PUBLIC_REDIRECT_SCHEMES: z.string().default('cursor'),
});

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(source);
  const betterAuthSecret = parsed.BETTER_AUTH_SECRET;
  if (!betterAuthSecret) throw new Error('BETTER_AUTH_SECRET is required');
  const publicUrl = parsed.PUBLIC_URL.replace(/\/$/, '');
  const trustedOrigins = parsed.TRUSTED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  const setupSecret = parsed.REFLOW_SETUP_SECRET;
  const githubClientSecret = parsed.GITHUB_CLIENT_SECRET;
  const resendApiKey = parsed.RESEND_API_KEY;
  const authResendApiKey = parsed.AUTH_RESEND_API_KEY;
  const authFrom = parsed.AUTH_EMAIL_FROM || undefined;
  const integrationEncryptionKey = parsed.INTEGRATION_ENCRYPTION_KEY;
  if (integrationEncryptionKey && (!/^[A-Za-z0-9+/]{43}=$/.test(integrationEncryptionKey) || Buffer.from(integrationEncryptionKey, 'base64').length !== 32)) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  if (authFrom) {
    const bracketed = authFrom.match(/^[^<>]+\s<([^<>\s]+)>$/);
    const address = bracketed ? bracketed[1] : authFrom;
    if (!z.email().safeParse(address).success) {
      throw new Error('AUTH_EMAIL_FROM must be an email address or Name <email@verified-domain>');
    }
  }
  if (resendApiKey && authResendApiKey && resendApiKey === authResendApiKey) {
    throw new Error('AUTH_RESEND_API_KEY must use a separate credential from RESEND_API_KEY');
  }
  if (parsed.NODE_ENV === 'production') {
    if (!publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must use https:// in production');
    if (betterAuthSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production');
    if (trustedOrigins.some((origin) => !origin.startsWith('https://'))) {
      throw new Error('TRUSTED_ORIGINS must contain only https:// origins in production');
    }
    if (!setupSecret || setupSecret.length < 32) {
      throw new Error('REFLOW_SETUP_SECRET must contain at least 32 characters in production');
    }
    if (!integrationEncryptionKey) {
      throw new Error('INTEGRATION_ENCRYPTION_KEY is required in production');
    }
    if (Boolean(parsed.GITHUB_CLIENT_ID) !== Boolean(githubClientSecret)) {
      throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together');
    }
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicUrl,
    databaseUrl: parsed.DATABASE_URL ?? 'postgresql://reflow:reflow@localhost:5432/reflow',
    betterAuthSecret,
    allowRegistration: parsed.ALLOW_REGISTRATION === 'true',
    trustedOrigins,
    dashboardDir: parsed.REFLOW_DASHBOARD_DIR,
    temporalAddress: parsed.TEMPORAL_ADDRESS,
    temporalNamespace: parsed.TEMPORAL_NAMESPACE,
    temporalTaskQueue: parsed.TEMPORAL_TASK_QUEUE,
    resendApiKey,
    resendWebhookSecret: parsed.RESEND_WEBHOOK_SECRET,
    from: parsed.REFLOW_FROM,
    integrationEncryptionKey,
    authResendApiKey,
    authFrom,
    githubClientId: parsed.GITHUB_CLIENT_ID,
    githubClientSecret,
    setupSecret,
    oauthProviderId: parsed.OAUTH_PROVIDER_ID,
    oauthDiscoveryUrl: parsed.OAUTH_DISCOVERY_URL || undefined,
    oauthClientId: parsed.OAUTH_CLIENT_ID,
    oauthClientSecret: parsed.OAUTH_CLIENT_SECRET,
    oauthPublicRedirectOrigins: parsed.OAUTH_PUBLIC_REDIRECT_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    oauthPublicRedirectSchemes: parsed.OAUTH_PUBLIC_REDIRECT_SCHEMES.split(',')
      .map((scheme) => scheme.trim().toLowerCase().replace(/:$/, ''))
      .filter(Boolean)
      .map((scheme) => `${scheme}:`),
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
