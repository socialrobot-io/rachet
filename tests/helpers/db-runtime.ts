import type { Client } from '@temporalio/client';
import type { ReflowAuth } from '../../apps/server/src/auth.js';
import { loadConfig } from '../../apps/server/src/config.js';
import { createDatabase, type Database } from '../../apps/server/src/db/index.js';
import type { OperationContext } from '../../packages/contracts/src/index.js';
import { ReflowService } from '../../apps/server/src/domain/service.js';

export type DbRuntime = {
  service: ReflowService;
  db: Database;
  pool: ReturnType<typeof createDatabase>['pool'];
  config: ReturnType<typeof loadConfig>;
  close: () => Promise<void>;
};

export async function probeDbRuntime(temporal?: Client): Promise<DbRuntime | null> {
  try {
    const config = loadConfig(process.env);
    const database = createDatabase(config);
    await database.pool.query('select 1');
    const client = temporal ?? ({ workflow: { getHandle: () => ({ signal: async () => undefined }) } } as unknown as Client);
    const auth = {} as ReflowAuth;
    return {
      service: new ReflowService(database.db, client, auth),
      db: database.db,
      pool: database.pool,
      config,
      close: async () => { await database.pool.end(); },
    };
  } catch {
    return null;
  }
}

export function adminContext(requestId = 'vitest'): OperationContext {
  return {
    requestId,
    principal: {
      userId: 'vitest-admin',
      workspaceIds: [],
      workspaceRoles: {},
      deploymentAdmin: true,
      scopes: ['reflow:read', 'reflow:write', 'reflow:send'],
    },
  };
}

export function roleContext(
  workspaceId: string,
  role: 'owner' | 'admin' | 'author' | 'sender' | 'operator' | 'viewer',
  userId = `vitest-${role}`,
): OperationContext {
  return {
    requestId: `vitest-${role}`,
    principal: {
      userId,
      workspaceIds: [workspaceId],
      workspaceRoles: { [workspaceId]: role },
      deploymentAdmin: false,
      scopes: ['reflow:read', 'reflow:write', 'reflow:send'],
    },
  };
}
