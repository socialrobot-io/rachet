import { and, eq, ne } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { enrollments, sendIntents, workspaces } from '../db/schema.js';
import { emailConnection, type EmailProviderName } from '../integrations/email-sender.js';
import type { EmailProvider } from '../providers/email-provider.js';
import { createUnsubscribeToken } from '../security/unsubscribe-token.js';
import { emailEligibility, emailKey, lockEmailAddress, mailboxAddress } from './email-policy.js';
import { appendMarketingFooter, type renderEmail } from './render.js';

type SendIntent = typeof sendIntents.$inferSelect;

export function prepareMarketingEmail(config: Config, workspaceId: string, rendered: Awaited<ReturnType<typeof renderEmail>>, senderName: string) {
  const token = createUnsubscribeToken(config);
  const url = `${config.publicUrl}/unsubscribe/${token.token}`;
  return {
    token,
    rendered: appendMarketingFooter(rendered, senderName, url),
    headers: {
      'List-ID': `Marketing <${workspaceId}.marketing.${new URL(config.publicUrl).hostname}>`,
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function dispatchEmail(
  db: Database,
  provider: EmailProvider,
  intent: SendIntent,
  sender: { fromAddress: string; connectionVersion: number | null; provider: EmailProviderName },
  purpose: 'marketing' | 'transactional',
) {
  const { id, workspaceId, enrollmentId } = intent;
  const address = emailKey(intent.recipient);
  const claim = await db.transaction(async (tx) => {
    const [workspace] = await tx.select({ enabled: workspaces.sendingEnabled, provider: workspaces.emailProvider })
      .from(workspaces).where(eq(workspaces.id, workspaceId)).for('share').limit(1);
    await lockEmailAddress(tx as unknown as Database, workspaceId, address);
    const [current] = await tx.select().from(sendIntents).where(eq(sendIntents.id, id)).for('update').limit(1);
    if (!current || current.state === 'abandoned') return { status: 'suppressed' } as const;
    if (current.state === 'accepted') return { status: 'succeeded' } as const;
    if (current.state === 'rejected') return { status: 'rejected', code: current.errorCode ?? 'provider_rejected' } as const;
    // An SES call in flight or interrupted after the claim may already have
    // sent. Leave its state intact so its response or a signed event can settle it.
    if (current.provider === 'ses' && (current.state === 'dispatching' || current.state === 'unknown')) {
      return { status: 'needs_attention' } as const;
    }

    const stop = async (reason: string, uncertain = false) => {
      const state = uncertain || current.firstAttemptAt ? 'unknown' : 'abandoned';
      await tx.update(sendIntents).set({ state, errorCode: reason, updatedAt: new Date() }).where(eq(sendIntents.id, id));
      return { status: state === 'unknown' ? 'needs_attention' : reason === 'unsubscribed' ? 'unsubscribed' : 'suppressed' } as const;
    };
    const connection = sender.connectionVersion === null ? undefined : await emailConnection(tx, workspaceId, sender.provider);
    if (current.provider !== sender.provider || workspace?.provider !== sender.provider ||
        current.connectionVersion !== sender.connectionVersion ||
        (sender.connectionVersion !== null && connection?.version !== sender.connectionVersion) ||
        mailboxAddress(current.fromAddress ?? '') !== mailboxAddress(sender.fromAddress)) return stop('connection_changed', !!enrollmentId);
    const now = new Date();
    if (current.provider === 'resend' && current.firstAttemptAt && now.getTime() - current.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000) {
      return stop('idempotency_window_expired', true);
    }
    if (enrollmentId) {
      const [enrollment] = await tx.select({ state: enrollments.state }).from(enrollments).where(eq(enrollments.id, enrollmentId)).limit(1);
      if (enrollment?.state === 'paused') return { status: 'paused' } as const;
      if (!enrollment || !['pending_start', 'running', 'waiting'].includes(enrollment.state)) return stop('enrollment_stopped');
    }
    if (!workspace?.enabled) return stop('sender_disabled');
    const eligibility = await emailEligibility(tx as unknown as Database, workspaceId, address, purpose);
    if (!eligibility.eligible) return stop(eligibility.reason);

    // A retry must keep the original From header, even if the display name changes.
    const fromAddress = enrollmentId && !current.firstAttemptAt ? sender.fromAddress : current.fromAddress ?? sender.fromAddress;
    const claimedAt = new Date(Math.max(now.getTime(), current.updatedAt.getTime() + 1));
    await tx.update(sendIntents).set({
      state: 'dispatching', fromAddress, firstAttemptAt: current.firstAttemptAt ?? now, updatedAt: claimedAt,
    }).where(eq(sendIntents.id, id));
    return { status: 'dispatching', fromAddress, claimedAt } as const;
  });
  if (claim.status !== 'dispatching') return claim;

  const outcome = await provider.send({
    from: claim.fromAddress, to: intent.recipient, subject: intent.subject,
    html: intent.html, text: intent.plainText, headers: intent.headers,
    tags: [{ name: 'rachet_workspace', value: workspaceId }, { name: 'rachet_intent', value: id }],
  }, intent.idempotencyKey);
  const updatedAt = new Date();
  if (outcome.kind === 'accepted') {
    await db.update(sendIntents).set({
      state: 'accepted', errorCode: null, providerMessageId: outcome.messageId, acceptedAt: updatedAt, updatedAt,
    }).where(and(eq(sendIntents.id, id), ne(sendIntents.state, 'accepted')));
    return { status: 'succeeded' } as const;
  }
  const state = outcome.kind === 'unknown' ? 'unknown' : outcome.retryable ? 'retryable' : 'rejected';
  const [updated] = await db.update(sendIntents).set({ state, errorCode: outcome.code, updatedAt })
    .where(and(eq(sendIntents.id, id), eq(sendIntents.state, 'dispatching'), eq(sendIntents.updatedAt, claim.claimedAt)))
    .returning({ id: sendIntents.id });
  if (sender.provider === 'ses') {
    if (!updated) {
      const [current] = await db.select({ state: sendIntents.state }).from(sendIntents).where(eq(sendIntents.id, id)).limit(1);
      if (current?.state === 'accepted') return { status: 'succeeded' } as const;
    }
    if (state === 'unknown') return { status: 'needs_attention' } as const;
  }
  return { status: state, code: outcome.code } as const;
}
