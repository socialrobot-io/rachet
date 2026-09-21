# Resend setup

Reflow keeps workflow-delivery credentials per organization. Each organization owner or admin connects their Resend account in **Organization settings → Resend**. The deployment's `AUTH_RESEND_API_KEY` and `AUTH_EMAIL_FROM` are separate: they send sign-in magic links, never workflow mail.

## Deployment prerequisite

Set `INTEGRATION_ENCRYPTION_KEY` to `openssl rand -base64 32` in the deployment's `.env.local` before starting the app and worker. Back up this key securely; losing or changing it makes stored organization credentials unreadable. `pnpm dev` generates a key in `.env.local` if one is missing. Production refuses to start without one. Do not put organization Resend credentials in deployment environment variables, a workflow, MCP prompt, CLI argument, or Git.

## Organization onboarding

After signup, the owner lands on **Integrations** and can choose **Resend**. Webhooks and Push are listed as coming soon. They may skip setup to build and simulate workflows, but real email sends require a saved and successfully tested connection. The same Integrations page is available later from the main navigation.

Each workflow email includes non-personal organization and send-intent tags. The signed webhook uses those tags to associate early delivery events with the correct organization even before the send API response has been saved. Events for another organization are ignored, and the webhook body is capped at 256 KiB.
Critical events for older sends that lack tags are retried when the send response has not yet been correlated; operators should monitor webhook retry failures and replay them after resolving any mismatch.

1. In a dedicated [Resend account](https://resend.com/domains) for this organization, add and verify the domain used in the sender address. The `resend.dev` sandbox cannot send to arbitrary recipients.
2. Create a [sending-only API key](https://resend.com/api-keys), restricted to the verified domain when possible.
3. Create a [webhook](https://resend.com/webhooks) using the exact URL shown in Reflow, `/webhooks/resend/<organization-id>`. Subscribe to sent, delivered, bounced, complained, and suppressed email events. Copy that webhook's `whsec_...` signing secret; it is **not** the API key.
4. In Reflow, enter the verified `From` address, sending key, and webhook signing secret. Reflow encrypts both secrets at rest and never returns them to the browser. To rotate a connection, re-enter both secrets in Organization settings.
5. Click **Send a test email**. An accepted response proves the key and sender can submit to Resend, not final delivery. Confirm delivery in the recipient inbox and Resend's dashboard, then run a small test workflow and inspect `message.list` and webhook effects.

The webhook URL is not a secret or proof of ownership. Reflow verifies the raw request body against this organization's signing secret, correlates the provider message ID to a send in the same organization, and only then records the event or suppression. Unknown messages are acknowledged without being stored or attributed to another organization. Duplicate webhook IDs are scoped per organization. The legacy deployment-wide `/webhooks/resend` route is no longer used.

## Operational notes

- A key or sender change increments the connection version. An in-flight ambiguous send is parked for attention instead of retried on a different account or sender.
- Use Resend's `delivered@resend.dev`, `bounced@resend.dev`, and `complained@resend.dev` test addresses for workflow tests; do not use invented addresses at real mail providers.
- If Resend rejects a test, verify that the sender domain is verified in the **same account** as the key, and that the key has sending access.
- A 400 webhook response means the signing secret or forwarded Svix headers are wrong. A 404 means the organization has no connection at that URL.
- Key rotation needs a plan for sends in flight. Review parked send intents before rotating or removing an account.

See Resend's [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).
