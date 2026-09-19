import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApplicationFailure } from '@temporalio/activity';
import {
  contacts,
  enrollments,
  sendIntents,
  suppressions,
  workspaces,
} from '../apps/server/src/db/schema.js';
import type { WorkflowDefinition } from '../packages/contracts/src/index.js';
import { configureActivities, executeAction, resetActivities } from '../apps/server/src/temporal/activities.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';
import { FakeEmailProvider } from './helpers/fake-email-provider.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('email.send activity invariants (postgres + fake provider)', () => {
  const boot = runtime as DbRuntime;
  const provider = new FakeEmailProvider();
  const admin = adminContext('activities');
  let workspaceId = '';
  let contactId = '';
  let enrollmentId = '';
  let templateVersionId = '';

  beforeAll(async () => {
    const slug = `act-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Activities ${slug}`,
      slug,
      sendingEnabled: true,
    }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;

    const created = await boot.service.templateCreate(admin, {
      workspaceId,
      name: `act-tpl-${crypto.randomUUID().slice(0, 6)}`,
      subject: 'Hello {{contact.firstName}}',
      sourceKind: 'html',
      html: '<p>Hello {{contact.firstName}}</p>',
      body: 'Hello {{contact.firstName}}',
    });
    const published = await boot.service.templatePublish(admin, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });
    if (!published) throw new Error('template publish failed');
    templateVersionId = published.id;

    const definition: WorkflowDefinition = {
      schemaVersion: '1',
      description: 'Activity fixture',
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
    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `act-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'activity fixture',
      definition,
    });
    const version = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
    if (!version) throw new Error('workflow publish failed');

    const contact = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `act-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: { firstName: 'Ada' },
    });
    contactId = contact.id;

    enrollmentId = crypto.randomUUID();
    await boot.db.insert(enrollments).values({
      id: enrollmentId,
      workspaceId,
      sequenceVersionId: version.id,
      contactId,
      workflowId: `test/${enrollmentId}`,
      input: { productUrl: 'https://example.com' },
      idempotencyKey: `act-${enrollmentId}`,
      state: 'running',
    });

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

  function sendNode(stepId: string) {
    return {
      id: stepId,
      type: 'action' as const,
      action: 'email.send' as const,
      input: { templateVersionId: { literal: templateVersionId } },
      next: 'done',
      onError: 'fail' as const,
    };
  }

  it('freezes send payload and is idempotent on retry', async () => {
    provider.sent.length = 0;
    provider.nextOutcome = { kind: 'accepted', messageId: 'msg_1' };

    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: sendNode('welcome'),
      eventData: {},
    })).resolves.toBe('succeeded');

    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: sendNode('welcome'),
      eventData: {},
    })).resolves.toBe('succeeded');

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.message.subject).toBe('Hello Ada');
    expect(provider.sent[0]?.message.html).toContain('Hello Ada');
    expect(provider.sent[0]?.idempotencyKey).toBe(`enrollment/${enrollmentId}/welcome`);

    const intents = await boot.db.select().from(sendIntents).where(eq(sendIntents.enrollmentId, enrollmentId));
    expect(intents.filter((row) => row.stepId === 'welcome')).toHaveLength(1);
    expect(intents.find((row) => row.stepId === 'welcome')?.state).toBe('accepted');
  });

  it('rejects retries when the frozen payload would change', async () => {
    provider.sent.length = 0;
    provider.nextOutcome = { kind: 'accepted', messageId: 'msg_2' };

    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: sendNode('reminder'),
      eventData: {},
    })).resolves.toBe('succeeded');

    await boot.db.update(contacts).set({
      fields: { firstName: 'Changed' },
      updatedAt: new Date(),
    }).where(eq(contacts.id, contactId));

    await expect(executeAction({
      workspaceId,
      enrollmentId,
      node: sendNode('reminder'),
      eventData: {},
    })).rejects.toBeInstanceOf(ApplicationFailure);

    expect(provider.sent).toHaveLength(1);
  });

  it('rejects suppressed recipients without calling the provider', async () => {
    provider.sent.length = 0;
    const [contact] = await boot.db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) throw new Error('contact missing');
    await boot.db.insert(suppressions).values({
      workspaceId,
      emailKey: contact.emailKey,
      reason: 'test',
      source: 'vitest',
      active: true,
    }).onConflictDoNothing();

    const [version] = await boot.db.select({ id: enrollments.sequenceVersionId })
      .from(enrollments).where(eq(enrollments.id, enrollmentId)).limit(1);
    if (!version) throw new Error('enrollment missing');

    const suppressedEnrollmentId = crypto.randomUUID();
    await boot.db.insert(enrollments).values({
      id: suppressedEnrollmentId,
      workspaceId,
      sequenceVersionId: version.id,
      contactId,
      workflowId: `test/${suppressedEnrollmentId}`,
      input: {},
      idempotencyKey: `sup-${suppressedEnrollmentId}`,
      state: 'running',
    });

    await expect(executeAction({
      workspaceId,
      enrollmentId: suppressedEnrollmentId,
      node: sendNode('welcome'),
      eventData: {},
    })).rejects.toMatchObject({ type: 'SuppressedError' });

    expect(provider.sent).toHaveLength(0);
  });
});
