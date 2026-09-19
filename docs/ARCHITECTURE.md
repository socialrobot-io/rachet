# Reflow implementation architecture

Status: runnable baseline plus planned hardening. Product semantics and release gates are defined in [PRD](PRD.md).

## Agent-authored capability graphs

MCP is the primary authoring surface. The server publishes a JSON Schema, installed action catalog, and `design-workflow` prompt. An MCP host agent translates natural-language intent into a finite graph of triggers, actions, delays, event waits, branches, and end states. Validation rejects unknown capabilities and structurally unsafe graphs before persistence. Simulation resolves sample data and traces control flow without side effects.

Temporal runs one versioned, deterministic graph interpreter. Action nodes cross the activity boundary into a registry; `email.send` uses the provider abstraction and durable send ledger, while `contact.update` is a separate installed action. Future email providers, CRMs, HTTP callbacks, and product integrations add registry entries and activity handlers. User-authored graphs never choose arbitrary Temporal workflow names, task queues, modules, or code.

## 1. Structure and module ownership

Use a TypeScript modular monolith with independently runnable worker processes. PostgreSQL is the application record, Temporal owns durable execution, and provider adapters own external protocol differences. Avoid an additional message broker in v1: a transactional outbox and inbox cover cross-system handoff.

```mermaid
flowchart LR
  Agent[Agent MCP client] --> MCP[MCP transport]
  CLI[CLI / stdio bridge] --> HTTP[Hono HTTP]
  MCP --> Ops[Shared application operations]
  HTTP --> Ops
  Auth[Better Auth + workspace policy] --> Ops
  Ops --> PG[(Application PostgreSQL)]
  PG --> Outbox[Outbox dispatcher]
  Outbox --> T[Temporal]
  T --> W[Workflow / activity workers]
  W --> PG
  W --> Interpolate[Interpolate {{placeholders}} in stored HTML]
  W --> Adapter[Provider adapter]
  Adapter --> Resend[Resend]
  Resend --> Hook[Raw-body webhook verification]
  Hook --> PG
  T --> TP[(Temporal persistence / visibility)]
```

| Module | External interface | Hidden implementation |
|---|---|---|
| Identity | Authenticate principal; authorize operation/resource | Better Auth, membership, scopes, revocation, workspace policy |
| Authoring | Draft, validate, publish, clone, render, simulate | Local React Email render (CLI), HTML + plain storage, immutable versions, prop interpolation |
| Audience | Upsert/import, select/snapshot, enroll eligibility | Identity resolution, consent evidence, dedupe, row errors |
| Sequencing | Enroll, control, inspect, deliver event | Workflow graph interpretation, timers, exits, projection updates |
| Delivery | Prepare, dispatch, reconcile send intent | Payload freezing, leases, quota reservations, provider outcomes |
| Events | Ingest verified event, replay stored event, inspect | Inbox dedupe, correlation, durable effects, outbox messages |
| Operations | Inspect job, audit, health, retention/export | Pagination, asynchronous progress, operational recovery |

Delivery has a provider seam because external protocols vary, explicitly required by the brief. Ship a Resend adapter and deterministic fake adapter used by simulation/integration tests. Do not create speculative adapters for every possible infrastructure dependency.

Nx workspace layout:

```text
apps/server/             Hono, Better Auth, HTTP MCP, Temporal worker/dispatcher entrypoints
apps/dashboard/          permanent same-origin React operations and OAuth consent UI
packages/contracts/      shared workflow and operation schemas
packages/cli/            publishable, server-free npm CLI bundle
migrations/              reviewed Better Auth and Reflow PostgreSQL migrations
docker/                  Compose support, TLS, and Temporal configuration
docs/                    architecture, setup, operations, and provider runbooks
```

Use pnpm workspaces, strict TypeScript, supported Node LTS, schema validation shared across transports, and reviewed SQL migrations (proposed Drizzle). Select and pin exact compatible releases during foundation work; this PRD does not fabricate a tested version matrix.

## 2. Records, keys, and ownership

