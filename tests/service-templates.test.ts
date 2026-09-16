import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import type { ReflowAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/index.js';
import { workspaces } from '../src/db/schema.js';
import type { OperationContext, WorkflowDefinition } from '../src/domain/contracts.js';
import { ReflowService } from '../src/domain/service.js';

type Runtime = {
  service: ReflowService;
  db: Database;
  close: () => Promise<void>;
};

async function probeDatabase(): Promise<Runtime | null> {
  try {
    const config = loadConfig(process.env);
    const database = createDatabase(config);
    await database.pool.query('select 1');
    const temporal = { workflow: { getHandle: () => ({ signal: async () => undefined }) } } as unknown as Client;
    const auth = {} as ReflowAuth;
    return {
      service: new ReflowService(database.db, temporal, auth),
      db: database.db,
      close: async () => { await database.pool.end(); },
    };
  } catch {
    return null;
  }
}

const runtime = await probeDatabase();

describe.skipIf(!runtime)('ReflowService template + workflow validation (postgres)', () => {
  // Runtime is non-null when the suite is not skipped.
  const boot = runtime as Runtime;
  let workspaceId = '';
  const context: OperationContext = {
    requestId: 'vitest-service',
    principal: {
      userId: 'vitest-admin',
      workspaceIds: [],
      workspaceRoles: {},
      deploymentAdmin: true,
      scopes: ['reflow:read', 'reflow:write', 'reflow:send'],
    },
  };

  beforeAll(async () => {
    const slug = `vitest-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Vitest ${slug}`,
      slug,
      sendingEnabled: true,
    }).returning();
    if (!workspace) throw new Error('Failed to create workspace');
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  it('publishes html templates and renders them with props', async () => {
    const created = await boot.service.templateCreate(context, {
      workspaceId,
      name: `Welcome ${crypto.randomUUID().slice(0, 8)}`,
      subject: 'Hi {{contact.firstName}}',
      preheader: 'Ready',
      sourceKind: 'html',
      html: '<p>Hello {{contact.firstName}}</p>',
      body: 'Hello {{contact.firstName}}',
    });
    expect(created.sourceKind).toBe('html');
    expect(created.html).toContain('{{contact.firstName}}');

    const published = await boot.service.templatePublish(context, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });
    expect(published?.id).toBeTruthy();
    const templateVersionId = published?.id ?? '';

    const rendered = await boot.service.templateRender(context, {
      workspaceId,
      templateVersionId,
      props: { contact: { firstName: 'Ada' } },
    });
    expect(rendered.subject).toBe('Hi Ada');
    expect(rendered.html).toContain('Hello Ada');
    expect(rendered.plainText).toContain('Hello Ada');
  });

  it('does not republish an archived template', async () => {
    const created = await boot.service.templateCreate(context, {
      workspaceId,
      name: `Archived ${crypto.randomUUID().slice(0, 8)}`,
      subject: 'Archived',
      sourceKind: 'html',
      html: '<p>Archived</p>',
      body: 'Archived',
    });
    await boot.service.templateArchive(context, { workspaceId, templateId: created.id });
    await expect(boot.service.templatePublish(context, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 409 });
  });

  it('fails workflow.validate when email.send pins a missing template version', async () => {
    const definition: WorkflowDefinition = {
      schemaVersion: '1',
      description: 'Missing template',
      trigger: { type: 'manual' },
      purpose: 'transactional',
      topic: 'test',
      entryNodeId: 'send',
      nodes: [
        {
          id: 'send',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { literal: '00000000-0000-4000-8000-000000000099' } },
          next: 'done',
          onError: 'fail',
        },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };

    await expect(boot.service.workflowValidate(context, { workspaceId, definition }))
      .rejects.toMatchObject({ code: 'TEMPLATE_REFERENCE_INVALID' });
  });

  it('blocks archive while a published workflow still pins the template', async () => {
    const created = await boot.service.templateCreate(context, {
      workspaceId,
      name: `Pinned ${crypto.randomUUID().slice(0, 8)}`,
      subject: 'Pinned',
      sourceKind: 'html',
      html: '<p>Pinned</p>',
      body: 'Pinned',
    });
    const published = await boot.service.templatePublish(context, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });

    expect(published?.id).toBeTruthy();
    const templateVersionId = published?.id ?? '';

    const definition: WorkflowDefinition = {
      schemaVersion: '1',
      description: 'Pins template',
      trigger: { type: 'manual' },
      purpose: 'transactional',
      topic: 'test',
      entryNodeId: 'send',
      nodes: [
        {
          id: 'send',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { literal: templateVersionId } },
          next: 'done',
          onError: 'fail',
        },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };

    const workflow = await boot.service.workflowCreate(context, {
      workspaceId,
      name: `WF ${crypto.randomUUID().slice(0, 8)}`,
      intent: 'test pin',
      definition,
    });
    await boot.service.workflowPublish(context, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });

    await expect(boot.service.templateArchive(context, { workspaceId, templateId: created.id }))
      .rejects.toMatchObject({ code: 'TEMPLATE_IN_USE' });
  });
});
