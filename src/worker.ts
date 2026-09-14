import { readFile } from 'node:fs/promises';
import { NativeConnection, Worker } from '@temporalio/worker';
import { loadConfig } from './config.js';
import * as activities from './temporal/activities.js';

const config = loadConfig();
activities.configureActivities(config);
const connection = await NativeConnection.connect({ address: config.temporalAddress });
const worker = await Worker.create({
  connection,
  namespace: config.temporalNamespace,
  taskQueue: config.temporalTaskQueue,
  workflowBundle: { code: await readFile(new URL('dist/workflow-bundle.js', `file://${process.cwd()}/`), 'utf8') },
  activities,
});

const shutdown = () => worker.shutdown();
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
await worker.run();
