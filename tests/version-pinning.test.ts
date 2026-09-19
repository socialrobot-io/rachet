import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  enrollments,
  sendIntents,
  sequences,
  sequenceVersions,
  workspaces,
} from '../apps/server/src/db/schema.js';
import type { FlowNode, WorkflowDefinition } from '../packages/contracts/src/index.js';
import { workflowDefinitionSchema } from '../packages/contracts/src/index.js';
import { configureActivities, executeAction, resetActivities } from '../apps/server/src/temporal/activities.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';
import { FakeEmailProvider } from './helpers/fake-email-provider.js';

const runtime = await probeDbRuntime();

/**
 * Proves that revising a template or publishing a new workflow version cannot
 * change what an already-running enrollment will send: template versions and
 * sequence versions are immutable, and enrollments pin one of each.
 */
describe.skipIf(!runtime)('version pinning (postgres + fake provider)', () => {
  const boot = runtime as DbRuntime;
  const provider = new FakeEmailProvider();
  const admin = adminContext('version-pinning');
  let workspaceId = '';

  beforeAll(async () => {
    const slug = `pin-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Version pin ${slug}`,
      slug,
      sendingEnabled: true,
    }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;

    configureActivities({
      ...boot.config,
      resendApiKey: 'test-key',
    }, { db: boot.db, provider });
  });

  afterAll(async () => {
    resetActivities();
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  async function publishTemplate(name: string, subject: string, html: string, body: string) {
    const created = await boot.service.templateCreate(admin, {
      workspaceId,
      name,
      subject,
      sourceKind: 'html',
      html,
      body,
    });
    const published = await boot.service.templatePublish(admin, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });
    if (!published) throw new Error('template publish failed');
    return { draft: created, version: published };
  }

  async function reviseAndPublish(
    templateId: string,
    expectedRevision: number,
    subject: string,
    html: string,
    body: string,
  ) {
    const revised = await boot.service.templateRevise(admin, {
      workspaceId,
      templateId,
      expectedRevision,
      subject,
      sourceKind: 'html',
      html,
      body,
    });
    const published = await boot.service.templatePublish(admin, {
      workspaceId,
      templateId,
      expectedRevision: revised.revision,
    });
    if (!published) throw new Error('template re-publish failed');
    return { draft: revised, version: published };
  }

  function twoStepDefinition(templateVersionId: string): WorkflowDefinition {
    return {
      schemaVersion: '1',
      description: 'Version-pinning fixture',
      trigger: { type: 'manual' },
      purpose: 'transactional',
      topic: 'test',
      entryNodeId: 'send_a',
      nodes: [
        {
          id: 'send_a',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { literal: templateVersionId } },
          next: 'wait',
          onError: 'fail',
        },
        { id: 'wait', type: 'delay', durationSeconds: 60, next: 'send_b' },
        {
          id: 'send_b',
          type: 'action',
          action: 'email.send',
          input: { templateVersionId: { literal: templateVersionId } },
          next: 'done',
          onError: 'fail',
        },
        { id: 'done', type: 'end', reason: 'completed' },
      ],
    };
  }

  function actionNode(definition: WorkflowDefinition, id: string): Extract<FlowNode, { type: 'action' }> {
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (!node || node.type !== 'action') throw new Error(`Missing action node ${id}`);
    return node;
  }

  /** Same join the dispatcher uses to load the definition for a Temporal start. */
  async function pinnedDefinition(enrollmentId: string): Promise<WorkflowDefinition> {
    const [row] = await boot.db
      .select({ definition: sequenceVersions.definition })
      .from(enrollments)
      .innerJoin(sequenceVersions, eq(sequenceVersions.id, enrollments.sequenceVersionId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1);
    if (!row) throw new Error('enrollment or sequence version missing');
    return workflowDefinitionSchema.parse(row.definition);
  }

  it('keeps an old template version byte-identical after revise + publish', async () => {
    const props = { contact: { firstName: 'Ada' } };
    const { draft, version: v1 } = await publishTemplate(
      `pin-tpl-${crypto.randomUUID().slice(0, 6)}`,
      'Subject v1',
      '<p>Body v1 {{contact.firstName}}</p>',
      'Body v1 {{contact.firstName}}',
    );

    const first = await boot.service.templateRender(admin, {
      workspaceId,
      templateVersionId: v1.id,
      props,
    });

    const { version: v2 } = await reviseAndPublish(
      draft.id,
      draft.revision,
      'Subject v2',
      '<p>Body v2 {{contact.firstName}}</p>',
      'Body v2 {{contact.firstName}}',
    );

    const again = await boot.service.templateRender(admin, {
      workspaceId,
      templateVersionId: v1.id,
      props,
    });
    expect(again).toEqual(first);
    expect(again.subject).toBe('Subject v1');
    expect(again.html).toContain('Body v1 Ada');

    const next = await boot.service.templateRender(admin, {
      workspaceId,
      templateVersionId: v2.id,
      props,
    });
    expect(next.subject).toBe('Subject v2');
    expect(next.html).toContain('Body v2 Ada');
    expect(v2.id).not.toBe(v1.id);
  });

  it('keeps a mid-flight enrollment sending the template version it pinned', async () => {
    provider.sent.length = 0;
    provider.nextOutcome = { kind: 'accepted', messageId: 'msg_pin_a' };

    const { draft, version: templateV1 } = await publishTemplate(
      `pin-mid-${crypto.randomUUID().slice(0, 6)}`,
      'Pin subject v1',
      '<p>Pin body v1</p>',
      'Pin body v1',
    );

    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `pin-mid-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'mid-flight pin',
      definition: twoStepDefinition(templateV1.id),
    });
    const workflowV1 = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
    if (!workflowV1) throw new Error('workflow publish failed');

    const contact = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `pin-mid-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: { firstName: 'Ada' },
    });
    const enrollmentId = crypto.randomUUID();
    await boot.db.insert(enrollments).values({
      id: enrollmentId,
      workspaceId,
      sequenceVersionId: workflowV1.id,
      contactId: contact.id,
      workflowId: `test/${enrollmentId}`,
      input: {},
      idempotencyKey: `pin-mid-${enrollmentId}`,
      state: 'running',
    });

    const definition = await pinnedDefinition(enrollmentId);
    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: actionNode(definition, 'send_a'),
      eventData: {},
    })).resolves.toBe('succeeded');

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.message.subject).toBe('Pin subject v1');
    expect(provider.sent[0]?.message.html).toContain('Pin body v1');

    await reviseAndPublish(
      draft.id,
      draft.revision,
      'Pin subject v2',
      '<p>Pin body v2</p>',
      'Pin body v2',
    );

    provider.nextOutcome = { kind: 'accepted', messageId: 'msg_pin_b' };
    const stillPinned = await pinnedDefinition(enrollmentId);
    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: actionNode(stillPinned, 'send_b'),
      eventData: {},
    })).resolves.toBe('succeeded');

    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[1]?.message.subject).toBe('Pin subject v1');
    expect(provider.sent[1]?.message.html).toContain('Pin body v1');
    expect(provider.sent[1]?.message.html).not.toContain('Pin body v2');

    const intents = await boot.db.select().from(sendIntents).where(eq(sendIntents.enrollmentId, enrollmentId));
    expect(intents).toHaveLength(2);
    for (const intent of intents) {
      expect(intent.subject).toBe('Pin subject v1');
      expect(intent.html).toContain('Pin body v1');
    }
  });

  it('leaves existing enrollments on workflow v1 after publishing workflow v2', async () => {
    const { version: templateV1 } = await publishTemplate(
      `pin-wf-a-${crypto.randomUUID().slice(0, 6)}`,
      'Workflow pin v1',
      '<p>Workflow pin v1</p>',
      'Workflow pin v1',
    );
    const { version: templateV2 } = await publishTemplate(
      `pin-wf-b-${crypto.randomUUID().slice(0, 6)}`,
      'Workflow pin v2',
      '<p>Workflow pin v2</p>',
      'Workflow pin v2',
    );

    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `pin-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'workflow pin',
      definition: twoStepDefinition(templateV1.id),
    });
    const workflowV1 = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
    if (!workflowV1) throw new Error('workflow v1 publish failed');

    const contact = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `pin-wf-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: { firstName: 'Ada' },
    });
    const existing = await boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: workflowV1.id,
      contactId: contact.id,
      variables: {},
      idempotencyKey: `pin-wf-existing-${crypto.randomUUID()}`,
    });
    if (!existing) throw new Error('enrollment create failed');

    // No workflow.revise yet: update the draft definition in place, then publish v2.
    const nextDefinition = {
      ...twoStepDefinition(templateV2.id),
      intent: 'workflow pin',
    };
    await boot.db.update(sequences).set({
      definition: nextDefinition,
      updatedAt: new Date(),
    }).where(eq(sequences.id, workflow.id));

    const [draft] = await boot.db.select().from(sequences).where(eq(sequences.id, workflow.id)).limit(1);
    if (!draft) throw new Error('draft missing');
    const workflowV2 = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: draft.revision,
    });
    if (!workflowV2) throw new Error('workflow v2 publish failed');
    expect(workflowV2.id).not.toBe(workflowV1.id);
    expect(workflowV2.version).toBe(2);

    const [row] = await boot.db.select().from(enrollments).where(eq(enrollments.id, existing.id)).limit(1);
    expect(row?.sequenceVersionId).toBe(workflowV1.id);

    const stillV1 = await pinnedDefinition(existing.id);
    const sendA = actionNode(stillV1, 'send_a');
    expect(sendA.input.templateVersionId).toEqual({ literal: templateV1.id });

    const other = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `pin-wf-new-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: { firstName: 'Bea' },
    });
    const fresh = await boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: workflowV2.id,
      contactId: other.id,
      variables: {},
      idempotencyKey: `pin-wf-new-${crypto.randomUUID()}`,
    });
    if (!fresh) throw new Error('new enrollment create failed');
    expect(fresh.sequenceVersionId).toBe(workflowV2.id);

    const nowV2 = await pinnedDefinition(fresh.id);
    expect(actionNode(nowV2, 'send_a').input.templateVersionId).toEqual({ literal: templateV2.id });
  });
});
