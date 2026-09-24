import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { sql } from 'drizzle-orm';

const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'ftp:', 'mailto:']);

export type DynamicClientRegistrationRequest = {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  application_type?: 'web' | 'native';
  scope?: string;
};

export function usesPrivateUseRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol !== 'http:' && url.protocol !== 'https:';
  } catch {
    return false;
  }
}

export function needsMcpPublicClientRegistration(body: DynamicClientRegistrationRequest): boolean {
  const redirects = body.redirect_uris ?? [];
  return redirects.length > 0
    && (body.token_endpoint_auth_method ?? 'none') === 'none'
    && !(body.grant_types ?? []).includes('client_credentials');
}

function assertSafeRedirectUri(uri: string, allowedHttpsOrigins: readonly string[], allowedPrivateSchemes: readonly string[]) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw Object.assign(new Error(`redirect URI must be an absolute URI: ${uri}`), { code: 'invalid_redirect_uri' });
  }
  if (uri.includes('#') || url.username || url.password) {
    throw Object.assign(new Error(`redirect URI must not include credentials or a fragment: ${uri}`), { code: 'invalid_redirect_uri' });
  }
  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    throw Object.assign(new Error(`redirect URI scheme is not allowed: ${uri}`), { code: 'invalid_redirect_uri' });
  }
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase();
    if (!(host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1')) {
      throw Object.assign(new Error(`http redirect URIs are only allowed on loopback hosts: ${uri}`), { code: 'invalid_redirect_uri' });
    }
  } else if (url.protocol === 'https:' && !allowedHttpsOrigins.includes(url.origin)) {
    throw Object.assign(new Error(`https redirect URI origin is not allowlisted: ${url.origin}`), { code: 'invalid_redirect_uri' });
  } else if (url.protocol !== 'https:' && !allowedPrivateSchemes.includes(url.protocol)) {
    throw Object.assign(new Error(`private-use redirect URI scheme is not allowlisted: ${url.protocol}`), { code: 'invalid_redirect_uri' });
  }
}

export function validatePublicRedirectUri(
  uri: string,
  allowedHttpsOrigins: readonly string[] = [],
  allowedPrivateSchemes: readonly string[] = ['cursor:'],
): void {
  assertSafeRedirectUri(uri, allowedHttpsOrigins, allowedPrivateSchemes);
}

/**
 * MCP clients such as Cursor register public native clients with private-use
 * redirect URIs like `cursor://anysphere.cursor-mcp/oauth/callback`. Better Auth
 * defaults DCR to application_type=web and rejects those URIs. Persist them as
 * native public clients so authorization can complete.
 */
export async function registerMcpPublicClient(
  db: Database,
  config: Config,
  body: DynamicClientRegistrationRequest,
) {
  const redirectUris = body.redirect_uris ?? [];
  if (redirectUris.length === 0) {
    throw Object.assign(new Error('redirect_uris is required'), { code: 'invalid_client_metadata' });
  }
  for (const uri of redirectUris) {
    assertSafeRedirectUri(uri, config.oauthPublicRedirectOrigins, config.oauthPublicRedirectSchemes);
  }

  const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
  if (grantTypes.includes('client_credentials')) {
    throw Object.assign(new Error('client_credentials grant requires authenticated registration'), { code: 'invalid_client_metadata' });
  }
  const responseTypes = body.response_types ?? (grantTypes.includes('authorization_code') ? ['code'] : []);
  const tokenEndpointAuthMethod = body.token_endpoint_auth_method ?? 'none';
  if (tokenEndpointAuthMethod !== 'none') {
    throw Object.assign(new Error('MCP public clients must use token_endpoint_auth_method=none'), { code: 'invalid_client_metadata' });
  }

  const clientId = randomBytes(24).toString('base64url');
  const id = randomBytes(16).toString('hex');
  const resourceId = randomBytes(16).toString('hex');
  const now = new Date();
  const allowedScopes = new Set(['openid', 'profile', 'email', 'offline_access', 'rachet:read', 'rachet:write', 'rachet:send']);
  const requestedScopes = body.scope?.split(' ').filter(Boolean)
    ?? ['openid', 'profile', 'email', 'offline_access', 'rachet:read', 'rachet:write', 'rachet:send'];
  if (requestedScopes.some((scope) => !allowedScopes.has(scope))) {
    throw Object.assign(new Error('requested scope is not supported'), { code: 'invalid_client_metadata' });
  }
  const scopes = requestedScopes;
  const mcpResource = `${config.publicUrl}/mcp`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into "oauthClient" (
        "id", "clientId", "disabled", "skipConsent", "enableEndSession", "scopes",
        "createdAt", "updatedAt", "name", "redirectUris", "tokenEndpointAuthMethod",
        "applicationType", "grantTypes", "responseTypes", "requirePKCE", "dpopBoundAccessTokens"
      ) values (
        ${id}, ${clientId}, false, false, false, ${JSON.stringify(scopes)}::jsonb,
        ${now}, ${now}, ${body.client_name ?? 'MCP client'}, ${JSON.stringify(redirectUris)}::jsonb, ${tokenEndpointAuthMethod},
        ${'native'}, ${JSON.stringify(grantTypes)}::jsonb, ${JSON.stringify(responseTypes)}::jsonb, true, false
      )
    `);
    await tx.execute(sql`
      insert into "oauthClientResource" ("id", "clientId", "resourceId", "createdAt")
      values (${resourceId}, ${clientId}, ${mcpResource}, ${now})
    `);
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: body.client_name ?? 'MCP client',
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    application_type: 'native' as const,
    require_pkce: true,
  };
}

export function inferNativeApplicationType(body: DynamicClientRegistrationRequest): DynamicClientRegistrationRequest {
  if (body.application_type) return body;
  const redirects = body.redirect_uris ?? [];
  const needsNative = redirects.some((uri) => {
    try {
      const url = new URL(uri);
      return url.protocol === 'http:' || usesPrivateUseRedirect(uri);
    } catch {
      return false;
    }
  });
  return needsNative ? { ...body, application_type: 'native' } : body;
}
