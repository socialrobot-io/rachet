import { describe, expect, it } from 'vitest';
import { RachetSdk } from '@socialrobot-io/rachet-sdk';
import {
  runWelcomeStarter,
  runWelcomeWorkflowCreated,
  setWelcomeStarter,
  setWelcomeWorkflowCreated,
  signalProductWelcome,
  startProductWelcome,
  welcomeEventId,
  welcomeFirstName,
  welcomeIdempotencyKey,
  welcomeVariables,
  WELCOME_WORKFLOW_NAME,
} from '../apps/server/src/welcome.js';

const workspaceId = 'c2c7e6da-b51e-4bb8-b39d-bfc93975bba8';
const versionId = '4805e4c5-7e66-41b9-a1e5-22ac62aead7b';

describe('welcome helpers', () => {
  it('uses the given name, then the mailbox, then a fallback', () => {
    expect(welcomeFirstName('Ada Lovelace', 'ada@example.com')).toBe('Ada');
    expect(welcomeFirstName('  ', 'ada@example.com')).toBe('ada');
    expect(welcomeFirstName(null, '@')).toBe('there');
  });

  it('builds enrollment variables from the public URL and sender', () => {
    expect(welcomeVariables('https://rachet.dev/', 'Rachet <hello@rachet.dev>')).toEqual({
      workflowsUrl: 'https://rachet.dev/workflows',
      integrationsUrl: 'https://rachet.dev/settings/integrations',
      replyMailto: 'mailto:hello@rachet.dev',
      logoUrl: 'https://rachet.dev/brand/rachet-logo.png',
      signatureUrl: 'https://rachet.dev/brand/founder-signature.png',
    });
  });

  it('runs the starter registered by the server', async () => {
    const seen: string[] = [];
    setWelcomeStarter(async (user) => { seen.push(user.id); });
    try {
      await runWelcomeStarter({ id: 'user-1', email: 'ada@example.com', name: 'Ada' });
      expect(seen).toEqual(['user-1']);
    } finally {
      setWelcomeStarter(async () => {});
    }
  });
});

function sdkFor(routes: Record<string, (body: Record<string, unknown>) => unknown>, calls: string[] = []) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const operation = String(input).split('/v1/operations/')[1] ?? '';
    calls.push(operation);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const route = routes[operation];
    if (!route) return new Response(JSON.stringify({ message: `missing ${operation}` }), { status: 404 });
    return new Response(JSON.stringify({ data: route(body) }), { status: 200 });
  };
  return new RachetSdk({
    url: 'https://rachet.test',
    apiKey: 'rf_test',
    workspaceId,
    fetch: fetchImpl,
  });
}

describe('product welcome SDK', () => {
  const user = { id: 'user-1', email: 'ada@example.com', name: 'Ada Lovelace' };

  it('enrolls with trigger when the welcome workflow is published', async () => {
    const calls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const sdk = sdkFor({
      'workflow.list': () => [{
        name: WELCOME_WORKFLOW_NAME,
        state: 'published',
        publishedVersions: [{ id: 'older', version: 1 }, { id: versionId, version: 2 }],
      }],
      'contact.upsert': (body) => {
        bodies.push(body);
        return { id: 'contact-1' };
      },
      'enrollment.create': (body) => {
        bodies.push(body);
        return { id: 'enrollment-1' };
      },
    }, calls);

    await startProductWelcome({
      sdk,
      workspaceId,
      publicUrl: 'https://rachet.dev',
      from: 'Rachet <hello@rachet.dev>',
      user,
    });

    expect(calls).toEqual(['workflow.list', 'contact.upsert', 'enrollment.create']);
    expect(bodies[0]).toMatchObject({
      workspaceId,
      email: user.email,
      externalId: user.id,
      fields: { firstName: 'Ada' },
    });
    expect(bodies[1]).toMatchObject({
      workspaceId,
      workflowVersionId: versionId,
      contactId: 'contact-1',
      idempotencyKey: welcomeIdempotencyKey(user.id),
      variables: welcomeVariables('https://rachet.dev', 'Rachet <hello@rachet.dev>'),
    });
  });

  it('does not enroll when the welcome workflow is not published', async () => {
    const calls: string[] = [];
    const sdk = sdkFor({
      'workflow.list': () => [{ name: WELCOME_WORKFLOW_NAME, state: 'draft', publishedVersions: [] }],
    }, calls);
    await startProductWelcome({
      sdk,
      workspaceId,
      publicUrl: 'https://rachet.dev',
      from: 'Rachet <hello@rachet.dev>',
      user,
    });
    expect(calls).toEqual(['workflow.list']);
  });

  it('emits workflow.created.v1 for the welcome enrollment', async () => {
    const seen: Record<string, unknown>[] = [];
    const sdk = sdkFor({
      'enrollment.list': () => [
        { id: 'other', idempotencyKey: 'welcome-someone-else' },
        { id: 'enrollment-1', idempotencyKey: welcomeIdempotencyKey(user.id) },
      ],
      'event.emit': (body) => {
        seen.push(body);
        return { accepted: true };
      },
    });
    const createdWorkflowId = 'wf-1';
    await signalProductWelcome({ sdk, workspaceId, userId: user.id, createdWorkflowId });
    expect(seen).toEqual([{
      workspaceId,
      enrollmentId: 'enrollment-1',
      eventId: welcomeEventId(createdWorkflowId),
      eventType: 'workflow.created.v1',
      data: { workflowId: createdWorkflowId },
    }]);
  });

  it('does not throw when the person has no welcome enrollment', async () => {
    const sdk = sdkFor({ 'enrollment.list': () => [] });
    await expect(signalProductWelcome({
      sdk,
      workspaceId,
      userId: user.id,
      createdWorkflowId: 'wf-1',
    })).resolves.toBeUndefined();
  });

  it('does not fail workflow creation when the SDK call fails', async () => {
    setWelcomeWorkflowCreated(async () => { throw new Error('sdk down'); });
    try {
      await expect(runWelcomeWorkflowCreated(user.id, 'wf-1')).resolves.toBeUndefined();
    } finally {
      setWelcomeWorkflowCreated(async () => {});
    }
  });
});
