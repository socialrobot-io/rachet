import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import {
  auditEvents,
  enrollmentEvents,
  enrollments,
  heldEnrollments,
  outbox,
  sendIntents,
  workspaces,
} from '../db/schema.js';
import { planLimits } from './plans.js';
import { admitContactUsage } from './admit.js';
import { reportOverageContact } from './overage.js';
import { sendUsageAlert } from './alerts.js';
import { currentYearMonth } from './usage.js';

const FINISHED = ['completed', 'cancelled', 'suppressed', 'failed'] as const;

export async function drainHeldEnrollments(
  db: Database,
  config: Pick<Config, 'billingEnabled' | 'stripeSecretKey' | 'stripeMeterEventName' | 'authResendApiKey' | 'authFrom' | 'publicUrl'>,
  workspaceId: string,
  limit = 50,
): Promise<{ released: number; stillHeld: number }> {
  if (!config.billingEnabled) return { released: 0, stillHeld: 0 };

  let released = 0;
  const held = await db.select().from(heldEnrollments)
    .where(eq(heldEnrollments.workspaceId, workspaceId))
    .orderBy(asc(heldEnrollments.createdAt))
    .limit(limit);

  for (const row of held) {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
      const [locked] = await tx.select().from(heldEnrollments).where(eq(heldEnrollments.id, row.id)).limit(1);
      if (!locked) return null;

      const admission = await admitContactUsage(tx, {
        workspaceId,
        contactId: locked.contactId,
        workflowVersionId: locked.sequenceVersionId,
        variables: locked.input,
        idempotencyKey: locked.idempotencyKey,
        releasingHeldId: locked.id,
      });
      if (admission.kind === 'held') return { kind: 'still_held' as const };

      const enrollmentId = crypto.randomUUID();
      const workflowId = `workspace/${workspaceId}/enrollment/${enrollmentId}`;
      await tx.insert(enrollments).values({
        id: enrollmentId,
        workspaceId,
        sequenceVersionId: locked.sequenceVersionId,
        contactId: locked.contactId,
        workflowId,
        input: locked.input,
        idempotencyKey: locked.idempotencyKey,
      });
      await tx.insert(outbox).values({ kind: 'enrollment.start', aggregateId: enrollmentId, payload: { enrollmentId } });
      await tx.insert(auditEvents).values({
        workspaceId,
        actorId: 'system',
        action: 'enrollment.release_held',
        targetType: 'enrollment',
        targetId: enrollmentId,
      });
      return { kind: 'released' as const, admission, enrollmentId };
    });

    if (!outcome || outcome.kind === 'still_held') break;
    released += 1;

    if (outcome.admission.asOverage) {
      await reportOverageForWorkspace(db, config, workspaceId, outcome.enrollmentId).catch((error: unknown) => {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Failed to report overage meter event',
          workspaceId,
          error: error instanceof Error ? error.message : 'unknown',
        }));
      });
    }
    if (outcome.admission.alert80 || outcome.admission.alert100) {
      await maybeSendAlerts(db, config, workspaceId, outcome.admission).catch(() => undefined);
    }
  }

  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` })
    .from(heldEnrollments)
    .where(eq(heldEnrollments.workspaceId, workspaceId));
  return { released, stillHeld: Number(count) };
}

async function reportOverageForWorkspace(
  db: Database,
  config: Pick<Config, 'stripeSecretKey' | 'stripeMeterEventName'>,
  workspaceId: string,
  identifier: string,
) {
  const customer = await db.execute<{ stripeCustomerId: string | null }>(sql`
    select s."stripeCustomerId" as "stripeCustomerId"
    from subscription s
    where s."referenceId" = ${workspaceId}
      and s.status in ('active', 'trialing')
    order by s."periodStart" desc nulls last
    limit 1
  `);
  const stripeCustomerId = customer.rows[0]?.stripeCustomerId;
  if (!stripeCustomerId) return;
  await reportOverageContact({ config, stripeCustomerId, identifier });
}

async function maybeSendAlerts(
  db: Database,
  config: Pick<Config, 'authResendApiKey' | 'authFrom' | 'publicUrl'>,
  workspaceId: string,
  admission: { alert80: boolean; alert100: boolean; yearMonth: string; uniqueContacts: number },
) {
  const [workspace] = await db.select({ plan: workspaces.plan }).from(workspaces)
    .where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return;
  const yearMonth = admission.yearMonth || currentYearMonth();

  if (admission.alert80) {
    const updated = await db.execute(sql`
      update workspace_usage_months
      set alert_80_sent_at = now(), updated_at = now()
      where workspace_id = ${workspaceId}
        and year_month = ${yearMonth}
        and alert_80_sent_at is null
      returning workspace_id
    `);
    if ((updated.rowCount ?? 0) > 0) {
      await sendUsageAlert({
        db,
        workspaceId,
        kind: '80',
        uniqueContacts: admission.uniqueContacts,
        plan: workspace.plan,
        authResendApiKey: config.authResendApiKey,
        from: config.authFrom,
        publicUrl: config.publicUrl,
      });
    }
  }
  if (admission.alert100) {
    const updated = await db.execute(sql`
      update workspace_usage_months
      set alert_100_sent_at = now(), updated_at = now()
      where workspace_id = ${workspaceId}
        and year_month = ${yearMonth}
        and alert_100_sent_at is null
      returning workspace_id
    `);
    if ((updated.rowCount ?? 0) > 0) {
      await sendUsageAlert({
        db,
        workspaceId,
        kind: '100',
        uniqueContacts: admission.uniqueContacts,
        plan: workspace.plan,
        authResendApiKey: config.authResendApiKey,
        from: config.authFrom,
        publicUrl: config.publicUrl,
      });
    }
  }
}

export async function purgeExpiredEnrollmentHistory(db: Database, billingEnabled: boolean): Promise<number> {
  if (!billingEnabled) return 0;

  const rows = await db.select({
    id: enrollments.id,
    workspaceId: enrollments.workspaceId,
    plan: workspaces.plan,
    updatedAt: enrollments.updatedAt,
  })
    .from(enrollments)
    .innerJoin(workspaces, eq(workspaces.id, enrollments.workspaceId))
    .where(inArray(enrollments.state, [...FINISHED]))
    .limit(200);

  let deleted = 0;
  const now = Date.now();
  for (const row of rows) {
    const days = planLimits(row.plan).historyDays;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    if (row.updatedAt.getTime() >= cutoff) continue;

    await db.transaction(async (tx) => {
      const events = await tx.select({ id: enrollmentEvents.id }).from(enrollmentEvents)
        .where(eq(enrollmentEvents.enrollmentId, row.id));
      const aggregateIds = [row.id, ...events.map((event) => event.id)];
      await tx.delete(outbox).where(inArray(outbox.aggregateId, aggregateIds));
      await tx.delete(sendIntents).where(eq(sendIntents.enrollmentId, row.id));
      await tx.delete(enrollmentEvents).where(eq(enrollmentEvents.enrollmentId, row.id));
      await tx.delete(enrollments).where(eq(enrollments.id, row.id));
    });
    deleted += 1;
  }
  return deleted;
}

export async function runBillingMaintenance(
  db: Database,
  config: Pick<Config, 'billingEnabled' | 'stripeSecretKey' | 'stripeMeterEventName' | 'authResendApiKey' | 'authFrom' | 'publicUrl'>,
): Promise<{ drainedWorkspaces: number; purged: number }> {
  if (!config.billingEnabled) return { drainedWorkspaces: 0, purged: 0 };

  const withHolds = await db.selectDistinct({ workspaceId: heldEnrollments.workspaceId }).from(heldEnrollments).limit(100);
  let drainedWorkspaces = 0;
  for (const row of withHolds) {
    const result = await drainHeldEnrollments(db, config, row.workspaceId, 25);
    if (result.released > 0) drainedWorkspaces += 1;
  }

  const purged = await purgeExpiredEnrollmentHistory(db, true);
  return { drainedWorkspaces, purged };
}

export { maybeSendAlerts, reportOverageForWorkspace };
