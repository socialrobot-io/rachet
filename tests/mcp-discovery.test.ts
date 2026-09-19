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
        getSession: async () => null,
        verifyApiKey: async () => ({ valid: false, key: null }),
      },
    } as unknown as ReflowAuth,
    db: {} as Database,
    service: {} as ReflowService,
    operations: {},
  });
  return { app, handler };
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
});
