# Shared MCP and CLI operation catalog

This is a proposed contract, not a list of implemented tools. Every listed v1 product operation must be available through both interfaces. Host bootstrap, Compose lifecycle, database recovery, and DNS changes are infrastructure prerequisites; they cannot depend on an already running/authenticated MCP server.

## Conventions

Canonical operation IDs use `resource.action`; MCP names use `reflow_resource_action`; CLI uses `reflow resource action`. For every action in a row, generate a distinct MCP tool with a concrete input/output schema. Avoid a single arbitrary execute tool. Nested resources use underscores for MCP and spaces for CLI.

Common input fields: `workspaceId`, `idempotencyKey` for mutations, `expectedRevision` for mutable updates, and `cursor`/`limit` for lists. The server derives principal identity from credentials. Read operations do not require idempotency keys. Default page size 50, maximum 200. Returned cursors are opaque.

| Resource | Actions in v1 | Scope / important semantics |
|---|---|---|
| `auth` | `whoami`, `providers`, `login_start`, `login_complete`, `login_status`, `login_password`, `logout`, `register`, `verify_email`, `password_reset_start`, `password_reset_complete`, `authorization_approve`, `authorization_deny` | Login/registration challenge operations are available before authentication with rate limits; authorization decisions require the authenticated subject |
| `account` | `create`, `get`, `list`, `update`, `disable`, `enable`, `set_role`, `revoke_sessions`, `link_identity` | Deployment admin for provisioning/roles; self-profile reads/updates allowed by explicit field policy; protect last admin |
| `registration_policy` | `get`, `update` | Public get exposes effective enabled flag only; deployment admin changes default-false policy |
| `workspace` | `create`, `get`, `list`, `update`, `suspend`, `resume` | Admin except permitted reads; creating another workspace requires deployment permission |
| `member` | `add`, `list`, `update`, `remove` | Admin; no implicit invitation email |
| `credential` | `create`, `list`, `revoke`, `rotate` | Admin; credential emitted once; cannot grant greater permissions |
| `oauth_client` | `create`, `list`, `update`, `rotate_secret`, `revoke` | Admin; workspace-bound machine clients and explicit scopes; show secret once |
| `oauth_provider` | `create`, `get`, `list`, `update`, `validate`, `disable`, `rotate_secret` | Deployment admin; configured external OAuth/OIDC login and protected secret references |
| `policy` | `get`, `update` | Policy admin for changes; caps, purposes, topics, retention |
| `provider` | `create`, `get`, `list`, `update`, `validate`, `disable`, `capabilities`, `rotate_secret` | Integration admin; return references/health, never stored secret values |
| `sender` | `create`, `get`, `list`, `update`, `verify`, `disable` | Integration admin; verification returns status and DNS instructions, does not change DNS |
| `webhook` | `register`, `get`, `list`, `update`, `disable`, `rotate_secret` | Integration admin; account-scoped provider webhook administration |
| `artifact` | `upload`, `get`, `list`, `delete` | Author for unreferenced source assets; protected bounded content, no server filesystem paths |
| `template` | `create`, `get`, `list`, `update`, `clone`, `validate`, `render`, `publish`, `archive`, `export`, `import` | Author except reads; render returns HTML/text artifacts; versions immutable |
| `template_version` | `get`, `list` | Read published version, hash, props schema and renderer metadata |
| `recipe` | `create`, `get`, `list`, `update`, `clone`, `validate`, `publish`, `archive`, `export`, `import` | Author; reusable sequence defaults; clone can create a sequence draft |
| `sequence` | `create`, `get`, `list`, `update`, `clone`, `validate`, `simulate`, `publish`, `archive`, `export`, `import` | Author; publication does not launch |
| `sequence_version` | `get`, `list` | Read immutable graph and references |
| `sequence_control` | `pause`, `resume`, `cancel` | Operator; cancel active runs is asynchronous with counts and operation ID |
| `contact` | `upsert`, `get`, `list`, `update`, `import`, `export`, `erase` | Audience write/read or dedicated erasure permission; import supports dry run |
| `consent` | `record`, `get`, `list`, `withdraw` | Audience/policy scope; evidence required |
| `suppression` | `add`, `get`, `list`, `remove` | Operator; removal requires evidence/reason and does not silently grant consent |
| `audience` | `preview`, `snapshot`, `get`, `list`, `export` | Audience scope; immutable membership cutoff |
| `trigger` | `create`, `get`, `list`, `update`, `enable`, `disable` | Sender for activation; maps schema-valid event to published sequence |
| `enrollment` | `create`, `bulk_create`, `get`, `list`, `timeline`, `pause`, `resume`, `cancel`, `refresh_data` | Send scope to create; operator for control; never edits already prepared/sent bytes |
| `event` | `emit`, `get`, `list` | Event-write scope, caller event ID; source of authenticated app events |
| `message` | `get`, `list`, `preview`, `test_send`, `reconcile`, `replace`, `abandon` | Read or dedicated send/recovery scope; replacement explicitly acknowledges duplicate risk |
| `webhook_event` | `get`, `list`, `replay` | Operator; replay stored verified record only |
| `operation` | `get`, `list`, `cancel` | Actor's permitted jobs; cancel only cancellable work, return partial results |
| `report` | `sequence`, `workspace`, `export` | Analytics read; counts, denominators, time range, version, freshness |
| `audit` | `get`, `list`, `export` | Audit read; redacted event details |
| `system` | `health`, `doctor`, `capabilities` | Health/read or operator for detailed diagnostics; excludes secrets |

