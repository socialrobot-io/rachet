---
name: reflow
description: Author and operate durable Rachet workflows through MCP or CLI from natural-language intent, including React Email templates, validation, simulation, publishing, enrollment, authentication, events, and recovery.
---

# Rachet

Prefer the authenticated MCP endpoint. Use CLI for the same operations or trusted host setup. Discover this skill via SEP-2640 `skills/list` / `skills/get` (`skill://reflow/SKILL.md`) when the host supports it, then read its resources. Also call `system_capabilities` (includes `agentCookbook`), read `rachet://workflow/actions` and `rachet://workflow/schema`, and use the `design-workflow` MCP prompt when starting from natural language. Never invent actions absent from the installed catalog.

## Fast path (do this first)

1. `auth_whoami` + `workspace_list` + `system_capabilities` (read `agentCookbook`).
2. `template_list` + `workflow_list` in the target workspace. Reuse existing templates/workflows before creating new ones.
3. Skim repo examples before inventing a graph:
   - `examples/welcome-nudge/` (React Email templates + push flow, minimal welcome + wait)
   - `examples/onboarding.workflow.json` (multi-step graph with email.send and contact.update)
4. Publish email templates through the React Email path when possible (see **React Email vs MCP** below). Never silently invent hand-written HTML when React Email is expected or available.
5. Validate → simulate **two** traces (no events + with representative activation event data) → `workflow_create`. Publish/enroll only when the user authorized side effects.

## React Email vs MCP

MCP never executes TSX. The server only stores HTML + plain text and interpolates `{{…}}` at send time. Local React Email render happens only through CLI `reflow template push ... --allow-code-execution` (upserts by `--name`). TSX runs with the local user's permissions; never opt in for untrusted source. Do not create `… v2` name duplicates.

**Detect** React Email readiness before creating a template: CLI authenticated, `react-email` (and preview deps if needed) resolvable in the project that owns the `.tsx`, and a reviewed local template file (or `reflow template init` sample) ready to push. Missing any of these means React Email is not set up.

**If not set up or not detected**, stop and ask the user to set it up. Recommend it with these benefits:
- Renders to HTML and plain text suited for common email clients
- Local preview (`reflow template preview`) before anything is published
- Component layout instead of hand-maintained table HTML
- Same publish path production uses (`template push` → immutable version pin)

Point them at `reflow template init`, install the missing React Email packages the CLI prints, `reflow auth login` if needed, then `reflow template push … --allow-code-execution`.

**If they still decline**, warn once that MCP will upload hand-written HTML that may not be email-client compliant (broken layout in Outlook/Gmail, weak multipart plain text, fragile CSS). Only then use `template_create` / `template_revise` with `sourceKind=html`, and state in the reply that the template is not React Email.

Translate the user's intent into explicit triggers, actions, delays, event waits, branches, timeouts, and end states. Define each versioned event type with `event_type_define` and a JSON Schema before a graph refers to it. Call `workflow_validate` and `workflow_simulate` with representative contact, variables, and schema-valid event data. Use `{ "eventType": "product.activated.v1", "data": { ... } }` when a graph reads an event payload. Read a dotted event name with `event["product.activated.v1"].data.field`. Show the trace and repair errors before `workflow_create`. Simulation does not wait or run side effects.

When a user mentions a clock time, date, or local calendar schedule without a timezone, ask which IANA timezone they mean and offer "your own timezone" as the default choice. Do not infer timezone from the host, locale, contact, or workspace. A scheduled trigger requires both an ISO 8601 datetime with an explicit `Z` or `±HH:MM` offset and a matching IANA `timeZone` (for example `2026-07-01T09:00:00+02:00` with `Europe/Amsterdam`). Confirm the offset on that date, including daylight-saving transitions; ask which occurrence the user intends for an ambiguous local time. `delay` and `wait_for_event` durations are elapsed seconds, not local calendar times. Contact `timezone`, when supplied, must be an IANA name.

Publishing creates an immutable workflow version and does not enroll anyone. Enrollment may send email or perform other side effects. Perform it when the user's task already authorizes that effect; otherwise leave a concrete validated draft for review. Keep workflow-version, contact, event, and idempotency IDs stable across retries.

Deletion is permanent. Before `workflow_delete`, identify the exact workflow and ask the user to confirm that its published versions and completed enrollment history will be removed. Call it only with `dangerouslyDeleteWorkflow: true`. It fails while any enrollment is in progress; cancel or wait for those enrollments first. Before `enrollment_delete`, ask the user to confirm the exact enrollment. It terminates an active Temporal execution and removes its event, send, and queued-job records; it cannot recall an email already accepted by the provider.

Use Rachet's delivery action rather than direct Resend calls so the durable send ledger, suppressions, and Temporal lifecycle remain effective. Verified Resend webhooks update message state. An unknown send outcome after provider deduplication expires needs operator attention because an automatic replacement could duplicate email.

Human login uses the dashboard. For interactive CLI use, run `reflow auth login` to complete OAuth Authorization Code + PKCE, select a workspace, then use plain `reflow`; the saved active workspace scopes later CLI operations. Use `reflow workspace use` to switch. Machine callers use scoped OAuth client credentials or a user-bound API key. Initial administrator creation is a trusted deployment-host operation. Later account creation requires deployment-administrator permission; self-registration works only when `ALLOW_REGISTRATION=true`.

Read [workflows](references/workflows.md) for concrete authoring and recovery paths. Read [concepts](references/concepts.md) for the canonical vocabulary, the enrollment and message state machines, and what the operations console shows.
