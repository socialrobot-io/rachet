import { apiKey } from '@better-auth/api-key';
import { getOAuthProviderApi, oauthProvider, type OAuthOptions, type Scope } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, addOAuthServerContext, createAuthEndpoint, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { bearer } from 'better-auth/plugins/bearer';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { jwt } from 'better-auth/plugins/jwt';
import { magicLink } from 'better-auth/plugins/magic-link';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { Resend } from 'resend';

export function isGitHubCallback(context: {
  path?: string | undefined;
  params?: Record<string, string | undefined> | undefined;
} | null | undefined): boolean {
  return context?.path === '/callback/:id' && context.params?.id === 'github';
}

export function reflowOAuthOptions(config: Config, pool?: Pool): OAuthOptions<Scope[]> {
  return {
    disableJwtPlugin: process.env.BETTER_AUTH_SCHEMA_GENERATION === 'true',
    loginPage: `${config.publicUrl}/auth/login`,
    consentPage: `${config.publicUrl}/auth/consent`,
    scopes: ['openid', 'profile', 'email', 'offline_access', 'rachet:read', 'rachet:write', 'rachet:send'],
    resources: process.env.BETTER_AUTH_SCHEMA_GENERATION === 'true' ? [] : [{ identifier: `${config.publicUrl}/mcp`, allowedScopes: ['rachet:read', 'rachet:write', 'rachet:send'], accessTokenTtl: 900 }],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: false,
    clientRegistrationDefaultResources: process.env.BETTER_AUTH_SCHEMA_GENERATION === 'true' ? [] : [`${config.publicUrl}/mcp`],
    m2mAccessTokenExpiresIn: 900,
    clientPrivileges: async ({ user }) => {
      if (!user?.id || !pool) return false;
      const result = await pool.query<{ deployment_admin: boolean }>('select deployment_admin from profiles where user_id = $1 limit 1', [user.id]);
      return result.rows[0]?.deployment_admin === true;
    },
  };
}

export function createAuth(config: Config, pool: Pool) {
  const oauthOptions = reflowOAuthOptions(config, pool);
  const externalOAuth = config.oauthProviderId && config.oauthDiscoveryUrl && config.oauthClientId && config.oauthClientSecret
    ? genericOAuth({
        config: [{
          providerId: config.oauthProviderId,
          discoveryUrl: config.oauthDiscoveryUrl,
          clientId: config.oauthClientId,
          clientSecret: config.oauthClientSecret,
          scopes: ['openid', 'email', 'profile'],
          // Existing linked identities may sign in, but product registration is
          // deliberately limited to magic link and GitHub.
          disableSignUp: true,
        }],
      })
    : undefined;

  return betterAuth({
    appName: 'Rachet',
    baseURL: config.publicUrl,
    secret: config.betterAuthSecret,
    database: pool,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: { enabled: false },
    socialProviders: config.githubClientId && config.githubClientSecret ? {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        disableImplicitSignUp: true,
      },
    } : {},
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 15 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/magic-link/verify': { window: 60, max: 10 },
        '/sign-in/social': { window: 60, max: 10 },
        '/oauth2/register': { window: 60, max: 60 },
        '/oauth2/token': { window: 60, max: 120 },
        '/oauth2/authorize': { window: 60, max: 60 },
      },
    },
    advanced: {
      useSecureCookies: config.nodeEnv === 'production',
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== '/sign-in/social') return;
        const body = context.body && typeof context.body === 'object'
          ? context.body as Record<string, unknown>
          : {};
        if (body.provider !== 'github' || body.requestSignUp !== true) return;
        const additionalData = body.additionalData && typeof body.additionalData === 'object'
          ? body.additionalData as Record<string, unknown>
          : {};
        const intentId = typeof additionalData.registrationIntentId === 'string'
          ? additionalData.registrationIntentId
          : undefined;
        if (!intentId) {
          throw new APIError('FORBIDDEN', { code: 'REGISTRATION_NOT_AUTHORIZED', message: 'Registration is not authorized or has expired' });
        }
        const intent = await pool.query(
          `select 1 from registration_intents
           where id = $1 and method = 'github' and consumed_at is null and expires_at > now()
           limit 1`,
          [intentId],
        );
        if (!intent.rowCount) {
          throw new APIError('FORBIDDEN', { code: 'REGISTRATION_NOT_AUTHORIZED', message: 'Registration is not authorized or has expired' });
        }
        await addOAuthServerContext({ reflowRegistrationIntentId: intentId });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            // Better Auth exposes the route pattern here, not the concrete URL.
            if (!isGitHubCallback(context)) return;
            const state = await getOAuthState();
            const intentId = typeof state?.serverContext?.reflowRegistrationIntentId === 'string'
              ? state.serverContext.reflowRegistrationIntentId
              : undefined;
            if (!intentId) {
              throw new APIError('FORBIDDEN', { code: 'REGISTRATION_NOT_AUTHORIZED', message: 'Registration is not authorized or has expired' });
            }
            const bound = await pool.query(
              `update registration_intents
               set email_key = lower(trim($1))
               where id = $2 and method = 'github' and consumed_at is null and expires_at > now()
               returning id`,
              [user.email, intentId],
            );
            if (!bound.rowCount) {
              throw new APIError('FORBIDDEN', { code: 'REGISTRATION_NOT_AUTHORIZED', message: 'Registration is not authorized or has expired' });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      bearer(),
      magicLink({
        expiresIn: 60 * 10,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url, token }) => {
          const allowed = await pool.query(
            `select 1 from "user" where lower(trim("email")) = lower(trim($1))
             union all
             select 1 from registration_intents
             where email_key = lower(trim($1)) and method = 'magic-link'
               and consumed_at is null and expires_at > now()
             limit 1`,
            [email],
          );
          if (!allowed.rowCount) return;
          if (!config.authResendApiKey || !config.authFrom) {
            throw new Error('Authentication email requires AUTH_RESEND_API_KEY and AUTH_EMAIL_FROM');
          }
          const safeUrl = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
          const idempotencyKey = `auth-magic-link/${createHash('sha256').update(token).digest('hex')}`;
          const { error } = await new Resend(config.authResendApiKey).emails.send({
            from: config.authFrom,
            to: email,
            subject: 'Sign in to Rachet',
            html: `<p>Use this one-time link to sign in to Rachet:</p><p><a href="${safeUrl}">Sign in to Rachet</a></p><p>This link expires in 10 minutes.</p>`,
            text: `Sign in to Rachet: ${url}\n\nThis link expires in 10 minutes.`,
          }, { idempotencyKey });
          if (error) throw new Error(`Authentication email failed: ${error.name}`);
        },
      }),
      apiKey({ enableMetadata: true }) as unknown as BetterAuthPlugin,
      jwt(),
      oauthProvider(oauthOptions) as unknown as BetterAuthPlugin,
      {
        id: 'reflow-resource-server',
        endpoints: {
          reflowToken: createAuthEndpoint('/reflow-token', { method: 'GET' }, async (context) => {
            const authorization = context.request?.headers.get('authorization');
            if (!authorization?.startsWith('Bearer ')) throw context.error('UNAUTHORIZED');
            return getOAuthProviderApi(context as unknown as Parameters<typeof getOAuthProviderApi>[0], oauthOptions).requireActiveAccessToken(authorization.slice(7));
          }),
        },
      },
      ...(externalOAuth ? [externalOAuth] : []),
    ],
  });
}

export type ReflowAuth = ReturnType<typeof createAuth>;
