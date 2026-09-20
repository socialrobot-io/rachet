import { describe, expect, it } from 'vitest';
import { ReflowSdk, ReflowSdkError } from '../packages/sdk/src/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowVersionId = '00000000-0000-4000-8000-000000000002';
const contactId = '00000000-0000-4000-8000-000000000003';

describe('ReflowSdk', () => {
  it('upserts a contact and starts an idempotent enrollment', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    const client = new ReflowSdk({
      url: 'https://reflow.example.test/',
      apiKey: 'reflow_test_key',
      workspaceId,
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const headers = new Headers(init?.headers);
        requests.push({ url: String(input), body, headers });
        const data = String(input).endsWith('contact.upsert')
          ? { id: contactId, workspaceId, email: 'user@example.com', emailKey: 'user@example.com', fields: {} }
          : { id: '00000000-0000-4000-8000-000000000004', workspaceId, sequenceVersionId: workflowVersionId, contactId, state: 'pending', idempotencyKey: 'welcome:user-1', createdAt: '', updatedAt: '' };
        return new Response(JSON.stringify({ status: 'succeeded', data }), { status: 200 });
      },
    });

    const result = await client.trigger({
      workflowVersionId,
      contact: { email: 'user@example.com', externalId: 'user-1' },
      variables: { plan: 'pro' },
      idempotencyKey: 'welcome:user-1',
    });

    expect(result.enrollment.contactId).toBe(contactId);
    expect(requests.map((request) => request.url)).toEqual([
      'https://reflow.example.test/v1/operations/contact.upsert',
      'https://reflow.example.test/v1/operations/enrollment.create',
    ]);
    expect(requests[0]?.headers.get('x-api-key')).toBe('reflow_test_key');
    expect(requests[1]?.body).toMatchObject({ workflowVersionId, contactId, idempotencyKey: 'welcome:user-1' });
  });

  it('preserves structured operation errors', async () => {
    const client = new ReflowSdk({
      url: 'https://reflow.example.test', apiKey: 'key', workspaceId,
      fetch: async () => new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Missing required scope: reflow:send' }), { status: 403 }),
    });
    await expect(client.call('enrollment.create')).rejects.toEqual(expect.objectContaining({ status: 403, code: 'FORBIDDEN' } satisfies Partial<ReflowSdkError>));
  });
});
