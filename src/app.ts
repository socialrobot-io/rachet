import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from './config.js';
import type { ReflowAuth } from './auth.js';
import type { Database } from './db/index.js';
import { sendIntents, suppressions, webhookEvents } from './db/schema.js';
import type { ReflowService } from './domain/service.js';
import { ReflowError, errorPayload } from './domain/errors.js';
import { createMcpServer } from './mcp.js';
import { authorizeOperation, type Operation } from './operations.js';
import { ResendProvider } from './providers/resend.js';
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

export function createApp(dependencies: Dependencies) {
  const { config, auth, db, service, operations } = dependencies;
  const app = new Hono();
  app.use('*', secureHeaders());
  app.use('/api/*', cors({ origin: config.trustedOrigins, credentials: true, allowHeaders: ['authorization', 'content-type', 'x-api-key'] }));

  app.get('/health/live', (context) => context.json({ status: 'ok' }));
  app.get('/health/ready', async (context) => {
    try { await db.execute('select 1'); return context.json({ status: 'ready' }); }
    catch { return context.json({ status: 'unavailable' }, 503); }
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
  app.all('/api/auth/*', (context) => auth.handler(context.req.raw));
  app.get('/auth/login', (context) => context.text('Use `reflow auth login` or your MCP client to continue authentication.', 401));
  app.get('/auth/consent', (context) => context.text('Use the authenticated CLI/MCP authorization approval operation.', 401));

  async function operationContext(request: Request) {
    const rawApiKey = request.headers.get('x-api-key');
    if (rawApiKey) {
      const api = auth.api as unknown as { verifyApiKey(args: { body: { key: string } }): Promise<{ valid: boolean; key: null | { referenceId: string; permissions: null | Record<string, string[]> } }> };
      const verified = await api.verifyApiKey({ body: { key: rawApiKey } });
      if (!verified.valid || !verified.key) throw new ReflowError('UNAUTHENTICATED', 'Invalid API key', 401);
      const principal = await service.principalFor(verified.key.referenceId);
      principal.scopes = (verified.key.permissions?.reflow ?? []).map((scope) => `reflow:${scope}`);
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
    const mcp = createMcpServer(operations, execution);
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
  app.get('/.well-known/openid-configuration', () => proxyAuthWellKnown('/.well-known/openid-configuration'));

  app.post('/webhooks/resend', async (context) => {
    if (!config.resendApiKey || !config.resendWebhookSecret) return context.text('Webhook not configured', 503);
    const raw = await context.req.text();
    let event: Record<string, unknown>;
    try { event = await new ResendProvider(config.resendApiKey, config.resendWebhookSecret).verifyWebhook(raw, context.req.raw.headers); }
    catch { return context.text('Invalid signature', 400); }
    const eventId = context.req.header('svix-id');
    const eventType = typeof event.type === 'string' ? event.type : 'unknown';
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {};
    const providerMessageId = typeof data.email_id === 'string' ? data.email_id : null;
    if (!eventId) return context.text('Missing event ID', 400);
    await db.insert(webhookEvents).values({ provider: 'resend', eventId, eventType, providerMessageId, payload: event, occurredAt: typeof event.created_at === 'string' ? new Date(event.created_at) : null }).onConflictDoNothing();
    if (providerMessageId) {
      const [intent] = await db.select().from(sendIntents).where(eq(sendIntents.providerMessageId, providerMessageId)).limit(1);
      if (intent && (eventType === 'email.bounced' || eventType === 'email.complained' || eventType === 'email.suppressed')) {
        await db.insert(suppressions).values({ workspaceId: intent.workspaceId, emailKey: intent.recipient.trim().toLowerCase(), reason: eventType, source: 'resend' }).onConflictDoUpdate({ target: [suppressions.workspaceId, suppressions.emailKey, suppressions.topic], set: { active: true, reason: eventType, updatedAt: new Date() } });
      }
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(and(eq(webhookEvents.provider, 'resend'), eq(webhookEvents.eventId, eventId)));
    return context.json({ received: true });
  });
  return app;
}

export function startServer(app: Hono, config: Config) {
  return serve({ fetch: app.fetch, port: config.port });
}
