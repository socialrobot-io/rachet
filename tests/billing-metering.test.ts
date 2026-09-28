import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Client } from '@temporalio/client';
import type { ReflowAuth } from '../apps/server/src/auth.js';
import {
  contacts, heldEnrollments, sequences, sequenceVersions, workspaceUsageMonths, workspaces,
} from '../apps/server/src/db/schema.js';
import { ReflowService } from '../apps/server/src/domain/service.js';
import { currentYearMonth } from '../apps/server/src/billing/usage.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('billing unique-contact metering (postgres)', () => {
  const boot = runtime as DbRuntime;
  let workspaceId = '';
  let workflowVersionId = '';
  const admin = adminContext('billing-meter');
  let billingService: ReflowService;

  beforeAll(async () => {
    const slug = `meter-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({
      name: `Meter ${slug}`,
      slug,
      sendingEnabled: true,
      plan: 'free',
    }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;

    const [sequence] = await boot.db.insert(sequences).values({
      workspaceId,
      name: `meter-wf-${slug}`,
      state: 'published',
      definition: {
        schemaVersion: '1',
        description: 'Meter test',
        trigger: { type: 'manual' },
        purpose: 'transactional',
        topic: 'test',
        entryNodeId: 'done',
        nodes: [{ id: 'done', type: 'end', reason: 'completed' }],
      },
    }).returning();
    if (!sequence) throw new Error('sequence create failed');
    const [version] = await boot.db.insert(sequenceVersions).values({
      workspaceId,
      sequenceId: sequence.id,
      version: 1,
      contentHash: 'meter-test',
      definition: sequence.definition,
    }).returning();
    if (!version) throw new Error('version create failed');
    workflowVersionId = version.id;

    await boot.db.insert(workspaceUsageMonths).values({
      workspaceId,
      yearMonth: currentYearMonth(),
      uniqueContacts: 500,
    }).onConflictDoNothing();

    const temporal = { workflow: { getHandle: () => ({ signal: async () => undefined }) } } as unknown as Client;
    billingService = new ReflowService(boot.db, temporal, {} as ReflowAuth, { billingEnabled: true });
  });

  afterAll(async () => {
    if (workspaceId) await boot.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await boot.close();
  });

  it('holds a new Free contact once the monthly unique-contact limit is reached', async () => {
    const [contact] = await boot.db.insert(contacts).values({
      workspaceId,
      email: `held-${crypto.randomUUID().slice(0, 8)}@example.com`,
      emailKey: `held-${crypto.randomUUID()}`,
    }).returning();
    if (!contact) throw new Error('contact create failed');

    await expect(billingService.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId,
      contactId: contact.id,
      variables: {},
      idempotencyKey: `hold-${crypto.randomUUID()}`,
    })).rejects.toMatchObject({ code: 'ENROLLMENT_HELD' });

    const held = await boot.db.select().from(heldEnrollments).where(eq(heldEnrollments.workspaceId, workspaceId));
    expect(held.length).toBeGreaterThan(0);
  });

  it('skips metering when billing is off', async () => {
    const [contact] = await boot.db.insert(contacts).values({
      workspaceId,
      email: `off-${crypto.randomUUID().slice(0, 8)}@example.com`,
      emailKey: `off-${crypto.randomUUID()}`,
    }).returning();
    if (!contact) throw new Error('contact create failed');
    await expect(boot.service.enrollmentCreate(admin, {
      workspaceId,
      workflowVersionId,
      contactId: contact.id,
      variables: {},
      idempotencyKey: `off-${crypto.randomUUID()}`,
    })).resolves.toMatchObject({ contactId: contact.id });
  });
});
