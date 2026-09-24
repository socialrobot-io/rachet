import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SavedOAuth } from './cli-state.js';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export type BrowserLoginResult = { oauth: SavedOAuth; authorizationUrl: string };

function encodedRandom(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function oauthCredential(clientId: string, token: TokenResponse, previousRefreshToken?: string): SavedOAuth {
  const refreshToken = token.refresh_token ?? previousRefreshToken;
  return {
    clientId,
    accessToken: token.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: Date.now() + Math.max(0, token.expires_in - 10) * 1000,
    scope: token.scope ?? '',
    tokenType: token.token_type ?? 'Bearer',
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error_description: response.statusText })) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error_description === 'string'
      ? payload.error_description
      : typeof payload.message === 'string' ? payload.message : `OAuth request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const arguments_ = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, arguments_, { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function loginWithBrowser(options: {
  url: string;
  openBrowser?: boolean;
  timeoutMs?: number;
  onAuthorize?: (url: string) => void;
  fetch?: typeof globalThis.fetch;
  testCallback?: { redirectUri: string; receiveCode: (authorizationUrl: string) => Promise<string> };
}): Promise<BrowserLoginResult> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.url.replace(/\/$/, '');
  const verifier = encodedRandom(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = encodedRandom();

  let callback: Server | undefined;
  let callbackCode: Promise<string> | undefined;
  let redirectUri = options.testCallback?.redirectUri;
  if (!redirectUri) {
    let settle: ((value: string) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    callbackCode = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject; });
    callback = createServer((request, response) => {
      const incoming = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (incoming.pathname !== '/oauth/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const returnedState = incoming.searchParams.get('state');
      const code = incoming.searchParams.get('code');
      const oauthError = incoming.searchParams.get('error');
      if (returnedState !== state) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid OAuth state. You can close this window.');
        fail?.(new Error('OAuth state mismatch'));
        return;
      }
      if (oauthError || !code) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization was not completed. You can close this window.');
        fail?.(new Error(incoming.searchParams.get('error_description') ?? oauthError ?? 'Authorization failed'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Rachet CLI is connected. You can close this window.');
      settle?.(code);
    });
    await new Promise<void>((resolve, reject) => {
      callback?.once('error', reject);
      callback?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = callback.address() as AddressInfo;
    redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const registration = await parseResponse<{ client_id: string }>(await requestFetch(`${baseUrl}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
      client_name: 'Rachet CLI',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'native',
        scope: 'openid profile email offline_access rachet:read rachet:write rachet:send',
      }),
    }));
    const authorization = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access rachet:read rachet:write rachet:send',
      resource: `${baseUrl}/mcp`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString();
    options.onAuthorize?.(authorization.toString());
    if (options.openBrowser !== false) openUrl(authorization.toString());
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    let pendingCode: Promise<string>;
    if (options.testCallback) pendingCode = options.testCallback.receiveCode(authorization.toString());
    else if (callbackCode) pendingCode = callbackCode;
    else throw new Error('OAuth callback listener was not initialized');
    const code = await Promise.race([
      pendingCode,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Timed out waiting for browser authorization')), timeoutMs);
      }),
    ]);
    const token = await parseResponse<TokenResponse>(await requestFetch(`${baseUrl}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: registration.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: `${baseUrl}/mcp`,
      }),
    }));
    return { oauth: oauthCredential(registration.client_id, token), authorizationUrl: authorization.toString() };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (callback) {
      callback.closeAllConnections();
      await new Promise<void>((resolve) => callback?.close(() => resolve()));
    }
  }
}

export async function refreshOAuth(url: string, saved: SavedOAuth, requestFetch: typeof globalThis.fetch = globalThis.fetch): Promise<SavedOAuth> {
  if (!saved.refreshToken) throw new Error('The saved OAuth session cannot be refreshed');
  const baseUrl = url.replace(/\/$/, '');
  const token = await parseResponse<TokenResponse>(await requestFetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: saved.clientId,
      refresh_token: saved.refreshToken,
      resource: `${baseUrl}/mcp`,
    }),
  }));
  return oauthCredential(saved.clientId, token, saved.refreshToken);
}
