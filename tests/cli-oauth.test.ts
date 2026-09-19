import { describe, expect, it } from 'vitest';
import { loginWithBrowser, refreshOAuth } from '../packages/cli/src/oauth.js';

describe('CLI OAuth', () => {
  it('uses dynamic native-client registration and authorization-code PKCE', async () => {
    let verifier = '';
    let redirectUri = '';
    const requestFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/oauth2/register')) {
        const body = JSON.parse(String(init?.body)) as { redirect_uris: string[]; token_endpoint_auth_method: string };
        redirectUri = body.redirect_uris[0] ?? '';
        expect(body.token_endpoint_auth_method).toBe('none');
        expect(redirectUri).toBe('http://127.0.0.1:43117/oauth/callback');
        return Response.json({ client_id: 'cli-client' }, { status: 201 });
      }
      if (url.endsWith('/api/auth/oauth2/token')) {
        const body = new URLSearchParams(String(init?.body));
        verifier = body.get('code_verifier') ?? '';
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('redirect_uri')).toBe(redirectUri);
        return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 900, token_type: 'Bearer', scope: 'reflow:read' });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await loginWithBrowser({
      url: 'https://reflow.example',
      openBrowser: false,
      fetch: requestFetch,
      testCallback: {
        redirectUri: 'http://127.0.0.1:43117/oauth/callback',
        receiveCode: async (value) => {
        const authorization = new URL(value);
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
          expect(authorization.searchParams.get('state')).toBeTruthy();
          return 'authorization-code';
        },
      },
    });

    expect(verifier.length).toBeGreaterThan(40);
    expect(result.oauth).toMatchObject({ clientId: 'cli-client', accessToken: 'access', refreshToken: 'refresh' });
  });

  it('rotates refresh tokens without dropping the previous token when omitted', async () => {
    const oauth = await refreshOAuth('https://reflow.example', {
      clientId: 'cli-client', accessToken: 'old', refreshToken: 'refresh', expiresAt: 0, scope: '', tokenType: 'Bearer',
    }, async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('refresh_token')).toBe('refresh');
      return Response.json({ access_token: 'new', expires_in: 900, scope: 'reflow:read', token_type: 'Bearer' });
    });
    expect(oauth).toMatchObject({ accessToken: 'new', refreshToken: 'refresh' });
  });
});
