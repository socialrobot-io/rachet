import { eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { resendConnections, sesConnections, workspaces } from '../db/schema.js';
import { ResendProvider } from '../providers/resend.js';
import { SesProvider, type SesCredentials } from '../providers/ses.js';
import { decryptIntegrationSecret } from './secret.js';

export type EmailProviderName = typeof workspaces.$inferSelect.emailProvider;

export async function emailConnection(db: Pick<Database, 'select'>, workspaceId: string, provider: EmailProviderName) {
  if (provider === 'ses') {
    const [connection] = await db.select().from(sesConnections).where(eq(sesConnections.workspaceId, workspaceId)).limit(1);
    return connection ? { ...connection, provider } : undefined;
  }
  const [connection] = await db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId)).limit(1);
  return connection ? { ...connection, provider } : undefined;
}

export async function activeEmailConnection(db: Pick<Database, 'select'>, workspaceId: string) {
  const [workspace] = await db.select({ provider: workspaces.emailProvider }).from(workspaces)
    .where(eq(workspaces.id, workspaceId)).limit(1);
  return workspace ? emailConnection(db, workspaceId, workspace.provider) : undefined;
}

export function sesProvider(config: Config, connection: typeof sesConnections.$inferSelect) {
  const credentials = JSON.parse(decryptIntegrationSecret(config, connection.workspaceId, 'ses-credentials', connection.credentialsEncrypted)) as SesCredentials;
  return new SesProvider(connection.region, connection.configurationSet, credentials);
}

export function emailProvider(config: Config, connection: NonNullable<Awaited<ReturnType<typeof emailConnection>>>) {
  if (connection.provider === 'ses') return sesProvider(config, connection);
  return new ResendProvider(decryptIntegrationSecret(config, connection.workspaceId, 'resend-api-key', connection.apiKeyEncrypted), undefined);
}
