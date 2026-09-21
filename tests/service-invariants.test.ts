import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, contacts, enrollmentEvents, enrollments, outbox, workspaces } from '../apps/server/src/db/schema.js';
import type { WorkflowDefinition } from '../packages/contracts/src/index.js';
import { ReflowError } from '../apps/server/src/domain/errors.js';
import { adminContext, probeDbRuntime, roleContext, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('service invariants (postgres)', () => {
  const boot = runtime as DbRuntime;
  let workspaceId = '';
  const admin = adminContext('invariants');

  beforeAll(async () => {
    const slug = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Invariants ${slug}`,
      slug,
      sendingEnabled: true,
    }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  async function publishHtmlTemplate(name: string) {
    const created = await boot.service.templateCreate(admin, {
      workspaceId,
      name,
      subject: 'Hi {{contact.firstName}}',
      sourceKind: 'html',
      html: '<p>Hi {{contact.firstName}}</p>',
      body: 'Hi {{contact.firstName}}',
    });
    const published = await boot.service.templatePublish(admin, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision,
    });
    if (!published) throw new Error('publish failed');
    return { created, published };
  }

  function definitionPinning(templateVersionId: string): WorkflowDefinition {
    return {
      schemaVersion: '1',
      description: 'Invariant workflow',
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
  }

  it('enforces role permissions for author vs sender vs viewer', async () => {
    const author = roleContext(workspaceId, 'author');
    const sender = roleContext(workspaceId, 'sender');
    const viewer = roleContext(workspaceId, 'viewer');

    await expect(boot.service.templateCreate(viewer, {
      workspaceId,
      name: `denied-${crypto.randomUUID().slice(0, 6)}`,
      subject: 'x',
      body: 'x',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(boot.service.contactUpsert(author, {
      workspaceId,
      email: 'author-cannot-send@example.com',
      fields: {},
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const contact = await boot.service.contactUpsert(sender, {
      workspaceId,
      email: 'sender-ok@example.com',
      fields: { firstName: 'Sam' },
    });
    expect(contact.emailKey).toBe('sender-ok@example.com');

    await expect(boot.service.enrollmentControl(viewer, {
      workspaceId,
      enrollmentId: crypto.randomUUID(),
    }, 'pause')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies cross-organization reads and writes before accessing tenant rows', async () => {
    const [foreignWorkspace] = await boot.db.insert(workspaces).values({
      name: 'Foreign access test', slug: `access-${crypto.randomUUID().slice(0, 8)}`,
    }).returning();
    if (!foreignWorkspace) throw new Error('workspace create failed');
    try {
      const member = roleContext(workspaceId, 'owner');
      await expect(boot.service.contactList(member, foreignWorkspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.templateList(member, foreignWorkspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.workflowList(member, foreignWorkspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.enrollmentList(member, foreignWorkspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.messageList(member, foreignWorkspace.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.webhookEventList(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(boot.service.contactUpsert(member, { workspaceId: foreignWorkspace.id, email: 'cross@example.com', fields: {} }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await boot.db.delete(workspaces).where(eq(workspaces.id, foreignWorkspace.id));
    }
  });

  it('upserts contacts by emailKey and preserves identity across case', async () => {
    const first = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: 'Ada@Example.com',
      fields: { firstName: 'Ada' },
    });
    const second = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: 'ada@example.com',
      fields: { firstName: 'Augusta', plan: 'pro' },
    });
    expect(second.id).toBe(first.id);
    expect(second.emailKey).toBe('ada@example.com');
    expect(second.fields).toMatchObject({ firstName: 'Augusta', plan: 'pro' });

    const rows = await boot.db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId));
    expect(rows.filter((row) => row.emailKey === 'ada@example.com')).toHaveLength(1);
  });

  it('rejects stale template and workflow revisions', async () => {
    const { created } = await publishHtmlTemplate(`rev-${crypto.randomUUID().slice(0, 6)}`);
    await expect(boot.service.templatePublish(admin, {
      workspaceId,
      templateId: created.id,
      expectedRevision: created.revision + 1,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });

    const { published } = await publishHtmlTemplate(`wf-rev-${crypto.randomUUID().slice(0, 6)}`);
    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `rev-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'revision check',
      definition: definitionPinning(published.id),
    });
    await expect(boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision + 5,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('keeps enrollment create idempotent and conflicts on mismatched replay', async () => {
    const { published } = await publishHtmlTemplate(`enr-${crypto.randomUUID().slice(0, 6)}`);
    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `enr-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'enrollment',
      definition: definitionPinning(published.id),
    });
    const version = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
    if (!version) throw new Error('workflow publish failed');

    const contact = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `enroll-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: { firstName: 'Eli' },
    });
    const other = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `enroll-other-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: {},
    });

    const key = `idem-${crypto.randomUUID()}`;
    const first = await boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: version.id,
      contactId: contact.id,
      variables: { plan: 'pro' },
      idempotencyKey: key,
    });
    expect(first?.id).toBeTruthy();
    const enrollmentId = first?.id ?? '';
    const replay = await boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: version.id,
      contactId: contact.id,
      variables: { plan: 'pro' },
      idempotencyKey: key,
    });
    expect(replay?.id).toBe(enrollmentId);

    const outboxRows = await boot.db.select().from(outbox).where(eq(outbox.aggregateId, enrollmentId));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.kind).toBe('enrollment.start');

    await expect(boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: version.id,
      contactId: other.id,
      variables: { plan: 'pro' },
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    await expect(boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: version.id,
      contactId: contact.id,
      variables: { plan: 'free' },
      idempotencyKey: key,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const enrollmentRows = await boot.db.select().from(enrollments).where(eq(enrollments.workspaceId, workspaceId));
    expect(enrollmentRows.filter((row) => row.idempotencyKey === key)).toHaveLength(1);
  });

  it('rejects a contact from another organization at both service and database boundaries', async () => {
    const [foreignWorkspace] = await boot.db.insert(workspaces).values({
      name: 'Foreign organization', slug: `foreign-${crypto.randomUUID().slice(0, 8)}`,
    }).returning();
    if (!foreignWorkspace) throw new Error('workspace create failed');
    try {
      const foreignContact = await boot.service.contactUpsert(admin, {
        workspaceId: foreignWorkspace.id,
        email: `foreign-${crypto.randomUUID().slice(0, 6)}@example.com`,
        fields: {},
      });
      const { published } = await publishHtmlTemplate(`tenant-${crypto.randomUUID().slice(0, 6)}`);
      const workflow = await boot.service.workflowCreate(admin, {
        workspaceId,
        name: `tenant-wf-${crypto.randomUUID().slice(0, 6)}`,
        intent: 'tenant isolation test',
        definition: definitionPinning(published.id),
      });
      const version = await boot.service.workflowPublish(admin, {
        workspaceId, workflowId: workflow.id, expectedRevision: workflow.revision,
      });
      if (!version) throw new Error('workflow publish failed');
      await expect(boot.service.enrollmentCreate(admin, {
        workspaceId, workflowVersionId: version.id, contactId: foreignContact.id,
        variables: {}, idempotencyKey: `cross-${crypto.randomUUID()}`,
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const id = crypto.randomUUID();
      await expect(boot.db.insert(enrollments).values({
        id, workspaceId, sequenceVersionId: version.id, contactId: foreignContact.id,
        workflowId: `test/${id}`, idempotencyKey: `cross-db-${id}`,
      })).rejects.toMatchObject({ cause: { code: '23503' } });
    } finally {
      await boot.db.delete(workspaces).where(eq(workspaces.id, foreignWorkspace.id));
    }
  });

  it('accepts each enrollment event identity once and rejects conflicting reuse', async () => {
    const { published } = await publishHtmlTemplate(`event-${crypto.randomUUID().slice(0, 6)}`);
    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `event-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'event idempotency',
      definition: definitionPinning(published.id),
    });
    const version = await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });
    if (!version) throw new Error('workflow publish failed');
    const contact = await boot.service.contactUpsert(admin, {
      workspaceId,
      email: `event-${crypto.randomUUID().slice(0, 6)}@example.com`,
      fields: {},
    });
    const enrollment = await boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId: version.id,
      contactId: contact.id,
      variables: {},
      idempotencyKey: `event-enrollment-${crypto.randomUUID()}`,
    });
    if (!enrollment) throw new Error('enrollment create failed');

    const eventId = `social_post_created:${crypto.randomUUID()}`;
    const input = {
      workspaceId,
      enrollmentId: enrollment.id,
      eventId,
      eventType: 'social_post_created',
      data: { plan: 'pro', nested: { enabled: true } },
    };
    await expect(boot.service.eventEmit(admin, input)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      delivery: 'delivered',
    });
    await expect(boot.service.eventEmit(admin, {
      ...input,
      data: { nested: { enabled: true }, plan: 'pro' },
    })).resolves.toMatchObject({
      accepted: false,
      duplicate: true,
      delivery: 'delivered',
    });
    await expect(boot.service.eventEmit(admin, { ...input, data: { plan: 'enterprise' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const receipts = await boot.db.select().from(enrollmentEvents).where(eq(enrollmentEvents.enrollmentId, enrollment.id));
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error('event receipt missing');
    expect(receipt.deliveredAt).not.toBeNull();
    const jobs = await boot.db.select().from(outbox).where(eq(outbox.aggregateId, receipt.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.completedAt).not.toBeNull();
    const audits = await boot.db.select().from(auditEvents).where(eq(auditEvents.targetId, enrollment.id));
    expect(audits.filter((event) => event.action === 'event.emit')).toHaveLength(1);
  });

  it('allows archive only after workflows stop pinning the template version', async () => {
    const { created, published } = await publishHtmlTemplate(`arch-${crypto.randomUUID().slice(0, 6)}`);
    const workflow = await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `arch-wf-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'archive lifecycle',
      definition: definitionPinning(published.id),
    });
    await boot.service.workflowPublish(admin, {
      workspaceId,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
    });

    await expect(boot.service.templateArchive(admin, { workspaceId, templateId: created.id }))
      .rejects.toBeInstanceOf(ReflowError);

    // Replace draft pin with a different published template, publish a new version, then archive becomes possible
    // only if no published version still pins it. Published v1 still pins, so archive must remain blocked.
    const other = await publishHtmlTemplate(`arch-other-${crypto.randomUUID().slice(0, 6)}`);
    // Direct draft rewrite is not exposed; create a sibling workflow without the pin and confirm the original stays blocked.
    await boot.service.workflowCreate(admin, {
      workspaceId,
      name: `arch-wf2-${crypto.randomUUID().slice(0, 6)}`,
      intent: 'unrelated',
      definition: definitionPinning(other.published.id),
    });
    await expect(boot.service.templateArchive(admin, { workspaceId, templateId: created.id }))
      .rejects.toMatchObject({ code: 'TEMPLATE_IN_USE' });
  });
});
