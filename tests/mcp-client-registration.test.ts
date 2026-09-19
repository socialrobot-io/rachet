import { describe, expect, it } from 'vitest';
import { inferNativeApplicationType, needsMcpPublicClientRegistration, usesPrivateUseRedirect, validatePublicRedirectUri } from '../apps/server/src/auth/mcp-client-registration.js';

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

  it('rejects arbitrary web callbacks unless the operator allowlists their origin', () => {
    expect(() => validatePublicRedirectUri('https://attacker.example/callback')).toThrow(/allowlisted/);
    expect(() => validatePublicRedirectUri('http://attacker.example/callback')).toThrow(/loopback/);
    expect(() => validatePublicRedirectUri('javascript:alert(1)')).toThrow(/not allowed/);
    expect(() => validatePublicRedirectUri('unknown-app://oauth/callback')).toThrow(/not allowlisted/);
    expect(() => validatePublicRedirectUri('https://client.example/callback', ['https://client.example'])).not.toThrow();
    expect(() => validatePublicRedirectUri('http://127.0.0.1:48152/callback')).not.toThrow();
    expect(() => validatePublicRedirectUri('cursor://oauth/callback')).not.toThrow();
    expect(() => validatePublicRedirectUri('vscode://oauth/callback', [], ['vscode:'])).not.toThrow();
  });
});