Every application row has a workspace ID except explicitly global infrastructure records. Use composite foreign keys to prevent a sequence from referencing another workspace's asset. Apply repository scoping and PostgreSQL row-level security with transaction-local workspace context; background jobs set the same context. Runtime database roles must not bypass RLS.

| Record | Essential fields and invariants |
|---|---|
| Workspace / membership / service principal | Role, scopes, disabled state, policy revision; use Better Auth identities without duplicating passwords |
| Provider connection | Provider kind, account identity, encrypted credential reference, capabilities, state; never store secrets in workflow input |
| Sender | Connection, from address/domain, verification state, allowed purpose, reply route |
| Contact | External identity, email, dedupe key, typed fields, timezone, revision |
| Consent / suppression | Topic or address scope, reason, evidence, timestamps; removal is an explicit audited event |
| Template / version | Draft revision or immutable version/hash, TSX source, schema, fixture, build digest |
| Recipe / version | Reusable graph and defaults; immutable published versions |
| Sequence / version | Pinned graph, template versions, policy, trigger settings, publication validation |
| Audience snapshot | Selection predicate, cutoff, stable member IDs, exclusion counts |
| Enrollment | Run ID, sequence version, contact, pinned data, state projection, workflow ID, applied control revision |
| Send intent | Unique enrollment/step/occurrence; provider account, frozen message hash/bytes, stable idempotency key, first-attempt time, outcome |
| Provider event | Unique connection/event ID; verified payload, provider message ID, occurrence/receipt time, correlation and processing state |
| Domain event | Caller event ID unique by workspace/source, contact correlation, payload, sequence watermark |
| Outbox | Operation/effect ID, kind, target, payload reference, attempt count, claim lease, completion |
| Operation / audit | Actor, command, idempotency key, result/progress; append-only audit reason and correlation IDs |

Application PostgreSQL owns desired configuration, contacts, send records, inbox/outbox, and queryable projections. Temporal history owns workflow progression and timers. Enrollment projection can lag; responses report its revision/time and optionally a live workflow observation. Do not write two independent authoritative state machines.

Keep source/render artifacts in application PostgreSQL initially with enforced size limits (source bundle 1 MiB, render output 1 MiB proposed defaults). This simplifies atomicity and backup. Large bulk uploads are chunked with a proposed 100 MiB total limit. Object storage can replace artifact internals later without changing authoring operations.

## 3. Command admission and durable handoff

1. Authenticate, authorize workspace/resource, validate input and expected revision.
2. Within one application transaction, reserve the command idempotency key, update desired state, insert audit record and outbox effect, and commit the operation result.
3. Return completed result for local transactions, or `accepted` plus operation ID for external work.
4. Dispatcher claims rows with bounded leases and `SKIP LOCKED`, then starts/signals Temporal using stable IDs.
5. Record acknowledgment only after Temporal accepts the message. Crashes between acknowledgment and database commit cause redelivery, which receivers deduplicate.

Workflow ID is `workspace/<id>/enrollment/<run-id>` with a reject-duplicate reuse policy. Start is separate from signal: a missing run on an event is reconciled against the durable enrollment/start intent; do not accidentally create an enrollment from a webhook. A completed run does not restart on replay.

Command idempotency is keyed by workspace, operation name, and caller key. A reused key with different canonical input is a conflict. Retain command results at least 30 days and document expiration; permanent send/run uniqueness is enforced separately so expiring an HTTP result cannot permit duplicate delivery.

Outbox and workflow inbox dedupe use durable effect IDs. A workflow stores bounded applied-message state; it can read durable event positions through activities and carry its watermark into Continue-As-New. An inbox effect is not complete merely because a signal was queued if its domain projection still needs an idempotent transaction.

## 4. Temporal execution

Use one workflow per enrollment. A bulk enrollment workflow creates records in bounded chunks and finishes; it does not retain thousands of children in one enormous history. A scheduled launch can use a durable workflow timer; recurring schedules are deferred.

