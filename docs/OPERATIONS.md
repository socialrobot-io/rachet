# Operations and MCP contract

Every product operation is defined once in `apps/server/src/operations.ts` and exposed as an HTTP operation, an MCP tool with dots converted to underscores, and the generic `rachet call` CLI command. Authentication protocol endpoints are intentionally not exposed through a generic CLI proxy.

## Implemented operation catalog

| Operation | Effect |
| --- | --- |
| `system.capabilities`, `auth.whoami`, `workspace.list` | Discover runtime, actions, current access, and available workspaces |
| `account.create` | Deployment administrator authorizes a passwordless registration invitation |
| `credential.create`, `credential.list`, `credential.revoke` | Create, inspect, or revoke an organization-bound SDK key. The secret is returned once; creation is HTTP/CLI only and excluded from MCP/model-visible catalogs. |
| `template.create`, `template.list`, `template.revise`, `template.publish`, `template.archive`, `template.render` | Manage HTML (preferred) or plain templates. CLI `rachet template push --allow-code-execution` renders reviewed local React Email code and **upserts by `--name`** (revise + publish). The server never executes TSX; it only interpolates `{{…}}` placeholders. |
| `workflow.actions` | List the installed action registry |
| `workflow.create`, `workflow.revise`, `workflow.list`, `workflow.validate`, `workflow.simulate`, `workflow.publish`, `workflow.delete` | Author, revise, check, trace, persist, version, and permanently delete capability graphs. `workflow.delete` requires `dangerouslyDeleteWorkflow: true` and rejects workflows with active enrollments. |
| `contact.upsert`, `contact.list` | Manage enrolled contacts |
| `email_policy.get`, `email_policy.update` | Inspect or set the recipient-facing sender name and support address |
| `contact.preferences.get`, `contact.unsubscribe`, `contact.resubscribe`, `subscription_event.list` | Inspect eligibility and audited marketing consent or opt-out changes |
| `enrollment.create`, `enrollment.list` | Start and inspect durable executions |
| `enrollment.pause`, `enrollment.resume`, `enrollment.cancel`, `enrollment.delete` | Control or permanently delete one Temporal execution. Deletion terminates an active execution and cannot recall accepted email. |
| `event_type.define`, `event_type.list` | Define and inspect immutable, versioned JSON Schema contracts for product events |
| `event.emit` | Durably accept a stable event ID and JSON payload for one enrollment; identical retries are no-ops and transient delivery failures are queued |
| `message.list`, `webhook_event.list` | Inspect send ledger and verified Resend events |
| `account.list` | Deployment administrator lists signed-up accounts, with workflow and enrolled-contact counts for their organizations |

MCP also serves `rachet://operations`, `rachet://workflow/schema`, and `rachet://workflow/actions`, plus the `design-workflow` authoring prompt. It advertises the SEP-2640 Skills extension and serves the first-party skill in the FastMCP resource shape (`skill://rachet/SKILL.md`, `_manifest`, supporting files with `_meta.fastmcp.skill`) so Cursor-style hosts discover it via `resources/list`, plus `skills/list` / `skills/get`. Skills use a temporary `@rachet/mcp-ext-skills` shim until the official typescript-sdk `/ext/skills` exports land; see [agent skills](SKILLS.md). Operations marked non-model-visible (currently one-time credential creation) are omitted from both the MCP tools and operation resource. `system.capabilities` includes an `agentCookbook` checklist (reuse before invent, simulate two paths, enrollment side effects).

## Workflow graph

A workflow has one trigger, an entry node, an explicit `marketing` or `transactional` purpose, topic metadata, and up to 100 nodes. Supported control nodes are `delay`, `wait_for_event`, `branch`, and `end`. An `action` references a namespaced installed capability and maps each input to either literal JSON or a path under `contact`, `variables`, or `event`.

For a scheduled trigger, CLI and MCP both require `at` as ISO 8601 with an explicit offset (or `Z`) and `timeZone` as a matching IANA name: `{"type":"schedule","at":"2026-07-01T09:00:00+02:00","timeZone":"Europe/Amsterdam"}`. A time without an offset, a missing timezone, or an offset that disagrees with the named timezone is rejected. Ask the user which timezone they mean when they give a local time; suggest their own timezone, but do not silently guess. Contact `timezone` values also use IANA names. Delay and event timeout values are elapsed seconds; they are not local calendar schedules.

