import { apiKey } from '@better-auth/api-key';
import { getOAuthProviderApi, oauthProvider, type OAuthOptions, type Scope } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { bearer } from 'better-auth/plugins/bearer';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { jwt } from 'better-auth/plugins/jwt';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { Resend } from 'resend';

export function reflowOAuthOptions(config: Config, pool?: Pool): OAuthOptions<Scope[]> {
  return {
    disableJwtPlugin: process.env.BETTER_AUTH_SCHEMA_GENERATION === 'true',
    loginPage: `${config.publicUrl}/auth/login`,
    consentPage: `${config.publicUrl}/auth/consent`,
    scopes: ['openid', 'profile', 'email', 'offline_access', 'reflow:read', 'reflow:write', 'reflow:send'],
    resources: process.env.BETTER_AUTH_SCHEMA_GENERATION === 'true' ? [] : [{ identifier: `${config.publicUrl}/mcp`, allowedScopes: ['reflow:read', 'reflow:write', 'reflow:send'], accessTokenTtl: 900 }],
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
          disableSignUp: !config.allowRegistration,
        }],
      })
    : undefined;

  return betterAuth({
    appName: 'Reflow',
    baseURL: config.publicUrl,
    secret: config.betterAuthSecret,
    database: pool,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.allowRegistration,
      requireEmailVerification: config.nodeEnv === 'production',
    },
    emailVerification: config.resendApiKey ? {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { error } = await new Resend(config.resendApiKey).emails.send({
          from: config.from, to: user.email, subject: 'Verify your Reflow account',
          html: `<p>Verify your Reflow account:</p><p><a href="${url}">Verify email</a></p>`,
          text: `Verify your Reflow account: ${url}`,
        });
        if (error) throw new Error(`Verification email failed: ${error.name}`);
      },
    } : undefined,
    account: { encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
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
        if (!config.allowRegistration && context.path.startsWith('/sign-up')) {
          throw new Error('REGISTRATION_DISABLED');
        }
      }),
    },
    databaseHooks: {
      user: { create: { after: async (user) => {
        if (!config.allowRegistration) return;
        const connection = await pool.connect();
        try {
          await connection.query('begin');
          await connection.query('insert into profiles(user_id) values ($1) on conflict do nothing', [user.id]);
          const workspace = await connection.query<{ id: string }>(
            "insert into workspaces(name, slug) values ($1, $2) returning id",
            [`${user.name}'s workspace`, `personal-${user.id.toLowerCase().replace(/[^a-z0-9]+/gu, '-').slice(0, 40)}`],
          );
          const workspaceId = workspace.rows[0]?.id;
          if (!workspaceId) throw new Error('Registration workspace creation failed');
          await connection.query("insert into memberships(workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, user.id]);
          await connection.query('commit');
        } catch (error) {
          await connection.query('rollback');
          throw error;
        } finally {
          connection.release();
        }
      } } },
    },
    plugins: [
      admin(),
      bearer(),
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
