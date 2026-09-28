import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  heldEnrollments,
  workspaceUsageContacts,
  workspaceUsageMonths,
  workspaces,
} from '../db/schema.js';
import { ReflowError } from '../domain/errors.js';
import { currentYearMonth, decideUsageAdmission } from './usage.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type AdmissionOutcome =
  | { kind: 'admit'; asOverage: boolean; alert80: boolean; alert100: boolean; yearMonth: string; uniqueContacts: number }
  | { kind: 'held'; heldId: string; reason: 'plan_limit' | 'overage_cap' };

/**
 * Gate one enrollment against unique-contact monthly usage.
 * Caller must already hold `SELECT … FROM workspaces … FOR UPDATE`.
 * No-op path is handled by the service when billing is off.
 */
export async function admitContactUsage(
  tx: Tx,
  input: {
    workspaceId: string;
    contactId: string;
    workflowVersionId: string;
    variables: Record<string, unknown>;
    idempotencyKey: string;
    /** When draining a held row, pass its id so the same hold is not treated as already held. */
    releasingHeldId?: string;
  },
): Promise<AdmissionOutcome> {
  const yearMonth = currentYearMonth();
  const [workspace] = await tx.select({
    plan: workspaces.plan,
    overageEnabled: workspaces.overageEnabled,
    overageCapCents: workspaces.overageCapCents,
  }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
  if (!workspace) throw new ReflowError('NOT_FOUND', 'Organization not found', 404);

  const [existingHeld] = await tx.select().from(heldEnrollments).where(and(
    eq(heldEnrollments.workspaceId, input.workspaceId),
    eq(heldEnrollments.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (existingHeld && existingHeld.id !== input.releasingHeldId) {
    if (
      existingHeld.contactId !== input.contactId
      || existingHeld.sequenceVersionId !== input.workflowVersionId
      || JSON.stringify(existingHeld.input) !== JSON.stringify(input.variables)
    ) {
      throw new ReflowError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different input', 409);
    }
    return { kind: 'held', heldId: existingHeld.id, reason: existingHeld.reason };
  }
  if (existingHeld && existingHeld.id === input.releasingHeldId) {
    await tx.delete(heldEnrollments).where(eq(heldEnrollments.id, existingHeld.id));
  }

  await tx.insert(workspaceUsageMonths).values({
    workspaceId: input.workspaceId,
    yearMonth,
  }).onConflictDoNothing();

  const [month] = await tx.select().from(workspaceUsageMonths).where(and(
    eq(workspaceUsageMonths.workspaceId, input.workspaceId),
    eq(workspaceUsageMonths.yearMonth, yearMonth),
  )).limit(1);

  let alreadyCounted = false;
  const inserted = await tx.insert(workspaceUsageContacts).values({
    workspaceId: input.workspaceId,
    yearMonth,
    contactId: input.contactId,
  }).onConflictDoNothing().returning({ contactId: workspaceUsageContacts.contactId });
  if (inserted.length === 0) alreadyCounted = true;

  const decision = decideUsageAdmission({
    plan: workspace.plan,
    alreadyCountedThisMonth: alreadyCounted,
    uniqueContacts: month?.uniqueContacts ?? 0,
    overageEnabled: workspace.overageEnabled,
    overageCapCents: workspace.overageCapCents,
  });

  if (decision.action === 'hold') {
    // Roll back the usage contact insert for held new contacts so they can
    // count again when capacity opens (upgrade / overage / month reset).
    if (!alreadyCounted) {
      await tx.delete(workspaceUsageContacts).where(and(
        eq(workspaceUsageContacts.workspaceId, input.workspaceId),
        eq(workspaceUsageContacts.yearMonth, yearMonth),
        eq(workspaceUsageContacts.contactId, input.contactId),
      ));
    }
    const [held] = await tx.insert(heldEnrollments).values({
      workspaceId: input.workspaceId,
      sequenceVersionId: input.workflowVersionId,
      contactId: input.contactId,
      input: input.variables,
      idempotencyKey: input.idempotencyKey,
      reason: decision.reason,
    }).returning();
    if (!held) throw new ReflowError('INTERNAL', 'Failed to hold enrollment', 500);
    return { kind: 'held', heldId: held.id, reason: decision.reason };
  }

  if (decision.countsTowardUsage) {
    await tx.update(workspaceUsageMonths).set({
      uniqueContacts: decision.nextCount,
      overageContacts: decision.asOverage
        ? sql`${workspaceUsageMonths.overageContacts} + 1`
        : workspaceUsageMonths.overageContacts,
      updatedAt: new Date(),
    }).where(and(
      eq(workspaceUsageMonths.workspaceId, input.workspaceId),
      eq(workspaceUsageMonths.yearMonth, yearMonth),
    ));
    return {
      kind: 'admit',
      asOverage: decision.asOverage,
      alert80: decision.alert80,
      alert100: decision.alert100,
      yearMonth,
      uniqueContacts: decision.nextCount,
    };
  }

  return {
    kind: 'admit',
    asOverage: false,
    alert80: false,
    alert100: false,
    yearMonth,
    uniqueContacts: month?.uniqueContacts ?? 0,
  };
}
