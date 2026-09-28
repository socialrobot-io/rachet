# Pricing

This file is the source of truth for Rachet Cloud pricing. When a price, limit, or rule changes, update this file first. Then update the pricing page in `apps/dashboard/src/pricing.tsx` and its tests in `apps/dashboard/src/pricing.test.tsx` to match.

Every plan is bring your own key (BYOK). The customer connects their own email sending account and pays their provider directly. Rachet charges only for running journeys.

## Cloud plans

| | Free | Solo | Growth | Scale |
| --- | --- | --- | --- | --- |
| Price | €0 | €12/month | €29/month | €59/month |
| Best for | Side projects, trying it out | Solo founders with a live product | Growing products | Established products |
| Contacts enrolled per month | 500 | 5,000 | 15,000 | 50,000 |
| Extra contacts over the limit | Held until next month | €2.50 per 1,000, opt-in | €2.50 per 1,000, opt-in | €2.50 per 1,000, opt-in |
| Live journeys | 3 | Unlimited | Unlimited | Unlimited |
| Team members | Unlimited | Unlimited | Unlimited | Unlimited |
| History for finished enrollments | 14 days | 90 days | 6 months | 1 year |
| Support | Community (GitHub) | Email | Email | Priority email |

Every plan includes:

- Agent authoring over MCP and CLI
- Drafts, validation, and simulation
- The ops console (journey graphs, enrollments, messages)
- Managed hosting, backups, and upgrades

Prices are in EUR and exclude VAT. Billing is monthly. Customers can cancel at any time.

## Self-host

Self-hosting is free under AGPL-3.0. It is the full engine with no features removed, and it has no limits on contacts or journeys. The operator runs the infrastructure. Support comes from the community on GitHub.

## Enterprise

Enterprise has custom pricing. It is for companies that need more than 50,000 contacts a month, or that need these controls:

- Custom volume and history retention
- SSO, audit logs, and roles
- A commercial license with no AGPL obligations
- Managed or dedicated hosting
- Priority support with an SLA

Contact: hey@rachet.dev

## How contacts are counted

The billing unit is **unique contacts enrolled per month**. The pricing page calls this "people who start a journey each month".

1. A contact counts once per calendar month, the first time it enters any journey that month.
2. A contact that enters three journeys in one month counts as one.
3. A contact that is partway through a journey does not count again in the next month.
4. A contact that enters a new journey in a later month counts again in that month.
5. Contacts that are stored but never enrolled are free.
6. The counter resets on the 1st of each month.

A journey sent to a whole list, such as a win-back campaign, counts every contact it enrolls.

Limits apply per workspace. Each workspace has its own plan. Each account can have one Free workspace.

## What happens at the limit

1. Rachet emails the customer at 80% and at 100% of the limit.
2. Paid plans get a 10% grace buffer. New enrollments continue past 100% at no charge.
3. After the buffer, the customer's overage setting decides what happens:
   - **Overage on:** new contacts enroll at €2.50 per 1,000, up to a monthly spending cap that the customer sets.
   - **Overage off (default):** new enrollments are held, not dropped. They start when the customer upgrades, turns on overage, or when the month resets. The customer can discard held enrollments that are too old before they start.
4. Contacts already in a journey always continue.

On Free there is no buffer and no overage. New enrollments are held until the next month or an upgrade.

## Pricing page calculator

The calculator recommends the cheapest option for the number of contacts the visitor enters. That option can be a smaller plan plus overage.

| Contacts per month | Cheapest option |
| --- | --- |
| Up to 500 | Free |
| 501 to 5,000 | Solo |
| 5,001 to about 11,600 | Solo plus overage |
| About 11,600 to 15,000 | Growth |
| 15,001 to about 27,000 | Growth plus overage |
| About 27,000 to 50,000 | Scale |
| More than 50,000 | Enterprise or self-host |

Overage is charged per contact at €2.50 per 1,000. When two options cost the same, the calculator recommends the bigger plan.

## Why BYOK

- The customer's sender reputation and domains stay theirs. They never share a sending pool with other customers.
- The customer pays their provider's price for sending, with no markup.
- Delivery logs, bounces, and complaints stay in the customer's provider dashboard.
- If the customer leaves Rachet, their sending setup does not change.
- If the sending key stops working, Rachet holds each enrollment at its current step and resumes when the key works again.

## Status

Cloud billing is gated by `BILLING_ENABLED` (default `false`). Self-hosters leave it off: no Stripe setup, no plan limits, no metering, unlimited usage.

When `BILLING_ENABLED=true`, Better Auth's Stripe plugin handles Checkout, the customer portal, and webhooks at `/api/auth/stripe/webhook`. Workspace plans sync from those webhooks. Free workspaces may publish at most 3 live journeys. Unique contacts are metered per month with grace, holds, optional overage, usage alerts, and plan history retention. See [docs/BILLING.md](BILLING.md).
