import { Client, Connection } from '@temporalio/client';
import type { Config } from '../config.js';

export async function createTemporalClient(config: Config) {
  const connection = await Connection.connect({ address: config.temporalAddress });
  return new Client({ connection, namespace: config.temporalNamespace });
}
