import { Resend } from 'resend';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { planLimits } from './plans.js';
import { softLimit } from './usage.js';

export async function sendUsageAlert(input: {
  db: Database;
  workspaceId: string;
  kind: '80' | '100';
  uniqueContacts: number;
  plan: string;
  authResendApiKey?: string | undefined;
  from?: string | undefined;
  publicUrl: string;
}): Promise<void> {
  if (!input.authResendApiKey || !input.from) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'Skipped usage alert; AUTH_RESEND_API_KEY or AUTH_EMAIL_FROM not configured',
      workspaceId: input.workspaceId,
      kind: input.kind,
    }));
    return;
  }

  const owners = await input.db.execute<{ email: string; name: string }>(sql`
    select u.email, u.name
    from memberships m
    join "user" u on u.id = m.user_id
    where m.workspace_id = ${input.workspaceId}
      and m.role in ('owner', 'admin')
      and coalesce(u.email, '') <> ''
  `);
  const recipients = [...new Set(owners.rows.map((row) => row.email).filter(Boolean))];
  if (recipients.length === 0) return;

  const limits = planLimits(input.plan);
  const subject = input.kind === '80'
    ? `Rachet: ${input.uniqueContacts} of ${limits.contactsPerMonth} contacts used this month`
    : `Rachet: contact limit reached (${limits.contactsPerMonth}/month)`;
  const soft = softLimit(limits);
  const body = input.kind === '80'
    ? [
      `Your organization has used ${input.uniqueContacts} of ${limits.contactsPerMonth} unique contacts this month.`,
      `Paid plans continue free through ${soft} (10% grace). After that, enrollments are held unless overage is on.`,
      `Manage billing: ${input.publicUrl}/settings/billing`,
    ].join('\n\n')
    : [
      `Your organization has reached its included contact limit (${limits.contactsPerMonth}/month).`,
      limits.overage
        ? `Grace continues through ${soft} contacts. Turn on overage or upgrade to keep enrolling past that.`
        : 'New enrollments are held until next month or an upgrade.',
      `Manage billing: ${input.publicUrl}/settings/billing`,
    ].join('\n\n');

  const client = new Resend(input.authResendApiKey);
  for (const to of recipients) {
    const { error } = await client.emails.send({
      from: input.from,
      to,
      subject,
      text: body,
    });
    if (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to send usage alert',
        to,
        workspaceId: input.workspaceId,
        error: error.message,
      }));
    }
  }
}