Archive replaces hard-delete for published/reference-bearing assets. Mutable unreferenced drafts can be discarded by a documented archive retention policy. All product-side recovery is accessible in both interfaces, but raw database restore and Temporal schema maintenance remain privileged host operations.

CLI convenience commands `reflow auth login --provider <id>` and `reflow auth login --client-id <id> --client-secret-file <path>` orchestrate the underlying login challenge or OAuth token exchange. The MCP stdio bridge can acquire machine tokens from protected configuration before connecting. Token exchange and standard HTTP MCP authorization run at transport-level OAuth endpoints, not as a protected tool that requires the token it is issuing. See [authentication](AUTHENTICATION.md). Bootstrap is `reflow setup` through host CLI; after setup every account/flow operation has both interfaces. `reflow skill export` / `reflow_skill_export` must expose the matching installed-server skill package at release.

## Results and errors

```json
{
  "operationId": "op_example",
  "status": "accepted",
  "data": { "enrollmentId": "enr_example", "state": "pending_start" },
  "warnings": [],
  "meta": { "requestId": "req_example", "revision": 1 }
}
```

Operation status is `accepted`, `running`, `succeeded`, `partially_succeeded`, `failed`, or `cancelled`. Individual domain objects retain their own state. Retrying a mutation with its original key returns the same operation/result. Async disconnect never cancels the admitted job.

Errors expose `code`, `message`, optional field errors, `retryable`, optional `retryAfterMs`, and `requestId`. Stable codes include `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `SUPPRESSED`, `CAPABILITY_UNSUPPORTED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `SEND_OUTCOME_UNKNOWN`. Map these consistently to HTTP status, MCP tool error with structured details, and CLI exit status.

Proposed CLI exits: 0 success/admitted async operation; 2 invalid input; 3 authentication/authorization; 4 not found; 5 conflict/policy rejection; 6 temporary dependency failure; 7 failed async operation observed with `--wait`; 8 bounded wait timed out while operation continues. No interactive prompt in JSON/noninteractive mode.

## Agent discovery

MCP resources expose `reflow://schemas/sequence`, template prop schemas, operation catalog, capabilities, and recipe metadata, scoped to the current principal. Authoring prompts can explain creating a sequence from a brief and diagnosing a failed enrollment, but contain no hidden privileged behavior.

Tool descriptions state side effects, preconditions, required scopes, and whether they can send email. Set appropriate read-only/destructive/idempotent annotations; those annotations are metadata, not authorization. Upload/download uses bounded inline content or scoped artifact handles, never an arbitrary local path from a remote caller. Restrict returned inbound email and template content as untrusted data in agent guidance.

## Illustrative CLI journey

These commands describe the intended interface; they cannot run until implementation. IDs below are illustrative, and credentials are supplied from protected environment/configuration.

```sh
reflow auth whoami --json
reflow provider capabilities --id provider_resend --json
reflow template import --file ./welcome.template.json --idempotency-key template-import-1 --json
reflow template validate --id tpl_welcome --json
reflow template publish --id tpl_welcome --expected-revision 1 --idempotency-key template-publish-1 --json
reflow sequence import --file ./examples/onboarding.sequence.json --idempotency-key sequence-import-1 --json
reflow sequence simulate --id seq_onboarding --fixture ./contact-events.json --json
reflow sequence publish --id seq_onboarding --expected-revision 1 --idempotency-key sequence-publish-1 --json
reflow enrollment create --sequence-version seqv_onboarding_1 --contact contact_test --idempotency-key enroll-test-1 --json
reflow enrollment timeline --id enr_example --json
```

The equivalent MCP enrollment tool is `reflow_enrollment_create` with schema-valid `sequenceVersionId`, `contactId`, `workspaceId`, and `idempotencyKey`. Ordinary enrollment is live sending authority, so a preview-only agent should not have its required scope.

## Report definitions

Report submission accepted, delivered, hard bounced, complained, suppressed, observed opens/clicks, replies, converted, completed, and stopped separately. Delivery rate uses accepted distinct messages as its denominator and identifies missing/pending telemetry. Enrollment conversion rate uses distinct enrolled runs within a declared cohort/window. Do not sum repeated opens as distinct people or equate sequence completion with conversion. Include last event processing time and outstanding inbox counts so an agent can explain delayed data.