Graphs reject duplicate IDs, missing targets, cycles, unreachable nodes, unknown actions, missing required action inputs, and event types that the workspace has not defined. `workflow.simulate` follows the graph using sample inputs, checks each event payload against its registered schema, treats delays as immediate, chooses event or timeout routes from `receivedEvents`, resolves action inputs, and never executes side effects.

`email.send` requires a literal published template-version UUID at publication. `contact.update` merges a resolved object into contact fields. Future provider and integration adapters register additional actions through the same catalog and executor boundary.

Marketing publication requires an email policy. Organization owners and admins can set it in **Integrations → Email → Resend** or through `email_policy.update`. Marketing enrollment requires consent evidence. Pass `consent` on `enrollment.create`, or record it first with `contact.resubscribe`. An opt-out blocks all marketing in the workspace and stops affected active runs. `subscription_event.list` records the email and workflow that supplied a link opt-out. Set the purpose in the workflow definition before publication. See [Unsubscribe and consent](UNSUBSCRIBE.md).

To change a workflow, get its `id` and `revision` from `workflow.list`. Call `workflow.revise` with `workspaceId`, `workflowId`, `expectedRevision`, and the complete replacement `definition`. Pass `intent` only when it changes. The response keeps the workflow id and increments its revision. Use the new revision in `workflow.publish` to create an immutable version. Existing enrollments stay pinned to their original workflow version.

`workflow.list` returns `publishedVersions` with each version's `id`, `sequenceId`, `version`, `definition`, and `createdAt`. Each `definition` is the immutable published graph. The workflow's top-level `definition` is its current draft. `enrollment.list` returns the pinned version number in `workflowVersion` and its ID in `sequenceVersionId`.

In the dashboard, workflow cards count published versions. The **Version** selector opens the latest published version by default, or the draft if no version exists. Select an older version to see its graph and active enrollments. Step counts include only that version. Select **Draft** to review unpublished changes; drafts have no enrollments. Enrollment rows and detail pages show `v1`, `v2`, and later version numbers. Their workflow links open the pinned version. In **Enrollments**, select a workflow to filter by version. Long IDs are under **IDs for API and support**.

The dashboard workflow and enrollment pages show a copyable workflow ID. On an active enrollment, Pause prevents the next action from starting; a delay timer still runs while paused. Resume allows execution to continue. Cancel wakes a waiting execution and marks it cancelled. An email already accepted by the provider cannot be recalled.

## CLI examples

```sh
rachet template init
rachet template preview
rachet template push emails/welcome.tsx --name Welcome --subject "Welcome, {{contact.firstName}}" --allow-code-execution
rachet template list
```

Preview needs `react-email` and `@react-email/ui` installed in the project that owns `emails/` (React Email 6). The init/preview commands print an install hint when either is missing.

```sh
rachet call workflow.actions
rachet call workflow.validate --file ./workflow-validation.json
rachet call workflow.simulate --file ./workflow-simulation.json
rachet call workflow.create --file ./workflow-create.json
rachet call enrollment.create --file ./enrollment.json
```

Send a product event with `rachet call event.emit --input '{...}'` or `--file activation-event.json`. The complete CLI, HTTP, and MCP examples are in [Sending product events](EVENTS.md).

`rachet tui --workspace UUID` provides an interactive workflow browser backed by `workflow.list`. Its workflow pane generates an SVG from the Mermaid definition and displays it through Kitty, iTerm2, or Sixel terminal graphics. It never substitutes character art. Press `o` to open the exact SVG when the terminal cannot display inline images. The equivalent noninteractive command is `rachet workflow show --workspace UUID --id UUID`, with `--format svg|mermaid|json`; SVG is the default. These are presentation clients over the shared operation contract, so they preserve CLI/MCP authorization and do not bypass the service layer.

Set `RACHET_URL` and either `RACHET_TOKEN` or `RACHET_API_KEY`. Human login uses the dashboard's magic-link or GitHub flow. Public registration succeeds only when `ALLOW_REGISTRATION=true`; administrator-created invitations remain explicit. Preserve idempotency and event IDs on retries.

## Planned extensions

The PRD includes workflow cloning, bulk audiences, recurring schedule triggers, workflow-level pause, richer delivery reports, webhook replay, sender/domain administration, provider connections, and action packages for CRMs and HTTP callbacks. Until those operations appear in `system.capabilities`, agents report the capability gap rather than bypassing Rachet through PostgreSQL or Temporal.
