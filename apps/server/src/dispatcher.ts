import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { enrollmentEvents, enrollments, outbox, sequenceVersions } from './db/schema.js';
import { workflowDefinitionSchema } from '@rachet/contracts';
import { createTemporalClient } from './temporal/client.js';
import { enrollmentWorkflow } from './temporal/workflows.js';
import { enrollmentEvent, unsubscribeEnrollment } from './temporal/shared.js';

const config = loadConfig();
const { db, pool } = createDatabase(config);
const temporal = await createTemporalClient(config);
let stopping = false;
let nextRateLimitCleanup = Date.now();
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

while (!stopping) {
  if (Date.now() >= nextRateLimitCleanup) {
    nextRateLimitCleanup = Date.now() + 60_000;
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 day'`);
  }
  const now = new Date();
  const [job] = await db.select().from(outbox).where(and(
    isNull(outbox.completedAt),
    lt(outbox.availableAt, new Date(now.getTime() + 1)),
    or(isNull(outbox.claimedUntil), lt(outbox.claimedUntil, now)),
  )).limit(1);
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  const claimedUntil = new Date(Date.now() + 30_000);
  const [claimed] = await db.update(outbox).set({ claimedUntil, attempts: job.attempts + 1 }).where(and(eq(outbox.id, job.id), eq(outbox.attempts, job.attempts))).returning();
  if (!claimed) continue;
  try {
    if (job.kind === 'enrollment.start') {
      const [row] = await db.select({ enrollment: enrollments, sequence: sequenceVersions }).from(enrollments)
        .innerJoin(sequenceVersions, eq(sequenceVersions.id, enrollments.sequenceVersionId))
        .where(eq(enrollments.id, job.aggregateId)).limit(1);
      if (!row) throw new Error('Enrollment or sequence version missing');
      if (row.enrollment.state === 'suppressed' || row.enrollment.state === 'cancelled') {
        await db.update(outbox).set({ completedAt: new Date(), claimedUntil: null, lastError: null }).where(eq(outbox.id, job.id));
        continue;
      }
      if (!row.sequence.purposeReviewedAt) {
        await db.update(enrollments).set({ state: 'needs_attention', updatedAt: new Date() }).where(eq(enrollments.id, row.enrollment.id));
        await db.update(outbox).set({ completedAt: new Date(), claimedUntil: null, lastError: 'Workflow purpose requires review and republish' }).where(eq(outbox.id, job.id));
        continue;
      }
      const definition = workflowDefinitionSchema.parse(row.sequence.definition);
      await temporal.workflow.start(enrollmentWorkflow, {
        workflowId: row.enrollment.workflowId,
        taskQueue: config.temporalTaskQueue,
        args: [{ workspaceId: row.enrollment.workspaceId, enrollmentId: row.enrollment.id, definition }],
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
      // An unsubscribe may commit after the state read above while the start
      // request is in flight. Recheck after start so a prior NotFound signal
      // cannot leave a newly started wait alive.
      const [afterStart] = await db.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, row.enrollment.id)).limit(1);
      if (afterStart?.state === 'suppressed') await temporal.workflow.getHandle(row.enrollment.workflowId).signal(unsubscribeEnrollment);
    } else if (job.kind === 'enrollment.unsubscribe') {
      const [row] = await db.select({ workflowId: enrollments.workflowId }).from(enrollments).where(eq(enrollments.id, job.aggregateId)).limit(1);
      if (row) {
        try { await temporal.workflow.getHandle(row.workflowId).signal(unsubscribeEnrollment); }
        catch (error) {
          // A pending start is already suppressed in PostgreSQL and will be
          // skipped above. A workflow that has ended needs no signal.
          if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'WorkflowNotFoundError') throw error;
        }
      }
    } else if (job.kind === 'enrollment.event') {
      const [row] = await db.select({ event: enrollmentEvents, enrollment: enrollments }).from(enrollmentEvents)
        .innerJoin(enrollments, eq(enrollments.id, enrollmentEvents.enrollmentId))
        .where(eq(enrollmentEvents.id, job.aggregateId)).limit(1);
      if (!row) throw new Error('Enrollment event or enrollment missing');
      if (!row.event.deliveredAt) {
        await temporal.workflow.getHandle(row.enrollment.workflowId).signal(
          enrollmentEvent,
          row.event.eventType,
          row.event.eventId,
          row.event.data,
        );
        await db.update(enrollmentEvents).set({ deliveredAt: new Date(), updatedAt: new Date() }).where(eq(enrollmentEvents.id, row.event.id));
      }
    } else {
      throw new Error(`Unsupported outbox kind: ${job.kind}`);
    }
    await db.update(outbox).set({ completedAt: new Date(), claimedUntil: null, lastError: null }).where(eq(outbox.id, job.id));
  } catch (error) {
    const delay = Math.min(300_000, 1000 * 2 ** Math.min(job.attempts, 8));
    await db.update(outbox).set({ claimedUntil: null, availableAt: new Date(Date.now() + delay), lastError: error instanceof Error ? error.message.slice(0, 2000) : 'unknown error' }).where(eq(outbox.id, job.id));
  }
}
await pool.end();
