import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { z } from 'zod';
import type { Config } from './config.js';
import type { ReflowAuth } from './auth.js';
import type { Database } from './db/index.js';
import { resendConnections, sendIntents, suppressions, webhookEvents, workspaces } from './db/schema.js';
import type { ReflowService } from './domain/service.js';
import { ReflowError, errorPayload } from './domain/errors.js';
import { createMcpServer } from './mcp.js';
import { authorizeOperation, type Operation } from './operations.js';
import { ResendProvider } from './providers/resend.js';
import { decryptIntegrationSecret, encryptIntegrationSecret, fingerprintIntegrationSecret } from './integrations/secret.js';
import { authorizeRegistrationIntent, registrationIntentSchema, registrationStatus } from './registration.js';
import { consumeRateLimit } from './security/rate-limit.js';
import {
  inferNativeApplicationType,
  needsMcpPublicClientRegistration,
  registerMcpPublicClient,
  type DynamicClientRegistrationRequest,
} from './auth/mcp-client-registration.js';

type Dependencies = {
  config: Config;
  auth: ReflowAuth;
  db: Database;
  service: ReflowService;
  operations: Record<string, Operation>;
};

// Resend webhook signing secrets use base64. Accept its standard characters
// (+, / and trailing =) as well as URL-safe variants without weakening the
// required whsec_ prefix or allowing whitespace.
export const resendWebhookSecretInput = z.string().trim().regex(
  /^whsec_[A-Za-z0-9+/_-]{8,200}={0,2}$/,
  'Enter a Resend webhook signing secret',
);

function mountDashboard(app: Hono, root: string) {
  if (!existsSync(join(root, 'index.html'))) return false;
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
  return true;
}

