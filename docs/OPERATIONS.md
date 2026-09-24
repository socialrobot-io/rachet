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
| `workflow.create`, `workflow.list`, `workflow.validate`, `workflow.simulate`, `workflow.publish` | Author, check, trace, persist, and version capability graphs |
| `contact.upsert`, `contact.list` | Manage enrolled contacts |
| `enrollment.create`, `enrollment.list` | Start and inspect durable executions |
| `enrollment.pause`, `enrollment.resume`, `enrollment.cancel` | Control one Temporal execution |
| `event_type.define`, `event_type.list` | Define and inspect immutable, versioned JSON Schema contracts for product events |
| `event.emit` | Durably accept a stable event ID and JSON payload for one enrollment; identical retries are no-ops and transient delivery failures are queued |
| `message.list`, `webhook_event.list` | Inspect send ledger and verified Resend events |

MCP also serves `reflow://operations`, `reflow://workflow/schema`, and `reflow://workflow/actions`, plus the `design-workflow` authoring prompt. It advertises the SEP-2640 Skills extension and serves the first-party skill in the FastMCP resource shape (`skill://reflow/SKILL.md`, `_manifest`, supporting files with `_meta.fastmcp.skill`) so Cursor-style hosts discover it via `resources/list`, plus `skills/list` / `skills/get`. Skills use a temporary `@reflow/mcp-ext-skills` shim until the official typescript-sdk `/ext/skills` exports land; see [agent skills](SKILLS.md). Operations marked non-model-visible (currently one-time credential creation) are omitted from both the MCP tools and operation resource. `system.capabilities` includes an `agentCookbook` checklist (reuse before invent, simulate two paths, enrollment side effects).

## Workflow graph

A workflow has one trigger, an entry node, purpose/topic metadata, and up to 100 nodes. Supported control nodes are `delay`, `wait_for_event`, `branch`, and `end`. An `action` references a namespaced installed capability and maps each input to either literal JSON or a path under `contact`, `variables`, or `event`.

For a scheduled trigger, CLI and MCP both require `at` as ISO 8601 with an explicit offset (or `Z`) and `timeZone` as a matching IANA name: `{"type":"schedule","at":"2026-07-01T09:00:00+02:00","timeZone":"Europe/Amsterdam"}`. A time without an offset, a missing timezone, or an offset that disagrees with the named timezone is rejected. Ask the user which timezone they mean when they give a local time; suggest their own timezone, but do not silently guess. Contact `timezone` values also use IANA names. Delay and event timeout values are elapsed seconds; they are not local calendar schedules.

Graphs reject duplicate IDs, missing targets, cycles, unreachable nodes, unknown actions, missing required action inputs, and event types that the workspace has not defined. `workflow.simulate` follows the graph using sample inputs, checks each event payload against its registered schema, treats delays as immediate, chooses event or timeout routes from `receivedEvents`, resolves action inputs, and never executes side effects.

`email.send` requires a literal published template-version UUID at publication. `contact.update` merges a resolved object into contact fields. Future provider and integration adapters register additional actions through the same catalog and executor boundary.

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

Set `REFLOW_URL` and either `REFLOW_TOKEN` or `REFLOW_API_KEY`. Human login uses the dashboard's magic-link or GitHub flow. Public registration succeeds only when `ALLOW_REGISTRATION=true`; administrator-created invitations remain explicit. Preserve idempotency and event IDs on retries.

## Planned extensions

The PRD includes draft updates/cloning, bulk audiences, recurring schedule triggers, workflow-level pause, richer delivery reports, webhook replay, sender/domain administration, provider connections, and action packages for CRMs and HTTP callbacks. Until those operations appear in `system.capabilities`, agents report the capability gap rather than bypassing Rachet through PostgreSQL or Temporal.
