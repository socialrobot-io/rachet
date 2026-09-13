# Reflow product requirements

Status: draft for implementation · Date: 2026-09-13 · Product: Social Robot email sequences

## 1. Product outcome

An agent can turn a brief into reusable React Email templates and an executable email sequence, validate it, enroll recipients, and manage its complete lifecycle through MCP. A human or automation can perform the same operations through CLI. Temporal preserves execution across restarts, deploys, long waits, and recoverable failures. Resend delivers email and reports events through verified webhooks.

The core product is sequence authoring **and execution**. A template gallery or email sender alone does not solve the problem.

### Decisions established by this brief

- TypeScript backend with Hono and Better Auth.
- Temporal for durable workflows; React Email for email templates.
- MCP is the primary interface; CLI has complete functional parity.
- Resend is the first delivery provider; provider-specific behavior stays behind an adapter.
- Docker Compose deployment. No product dashboard, editor, or other operator UI.
- This phase delivers the PRD and architecture in a local Git repository.
- Configured OAuth login and client-ID/client-secret machine access are v1 requirements.
- Initial setup creates an administrator. Administrators can create accounts; self-registration is disabled unless `ALLOW_REGISTRATION=true`, and then works through CLI and MCP.
- Ship agent interaction skills, maintained documentation, and executable repository sanity checks.

### Proposed defaults

These are design assumptions, not facts supplied by the product owner:

- One deployment can host multiple isolated workspaces. Initially Social Robot may use only one.
- Existing agents generate copy and TSX. Reflow supplies schemas, reusable assets, validation, rendering, and execution; it does not require its own LLM subscription or model orchestration.
- V1 sends permission-based lifecycle and marketing email. Contact discovery, scraping, and mailbox warmup are outside scope.
- Production v1 supports a single host with backups and documented recovery. Multi-host high availability is a later topology.
- Human OAuth uses a configured external identity provider; service clients authenticate without a browser using scoped client credentials. No Reflow account-management UI is required.
- Default marketing topic is `marketing`; transactional purpose requires an explicit classification and policy.

## 2. Users and success measures

| User | Job |
|---|---|
| Social Robot agent | Discover schemas, adapt a sequence recipe, generate templates/copy, validate, publish, enroll, and report outcomes |
| Operator | Configure credentials/domains, control sending, inspect failures, replay safe work, and recover infrastructure |
| Application integration | Upsert contacts and emit events such as signup, activation, purchase, or cancellation |
| Workspace administrator | Manage access, sending policies, suppressions, retention, and audit records |

Release success means a new workspace can complete the documented onboarding sequence using only CLI or MCP, after infrastructure and DNS prerequisites are available. A reference agent must independently discover and perform the same flow using MCP tool schemas and resources.

Proposed acceptance targets, measured on a published reference deployment rather than claimed in advance:

- 100% of product operations available in both interfaces, with shared validation and authorization.
- Zero duplicate sends in the defined crash/retry acceptance suite. No claim of universally exactly-once email delivery.
- No acknowledged webhook lost in worker/Temporal restart tests.
- 10,000 simultaneously waiting enrollments and 50,000 contacts on an initial 8-vCPU/16-GB SSD host; benchmark to confirm or revise before launch.
- At configured provider capacity, 95% of eligible sends dispatched within 60 seconds of their due time, excluding documented outages and provider throttling.
- At the benchmark load, command admission p95 under 500 ms and durable webhook acknowledgment p95 under 250 ms, excluding large uploads. Long jobs return operation IDs.
- Single-host target availability 99.5% monthly; target recovery point at most 15 minutes and recovery time at most 4 hours, validated by restore drills. These are engineering targets, not a contractual SLA.

## 3. Scope and sequencing

