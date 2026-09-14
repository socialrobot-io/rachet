import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_FILE: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_SECRET_FILE: z.string().optional(),
  ALLOW_REGISTRATION: z.enum(['true', 'false']).default('false'),
  TRUSTED_ORIGINS: z.string().default('http://localhost:3000'),
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('reflow'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('reflow-enrollments'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_KEY_FILE: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  RESEND_WEBHOOK_SECRET_FILE: z.string().optional(),
  REFLOW_FROM: z.string().default('Reflow <onboarding@resend.dev>'),
  OAUTH_PROVIDER_ID: z.string().optional(),
  OAUTH_DISCOVERY_URL: z.union([z.literal(''), z.url()]).optional(),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_CLIENT_SECRET_FILE: z.string().optional(),
});

function secret(value: string | undefined, path: string | undefined): string | undefined {
  if (value) return value;
  if (!path) return undefined;
  return readFileSync(path, 'utf8').trim();
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(source);
  const betterAuthSecret = secret(parsed.BETTER_AUTH_SECRET, parsed.BETTER_AUTH_SECRET_FILE);
  if (!betterAuthSecret) throw new Error('BETTER_AUTH_SECRET or BETTER_AUTH_SECRET_FILE is required');
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicUrl: parsed.PUBLIC_URL.replace(/\/$/, ''),
    databaseUrl: secret(parsed.DATABASE_URL, parsed.DATABASE_URL_FILE) ?? 'postgresql://reflow:reflow@localhost:5432/reflow',
    betterAuthSecret,
    allowRegistration: parsed.ALLOW_REGISTRATION === 'true',
    trustedOrigins: parsed.TRUSTED_ORIGINS.split(',').map((origin) => origin.trim()),
    temporalAddress: parsed.TEMPORAL_ADDRESS,
    temporalNamespace: parsed.TEMPORAL_NAMESPACE,
    temporalTaskQueue: parsed.TEMPORAL_TASK_QUEUE,
    resendApiKey: secret(parsed.RESEND_API_KEY, parsed.RESEND_API_KEY_FILE),
    resendWebhookSecret: secret(parsed.RESEND_WEBHOOK_SECRET, parsed.RESEND_WEBHOOK_SECRET_FILE),
    from: parsed.REFLOW_FROM,
    oauthProviderId: parsed.OAUTH_PROVIDER_ID,
    oauthDiscoveryUrl: parsed.OAUTH_DISCOVERY_URL || undefined,
    oauthClientId: parsed.OAUTH_CLIENT_ID,
    oauthClientSecret: secret(parsed.OAUTH_CLIENT_SECRET, parsed.OAUTH_CLIENT_SECRET_FILE),
  } as const;
}

export type Config = ReturnType<typeof loadConfig>;
