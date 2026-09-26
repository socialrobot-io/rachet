import { RachetSdk } from '@socialrobot-io/rachet-sdk';
import { createAuth } from './auth.js';
import { createApp, startServer } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { ReflowService } from './domain/service.js';
import { createOperations } from './operations.js';
import { createTemporalClient } from './temporal/client.js';
import { setWelcomeStarter, setWelcomeWorkflowCreated, signalProductWelcome, startProductWelcome } from './welcome.js';

const config = loadConfig();
const { db, pool } = createDatabase(config);
const auth = createAuth(config, pool);
const temporal = await createTemporalClient(config);
const service = new ReflowService(db, temporal, auth);
const welcomeWorkspaceId = config.welcomeWorkspaceId;
if (config.welcomeApiKey && welcomeWorkspaceId) {
  const sdk = new RachetSdk({
    url: `http://127.0.0.1:${config.port}`,
    apiKey: config.welcomeApiKey,
    workspaceId: welcomeWorkspaceId,
  });
  setWelcomeStarter((user) => startProductWelcome({
    sdk,
    workspaceId: welcomeWorkspaceId,
    publicUrl: config.publicUrl,
    from: config.from,
    user,
  }));
  setWelcomeWorkflowCreated((userId, workflowId) => signalProductWelcome({
    sdk,
    workspaceId: welcomeWorkspaceId,
    userId,
    createdWorkflowId: workflowId,
  }));
}
const operations = createOperations(service);
const server = startServer(createApp({ config, auth, db, service, operations }), config);

const shutdown = () => server.close(() => void pool.end());
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
console.log(JSON.stringify({ level: 'info', message: 'Rachet server listening', port: config.port }));
