import { afterAll, describe, expect, it } from 'vitest';
import { rateLimitBuckets } from '../apps/server/src/db/schema.js';
import { consumeRateLimit } from '../apps/server/src/security/rate-limit.js';
import { probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('deployment-wide rate limits (postgres)', () => {
  const boot = runtime as DbRuntime;
  const subject = `member-${crypto.randomUUID()}@example.com`;
  const other = `member-${crypto.randomUUID()}@example.com`;
  const scope = `test-${crypto.randomUUID()}`;

  afterAll(async () => {
    await boot.close();
  });

  it('enforces an atomic per-subject budget and does not store the raw email', async () => {
    await consumeRateLimit(boot.db, boot.config, scope, subject, 2, 3600);
    await consumeRateLimit(boot.db, boot.config, scope, subject, 2, 3600);
    await expect(consumeRateLimit(boot.db, boot.config, scope, subject, 2, 3600))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(consumeRateLimit(boot.db, boot.config, scope, other, 2, 3600)).resolves.toBeUndefined();
    const buckets = await boot.db.select().from(rateLimitBuckets);
    expect(buckets.some((bucket) => bucket.key.includes(subject))).toBe(false);
  });
});
