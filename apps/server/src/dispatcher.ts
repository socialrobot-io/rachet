import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { enrollments, outbox, sequenceVersions } from './db/schema.js';
import { workflowDefinitionSchema } from '@reflow/contracts';
import { createTemporalClient } from './temporal/client.js';
import { enrollmentWorkflow } from './temporal/workflows.js';

const config = loadConfig();
const { db, pool } = createDatabase(config);
const temporal = await createTemporalClient(config);
let stopping = false;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

while (!stopping) {
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
    if (job.kind !== 'enrollment.start') throw new Error(`Unsupported outbox kind: ${job.kind}`);
    const [row] = await db.select({ enrollment: enrollments, sequence: sequenceVersions }).from(enrollments)
      .innerJoin(sequenceVersions, eq(sequenceVersions.id, enrollments.sequenceVersionId))
      .where(eq(enrollments.id, job.aggregateId)).limit(1);
    if (!row) throw new Error('Enrollment or sequence version missing');
    const definition = workflowDefinitionSchema.parse(row.sequence.definition);
    await temporal.workflow.start(enrollmentWorkflow, {
      workflowId: row.enrollment.workflowId,
      taskQueue: config.temporalTaskQueue,
      args: [{ workspaceId: row.enrollment.workspaceId, enrollmentId: row.enrollment.id, definition }],
      workflowIdConflictPolicy: 'USE_EXISTING',
    });
    await db.update(outbox).set({ completedAt: new Date(), claimedUntil: null, lastError: null }).where(eq(outbox.id, job.id));
  } catch (error) {
    const delay = Math.min(300_000, 1000 * 2 ** Math.min(job.attempts, 8));
    await db.update(outbox).set({ claimedUntil: null, availableAt: new Date(Date.now() + delay), lastError: error instanceof Error ? error.message.slice(0, 2000) : 'unknown error' }).where(eq(outbox.id, job.id));
  }
}
await pool.end();
