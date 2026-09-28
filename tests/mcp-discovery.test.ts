import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import type { ReflowAuth } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';
import type { Database } from '../apps/server/src/db/index.js';
import type { ReflowService } from '../apps/server/src/domain/service.js';

function discoveryApp() {
  const handler = vi.fn(async (request: Request) => Response.json({
    issuer: 'http://localhost:3000/api/auth',
    requestedPath: new URL(request.url).pathname,
  }));
  const getSession = vi.fn(async () => null);
  const config = {
    publicUrl: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:3000'],
    dashboardDir: '/definitely-not-a-dashboard',
  } as Config;
  const app = createApp({
    config,
    auth: {
      handler,
      api: {
        getSession,
        verifyApiKey: async () => ({ valid: false, key: null }),
      },
    } as unknown as ReflowAuth,
    db: {} as Database,
    service: {} as ReflowService,
    operations: {},
  });
  return { app, handler, getSession };
}

describe('MCP OAuth discovery', () => {
  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api/auth',
  ])('serves authorization-server metadata at %s', async (path) => {
    const { app } = discoveryApp();
    const response = await app.request(path);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'http://localhost:3000/api/auth',
      requestedPath: '/api/auth/.well-known/oauth-authorization-server',
    });
  });

  it.each([
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/api/auth',
  ])('serves OpenID metadata at %s', async (path) => {
    const { app } = discoveryApp();
    const response = await app.request(path);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'http://localhost:3000/api/auth',
      requestedPath: '/api/auth/.well-known/openid-configuration',
    });
  });

  it('challenges unauthenticated initialize and tools/call', async () => {
    const { app } = discoveryApp();
    for (const method of ['initialize', 'tools/call'] as const) {
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: method === 'initialize'
            ? {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '0' },
              }
            : { name: 'auth_whoami', arguments: {} },
        }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Bearer');
    }
  });

  it('returns a retryable error when a session lookup fails', async () => {
    const { app, getSession } = discoveryApp();
    getSession.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await app.request('/mcp', { method: 'POST' });

    expect(response.status).toBe(503);
    expect(response.headers.get('www-authenticate')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_UNAVAILABLE', retryable: true });
  });

  it.each([
    [429, 'RATE_LIMITED', 429],
    [500, 'AUTH_UNAVAILABLE', 503],
  ] as const)('does not turn an OAuth %i into a 401 challenge', async (authStatus, code, expectedStatus) => {
    const { app, handler } = discoveryApp();
    handler.mockResolvedValueOnce(Response.json({}, { status: authStatus }));

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('www-authenticate')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ code, retryable: true });
  });
});
