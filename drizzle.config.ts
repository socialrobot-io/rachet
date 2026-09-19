import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/server/src/db/schema.ts',
  out: './migrations/reflow',
});
