import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { ReflowService } from './domain/service.js';
import { createMcpServer } from './mcp.js';
import { createOperations } from './operations.js';
import { createTemporalClient } from './temporal/client.js';

if (process.env.REFLOW_STDIO_TRUSTED_HOST !== 'true') {
  throw new Error('Stdio MCP trusts the local host identity. Set REFLOW_STDIO_TRUSTED_HOST=true only in a single-user trusted environment.');
}
const actorId = process.env.REFLOW_ACTOR_USER_ID;
if (!actorId) throw new Error('REFLOW_ACTOR_USER_ID is required for trusted local stdio MCP; use the authenticated HTTP /mcp endpoint otherwise');
const config = loadConfig(); const { db, pool } = createDatabase(config); const auth = createAuth(config, pool);
const service = new ReflowService(db, await createTemporalClient(config), auth);
const server = await createMcpServer(createOperations(service), { principal: await service.principalFor(actorId), requestId: crypto.randomUUID() });
await server.connect(new StdioServerTransport());
const shutdown = () => void pool.end(); process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
