import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { ReflowError } from '../domain/errors.js';

/** Atomic, deployment-wide limit shared by API replicas. Subjects are HMACed
 * so email addresses and other identifiers are not stored in bucket keys. */
export async function consumeRateLimit(
  db: Database, config: Config, scope: string, subject: string, maximum: number, windowSeconds: number,
): Promise<void> {
  const key = createHmac('sha256', config.betterAuthSecret).update(`${scope}:${subject}`).digest('hex');
  const result = await db.execute<{ count: number; reset_at: Date }>(sql`
    INSERT INTO rate_limit_buckets (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      reset_at = CASE WHEN rate_limit_buckets.reset_at <= now()
        THEN now() + make_interval(secs => ${windowSeconds}) ELSE rate_limit_buckets.reset_at END
    RETURNING count, reset_at
  `);
  const bucket = result.rows[0];
  if (bucket && bucket.count > maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(bucket.reset_at).getTime() - Date.now()) / 1000));
    throw new ReflowError('RATE_LIMITED', 'Too many requests; try again later', 429, true, { details: { retryAfterSeconds } });
  }
}
