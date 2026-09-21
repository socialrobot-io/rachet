import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db/index.js';

const registrationIntentFields = {
  name: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(120).default('My organization'),
  organizationSlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  setupSecret: z.string().min(1).max(500).optional(),
};

export const registrationIntentSchema = z.discriminatedUnion('method', [
  z.object({ ...registrationIntentFields, method: z.literal('magic-link'), email: z.string().trim().email() }),
  z.object({ ...registrationIntentFields, method: z.literal('github'), email: z.never().optional() }),
]);

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function secretsMatch(provided: string | undefined, configured: string | undefined): boolean {
  if (!provided || !configured) return false;
  const left = createHash('sha256').update(provided).digest();
  const right = createHash('sha256').update(configured).digest();
  return timingSafeEqual(left, right);
}

export async function registrationStatus(db: Database, config: Config) {
  const result = await db.execute<{ initialized: boolean; userCount: string }>(sql`
    select
      exists(select 1 from system_settings where key = 'initialized') as initialized,
      (select count(*)::text from "user") as "userCount"
  `);
  const row = result.rows[0];
  const userCount = Number(row?.userCount ?? 0);
  return {
    requiresSetup: row?.initialized !== true && userCount === 0,
    registrationEnabled: config.allowRegistration,
    methods: {
      magicLink: Boolean(config.authResendApiKey && config.authFrom),
      github: Boolean(config.githubClientId && config.githubClientSecret),
    },
    magicLinkConfigurationWarning: config.authResendApiKey && !config.authFrom
      ? 'Magic links need AUTH_EMAIL_FROM set to a sender on a domain verified in the authentication Resend account.'
      : undefined,
  };
}

export async function authorizeRegistrationIntent(
  db: Database,
  config: Config,
  rawInput: unknown,
): Promise<{ accepted: true; requiresSetup: boolean; intentId?: string }> {
  const input = registrationIntentSchema.parse(rawInput);
  const status = await registrationStatus(db, config);
  const normalizedEmail = input.method === 'magic-link' ? emailKey(input.email) : undefined;
  if (normalizedEmail) {
    const existing = await db.execute(sql`select 1 from "user" where lower(trim("email")) = ${normalizedEmail} limit 1`);
    if (existing.rowCount) return { accepted: true, requiresSetup: false };
  }

  const kind = status.requiresSetup ? 'bootstrap' : 'public';
  if (status.requiresSetup) {
    if (!secretsMatch(input.setupSecret, config.setupSecret)) {
      throw Object.assign(new Error('The setup code is invalid'), { status: 403 });
    }
  } else if (!config.allowRegistration) {
    // Do not reveal whether the supplied email belongs to an existing account.
    return { accepted: true, requiresSetup: false };
  }

  const intentKey = normalizedEmail ?? `github:${randomUUID()}`;
  await db.execute(sql`delete from registration_intents where consumed_at is null and expires_at <= now()`);
  const created = await db.execute<{ id: string }>(sql`
    insert into registration_intents (
      email_key, name, organization_name, organization_slug, method, kind, expires_at
    ) values (
      ${intentKey}, ${input.name}, ${input.organizationName}, ${input.organizationSlug ?? null},
      ${input.method}, ${kind}, now() + interval '15 minutes'
    )
    on conflict (email_key) where consumed_at is null do update set
      name = excluded.name,
      organization_name = excluded.organization_name,
      organization_slug = excluded.organization_slug,
      method = excluded.method,
      kind = excluded.kind,
      expires_at = excluded.expires_at
    returning id
  `);
  const intentId = input.method === 'github' ? created.rows[0]?.id : undefined;
  if (input.method === 'github' && !intentId) throw new Error('Could not authorize GitHub registration');
  return {
    accepted: true,
    requiresSetup: status.requiresSetup,
    ...(intentId ? { intentId } : {}),
  };
}