| Area | V1 release requirement | Later |
|---|---|---|
| Authoring | Templates, sequence recipes, immutable versions, props schemas, previews, validation, simulation, export/import | In-product LLM generation; collaborative editing |
| Execution | Send, wait, event wait, branch, end; per-contact enrollments; schedules; pause/resume/cancel | Arbitrary loops, parallel graphs, cross-channel orchestration |
| Audience | Contact upsert/import, tags, static snapshots, filtered selection, dedupe, consent, suppressions | Continuous segment membership and native CRM connectors |
| Delivery | Resend, sender/domain status, caps, test send, event ingestion, reply correlation | Other production providers, cross-provider routing, attachments |
| Agents | MCP stdio bridge, authenticated Streamable HTTP, configured OAuth, CLI JSON, scoped client credentials, packaged Reflow skills | Additional client compatibility as protocols evolve |
| Operations | Audit, status, recovery, exports, alerts/metrics, tested Compose deployment | Multi-host HA and managed provisioning |

## 4. Workflow catalog

| ID | Workflow | Required behavior | Phase |
|---|---|---|---|
| W01 | Bootstrap workspace | Initial setup creates administrator and workspace atomically; later restarts never recreate/reset the account | V1 |
| W02 | Connect Resend | Register secret reference, check credentials, configure sender/domain, register webhook, inspect health | V1 |
| W03 | Author email template | Agent uploads TSX, props JSON Schema, fixtures, metadata; build/render/validate; publish immutable version | V1 |
| W04 | Reuse sequence recipe | Clone a recipe with timings, copy defaults, template references, and parameter schema into a draft | V1 |
| W05 | Launch onboarding drip | Enroll on signup; send welcome; wait; branch on activation; complete or send follow-up | V1 |
| W06 | Scheduled campaign | Snapshot a filtered audience and start at an absolute time; each recipient follows local sending windows | V1 |
| W07 | Event-relative lifecycle | External event triggers enrollment with event data; dedupe repeated events and enforce re-entry policy | V1 |
| W08 | Stop on conversion | Purchase/activation event exits matching enrollment before later sends | V1 |
| W09 | Follow-up until reply | Wait for correlated inbound reply or timeout; stop on reply, otherwise follow up | V1 with receiving configured |
| W10 | Suppression | Unsubscribe, complaint, hard bounce, or administrator action blocks future applicable sends across sequences | V1 |
| W11 | Timezone delivery | Business-day windows, absolute deadlines, DST behavior, and explicit missing-timezone fallback | V1 |
| W12 | Human/agent control | Pause/resume one recipient or whole sequence; cancel; inspect effective and pending state | V1 |
| W13 | Recover provider outage | Backoff within safe retry window; throttle; park ambiguous sends; inspect/reconcile without blind resend | V1 |
| W14 | Change live sequence | Publish new version for new enrollments; existing enrollments keep old versions | V1 |
| W15 | Bulk audience import | CSV/JSON upload, dry run, row errors, resumable chunk processing, stable deduplication | V1 |
| W16 | Audit and export | Explain each send/skip/stop, export timeline and aggregate outcome counts by sequence version | V1 |
| W17 | Recurring campaign | Scheduled audience snapshots, overlap rules, occurrence dedupe | Later; one-off schedule in V1 |
| W18 | Experiments | Stable recipient variant allocation and per-variant metrics | Later |
| W19 | Dynamic audience | Enter/exit when segment membership changes | Later; explicit event triggers in V1 |
| W20 | Provider migration | New sends/enrollments use another configured adapter after capability validation | Later |
| W21 | Data lifecycle | Export contact data, cancel active work before erasure, apply retention and suppression tombstones | V1 |
| W22 | Admin provisioning | Administrator creates/disables accounts and grants roles through CLI or MCP | V1 |
| W23 | Optional registration | CLI/MCP registration succeeds only when server-side `ALLOW_REGISTRATION=true`; account starts without administrative rights | V1 |
| W24 | Configured OAuth | Start login from CLI/MCP, authenticate with the configured provider, complete the bound login challenge | V1 |
| W25 | Service-triggered flows | Client ID/secret obtains a scoped access token; emit an event or enroll with stable caller idempotency | V1 |

## 5. Authoring and templates