export function createApp(dependencies: Dependencies) {
  const { config, auth, db, service, operations } = dependencies;
  const app = new Hono();
  app.use('*', secureHeaders());
  app.use('/api/*', cors({ origin: config.trustedOrigins, credentials: true, allowHeaders: ['authorization', 'content-type', 'x-api-key'] }));
  app.use('/v1/*', cors({ origin: config.trustedOrigins, allowHeaders: ['authorization', 'content-type', 'x-api-key'] }));

  const workspaceIdInput = z.uuid();
  const senderInput = z.string().trim().min(3).max(254).refine((value) => {
    const bracketed = value.match(/^[^<>]+\s<([^<>\s]+)>$/);
    return z.email().safeParse(bracketed ? bracketed[1] : value).success;
  }, 'Enter an email address or Name <email@verified-domain>');
  const connectionInput = z.object({
    workspaceId: workspaceIdInput,
    from: senderInput,
    apiKey: z.string().trim().regex(/^re_[A-Za-z0-9_-]{8,200}$/, 'Enter a Resend API key'),
    webhookSecret: resendWebhookSecretInput,
  });
  async function integrationMember(request: Request, workspaceId: string, admin: boolean) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new ReflowError('UNAUTHENTICATED', 'Authentication required', 401);
    const principal = await service.principalFor(session.user.id);
    const role = principal.workspaceRoles[workspaceId];
    if (!role || (admin && role !== 'owner' && role !== 'admin')) {
      throw new ReflowError('FORBIDDEN', 'Organization access denied', 403);
    }
    return principal;
  }
  function sameOriginWrite(request: Request) {
    const origin = request.headers.get('origin');
    return !!origin && config.trustedOrigins.includes(origin);
  }
  async function limitedText(request: Request, maxBytes: number) {
    const reader = request.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ReflowError('VALIDATION_FAILED', 'Request body is too large', 413);
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  }
  function integrationError(error: unknown) {
    if (error instanceof ReflowError) return { status: error.status, body: errorPayload(error) };
    if (error instanceof ZodError) return { status: 422, body: { code: 'VALIDATION_FAILED', message: 'Check the integration fields', fieldErrors: z.flattenError(error).fieldErrors } };
    if (error instanceof SyntaxError) return { status: 400, body: { code: 'INVALID_JSON', message: 'Invalid JSON request' } };
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      return { status: 409, body: { code: 'CONNECTION_CONFLICT', message: 'A Resend credential is already connected to another organization' } };
    }
    console.error('Integration request failed', error instanceof Error ? error.name : 'unknown');
    return { status: 500, body: { code: 'INTERNAL', message: 'Integration request failed' } };
  }
  app.get('/api/integrations/resend', async (context) => {
    try {
      const workspaceId = workspaceIdInput.parse(context.req.query('workspaceId'));
      await integrationMember(context.req.raw, workspaceId, false);
      const [connection] = await db.select({ fromAddress: resendConnections.fromAddress, updatedAt: resendConnections.updatedAt, lastTestAcceptedAt: resendConnections.lastTestAcceptedAt })
        .from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId)).limit(1);
      const [workspace] = await db.select({ onboardingCompletedAt: workspaces.onboardingCompletedAt })
        .from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      context.header('Cache-Control', 'no-store');
      return context.json({
        configured: !!connection,
        from: connection?.fromAddress ?? null,
        updatedAt: connection?.updatedAt ?? null,
        lastTestAcceptedAt: connection?.lastTestAcceptedAt ?? null,
        onboardingComplete: !!workspace?.onboardingCompletedAt,
        webhookUrl: `${config.publicUrl}/webhooks/resend/${workspaceId}`,
      });
    } catch (error) {
      const { status, body } = integrationError(error);
      return context.json(body, status as 400);
    }
  });
  app.post('/api/integrations/resend', async (context) => {
    try {
      if (!sameOriginWrite(context.req.raw)) throw new ReflowError('FORBIDDEN', 'Invalid request origin', 403);
      const raw = await limitedText(context.req.raw, 4096);
      const input = connectionInput.parse(JSON.parse(raw));
      const principal = await integrationMember(context.req.raw, input.workspaceId, true);
      await consumeRateLimit(db, config, 'resend-connection-save', input.workspaceId, 20, 3600);
      if (!config.integrationEncryptionKey) throw new ReflowError('NOT_CONFIGURED', 'Integration encryption is not configured on this deployment', 503);
      if (input.apiKey === config.authResendApiKey || input.apiKey === config.resendApiKey) {
        throw new ReflowError('VALIDATION_FAILED', 'Use a dedicated Resend key for this organization', 422);
      }
      const apiKeyEncrypted = encryptIntegrationSecret(config, input.workspaceId, 'resend-api-key', input.apiKey);
      const webhookSecretEncrypted = encryptIntegrationSecret(config, input.workspaceId, 'resend-webhook-secret', input.webhookSecret);
      const apiKeyFingerprint = fingerprintIntegrationSecret(config, 'resend-api-key', input.apiKey);
      const webhookSecretFingerprint = fingerprintIntegrationSecret(config, 'resend-webhook-secret', input.webhookSecret);
      await db.transaction(async (transaction) => {
        await transaction.insert(resendConnections).values({
          workspaceId: input.workspaceId, apiKeyEncrypted, apiKeyFingerprint, webhookSecretEncrypted, webhookSecretFingerprint, fromAddress: input.from,
        }).onConflictDoUpdate({ target: resendConnections.workspaceId, set: {
          apiKeyEncrypted, apiKeyFingerprint, webhookSecretEncrypted, webhookSecretFingerprint, fromAddress: input.from,
          version: sql`${resendConnections.version} + 1`, lastTestAcceptedAt: null, updatedAt: new Date(),
        } });
        await transaction.update(workspaces).set({ sendingEnabled: false, updatedAt: new Date() })
          .where(eq(workspaces.id, input.workspaceId));
      });
      console.info('Resend connection configured', { workspaceId: input.workspaceId, actorId: principal.userId });
      return context.json({ configured: true });
    } catch (error) {
      const { status, body } = integrationError(error);
      return context.json(body, status as 400);
    }
  });
  app.post('/api/integrations/resend/skip', async (context) => {
    try {
      if (!sameOriginWrite(context.req.raw)) throw new ReflowError('FORBIDDEN', 'Invalid request origin', 403);
      const raw = await limitedText(context.req.raw, 256);
      const workspaceId = workspaceIdInput.parse((JSON.parse(raw) as { workspaceId?: unknown }).workspaceId);
      await integrationMember(context.req.raw, workspaceId, true);
      await consumeRateLimit(db, config, 'resend-connection-test', workspaceId, 5, 3600);
      await db.update(workspaces).set({ onboardingCompletedAt: new Date(), updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      return context.json({ onboardingComplete: true });
    } catch (error) {
      const { status, body } = integrationError(error);
      return context.json(body, status as 400);
    }
  });
  app.post('/api/integrations/resend/test', async (context) => {
    try {
      if (!sameOriginWrite(context.req.raw)) throw new ReflowError('FORBIDDEN', 'Invalid request origin', 403);
      const raw = await limitedText(context.req.raw, 256);
      const workspaceId = workspaceIdInput.parse((JSON.parse(raw) as { workspaceId?: unknown }).workspaceId);
      await integrationMember(context.req.raw, workspaceId, true);
      const session = await auth.api.getSession({ headers: context.req.raw.headers });
      if (!session) throw new ReflowError('UNAUTHENTICATED', 'Authentication required', 401);
      const [connection] = await db.select().from(resendConnections).where(eq(resendConnections.workspaceId, workspaceId)).limit(1);
      if (!connection) throw new ReflowError('NOT_FOUND', 'Connect Resend first', 404);
      const key = decryptIntegrationSecret(config, workspaceId, 'resend-api-key', connection.apiKeyEncrypted);
      const outcome = await new ResendProvider(key, undefined).send({
        from: connection.fromAddress,
        to: session.user.email,
        subject: 'Reflow Resend connection test',
        html: '<p>Your organization’s Resend connection can send email.</p>',
        text: 'Your organization’s Resend connection can send email.',
        tags: [{ name: 'reflow_kind', value: 'connection_test' }],
      }, `connection-test/${crypto.randomUUID()}`);
      if (outcome.kind !== 'accepted') return context.json({ code: outcome.code, message: 'Resend did not accept the test email' }, 502);
      await db.transaction(async (transaction) => {
        const [tested] = await transaction.update(resendConnections).set({ lastTestAcceptedAt: new Date() })
          .where(and(eq(resendConnections.workspaceId, workspaceId), eq(resendConnections.version, connection.version)))
          .returning({ workspaceId: resendConnections.workspaceId });
        if (!tested) throw new ReflowError('CONNECTION_CHANGED', 'Connection changed during the test; test it again', 409);
        await transaction.update(workspaces).set({ onboardingCompletedAt: new Date(), sendingEnabled: true, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId));
      });
      return context.json({ accepted: true });
    } catch (error) {
      const { status, body } = integrationError(error);
      return context.json(body, status as 400);
    }
  });

  app.get('/health/live', (context) => context.json({ status: 'ok' }));
  app.get('/health/ready', async (context) => {
    try { await db.execute('select 1'); return context.json({ status: 'ready' }); }
    catch { return context.json({ status: 'unavailable' }, 503); }
  });
  app.get('/api/setup/status', async (context) => {
    const status = await registrationStatus(db, config);
    context.header('Cache-Control', 'no-store');
    return context.json(status);
  });
  app.post('/api/registration/intent', async (context) => {
    try {
      const raw = await limitedText(context.req.raw, 4096);
      await consumeRateLimit(db, config, 'registration-intent-global', 'deployment', 60, 60);
      const input = registrationIntentSchema.parse(JSON.parse(raw));
      if (input.method === 'magic-link') {
        await consumeRateLimit(db, config, 'registration-intent-email', input.email.trim().toLowerCase(), 5, 15 * 60);
      }
      const result = await authorizeRegistrationIntent(db, config, input);
      context.header('Cache-Control', 'no-store');
      return context.json(result);
    } catch (error) {
      if (error instanceof ReflowError) return context.json(errorPayload(error), error.status as 400);
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        const messages: Record<string, string> = {
          email: 'Enter a valid email address.',
          name: 'Enter your name.',
          organizationName: 'Enter an organization name.',
          organizationSlug: 'Use lowercase letters, numbers, and hyphens only.',
          setupSecret: 'Enter the setup secret.',
        };
        for (const issue of error.issues) {
          const field = typeof issue.path[0] === 'string' ? issue.path[0] : 'form';
          fieldErrors[field] ??= [];
          fieldErrors[field].push(messages[field] ?? 'Check this value.');
        }
        return context.json({
          code: 'VALIDATION_FAILED',
          message: 'Check the highlighted fields and try again.',
          fieldErrors,
        }, 422);
      }
      const status = error instanceof Error && 'status' in error && error.status === 403 ? 403 : 422;
      const message = error instanceof Error ? error.message : 'Registration request failed';
      return context.json({ message }, status);
    }
  });
  app.post('/api/auth/oauth2/register', async (context) => {
    const body = await context.req.json().catch(() => null) as DynamicClientRegistrationRequest | null;
    if (!body || typeof body !== 'object') {
      return context.json({ error: 'invalid_client_metadata', error_description: 'JSON body required' }, 400);
    }
    try {
      if (needsMcpPublicClientRegistration(body)) {
        return context.json(await registerMcpPublicClient(db, config, body), 201);
      }
      const normalized = inferNativeApplicationType(body);
      return await auth.handler(new Request(context.req.raw.url, {
        method: 'POST',
        headers: context.req.raw.headers,
        body: JSON.stringify(normalized),
      }));
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Client registration failed';
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'invalid_client_metadata';
      return context.json({ error: code, error_description: description }, 400);
    }
  });
  app.post('/api/connected-apps/:consentId/revoke', async (context) => {
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ message: 'Authentication required' }, 401);
    const consentId = context.req.param('consentId');
    const found = await db.execute<{ clientId: string }>(sql`
      select "clientId" as "clientId" from "oauthConsent"
      where id = ${consentId} and "userId" = ${session.user.id}
      limit 1
    `);
    const clientId = found.rows[0]?.clientId;
    if (!clientId) return context.json({ message: 'Connected app not found' }, 404);
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`delete from "oauthAccessToken" where "clientId" = ${clientId} and "userId" = ${session.user.id}`);
      await transaction.execute(sql`delete from "oauthRefreshToken" where "clientId" = ${clientId} and "userId" = ${session.user.id}`);
      await transaction.execute(sql`delete from "oauthConsent" where id = ${consentId} and "userId" = ${session.user.id}`);
      const remaining = await transaction.execute<{ count: string }>(sql`select count(*)::text as count from "oauthConsent" where "clientId" = ${clientId}`);
      if (remaining.rows[0]?.count === '0') {
        await transaction.execute(sql`delete from "oauthClient" where "clientId" = ${clientId} and "userId" is null and "referenceId" is null`);
      }
    });
    return context.json({ revoked: true });
  });
  app.all('/api/auth/*', (context) => auth.handler(context.req.raw));
  async function operationContext(request: Request) {
    const rawApiKey = request.headers.get('x-api-key');
    if (rawApiKey) {
      const api = auth.api as unknown as { verifyApiKey(args: { body: { key: string } }): Promise<{ valid: boolean; key: null | { referenceId: string; permissions: null | Record<string, string[]>; metadata?: unknown } }> };
      const verified = await api.verifyApiKey({ body: { key: rawApiKey } });
      if (!verified.valid || !verified.key) throw new ReflowError('UNAUTHENTICATED', 'Invalid API key', 401);
      const principal = await service.principalFor(verified.key.referenceId);
      principal.scopes = (verified.key.permissions?.reflow ?? []).map((scope) => `reflow:${scope}`);
      const metadata = verified.key.metadata && typeof verified.key.metadata === 'object'
        ? verified.key.metadata as Record<string, unknown>
        : {};
      const workspaceId = typeof metadata.workspaceId === 'string' ? metadata.workspaceId : undefined;
      if (!workspaceId) throw new ReflowError('FORBIDDEN', 'API key has no organization binding', 403);
      if (!principal.workspaceIds.includes(workspaceId)) {
        throw new ReflowError('FORBIDDEN', 'API key organization access was revoked', 403);
      }
      principal.workspaceIds = [workspaceId];
      principal.workspaceRoles = principal.workspaceRoles[workspaceId]
        ? { [workspaceId]: principal.workspaceRoles[workspaceId] }
        : {};
      principal.deploymentAdmin = false;
      return await Promise.resolve({ principal, requestId: crypto.randomUUID() });
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) return { principal: await service.principalFor(session.user.id), requestId: crypto.randomUUID() };
    const authorization = request.headers.get('authorization');
    if (authorization?.startsWith('Bearer ')) {
      const response = await auth.handler(new Request(`${config.publicUrl}/api/auth/reflow-token`, { headers: request.headers }));
      if (!response.ok) throw new ReflowError('UNAUTHENTICATED', 'Invalid OAuth access token', 401);
      const token = await response.json() as { aud?: string | string[]; sub?: string; client_id?: string; scope?: string };
      const audience = Array.isArray(token.aud) ? token.aud : [token.aud];
      if (!audience.includes(`${config.publicUrl}/mcp`)) throw new ReflowError('FORBIDDEN', 'OAuth token is not valid for Reflow MCP', 403);
      let userId = token.sub;
      if (!userId && token.client_id) {
        const result = await db.execute<{ userId: string }>(sql`select "userId" as "userId" from "oauthClient" where "clientId" = ${token.client_id} and disabled is not true limit 1`);
        userId = result.rows[0]?.userId;
      }
      if (!userId) throw new ReflowError('FORBIDDEN', 'OAuth client is not assigned to a Reflow account', 403);
      const principal = await service.principalFor(userId);
      principal.scopes = token.scope?.split(' ').filter(Boolean) ?? [];
      return { principal, requestId: crypto.randomUUID() };
    }
    throw new ReflowError('UNAUTHENTICATED', 'Authentication required', 401);
  }

  app.post('/v1/operations/:name', async (context) => {
    try {
      const operation = operations[context.req.param('name')];
      if (!operation) throw new ReflowError('NOT_FOUND', 'Operation not found', 404);
      const execution = await operationContext(context.req.raw);
      authorizeOperation(operation, execution);
      const input = operation.input.parse(await context.req.json().catch(() => ({})));
      const data = await operation.invoke(execution, input);
      return context.json({ status: 'succeeded', data, requestId: execution.requestId });
    } catch (error) {
      if (error instanceof ReflowError) return context.json(errorPayload(error), error.status as 400);
      if (error instanceof Error && error.name === 'ZodError') return context.json({ code: 'VALIDATION_FAILED', message: error.message, retryable: false }, 422);
      console.error(error);
      return context.json({ code: 'INTERNAL', message: 'Operation failed', retryable: false }, 500);
    }
  });

  app.all('/mcp', async (context) => {
    let execution;
    try { execution = await operationContext(context.req.raw); }
    catch {
      return context.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': `Bearer realm="reflow", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp"`,
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const mcp = await createMcpServer(operations, execution);
    await mcp.connect(transport);
    return transport.handleRequest(context.req.raw);
  });

  const authorizationServer = `${config.publicUrl}/api/auth`;
  const protectedResourceMetadata = {
    resource: `${config.publicUrl}/mcp`,
    authorization_servers: [authorizationServer],
    scopes_supported: ['reflow:read', 'reflow:write', 'reflow:send'],
    bearer_methods_supported: ['header'],
  };
  app.get('/.well-known/oauth-protected-resource', (context) => context.json(protectedResourceMetadata));
  app.get('/.well-known/oauth-protected-resource/mcp', (context) => context.json(protectedResourceMetadata));
  // Some MCP clients still probe the resource origin before reading authorization_servers.
  async function proxyAuthWellKnown(path: string) {
    const response = await auth.handler(new Request(`${authorizationServer}${path}`));
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  }
  app.get('/.well-known/oauth-authorization-server', () => proxyAuthWellKnown('/.well-known/oauth-authorization-server'));
  // RFC 8414 inserts the issuer path after the well-known prefix. Because the
  // Reflow authorization-server issuer is /api/auth, OAuth clients such as
  // Cursor discover it at this path rather than at the origin-only variant.
  app.get('/.well-known/oauth-authorization-server/api/auth', () => proxyAuthWellKnown('/.well-known/oauth-authorization-server'));
  app.get('/.well-known/openid-configuration', () => proxyAuthWellKnown('/.well-known/openid-configuration'));
  app.get('/.well-known/openid-configuration/api/auth', () => proxyAuthWellKnown('/.well-known/openid-configuration'));

  app.post('/webhooks/resend/:workspaceId', async (context) => {
    const workspaceId = workspaceIdInput.safeParse(context.req.param('workspaceId'));
    if (!workspaceId.success || !config.integrationEncryptionKey) return context.text('Webhook not configured', 404);
    const [connection] = await db.select().from(resendConnections)
      .where(eq(resendConnections.workspaceId, workspaceId.data)).limit(1);
    if (!connection) return context.text('Webhook not configured', 404);
    let raw: string;
    try { raw = await limitedText(context.req.raw, 256 * 1024); }
    catch { return context.text('Webhook body too large', 413); }
    let event: Record<string, unknown>;
    try {
      const apiKey = decryptIntegrationSecret(config, workspaceId.data, 'resend-api-key', connection.apiKeyEncrypted);
      const secret = decryptIntegrationSecret(config, workspaceId.data, 'resend-webhook-secret', connection.webhookSecretEncrypted);
      event = await new ResendProvider(apiKey, secret).verifyWebhook(raw, context.req.raw.headers);
    }
    catch { return context.text('Invalid signature', 400); }
    const eventId = context.req.header('svix-id');
    const eventType = typeof event.type === 'string' ? event.type : 'unknown';
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {};
    const providerMessageId = typeof data.email_id === 'string' ? data.email_id : null;
    if (!eventId) return context.text('Missing event ID', 400);
    const tags = typeof data.tags === 'object' && data.tags !== null && !Array.isArray(data.tags)
      ? data.tags as Record<string, unknown> : {};
    if (tags.reflow_kind === 'connection_test') return context.json({ received: true });
    if (typeof tags.reflow_workspace === 'string' && tags.reflow_workspace !== workspaceId.data) {
      return context.json({ received: true });
    }
    const taggedIntentId = typeof tags.reflow_intent === 'string' && z.uuid().safeParse(tags.reflow_intent).success
      ? tags.reflow_intent : null;
    if (taggedIntentId && tags.reflow_workspace !== workspaceId.data) return context.json({ received: true });
    const [intent] = taggedIntentId
      ? await db.select().from(sendIntents).where(and(eq(sendIntents.id, taggedIntentId), eq(sendIntents.workspaceId, workspaceId.data))).limit(1)
      : providerMessageId
        ? await db.select().from(sendIntents).where(and(eq(sendIntents.workspaceId, workspaceId.data), eq(sendIntents.providerMessageId, providerMessageId))).limit(1)
        : [];
    // A tagged send intent exists before Resend responds, closing the race in
    // which a bounce reaches us before providerMessageId is saved. Never apply
    // an event merely because the webhook signature is valid for the account.
    if (!intent) {
      // Pre-tag legacy sends have no intent ID in the event. Retry critical
      // outcomes until the send response can be correlated by provider ID;
      // acknowledging here could permanently lose a bounce or complaint.
      if (!taggedIntentId && !tags.reflow_workspace && providerMessageId &&
        (eventType === 'email.bounced' || eventType === 'email.complained' || eventType === 'email.suppressed')) {
        return context.text('Send correlation pending', 503);
      }
      return context.json({ received: true });
    }
    const recipients = Array.isArray(data.to) ? data.to : [];
    if (!recipients.some((recipient) => typeof recipient === 'string' && recipient.toLowerCase() === intent.recipient.toLowerCase())) {
      return context.json({ received: true });
    }
    if (providerMessageId && intent.providerMessageId && providerMessageId !== intent.providerMessageId) {
      return context.json({ received: true });
    }
    if (providerMessageId && !intent.providerMessageId) {
      await db.update(sendIntents).set({ providerMessageId }).where(and(eq(sendIntents.id, intent.id), eq(sendIntents.workspaceId, workspaceId.data), isNull(sendIntents.providerMessageId)));
    }
    await db.insert(webhookEvents).values({ workspaceId: workspaceId.data, provider: 'resend', eventId, eventType, providerMessageId, payload: event, occurredAt: typeof event.created_at === 'string' ? new Date(event.created_at) : null }).onConflictDoNothing();
    if (providerMessageId) {
      if (intent && (eventType === 'email.bounced' || eventType === 'email.complained' || eventType === 'email.suppressed')) {
        await db.insert(suppressions).values({ workspaceId: intent.workspaceId, emailKey: intent.recipient.trim().toLowerCase(), reason: eventType, source: 'resend' }).onConflictDoUpdate({ target: [suppressions.workspaceId, suppressions.emailKey, suppressions.topic], set: { active: true, reason: eventType, updatedAt: new Date() } });
      }
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(and(eq(webhookEvents.workspaceId, workspaceId.data), eq(webhookEvents.provider, 'resend'), eq(webhookEvents.eventId, eventId)));
    return context.json({ received: true });
  });

  // Same-origin operations console (baked into the image; skipped when the build output is absent).
  mountDashboard(app, config.dashboardDir);

  return app;
}

export function startServer(app: Hono, config: Config) {
  return serve({ fetch: app.fetch, port: config.port });
}
