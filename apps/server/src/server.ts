import { createAuth } from './auth.js';
import { createApp, startServer } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { ReflowService } from './domain/service.js';
import { createOperations } from './operations.js';
import { createTemporalClient } from './temporal/client.js';

const config = loadConfig();
const { db, pool } = createDatabase(config);
const auth = createAuth(config, pool);
const temporal = await createTemporalClient(config);
const service = new ReflowService(db, temporal, auth);
const operations = createOperations(service);
const server = startServer(createApp({ config, auth, db, service, operations }), config);

const shutdown = () => server.close(() => void pool.end());
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
console.log(JSON.stringify({ level: 'info', message: 'Reflow server listening', port: config.port }));
