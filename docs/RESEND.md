# Resend setup

Reflow uses Resend for outbound email and signed delivery webhooks. Resend is optional for workflow validation and simulation; configure it before enrolling contacts for real sends.

## 1. Create a sending API key

In the [Resend API keys](https://resend.com/api-keys) dashboard, create a key with the least privilege that supports sending. Keep it server-side. Never put it in a React Email file, CLI command line, workflow definition, MCP prompt, or Git repository.

For Docker Compose and Coolify, put the values in `.env.local` (or Coolify's masked environment variables):

```sh
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
```

Run Compose with `docker compose --env-file .env.local ...`. Coolify substitutes the same variables into the production Compose file.

## 2. Verify the sender domain

In Resend, add the domain you will use in the `From` address and publish the DNS records Resend provides. Wait until the domain is verified. The domain in `REFLOW_FROM` must exactly match the verified domain; for example:

```sh
REFLOW_FROM='Reflow <mail.example.com>'
```

The `resend.dev` sender is a sandbox. It is useful for initial tests but can only deliver to the email address associated with the Resend account. Use a verified domain for other recipients. See Resend’s [domain guide](https://resend.com/docs/dashboard/domains/introduction).

## 3. Configure Reflow

Set these values before starting the API and worker:

```sh
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
REFLOW_FROM='Reflow <mail.example.com>'
```

Restart or redeploy the `app`, `worker`, and `dispatcher` services after changing provider credentials.

## 4. Configure the webhook

Create a webhook in the Resend dashboard with this URL:

```text
https://<your-reflow-domain>/webhooks/resend
```

Subscribe at least to `email.bounced`, `email.complained`, and `email.suppressed`. Delivery and engagement events such as `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.opened`, and `email.clicked` can also be enabled for operational reporting.

Copy the endpoint signing secret into `RESEND_WEBHOOK_SECRET`. Do not use the API key as the webhook secret. Reflow verifies the raw request body and Svix signature headers before storing an event. Duplicate event IDs are safe to receive again.

## 5. Test safely

Use Resend’s test addresses rather than random fake mailboxes:

- `delivered@resend.dev` simulates successful delivery.
- `bounced@resend.dev` simulates a hard bounce.
- `complained@resend.dev` simulates a spam complaint.

Create a small workflow with a published template, enroll one test contact, and inspect the send ledger through `message.list`. After a bounce or complaint, Reflow records a suppression and will refuse subsequent sends to that address.

Resend retries transport failures and retains idempotency keys for a limited period. Reflow therefore sends each enrollment step with a stable idempotency key and parks ambiguous sends after its safe retry window. See the [Resend idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Troubleshooting

- **403 or domain mismatch:** verify the `From` domain and make sure Resend shows it as verified.
- **Sandbox recipient rejected:** use the account email or a `resend.dev` test address, or verify a real domain.
- **Webhook returns 503:** both the API key and webhook secret must be configured.
- **Webhook returns 400:** check the endpoint secret and ensure the reverse proxy forwards `svix-id`, `svix-timestamp`, and `svix-signature` unchanged.
- **No suppression created:** inspect `webhook_event.list`; Reflow only suppresses events that correlate to a known provider message ID.
