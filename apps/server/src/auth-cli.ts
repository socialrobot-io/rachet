import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';

const config = loadConfig();
const { pool } = createDatabase(config);
export const auth = createAuth(config, pool);
