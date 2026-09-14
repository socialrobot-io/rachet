import { describe, expect, it } from 'vitest';
import { inferNativeApplicationType, needsMcpPublicClientRegistration, usesPrivateUseRedirect } from '../src/auth/mcp-client-registration.js';

describe('MCP OAuth client registration', () => {
  it('recognizes public PKCE clients using loopback or private-use redirects', () => {
    expect(needsMcpPublicClientRegistration({ redirect_uris: ['http://127.0.0.1:48152/callback'] })).toBe(true);
    expect(needsMcpPublicClientRegistration({ redirect_uris: ['cursor://oauth/callback'] })).toBe(true);
    expect(needsMcpPublicClientRegistration({ redirect_uris: ['cursor://oauth/callback'], token_endpoint_auth_method: 'client_secret_basic' })).toBe(false);
    expect(usesPrivateUseRedirect('cursor://oauth/callback')).toBe(true);
  });

  it('infers native application type for local MCP callbacks', () => {
    expect(inferNativeApplicationType({ redirect_uris: ['http://localhost:3001/callback'] }).application_type).toBe('native');
    expect(inferNativeApplicationType({ redirect_uris: ['https://client.example/callback'], application_type: 'web' }).application_type).toBe('web');
  });
});
