# Reflow operation paths

These names describe the proposed v1 contract. Discover the running server's schema/version before use. Missing operations are capability gaps, not permission to bypass Reflow through its database, Temporal, or email provider.

## Create and launch a sequence

1. Inspect `auth.whoami`, `system.capabilities`, and relevant template/recipe schemas. Select the intended workspace and provider connection.
2. Create or clone React Email templates and a sequence recipe. Upload bounded TSX source/props schema/fixtures through artifact operations. No arbitrary package installation inside templates.
3. Validate/render representative props and simulate the graph with an event timeline and timezone. Inspect missing values, scheduling, exits, and required consent/topic policy.
4. Publish templates and sequence; retain returned immutable version IDs. Obtain an audience snapshot or explicit contacts, preview eligible/excluded counts, and check sender readiness.
5. When launch is authorized, create enrollments using those version/contact IDs and stable idempotency keys. Save the returned operation ID, poll it, and report item errors separately from accepted work.
6. Inspect timeline/report operations. Do not call an accepted provider submission “delivered” without its delivery fact.

For draft-only requests, stop after returning validated draft/preview references. A new publication does not migrate running enrollments.

## Configure access and trigger flows

Use `auth.providers` and the client's OAuth login path for a human. Use protected machine credentials for an unattended client. `oauth_client.create` and secret rotation require administrator scope; return/store one-time credentials through the secure client channel.

`account.create` provisions accounts as an administrator. `auth.register` is self-service only when `registration_policy.get` enables it. A registration response does not confer deployment administration or sending activation. Identity-provider email matching is not sufficient to link an administrative identity.

Trigger an allowed flow with `event.emit` or `enrollment.create`; preserve event and idempotency IDs on timeout/retry. Never expose a generic Temporal workflow-start operation to work around missing product permissions.

## Diagnose or recover

Inspect operation status, enrollment timeline, send intent, provider connection health, and webhook inbox state. Distinguish an invalid request, provider rejection, unknown submission, and missing delivery telemetry.

Use replay only for persisted verified events with replay eligibility. Reconcile unknown sends through `message.reconcile`; if no evidence resolves an old submission, report `needs_attention`. An explicit replacement is a new external send and needs the user's duplicate-risk authorization. Preserve current suppression regardless of old delivery events.

When pausing a sequence, report whether control is effective and whether any sends are in flight. Do not imply that revoking a client cancels earlier authorized enrollments; use the appropriate control operation if that is intended.
