import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { contacts, deliveryBlocks, enrollments, marketingConsents, marketingOptOuts, outbox, sequenceVersions, subscriptionEvents, suppressions, type UnsubscribeOrigin } from '../db/schema.js';
import { RachetError, isUniqueViolation } from './errors.js';

export const emailKey = (email: string) => email.trim().toLowerCase();

export const mailboxAddress = (from: string) => emailKey(from.match(/<([^<>]+)>\s*$/)?.[1] ?? from);

// A transaction-scoped address lock works even before a preference row exists.
// Hash collisions only serialize extra addresses; they cannot mix their data.
export async function lockEmailAddress(db: Database, workspaceId: string, address: string) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId + ':' + address}, 0))`);
}

export async function emailEligibility(db: Database, workspaceId: string, address: string, purpose: 'marketing' | 'transactional') {
  const durable = await db.select({ reason: deliveryBlocks.reason, source: deliveryBlocks.source, at: deliveryBlocks.createdAt }).from(deliveryBlocks).where(and(eq(deliveryBlocks.workspaceId, workspaceId), eq(deliveryBlocks.emailKey, address)));
  if (durable.length > 0) return { eligible: false as const, reason: 'delivery_block' as const, blocks: durable };
  const [block] = await db.select({ reason: suppressions.reason, source: suppressions.source, at: suppressions.updatedAt }).from(suppressions).where(and(eq(suppressions.workspaceId, workspaceId), eq(suppressions.emailKey, address), eq(suppressions.active, true))).limit(1);
  if (block) return { eligible: false as const, reason: 'delivery_block' as const, blocks: [block] };
  if (purpose === 'transactional') return { eligible: true as const };
  const [optOut, consent] = await Promise.all([
    db.select({ source: marketingOptOuts.source, updatedAt: marketingOptOuts.updatedAt }).from(marketingOptOuts).where(and(eq(marketingOptOuts.workspaceId, workspaceId), eq(marketingOptOuts.emailKey, address))).limit(1),
    db.select({ source: marketingConsents.source, consentReference: marketingConsents.consentReference, updatedAt: marketingConsents.updatedAt }).from(marketingConsents).where(and(eq(marketingConsents.workspaceId, workspaceId), eq(marketingConsents.emailKey, address))).limit(1),
  ]);
  if (optOut[0]) return { eligible: false as const, reason: 'unsubscribed' as const, source: optOut[0].source, at: optOut[0].updatedAt };
  if (!consent[0]) return { eligible: false as const, reason: 'consent_required' as const };
  return { eligible: true as const, consent: consent[0] };
}

type PreferenceChange = {
  workspaceId: string; address: string; eventId: string; source: string; actorId?: string | undefined;
  action: 'unsubscribe' | 'consent'; consentReference?: string | undefined;
  origin?: UnsubscribeOrigin | null;
};

export async function recordPreference(tx: Database, input: PreferenceChange) {
  const address = emailKey(input.address);
  await lockEmailAddress(tx, input.workspaceId, address);
  const [previousEvent] = await tx.select().from(subscriptionEvents).where(and(eq(subscriptionEvents.workspaceId, input.workspaceId), eq(subscriptionEvents.eventId, input.eventId))).limit(1);
  if (previousEvent) {
    if (previousEvent.emailKey !== address || previousEvent.action !== input.action || previousEvent.source !== input.source || previousEvent.consentReference !== (input.consentReference ?? null) || !isDeepStrictEqual(previousEvent.origin, input.origin ?? null)) throw new RachetError('IDEMPOTENCY_CONFLICT', 'Event ID was used for another preference change', 409);
    return { changed: false, eventId: input.eventId };
  }
  const [existingOptOut] = await tx.select({ eventId: marketingOptOuts.eventId }).from(marketingOptOuts).where(and(eq(marketingOptOuts.workspaceId, input.workspaceId), eq(marketingOptOuts.emailKey, address))).limit(1);
  const consentReference = input.consentReference;
  if (input.action === 'consent' && !consentReference) throw new RachetError('VALIDATION_FAILED', 'New consent evidence is required', 422);
  await tx.insert(subscriptionEvents).values({ workspaceId: input.workspaceId, emailKey: address, eventId: input.eventId, action: input.action, source: input.source, actorId: input.actorId, consentReference: input.consentReference, origin: input.origin });
  if (input.action === 'consent') {
    await tx.insert(marketingConsents).values({ workspaceId: input.workspaceId, emailKey: address, consentReference: consentReference ?? '', source: input.source }).onConflictDoUpdate({
      target: [marketingConsents.workspaceId, marketingConsents.emailKey],
      set: { consentReference: consentReference ?? '', source: input.source, updatedAt: new Date() },
    });
    await tx.delete(marketingOptOuts).where(and(eq(marketingOptOuts.workspaceId, input.workspaceId), eq(marketingOptOuts.emailKey, address)));
  } else {
    if (!existingOptOut) await tx.insert(marketingOptOuts).values({ workspaceId: input.workspaceId, emailKey: address, eventId: input.eventId, source: input.source });
    const active = await tx.select({ id: enrollments.id, definition: sequenceVersions.definition }).from(enrollments)
      .innerJoin(contacts, eq(contacts.id, enrollments.contactId))
      .innerJoin(sequenceVersions, eq(sequenceVersions.id, enrollments.sequenceVersionId))
      .where(and(eq(enrollments.workspaceId, input.workspaceId), eq(contacts.emailKey, address), inArray(enrollments.state, ['pending_start', 'running', 'waiting', 'paused', 'needs_attention'])));
    for (const row of active) {
      if (row.definition.purpose !== 'marketing') continue;
      await tx.update(enrollments).set({ state: 'suppressed', updatedAt: new Date() }).where(eq(enrollments.id, row.id));
      await tx.insert(outbox).values({ kind: 'enrollment.unsubscribe', aggregateId: row.id, payload: { enrollmentId: row.id } }).onConflictDoNothing();
    }
  }
  return { changed: input.action === 'consent' || !existingOptOut, eventId: input.eventId };
}

export async function changePreference(db: Database, input: PreferenceChange) {
  try { return await db.transaction(async (tx) => recordPreference(tx as unknown as Database, input)); } catch (error) {
    if (isUniqueViolation(error)) throw new RachetError('IDEMPOTENCY_CONFLICT', 'Event ID was used for another preference change', 409);
    throw error;
  }
}
