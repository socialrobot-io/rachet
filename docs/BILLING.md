# Cloud billing (Stripe)

Rachet Cloud billing is opt-in via `BILLING_ENABLED=true`. Self-host leaves it off. When billing is off, there is no Stripe setup, no plan limits, no unique-contact metering, no holds, and no retention-by-plan.

## Who handles Stripe webhooks

Better Auth’s Stripe plugin owns the endpoint:

`POST {PUBLIC_URL}/api/auth/stripe/webhook`

When `BILLING_ENABLED=true`, the plugin verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET` and processes:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Rachet hooks those events to sync `workspaces.plan` (`solo` / `growth` / `scale`, or back to `free`) and to release held enrollments after an upgrade. The test-mode endpoint also listens for `invoice.paid` and `invoice.payment_failed`; plan sync does not depend on them.

Do not add a second Stripe webhook router. Keep Resend webhooks separate.

## Stripe catalog (test mode, rachet.dev)

Created with the Stripe MCP against account `rachet.dev` (test mode):

| Plan | Product | Price | Lookup key | Amount |
| --- | --- | --- | --- | --- |
| Solo | `prod_VLGH0pBcfXgcoi` | `price_1UKZkoLCt7kotVjH3gTmj8Ji` | `rachet_solo_monthly` | €12 / month |
| Growth | `prod_VLGHAHAqhAJCJq` | `price_1UKZkoLCt7kotVjHosxsplHp` | `rachet_growth_monthly` | €29 / month |
| Scale | `prod_VLGHCwAWAgyj0v` | `price_1UKZkqLCt7kotVjHXU7xQlHG` | `rachet_scale_monthly` | €59 / month |
| Overage | `prod_VLGHSMKwwRYD1r` | create with meter script | `rachet_contact_overage` | €0.0025 / contact (€2.50 / 1,000) |

Customer Portal configuration: `bpc_1UKZljLCt7kotVjHfnOtBkra` (default). Cancel at period end. Plan changes between Solo / Growth / Scale are allowed.

Webhook endpoint (test): `we_1UKZlILCt7kotVjHvWgDwfCm` → `https://rachet.dev/api/auth/stripe/webhook`

Prices use tax code `txcd_10103001` (SaaS) and `tax_behavior=exclusive` (VAT on top).

### Overage meter

Create the Billing Meter and metered price once (needs `STRIPE_SECRET_KEY`):

```bash
node --env-file=.env.local --import tsx scripts/stripe-overage-meter.ts
```

Put the printed `STRIPE_PRICE_OVERAGE` and `STRIPE_METER_EVENT_NAME` into the deployment env. Overage stays off per workspace until an owner enables it in Billing settings.

## Enable Cloud billing locally

1. Copy the test secret key from [Stripe API keys](https://dashboard.stripe.com/test/apikeys) into `.env.local` as `STRIPE_SECRET_KEY`.
2. Set the webhook signing secret from the Stripe webhook endpoint (or `stripe listen`) as `STRIPE_WEBHOOK_SECRET`.
3. Set the three plan price IDs (and optionally the overage price from the meter script).
4. Set `BILLING_ENABLED=true` and restart the API and dispatcher.
5. For local Checkout without a public URL, run `stripe listen --forward-to localhost:3000/api/auth/stripe/webhook` and use the CLI’s `whsec_…` instead of the Dashboard endpoint secret.

## What runs when billing is on

- Free: max 3 live journeys; 500 unique contacts/month; holds past the limit; 14-day finished-enrollment history.
- Paid: plan contact limits, 10% grace, optional overage (€2.50 / 1,000) with a monthly spend cap, 80%/100% usage emails (needs `AUTH_RESEND_API_KEY` + `AUTH_EMAIL_FROM`), held-queue drain on upgrade / overage enable / dispatcher maintenance, retention by plan.
- Self-host with `BILLING_ENABLED=false`: none of the above.

## Production

Recreate the same products, meter, and webhook in **live** mode (or promote carefully). Point the live webhook at `https://rachet.dev/api/auth/stripe/webhook`. Store live secrets only in the deployment secret store. Never commit `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.
