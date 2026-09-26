import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import type { ReflowAuth } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';
import type { Database } from '../apps/server/src/db/index.js';
import type { ReflowService } from '../apps/server/src/domain/service.js';

function healthApp(db: Database) {
  const config = {
    publicUrl: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:3000'],
    dashboardDir: '/definitely-not-a-dashboard',
  } as Config;
  return createApp({
    config,
    auth: {
      handler: async () => new Response(null, { status: 404 }),
      api: {
        getSession: async () => null,
        verifyApiKey: async () => ({ valid: false, key: null }),
      },
    } as unknown as ReflowAuth,
    db,
    service: {} as ReflowService,
    operations: {},
  });
}

describe('health endpoints', () => {
  it('serves liveness without touching the database', async () => {
    const execute = vi.fn();
    const app = healthApp({ execute } as unknown as Database);
    const response = await app.request('/health/live');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports ready when the database answers', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    const app = healthApp({ execute } as unknown as Database);
    const response = await app.request('/health/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(execute).toHaveBeenCalledWith('select 1');
  });

  it('reports unavailable when the database is down', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    const app = healthApp({ execute } as unknown as Database);
    const response = await app.request('/health/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

describe('container healthcheck wiring', () => {
  it('ships a Dockerfile HEALTHCHECK that probes readiness', async () => {
    const dockerfile = await readFile('Dockerfile', 'utf8');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('docker/healthcheck-ready.js');
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends curl/);
  });

  it('configures the app service healthcheck in compose', async () => {
    const compose = await readFile('compose.yaml', 'utf8');
    expect(compose).toContain('docker/healthcheck-ready.js');
    expect(compose).toContain('start_period');
  });

  it('exposes docker-compose.yaml for Coolify', async () => {
    const wrapper = await readFile('docker-compose.yaml', 'utf8');
    expect(wrapper).toContain('compose.yaml');
  });
});
