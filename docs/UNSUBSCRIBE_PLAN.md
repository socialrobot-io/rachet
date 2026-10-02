# Email unsubscribe plan

Status: implementation in progress, 2026-09-30. The first release uses workspace-wide marketing scope. See [Unsubscribe and consent](UNSUBSCRIBE.md) for current setup. Topic scope, custom footers, signed change webhooks, and live staging delivery checks remain open. This plan also records the intended later behavior.

## Product decision

Make unsubscribe a built-in email policy. Every marketing send gets a visible link and mailbox one-click headers. A recipient's choice applies across journeys in the same workspace. Customers do not add an unsubscribe node to each workflow.

Start with **all marketing from this workspace** as the default scope. Customers that use named subscription topics can offer a clearly labeled topic unsubscribe and an equally accessible all-marketing option. Never interpret unsubscribe as stopping only the current workflow.

Keep necessary account and service messages separate. A newsletter opt-out should not stop a requested sign-in link or a receipt. A hard bounce or complaint blocks the address across purposes by default, as required by the [PRD](PRD.md#9-consent-and-send-policy).

These choices are product recommendations, not findings from customer interviews. Validate the scope and wording with pilot customers before making topic unsubscribe the default.

## What customers need

There are two users: the business using Rachet and the person receiving its email.

| User | Need | Proposed behavior |
| --- | --- | --- |
| Small product team | Stop unwanted email without building a separate system | Rachet supplies the footer, endpoint, policy checks, and history |
| Lifecycle marketer | Stop promotions while preserving necessary service mail | Separate marketing preferences from address delivery blocks |
| Team with several newsletters | Let people leave one subscription | Stable topics with recipient-facing names; explicit all-marketing option |
| Developer with existing preferences | Keep product signup and Rachet in agreement | Shared preference operations and inspectable change events |
| Support agent | Explain why a contact did not get an email | Current eligibility, scope, reason, source, and timestamp |
| Recipient | Stop email quickly and understand the result | No login, email entry, CAPTCHA, or required survey |

Useful pilot questions: Does “unsubscribe” mean one newsletter or all promotional mail? Which emails must remain available? Where does consent originate? Who handles requests received by support? Does the product already have a preference system?

## Recipient experience

### From the email body

1. Show a readable footer: “Unsubscribe from Acme marketing emails.” If the send uses topic scope, show “Unsubscribe from Acme product updates” instead.
2. Opening the link shows a small branded page. GET does not change preferences; security scanners can open links.
3. Show one primary button with the same scope as the link. A topic page also offers “Stop all marketing emails from Acme.” Neither action requires login.
4. Submit the choice with POST. Confirm success only after the database change commits.
5. Show: “You're unsubscribed from Acme marketing emails.” Explain that necessary account and service messages may still arrive. For topic scope, name the topic in the confirmation.

Use the workspace's recipient-facing sender name, not a workflow name or deployment name. Mask any displayed email address. The page works on mobile and without JavaScript. It contains no analytics, advertising, third-party assets, or required feedback form.

An already-unsubscribed recipient sees the same clear result. A database failure shows a retry action and does not claim success. A malformed or revoked link returns a generic error without revealing whether the address exists. Provide a configured support contact on that error page.

Unsubscribe does not delete the contact or cancel the person's product account. Do not send a marketing “sorry to see you go” email. Resubscription is a separate action with new consent evidence; an old unsubscribe link cannot authorize it.

### From the mailbox unsubscribe control

The mailbox sends a token-authorized POST. Apply the scope carried by the URL immediately and return an empty HTTP 200 after commit. No confirmation page, redirect, browser cookie, login, or extra interaction is required. Support both form-urlencoded and multipart bodies with `List-Unsubscribe=One-Click`. This follows [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html).

The header URL and body link must describe the same scope. Rachet should enforce this for all marketing sends regardless of volume. Gmail requires one-click and a visible body link for marketing/subscription mail from bulk senders. [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en).

## Customer setup and operation

For the first release, use workspace-wide marketing unsubscribe with a managed footer. Add minimal branding fields and a support contact. Existing CLI/MCP users must be able to configure and inspect these settings through shared operations; a dashboard is not required.

At workflow publication, require an explicit email purpose. Marketing uses the default `marketing` topic unless the customer selects a defined topic. A topic has a stable key and a readable name, such as `product_updates` / “Product updates.” Renaming a workflow must not change subscription scope. Retire topics without deleting their opt-out history or invalidating old links.

Recommended later option: allow a custom footer using a reserved server-owned placeholder, such as `{{subscription.unsubscribeUrl}}`. Reject marketing publication if the managed footer is disabled and the required link is missing. Preview HTML and plain text with an inert URL. Do not expose usable unsubscribe tokens in MCP results or previews. A placeholder check does not prove visual visibility; the managed footer provides the reliable default.

Customers need a contact preference view through operations first, with optional dashboard display later. Return separate marketing eligibility and delivery eligibility rather than a single “subscribed” flag. A send blocked by a preference should explain the topic or all-marketing scope. It is a normal policy outcome, not a provider failure requiring attention.

Imports, SDK triggers, contact updates, workflow edits, and provider suppression removal cannot clear opt-out. A customer can record a support unsubscribe request. Resubscription requires a dedicated audited operation with evidence of a new recipient request. Marketing enrollment also requires consent evidence; absence of suppression is not consent.

## Policy model

Use independent records for consent/preferences and delivery blocks. A single mutable suppression row must not let one reason overwrite another.

| Record | Scope | Effect |
| --- | --- | --- |
| Topic consent | Workspace + normalized address + topic | Evidence permitting that marketing subscription |
| Topic opt-out | Workspace + normalized address + topic | Blocks marketing in that topic across all journeys |
| All-marketing opt-out | Workspace + normalized address | Blocks all marketing, including topics created later |
| Delivery block | Workspace + normalized address | Blocks email across purposes; examples include hard bounce and complaint |

All-marketing opt-out takes precedence over topic consent. Resubscribing to a topic cannot silently clear all-marketing opt-out; the new request must explicitly authorize that change. Clearing a marketing opt-out never clears a bounce, complaint, or administrator delivery block. Keep append-only evidence and project current state from it, or maintain current state and history in the same transaction.

Evidence includes workspace, address key, scope, action, source, event ID, timestamp, actor where applicable, and consent reference. Retain the address form used by the sent message. A link from an old address affects that address, not a contact's replacement destination. Recreating or importing the same address retains its opt-out. Contact erasure must preserve the keyed suppression tombstone required by the PRD.

All state and token lookups are workspace-scoped. One customer's unsubscribe never changes another customer's contact. The current workspace is the sender boundary. Separate brands inside one workspace are a later design decision, not an implicit topic workaround.

## Backend design

### Public endpoint and tokens

Propose `GET /unsubscribe/:token` and `POST /unsubscribe/:token`. These are recipient endpoints outside operator authentication. For mailbox one-click, require the exact expected form field; the browser form uses a separately validated action and can choose topic or all-marketing scope.

Use a signed opaque token with a random identifier. Store its digest and bind it to workspace, original address key, scope, send intent, and signing-key version. Do not embed the raw email address in a URL. The token grants only opt-out for its permitted scopes. It never grants contact reads, arbitrary preference writes, or opt-in.

Use a dedicated signing-key lifecycle. Keep old email links working during routine rotation, and do not give unsubscribe links the short expiry of login links. Allow explicit revocation after a key compromise. Redact tokens from access logs, traces, and model-visible messages; return no-store and no-referrer headers. Bound requests and use generous abuse limits that still permit legitimate mailbox bursts.

### Send preparation and dispatch

1. Resolve purpose/topic from the immutable workflow version and bind the intended recipient address.
2. Prepare the send intent, stable unsubscribe token, rendered footer, and headers once. Freeze the provider payload and hash it, including the headers. Retries reuse the exact payload and provider idempotency key.
3. Before dispatch, check current consent, applicable opt-out, delivery blocks, sender state, and enrollment control in a transaction. Preference mutations and dispatch admission acquire the same workspace/address lock, including when no preference row exists yet.
4. If unsubscribe commits first, reject dispatch admission and record the policy reason. If dispatch admission commits first, that attempt may complete after unsubscribe. Never claim an admitted or accepted email can be recalled.
5. Recheck policy before any new provider attempt. If a prior attempt is already accepted, preserve its accepted result. If its outcome is ambiguous, retain that ambiguity and reconcile it; do not mark it unsent, resend after opt-out, or use a new idempotency key.

The provider payload adds:

```text
List-Unsubscribe: <https://public-host/unsubscribe/opaque-token>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Both headers must be covered by a valid DKIM signature for RFC 8058. Verify this on delivered mail rather than assuming provider header support proves it. Resend's send API accepts custom unsubscribe headers, but does not manage recipients' preferences for this email-send path; Rachet owns the state. [Resend unsubscribe guide](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails).

### Journeys already in progress

Commit the preference change and an outbox notification together. Signal every applicable active marketing enrollment to end with reason `unsubscribed`; interrupt scheduled starts, delays, event waits, and paused runs. The database dispatch gate blocks sends even while signal delivery is delayed or Temporal is unavailable.

End only marketing enrollments affected by the scope. A newsletter opt-out does not cancel unrelated transactional workflows. Resubscription permits eligible new enrollment; it does not revive cancelled runs or flush old unsent messages. Expose accepted/ambiguous attempts separately from blocked future sends.

### Shared operations

Proposed names below require contracts and implementation before they are advertised:

| Operation | Purpose |
| --- | --- |
| `email_policy.get`, `email_policy.update` | Inspect/configure branding, scope, and managed footer |
| `contact.preferences.get` | Read current scope, eligibility, and evidence |
| `contact.unsubscribe` | Record a customer/support opt-out request with a stable event ID |
| `contact.resubscribe` | Record new consent evidence with explicit scope |
| `subscription_event.list` | Inspect/export preference changes for product synchronization |
| `email_topic.define`, `email_topic.list` | Define stable subscription topics in the later topic release |

Use the existing operation registry for HTTP, CLI, and MCP. Add SDK helpers over the same contracts. Preference reads require workspace access, opt-out writes require an appropriate scoped permission, and opt-in/policy changes require stricter policy authority. Each write validates scope and evidence and preserves retry idempotency.

Start synchronization with inspectable events and stable event IDs. Add signed outbound webhooks later with an outbox, retries, and duplicate handling. An outbound delivery failure must never undo a local opt-out.

## Gaps identified in the proposal

The PRD specified unsubscribe before the first implementation. These were the gaps that shaped the first release:

- `packages/contracts/src/index.ts` defaults purpose and topic to `transactional`. The proposed publication policy requires explicit classification and a documented migration for existing versions.
- `apps/server/src/db/schema.ts` has suppression rows with a topic, but no separate consent evidence or marketing preference model.
- `apps/server/src/temporal/activities.ts` checks any active address suppression without matching purpose/topic. The check and dispatch-state update are separate operations, so there is no serialized preference/dispatch gate.
- `apps/server/src/domain/service.ts` starts enrollments without checking marketing consent or preference eligibility.
- `apps/server/src/domain/render.tsx` has no reserved unsubscribe context or managed footer.
- `apps/server/src/providers/email-provider.ts` has no custom-header field in its frozen message contract.
- `apps/server/src/temporal/workflows.ts` has no dedicated unsubscribe outcome or interruptible unsubscribe exits for every wait.
- `apps/server/src/app.ts` records provider suppression facts, but provides no recipient unsubscribe route.

Do not infer that existing workflows labeled transactional are correctly classified. Before enabling this feature, review active/published email workflows and require explicit approval of purpose. Preserve immutable histories and add replay-safe workflow versioning. Migrate existing suppression rows conservatively to delivery blocks unless their source proves a narrower marketing scope; retain original evidence.

## Delivery plan

1. **Policy foundation:** consent evidence, independent blocks, address locks, audited mutation service, shared read/write operations, explicit purpose validation, and migration plan. Route provider blocks through the same locking policy.
2. **Complete first release:** global marketing opt-out, managed footer, frozen headers/token, public page and one-click POST, enrollment eligibility, final dispatch gate, outbox signals, and clear blocked/unsubscribed outcomes. Release these together so links cannot promise protection that dispatch does not enforce.
3. **Topic release:** named topics, topic-scoped links plus all-marketing choice, custom footer support, and preference history/export. Add a full preference center only when customers need several subscriptions.
4. **Integrations:** signed change webhooks, richer reporting, verified resubscription flows, and optional pause/frequency preferences. Avoid delaying basic unsubscribe for these features.

The first release succeeds when a customer can send a marketing journey with an automatically supplied link, unsubscribe from that message, and see all later marketing attempts blocked across existing and new journeys while eligible service messages still work.

## Acceptance checks

- Opening, previewing, or scanning a GET link leaves preferences unchanged. Browser POST works without JavaScript; mailbox POST needs no login, cookie, redirect, or confirmation.
- Repeated opt-out requests have one logical effect. Forged tokens and cross-workspace requests cannot change another recipient's state.
- Global opt-out blocks every marketing topic; topic opt-out blocks matching journeys only. Delivery blocks remain independent of opt-in changes.
- Consent is required at marketing enrollment and current policy is rechecked at dispatch. Concurrent unsubscribe/send tests prove the admission boundary.
- Signals stop all affected waits/runs. A delayed or failed signal cannot allow a later provider admission.
- Retries preserve token, rendered payload, headers, and idempotency key. Accepted and ambiguous prior attempts retain truthful outcomes after opt-out.
- Import/upsert/re-enrollment cannot clear preferences. New consent does not revive old runs; delivery blocks still win.
- HTML and plain text contain usable unsubscribe links. Delivered staging mail contains both headers with valid DKIM coverage. Test the body flow and mailbox POST; mailbox UI display is controlled by the mailbox provider.
- Existing Temporal histories replay safely, migrations preserve evidence, and contact erasure retains applicable suppression tombstones.
- Run `make check`, relevant database integration tests, workflow replay checks, and live staging delivery checks before enabling real marketing traffic.
