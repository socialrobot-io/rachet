# Resend setup

Rachet keeps workflow-delivery credentials per organization. Each organization owner or admin connects their Resend account in **Integrations → Email → Resend**. The deployment's `AUTH_RESEND_API_KEY` and `AUTH_EMAIL_FROM` are separate: they send sign-in magic links, never workflow mail.

## Deployment prerequisite

Set `INTEGRATION_ENCRYPTION_KEY` to `openssl rand -base64 32` in the deployment's `.env.local` before starting the app and worker. Back up this key securely; losing or changing it makes stored organization credentials unreadable. `pnpm dev` generates a key in `.env.local` if one is missing. Production refuses to start without one. Do not put organization Resend credentials in deployment environment variables, a workflow, MCP prompt, CLI argument, or Git.

## Organization onboarding

After signup, the owner lands on **Integrations** and can choose **Email → Resend**. Webhooks and Push are listed as coming soon. They may skip setup to build and simulate workflows, but real email sends require a saved and successfully tested connection. The same Integrations page is available later from the main navigation.

Each workflow email includes non-personal organization and send-intent tags. The signed webhook uses those tags to associate early delivery events with the correct organization even before the send API response has been saved. Events for another organization are ignored, and the webhook body is capped at 256 KiB.
Critical events for older sends that lack tags are retried when the send response has not yet been correlated; operators should monitor webhook retry failures and replay them after resolving any mismatch.

1. In a dedicated [Resend account](https://resend.com/domains) for this organization, add and verify the domain used in the sender address. The `resend.dev` sandbox cannot send to arbitrary recipients.
2. Create a [sending-only API key](https://resend.com/api-keys), restricted to the verified domain when possible.
3. Create a [webhook](https://resend.com/webhooks) using the exact URL shown in Rachet, `/webhooks/resend/<organization-id>`. Subscribe to sent, delivered, bounced, complained, suppressed, opened, and clicked email events. Enable open and click tracking on the sending domain if you need engagement events. Copy that webhook's `whsec_...` signing secret; it is **not** the API key.
4. In Rachet, enter the verified transactional `From` address, a Resend sending API key beginning with `re_` (not your account password), and the webhook signing secret beginning with `whsec_`. Standard base64 signing secrets may contain `+`, `/`, and trailing `=`; paste the entire value. If you plan to send marketing mail, select **Set up marketing email** and enter its sender name, support email, and a separate verified From address. Save the settings together. Rachet encrypts both secrets at rest and never returns them to the browser. To rotate a connection or change its transactional sender, re-enter both secrets. You can edit only the marketing details without rotating the connection.
5. Click **Send a test email**. An accepted response proves the key and sender can submit to Resend, not final delivery. Confirm delivery in the recipient inbox and Resend's dashboard, then run a small test workflow and inspect `message.list` and webhook effects.

## Gmail sender checks

Complete these checks for each sending domain before sending to personal Gmail accounts. Rachet manages the marketing unsubscribe link and one-click headers; your domain and Resend account determine authentication and transport.

1. Publish SPF and DKIM records for the verified sending domain. If Gmail classifies your primary domain as a bulk sender, also publish DMARC with at least `p=none`. Check that the delivered From domain aligns with SPF or DKIM. Google recommends configuring all three at every volume. A bulk sender must pass SPF, DKIM, and DMARC.
2. Confirm with Resend that its sending IP has matching forward and reverse DNS (PTR), and that mail to Gmail uses TLS. Check a delivered message's full headers for RFC 5322 formatting, a valid Message-ID, and authentication results. Use one accurate From address and a sender name that identifies the organization.
3. Use the connection's From address for transactional workflow mail. Set a separate verified address for marketing in the same email settings form. Keep the marketing address stable. Use the sender name to identify the organization, not to advertise an offer or imply a reply.
4. Send a marketing message to a Gmail staging inbox. Inspect the delivered message, not just Rachet's preview: the unsubscribe link must be clear in the body, and `List-ID`, `List-Unsubscribe`, and `List-Unsubscribe-Post` must be present. Check that a passing DKIM signature covers both unsubscribe headers. Verify that the body link and mailbox one-click POST each stop later marketing for that address within 48 hours. Rachet applies an opt-out as soon as it commits; a send already accepted by Resend cannot be recalled.
5. Verify your sending domain in [Google Postmaster Tools](https://postmaster.google.com/). Keep its reported user spam rate below 0.3%; aim below 0.1%. Start with a low, steady volume, avoid bursts, and monitor complaints, bounces, and deferrals. Pause or reduce traffic if rates worsen. Bulk sender status is based on all mail from the primary domain, including other systems.

Google's [sender guidelines](https://support.google.com/mail/answer/81126?hl=en), [subscription guidelines](https://support.google.com/mail/answer/15263077?hl=en), and [sender FAQ](https://support.google.com/mail/answer/14229414?hl=en) are the source for these checks. Follow them as they change. Rachet cannot prove DNS, TLS, DKIM header coverage, or ongoing reputation from a saved Resend key or local preview.

Validation and success messages appear beside **Save email settings**, with field-specific errors beneath the affected inputs. Test-send results appear beside **Send a test email**. During onboarding, an accepted test stays on the page so you can read its result before choosing **Continue to dashboard**.

The webhook URL is not a secret or proof of ownership. Rachet verifies the raw request body against this organization's signing secret, correlates the provider message ID to a send in the same organization, and only then records the event or suppression. Unknown messages are acknowledged without being stored or attributed to another organization. Duplicate webhook IDs are scoped per organization. The legacy deployment-wide `/webhooks/resend` route is no longer used.

Rachet stores correlated `email.opened` and `email.clicked` webhook events in `webhook_events`. The `webhook_event.list` administrator operation can inspect them. They do not appear in enrollment History or change a workflow route. Resend has no separate "read" event; an open means the tracking image was fetched, not that the person read the message.

## Operational notes

- A key or sender change increments the connection version. An in-flight ambiguous send is parked for attention instead of retried on a different account or sender.
- Use Resend's `delivered@resend.dev`, `bounced@resend.dev`, and `complained@resend.dev` test addresses for workflow tests; do not use invented addresses at real mail providers.
- If Resend rejects a test, verify that the sender domain is verified in the **same account** as the key, and that the key has sending access.
- A 400 webhook response means the signing secret or forwarded Svix headers are wrong. A 404 means the organization has no connection at that URL.
- Key rotation needs a plan for sends in flight. Review parked send intents before rotating or removing an account.

See Resend's [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).
