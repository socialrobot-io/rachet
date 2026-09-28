import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import type { ReflowAuth } from '../apps/server/src/auth.js';
import { workspaces } from '../apps/server/src/db/schema.js';
import { ReflowService } from '../apps/server/src/domain/service.js';
import type { WorkflowDefinition } from '../packages/contracts/src/index.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('billing plan limits (postgres)', () => {
  const boot = runtime as DbRuntime;
  let workspaceId = '';
  const admin = adminContext('billing-limits');
  let billingService: ReflowService;

  beforeAll(async () => {
    const slug = `bill-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Billing ${slug}`,
      slug,
      sendingEnabled: true,
      plan: 'free',
    }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;
    const temporal = { workflow: { getHandle: () => ({ signal: async () => undefined }) } } as unknown as Client;
    billingService = new ReflowService(boot.db, temporal, {} as ReflowAuth, { billingEnabled: true });
  });

  afterAll(async () => {
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  async function publishJourney(suffix: string) {
    const created = await billingService.templateCreate(admin, {
      workspaceId,
      name: `bill-tpl-${suffix}`,
      subject: 'Hi',
      sourceKind: 'html',
      html: '<p>Hi</p>',
      body: 'Hi',
    });
    const published = await billingService.templatePublish(admin, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });
    if (!published) throw new Error('template publish failed');
    const definition: WorkflowDefinition = {
      schemaVersion: '1',
      description: 'Billing limit workflow',
      trigger: { type: 'manual' },
      purpose: 'transactional',
      topic: 'test',
      entryNodeId: 'send',
      nodes: [
        {
          id: 'send',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { literal: published.id } },
          next: 'done',
          onError: 'fail',
        },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
    const workflow = await billingService.workflowCreate(admin, {
      workspaceId,
      name: `bill-wf-${suffix}`,
      intent: 'limit check',
      definition,
    });
    return billingService.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
  }

  it('allows three Free live journeys and blocks the fourth when billing is on', async () => {
    await expect(publishJourney('1')).resolves.toBeTruthy();
    await expect(publishJourney('2')).resolves.toBeTruthy();
    await expect(publishJourney('3')).resolves.toBeTruthy();
    await expect(publishJourney('4')).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
  });

  it('does not enforce journey limits when billing is off', async () => {
    await expect(boot.service.workflowCreate(admin, {
      workspaceId,
      name: `off-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'unlimited when off',
      definition: {
        schemaVersion: '1',
        description: 'Unlimited when billing off',
        trigger: { type: 'manual' },
        purpose: 'transactional',
        topic: 'test',
        entryNodeId: 'done',
        nodes: [{ id: 'done', type: 'end', reason: 'completed' }],
      },
    }).then(async (workflow) => boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    }))).resolves.toBeTruthy();
  });
});