The workflow interprets a pinned declarative graph. Workflow code does no database/network I/O, TSX rendering, non-deterministic random calls, or direct wall-clock access. All external work runs in activities. Inputs/history carry IDs and small decisions rather than full email bodies or contact profiles.

- Durable timers implement waits and sending windows.
- Signals carry committed control/event IDs. Queries expose live state. Updates may support validated synchronous control when available, but persisted command/outbox admission remains the public consistency contract. Temporal distinguishes these message mechanisms. [TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing).
- Execute message handlers serially where they change progression. Wait for handlers before Continue-As-New. Check durable exit events immediately before dispatch admission.
- Continue-As-New before history limits, preserving step, pinned versions, pending timer semantics, and event/control watermarks. High-volume open/click events are coalesced into database facts instead of flooding history.
- Define explicit timeouts for every activity. Example starting defaults: provider network timeout 15 seconds, dispatch activity 30 seconds, render 5 seconds, local persistence 10 seconds. Long imports heartbeat and checkpoint. Tune from measured behavior.
- Retry infrastructure failures with capped exponential backoff. Validation/auth failures are nonretryable. Delivery retries are constrained by the send ledger; do not give an activity unlimited provider retries.
- Ordinary workflow cancellation is cooperative. Provider dispatch may already have happened. Never use Temporal reset as a generic resend mechanism.
- Pin compatible worker deployments; replay historical fixtures before release. Keep the old worker build available until its workflows drain or use tested compatibility patches. Graph schema versions and workflow code versions are separate.

## 5. Send transaction and uncertain outcomes

Suggested internal adapter shape, illustrative TypeScript:

```ts
type SendOutcome =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'rejected'; code: string; retryable: boolean; retryAfterMs?: number }
  | { kind: 'unknown'; code: string };

interface EmailProvider {
  capabilities(): ProviderCapabilities;
  send(message: FrozenMessage, context: SendContext): Promise<SendOutcome>;
  getMessage(id: string): Promise<ProviderMessageStatus>;
  verifyWebhook(raw: Uint8Array, headers: Headers, secrets: SecretSet): VerifiedEvent;
  normalizeEvent(event: VerifiedEvent): NormalizedEvent[];
}
```

Connection administration is a separate interface for credential checks, domain inspection, and webhook registration. Capabilities declare idempotency retention, receiving, tracking, webhook management, and lookup support. Unsupported capabilities cause validation errors. Provider account IDs and raw payload details remain available for diagnostics without entering the sequence schema.

Send state: `prepared → dispatching → accepted`, or `retryable`, `rejected`, `unknown`, `abandoned`. Delivery and engagement facts are separate from submission state.