**FR-T01 — Two reusable assets.** An email template is a React Email component plus props schema, fixtures, subject/preheader metadata, locale, and brand metadata. A sequence recipe is a reusable graph with template references and parameter defaults. Agents can clone either independently.

**FR-T02 — Versioning.** Drafts are editable using optimistic concurrency. Publishing creates an immutable numbered version with content hash and build artifact digest. Published templates and sequences cannot be edited or hard-deleted while referenced. Archive hides an asset from new use. Cloning creates a new draft.

**FR-T03 — Agent authoring.** MCP accepts source files through a bounded upload operation, so a remote agent does not need access to the server filesystem. CLI accepts a file/directory and uses the same upload contract. Allowed imports, supported React Email version, upload limits, props schema dialect, and validation results are discoverable.

**FR-T04 — Render contract.** Produce HTML, plain text, subject, and preheader. Reject missing required props, invalid addresses, header injection, unsupported imports, invalid URL schemes, and oversized output. Include a fixture with empty/long values. Previews return artifacts and diagnostic JSON; they never send email. React Email provides rendering utilities for HTML and plain text; the build isolation rules are our design. [Rendering reference](https://react.email/docs/utilities/render).

**FR-T05 — Safe execution.** TSX is executable code. Uploading or rendering must never run it in the Hono or Temporal worker process. V1 uses a separate restricted renderer with no provider/database credentials, no network, read-only runtime, bounded CPU/memory/time/output, and a fixed dependency allowlist. Reject arbitrary npm packages and install scripts. The initial deployment assumes trusted workspace authors; hostile public multi-tenant code execution requires a stronger sandbox before that deployment model is supported.

**FR-T06 — Reproducibility.** Pin template version, renderer image digest, sequence version, enrollment variables, and render-time props snapshot. Store the final message bytes before attempting a send. Retry uses the same bytes, provider, and idempotency key.

**FR-T07 — Starter assets.** Ship welcome, feature education, activation nudge, and closing follow-up templates, plus onboarding and event-follow-up recipes. Copy is generic and editable; no server-side generation step is required.

## 6. Sequence definition and validation

**FR-S01 — Declarative graph.** Use versioned JSON validated against a published JSON Schema. Every step has a stable ID. V1 supports a directed acyclic graph with at most 100 steps, 180 days of execution, and 20 sends per enrollment by default; workspace policy can lower these limits. Expressions are a typed allowlist of comparisons and boolean operators, never JavaScript/eval.

| Step | Semantics |
|---|---|
| `send_email` | Resolve pinned template and props; check policy; persist intent; deliver; proceed on provider acceptance or follow explicit failure policy |
| `wait` | Durable elapsed duration or absolute timestamp; never a process sleep |
| `wait_for_event` | Observe a correlated event after enrollment start or an explicitly declared step-entry watermark; timeout is mandatory and chooses another edge |
| `branch` | Evaluate declared conditions on pinned variables or the durable event projection; missing-value behavior is explicit |
| `end` | Complete with a named reason |

**FR-S02 — Publication checks.** Reject cycles, unreachable nodes, missing targets, missing end paths, unbounded waits, unsupported provider capabilities, unpublished template references, invalid prop mappings, or undefined event correlation. Warn about unavailable engagement tracking. Publishing never enrolls anyone.

**FR-S03 — Scheduling.** Persist UTC instants and an IANA timezone. Durations mean elapsed time; local calendar rules apply to allowed send windows. Missing contact timezone uses the workspace timezone and is visible in simulation. Nonexistent local times move forward to the first valid instant; ambiguous local times choose the earlier occurrence once. Pause freezes relative waits; absolute deadlines retain their timestamps. Resume moves overdue sends into the next permitted window, enforcing spacing and caps rather than releasing all at once.

**FR-S04 — Global exits.** Suppression, explicit cancellation, and configured conversion/reply exits are checked before every send. Events arriving before a wait are retained and eligible according to the declared watermark. An event matching a global exit takes precedence over an ordinary branch. Simultaneous arrival and timeout resolve by serialized workflow processing: an event already persisted by the cutoff is eligible after inbox reconciliation, otherwise timeout wins. Late events remain in the audit trail.

**FR-S05 — Simulation.** A dry run accepts sample contact data, event timeline, timezone, and clock. Return every visited step, rendered preview, eligibility reason, scheduled time, and missing data without creating production enrollments or provider requests.

## 7. Contacts, enrollment, and controls

**FR-C01.** Store workspace-scoped contacts with external ID, email, tags, timezone, typed custom fields, and topic consent evidence (source/time/reference). Normalize domain names and surrounding whitespace; do not collapse Gmail aliases or dots. Define and document a conservative case-insensitive dedupe key while preserving the supplied address. Reject conflicting external-ID/email merges for explicit resolution.

**FR-C02.** Enrollment accepts explicit contact IDs or a persisted audience snapshot. Bulk work returns counts for accepted, duplicate, excluded, and invalid entries with per-item reasons. Pagination and chunk checkpoints allow resumption without duplicate enrollment.

**FR-C03.** Default uniqueness is one enrollment per contact per sequence, across versions. Optional re-entry permits completion plus a configured cooldown; it never overlaps active enrollments unless a separately scoped policy explicitly allows it. Trigger/event ID and enrollment idempotency key are additional dedupe dimensions. Manual re-enrollment creates a new run ID with an audit reason.

**FR-C04.** Enrollment states: `pending_start`, `running`, `waiting`, `paused`, `needs_attention`, `completed`, `cancelled`, `suppressed`, `failed`. Wait reason and current step are separate fields. Command status is separate from workflow state. A pause response states whether it is requested or effective and reports any already dispatching message.

**FR-C05.** Pausing a sequence blocks new enrollments and gates current sends. Resume continues existing enrollments. Archive disables new enrollment but leaves running enrollments intact. Cancel stops selected active enrollments permanently. No operation rewrites sent email.

**FR-C06.** Defaults pin enrollment data. Updating a contact does not silently rewrite existing personalization; an explicit audited refresh affects only unsent steps. Consent/suppression always uses current data. Email changes pause active work until an authorized refresh confirms the new destination.

**FR-C07.** External events require a caller event ID, event type, contact/external identity, occurred-at timestamp, and schema-valid data. Trigger rules map event type to a published sequence and enforce freshness, re-entry, and per-workspace limits. Future or excessively old timestamps are rejected or quarantined according to a documented policy.

## 8. Sending and webhook behavior

**FR-D01.** Resend configuration includes credential reference, allowed senders/domains, reply-to route, webhook secret reference, enabled capabilities, and configurable per-provider/workspace quotas. Check domain readiness at publish/preflight and again before dispatch. Credential rotation must not change a previously attempted send's provider account.

**FR-D02.** Temporal owns scheduling. Send immediately through Resend only when due; do not combine provider-side scheduling with Temporal timers. One recipient per provider send in V1 simplifies isolation, event correlation, unsubscribe, and retries.

**FR-D03.** Persist one send intent per enrollment/step occurrence with stable key and payload hash. API acceptance is distinct from recipient-server delivery. Ambiguous transport outcomes are retried only within the provider's safe idempotency period. Resend currently retains idempotency keys for 24 hours. Older unresolved intents enter `needs_attention`; operators can reconcile, mark abandoned, or explicitly create a replacement send with a duplicate-risk acknowledgment. Temporal retry alone cannot extend the provider guarantee. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

**FR-D04.** Rate limits are shared across workers. Honor provider backoff, reserve capacity before sending, enforce workspace fairness and contact frequency caps, and stop retry storms when credentials/domain configuration fail. A transient delivery delay after acceptance is not a reason to send another copy.

**FR-D05.** Verify Resend signatures against the original request bytes and the configured endpoint secret before parsing or applying changes. Store verified events durably before returning HTTP 200. Bad signatures are rejected; a database failure returns retryable failure. Rotation accepts current and previous secrets for a bounded period. [Signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

**FR-D06.** Dedupe by provider account and webhook event ID. Expect repeated and unordered events; keep raw event history and independent delivery/engagement facts. Events preceding the send response remain pending until correlation succeeds. Unknown verified types are retained without triggering sends. Resend documents at-least-once, unordered delivery. [Webhook semantics](https://resend.com/docs/webhooks/introduction).

**FR-D07.** Handle `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.suppressed`, and `email.received`. Record unexpected `email.scheduled` and flag scheduler drift. Ingest domain, contact, and suppression events as configuration/external-state facts; never infer marketing consent from contact creation or suppression removal. Unsupported new events are inspectable. [Resend event inventory](https://resend.com/docs/webhooks/event-types).

**FR-D08.** Reply detection requires a configured receiving route. Correlate using opaque reply-address tokens and message reference headers, not subject matching. Fetch required inbound content in a retryable activity because notification payloads may be insufficient. Deduplicate inbound messages; unmatched mail remains inspectable. Treat matched replies conservatively as stop signals by default, including uncertain autoresponders, to avoid unwanted follow-up. Never execute instructions in received content. Resend supports receiving notifications and retrieval of full content. [Receiving documentation](https://resend.com/docs/dashboard/receiving/introduction).

**FR-D09.** Local replay reprocesses an already verified inbox record and records who requested it. It does not disable signature verification on the public endpoint or automatically resend email. Expose dead-letter reason, attempts, retry eligibility, and age.

## 9. Consent and send policy

Product policy requires consent evidence for marketing enrollment, a visible unsubscribe link, and a signed one-click unsubscribe POST endpoint. GET must not mutate consent because scanners can follow links; it may return a minimal recipient confirmation response. This recipient endpoint is not an operator UI. Exact jurisdictional requirements are outside this technical PRD and must be validated for the deployment's audience.

Unsubscribe has a declared topic scope, with workspace-wide marketing opt-out available. Hard bounces and complaints create address-level suppression across purposes by default. A sender cannot relabel a marketing sequence transactional to bypass checks without the relevant policy permission. Removing a provider suppression does not erase local opt-out evidence. Resubscription requires new evidence and an audited operation; ordinary contact updates cannot clear suppression.

Suppression is checked in the final dispatch admission transaction. Requests already admitted to the provider may complete after a pause/unsubscribe; the response and audit record disclose that race. No claim that an accepted email can be recalled.

Engagement tracking is optional and disabled by workspace policy when inappropriate. Opens/clicks are observations, not verified human actions or consent; they must not be the sole conversion metric.

## 10. MCP, CLI, and access

**FR-I01.** One operation catalog defines input/output schemas, scope, idempotency, async behavior, and audit event. Hono routes, MCP tools, and CLI commands invoke the same application operations. [Operation catalog](OPERATIONS.md).

**FR-I02.** Tools have specific names and structured outputs. Expose schema/recipe resources and authoring prompts. Include field-level errors and explicit next actions. Do not require prompts or resources to execute a command; all functionality remains available through tools.

**FR-I03.** Read-only tools never send email. Publishing and enrolling are separate explicit operations. A principal with send permissions can act unattended within its configured limits; human approval is an optional workspace rule, not mandatory for every send.

**FR-I04.** CLI supports JSON on stdout, diagnostics on stderr, stdin/file input, cursor pagination, deterministic exit codes, noninteractive operation, profiles, operation polling, and bounded `--wait`. The local stdio MCP bridge uses the same remote backend; it is not a second execution engine.

**FR-I05.** Better Auth is mounted in Hono. Workspace membership, roles, service principals, and per-operation scopes are enforced server-side for every interface, including asset reads. Workspace IDs in arguments never grant access. [Hono integration](https://better-auth.com/docs/integrations/hono).

**FR-I06.** V1 supports configured OAuth/OIDC human login and OAuth client-credentials authentication for service clients. CLI and MCP expose the same login challenge lifecycle, account management, and registration policy. Organization-owned API keys remain an optional compatibility mechanism. Authentication exchange endpoints are necessarily reachable before login but never expose authenticated product operations. See [authentication specification](AUTHENTICATION.md) for provisioning, policy, identity linking, OAuth flows, and machine-secret handling.

**FR-I07.** Initial setup creates a deployment administrator atomically and only once. Administrators can create other accounts and explicitly assign administrative privileges. Prevent removal/disablement of the last enabled deployment administrator. Workspace administration alone does not confer deployment-wide account creation or registration-policy control.

**FR-I08.** `ALLOW_REGISTRATION` defaults to false. Enforce it on password registration, OAuth first-time identity creation, raw Better Auth routes, CLI, and MCP. When true, CLI/MCP self-registration creates a non-admin account and isolated workspace according to deployment policy; it never joins an existing workspace without an explicit grant. See the auth document for verification and send activation rules.

**FR-I09.** Publish an installable `reflow` agent skill covering authentication, authoring, templates, simulation, launch, monitoring, and recovery. The skill must discover current capabilities, preserve operation IDs/idempotency keys, and use Reflow operations instead of bypassing its send ledger through a provider. Skill instructions must distinguish proposed commands from implemented behavior.

Default roles: viewer, author, sender, operator, administrator. Author can edit/publish assets but cannot enroll live recipients or send tests. Sender can launch within policy. Operator can pause, inspect, replay safe ingestion, and reconcile with a dedicated scope. Administrator manages credentials and policy. Keys cannot grant scopes their creator lacks.

## 11. Production and data requirements

- Compose includes TLS ingress, Hono/MCP, Temporal workers, an outbox dispatcher, restricted renderer, application PostgreSQL, Temporal with separate persistence/visibility databases, migration jobs, and a diagnostics CLI container. No product or Temporal UI is required.
- Pin runtime and image versions; run application processes as non-root with resource limits, health checks, graceful shutdown, and persistent volumes. Credentials are injected from protected secret files; provider secrets are encrypted at rest.
- Only HTTPS ingress is public. Database, Temporal, renderer, and metrics ports stay private. Configure Temporal authentication/authorization and TLS for the deployment; network membership alone is not sufficient for untrusted peers.
- Back up application data, Temporal databases, artifacts, and required encryption-key material off-host. Restores start with dispatch disabled until send intents and workflow history have been reconciled.
- Provide upgrade, rollback, key rotation, provider outage, webhook backlog, ambiguous send, and disaster recovery runbooks.
- Logs/metrics correlate request, operation, workspace, enrollment, workflow, send intent, and provider message IDs without exposing email bodies or credentials. Avoid high-cardinality metric labels.
- Suggested retention: raw webhooks 30 days, rendered messages 30 days after terminal enrollment, operational timelines 90 days, audit 365 days, Temporal closed history 30 days. Published artifacts remain while referenced. Values are configurable and must be reconciled with workspace policy.
- Erasure cancels active runs, removes content and identifying data, and uses a keyed address digest for required suppression tombstones. Minimize personal data in Temporal history; encryption and bounded retention address data that cannot be selectively removed from live history. Backups expire by documented retention, not instantly.

## 12. Release acceptance scenarios

| Test | Pass condition |
|---|---|
| A01: MCP-only onboarding | Agent creates template and sequence, simulates, publishes, enrolls test contacts, observes delivery and completion without hidden CLI steps |
| A02: CLI parity | Same fixtures and credentials produce equivalent results, validation errors, and audit events |
| A03: Restart during wait | Worker and Temporal restart preserve due time and continue once |
| A04: Crash around send | Crashes before request, after provider acceptance, and before ledger commit never create a second provider send within the safe window |
| A05: Ambiguity beyond 24h | Unresolved send parks with a reason; automated replay does not resend |
| A06: Duplicate/unordered hooks | Repeated bounce/open/delivery events produce one effect each and preserve suppression |
| A07: Hook before send commit | Early provider event is correlated later without loss |
| A08: Temporal unavailable | Accepted enrollments and webhooks persist in outbox/inbox and start/process after recovery |
| A09: Exit race | Conversion, unsubscribe, pause, and timer races follow dispatch admission semantics; in-flight sends are visible |
| A10: Tenant isolation | Cross-workspace reads, updates, asset references, and workflow signals are denied |
| A11: Template isolation | Infinite render, forbidden import, network attempt, path traversal, and oversize output fail within limits without secret access |
| A12: Immutable deployment | Publish v2 and deploy compatible workers; existing v1 enrollments render identical pinned content |
| A13: Clock cases | DST gap/fold, missing timezone, pause across deadline, and prolonged outage honor documented scheduling rules |
| A14: Bulk retries | Repeated import/enrollment chunks neither duplicate contacts nor runs; per-row failures are inspectable |
| A15: Throttling | Multiple workers share quotas, honor retry guidance, and avoid starving a workspace |
| A16: Restore | Restore backup on a clean host; reconcile external sends before enabling dispatch; meet measured RPO/RTO |
| A17: Headless auth | Bootstrap, key rotation/revocation, stdio and supported HTTP MCP client connections work without a product UI |
| A18: Replay-safe upgrades | Historical workflow fixtures replay under the candidate deployment; incompatible changes are blocked |
| A19: Reply stop | Correlated inbound reply halts later sends; unrelated or duplicated inbound events do not alter another run |
| A20: Setup/admin lifecycle | Concurrent/repeated setup creates exactly one initial admin; administrator can provision accounts via both interfaces; last-admin removal fails |
| A21: Registration policy | Disabled signup is rejected across all transports and OAuth auto-provisioning; enabled CLI/MCP signup creates no elevated privileges |
| A22: Configured OAuth | State/PKCE/nonce, redirect, expiry, issuer and account-linking failures are rejected; valid configured-provider login works from CLI and MCP |
| A23: Client secrets | Machine token can trigger only its scoped workspace flows; invalid/rotated/revoked secrets and wrong-audience tokens fail; retries dedupe |
| A24: Repository and skills | A clean checkout runs documented checks; Reflow skill installs and resolves its references; CI runs the same checks; runtime parity tests are required before release |

## 13. Implementation milestones

1. **Foundation and contracts:** TypeScript workspace, shared schemas, Hono/Better Auth, configured OAuth, admin bootstrap, gated registration, scoped client credentials, workspace authorization, database migrations, CLI, MCP, operation IDs, audit, repository checks, and agent skills. Exit: A02/A10/A17/A20–A24 for implemented operations.
2. **Authoring:** Isolated React Email render/build path, immutable assets, recipe cloning, validation, simulation. Exit: fixture renders plus A11/A12 authoring checks.
3. **Durable vertical slice:** Enrollment workflow, timers, outbox, send ledger, Resend adapter, provider retry safeguards. Exit: end-to-end welcome email and A03–A05/A08.
4. **Events and lifecycle:** Verified inbox, suppression, global exits, reply correlation, branches, audience import, controls. Exit: A06/A07/A09/A13/A14/A19.
5. **Production qualification:** Hardened Compose, pinned builds, observability, runbooks, replay/load/fault tests, backup/restore. Exit: all acceptance scenarios and published benchmark evidence.

No calendar estimate is asserted before the authentication and renderer isolation spikes. Release requires passing the complete gate, not merely finishing feature code.

## 14. Decisions to revisit without blocking the draft

- Confirm expected audience size and peak send rate to replace proposed benchmark targets.
- Supply the OAuth provider issuer/client configuration at deployment; configured OAuth support is required, while Better Auth owns Reflow identities and authorization.
- Confirm intended MCP clients for the interoperability test matrix; CLI/stdio and configured OAuth HTTP paths are required.
- Confirm receiving domain availability for native reply-stop; external authenticated reply events work independently.
- Decide whether stronger isolation is required for untrusted third-party template authors before offering hosted multi-tenant access.
- Confirm marketing topics, consent sources, retention, and who can authorize replacement sends after ambiguous outcomes.