1. Render and freeze bytes. Insert send intent once, before any provider side effect.
2. Atomically check current sequence control, recipient suppression, sender health, and quota; claim the intent with a fencing revision and record its first possible attempt time. This is the dispatch admission point. Policy changes serialize against the same control/recipient locks or revisions.
3. Commit, then call Resend with the same payload and stable key. Never hold a database transaction open across network I/O.
4. Persist acceptance/message ID or a classified error. A crash after the request leaves an uncertain intent that is reconciled before retry.
5. If still within the safe window, retry identical bytes/key on the same account. Use a conservative cutoff (proposed 23 hours from first attempt) so request timeout and clock skew cannot cross Resend's 24-hour retention. Also bound every attempt's end time to that cutoff. [Provider constraint](https://resend.com/docs/dashboard/emails/idempotency-keys).
6. If a message ID is known, query status or apply verified events. Do not assume the provider offers lookup by arbitrary idempotency key. Without sufficient evidence after the cutoff, park the intent for explicit reconciliation.

Lease expiry does not prove the previous request failed. Fencing prevents stale database writes; the provider key handles overlapping external attempts within its window. Never automatically switch provider/account after an ambiguous attempt: providers do not share deduplication state.

Quota reservations use shared PostgreSQL counters/leases at the initial scale. Serialize counters in a defined lock order; count an accepted send once and conservatively retain uncertain reservations until resolved. Workspace fairness and connection limits apply independently. Retried provider requests still consume request-rate capacity even when logically idempotent.

## 6. Event processing and race resolution

The endpoint path identifies the configured connection, but does not authenticate it. Verify raw bytes and timestamp with the adapter, then atomically insert inbox record and processing outbox job. Return 200 for committed records and known duplicates; return failure if persistence is unavailable. Resend verification requires original bytes, and provider events can be duplicated or unordered. [Verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [delivery semantics](https://resend.com/docs/webhooks/introduction).

Processor normalizes the event, correlates connection/message ID, commits its effects, then emits workflow notifications in the same transaction. Unknown message IDs remain pending with bounded retries and an alert threshold. Maintain facts such as accepted-at, delivered-at, bounce-at, first-open-at, and complaint-at; do not let a late delivered event clear a complaint.

Maintain a monotonic per-enrollment event position. Event waits declare a lower watermark and deadline. Before applying a timeout, an activity reconciles committed eligible events through the cutoff; future late arrivals cannot retroactively undo a send. Record why the race resolved as it did. Suppression has an additional database dispatch gate regardless of workflow signal latency.

For inbound replies, fetch content only when necessary in an activity, store it with short retention, and correlate reply tokens/reference headers. External Social Robot `reply.received` events offer an alternative when receiving is hosted elsewhere. Untrusted inbound content is data, never an agent instruction.

Local replay targets persisted verified events, reuses effect IDs, and cannot bypass uniqueness or suppression. Track receipt failure, processing failure, and uncorrelated events separately so operators know what replay can fix.

## 7. Authentication and connected clients

Mount Better Auth's handler on `/api/auth/*` in Hono; apply trusted-origin/CORS handling in the documented order. Sessions support identity administration, while application operations enforce workspace policy. [Official Hono integration](https://better-auth.com/docs/integrations/hono).

Initial setup runs a one-shot host-admin bootstrap that creates the first deployment administrator/workspace in a locked transaction and records completion. Restarts do not reset credentials or create another administrator. Later account provisioning and policy management work through authenticated CLI/MCP operations. No public unauthenticated bootstrap route exists. See [authentication specification](AUTHENTICATION.md) for the complete account lifecycle.

The CLI is a public OAuth client. It registers a loopback callback, uses Authorization Code + PKCE in the dashboard, and keeps short-lived access and refresh credentials in a protected local file. It never copies a browser session cookie or accepts a password. Machine automation can use scoped API keys or confidential OAuth clients. Never require secrets on command-line arguments or put them in MCP prompts. [API key plugin](https://better-auth.com/docs/plugins/api-key).

HTTP MCP is a protected resource. Publish authorization-server and protected-resource metadata, validate issuer/audience/expiry/scopes, and authorize every request. Machine access uses administrator-provisioned client IDs/secrets, explicit workspace scopes, and short-lived OAuth tokens. Clients exchange secrets at the token endpoint; they do not pass a provider secret to flow operations. [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider).

Better Auth can broker a configured external OAuth/OIDC provider and always issues the Reflow-scoped credential; external-provider access tokens are never directly accepted. The permanent same-origin dashboard owns login, explicit client consent, and Connected apps revocation. CLI/MCP operations remain independently complete and do not require an operator to use workflow screens. Standard HTTP MCP authorization uses discovery, PKCE, restricted redirects, and resource-specific tokens. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

`ALLOW_REGISTRATION=false` is enforced for Better Auth signup and first external-OAuth sign-in. Existing provisioned accounts can sign in. When enabled, self-registration creates a non-admin user and a new isolated, sending-disabled workspace; it never joins an existing tenant. Deployment administrators provision other accounts and attach workspace roles explicitly.

Validate HTTP Origin where present, bind local bridge listeners to loopback if any, and use TLS. Never treat an MCP session ID as authentication. STDIO stdout contains protocol messages only. [MCP transport baseline](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Credential revocation blocks new commands immediately on authoritative verification. For machine JWTs, also check application principal/client disabled state; signature validity alone cannot implement immediate revocation. Disabling a credential does not cancel previously authorized workflows by default. An administrator can separately suspend workspace sending.

Provider adapter implementation must check the Resend SDK's returned `{ data, error }` as well as thrown transport failures. Pin matching versions of all Temporal TypeScript SDK packages and prebundle production workflows. Evaluate Temporal task-queue fairness for tenant isolation against the pinned self-hosted server; do not make a preview feature a production dependency without qualification. Existing PostgreSQL admission fairness remains required. These implementation notes follow the installed official skills recorded in [skill setup](SKILLS.md).

## 8. Production Compose design

Compose is the requested deployment unit. Build a hardened single-host topology and explicitly accept that losing the host stops execution until recovery. Container restart policies do not provide host-level HA. Temporal provides production deployment and readiness guidance, which must be applied rather than copying a development server configuration. [Deployment guide](https://docs.temporal.io/self-hosted-guide/deployment), [production checklist](https://docs.temporal.io/self-hosted-guide/production-checklist).

| Process | Production requirement |
|---|---|
| TLS ingress | HTTPS only; request/body limits; proxy timeout compatible with MCP streaming; certificate renewal |
| Server | Auth + HTTP/MCP + hooks; readiness on application DB, explicit degraded Temporal status |
| Dispatcher | Durable claims, retry/backoff, lease recovery, backlog metrics |
| Workers | Graceful drain, compatible workflow build, isolated activity task queues and concurrency |
| Renderer | No egress/secrets/host mounts; drop capabilities; non-root; read-only root; bounded tmpfs; no Docker socket |
| Application PostgreSQL | Durable volume, distinct runtime/migration/backup roles, WAL archive and tested restore |
| Temporal PostgreSQL | Separate credentials/databases for persistence and visibility; durable volume and supported schema upgrades |
| Temporal server | Production server image/config, namespaces/retention, auth and TLS, private ports; no `start-dev` |
| Migration jobs | Explicit one-shot application and Temporal schema jobs, run before compatible deployment |
| Admin CLI | Same image/contracts, operator commands via Compose exec/run; host lifecycle remains external |

For v1 use a dedicated Temporal database instance to prevent application workload from exhausting its connections; both remain on the same host. Size worker concurrency and connection pools to the published reference host. Do not impose a Redis or Elasticsearch dependency unless measured needs require it; verify the selected Temporal release supports the chosen PostgreSQL visibility configuration.

Deployment runbook must cover: DNS/TLS prerequisites; generate secrets; provision volume permissions; initialize databases/schemas; initialize Temporal namespace; start server/workers; bootstrap owner; configure Resend/sender/webhook; run CLI doctor; perform an allowlisted test; enable production sending. These will be real commands in implementation, not pretend runnable snippets in this draft.

Provide separate development and production Compose configuration. Pin images by version/digest, build reproducibly, scan dependencies/images, and ship no default passwords or credential-bearing examples. Secrets in Compose files are host-protected files, not automatically encrypted by Compose.

Back up both stores and artifact data with a recorded recovery epoch. Restore with provider dispatch disabled. Reconcile application send intents against restored Temporal histories and provider facts; backups across systems are not automatically atomic. Treat restored ambiguous sends beyond the provider key window as attention-required. Recover key material separately under restricted access.

Upgrade uses expand/contract schema changes, historical workflow replay tests, worker draining, and documented compatible rollback. Never auto-run uncontrolled schema migrations from every replica on startup. A rollback must preserve support for existing workflow histories and published renderer artifacts.

## 9. Verification strategy

Test through module interfaces: schema/graph validation and policy unit tests; Temporal time-skipping integration tests; real PostgreSQL inbox/outbox uniqueness and RLS tests; fake-provider fault injection; Resend contract tests on an allowlisted test setup; MCP/CLI parity tests; Compose crash/restore and load tests.

Provider contract tests verify classification, raw-body verification, dedupe, receiving correlation, and safe retry cutoff. They must not send to production recipients. CI requires typecheck, lint, meaningful tests, workflow replay, generated-contract drift detection, and image build. Production readiness is established only after the PRD acceptance scenarios have recorded evidence.
