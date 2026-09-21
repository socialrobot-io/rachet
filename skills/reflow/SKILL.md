---
name: reflow
description: Author and operate durable Reflow workflows through MCP or CLI from natural-language intent, including React Email templates, validation, simulation, publishing, enrollment, authentication, events, and recovery.
---

# Reflow

Prefer the authenticated MCP endpoint. Use CLI for the same operations or trusted host setup. Discover this skill via SEP-2640 `skills/list` / `skills/get` (`skill://reflow/SKILL.md`) when the host supports it, then read its resources. Also call `system_capabilities` (includes `agentCookbook`), read `reflow://workflow/actions` and `reflow://workflow/schema`, and use the `design-workflow` MCP prompt when starting from natural language. Never invent actions absent from the installed catalog.

## Fast path (do this first)

1. `auth_whoami` + `workspace_list` + `system_capabilities` (read `agentCookbook`).
2. `template_list` + `workflow_list` in the target workspace. Reuse existing templates/workflows before creating new ones.
3. Skim repo examples before inventing a graph:
   - `examples/welcome-nudge/` (React Email templates + push flow, minimal welcome + wait)
   - `examples/onboarding.workflow.json` (multi-step graph with email.send and contact.update)
4. Author and review React Email locally; publish with `reflow template push ... --allow-code-execution` (upserts by `--name`: revise + publish). TSX runs with the local user's permissions; never opt in for untrusted source. Do not create `… v2` duplicates when a name already exists.
5. Validate → simulate **two** traces (no events + with activation events) → `workflow_create`. Publish/enroll only when the user authorized side effects.

Translate the user's intent into explicit triggers, actions, delays, event waits, branches, timeouts, and end states. Create and publish required templates first because `email.send` takes an immutable template version. Call `workflow_validate` and `workflow_simulate` with representative contact, variables, and events. Show the trace and repair errors before `workflow_create`. Simulation does not wait or run side effects.

When a user mentions a clock time, date, or local calendar schedule without a timezone, ask which IANA timezone they mean and offer "your own timezone" as the default choice. Do not infer timezone from the host, locale, contact, or workspace. A scheduled trigger requires both an ISO 8601 datetime with an explicit `Z` or `±HH:MM` offset and a matching IANA `timeZone` (for example `2026-07-01T09:00:00+02:00` with `Europe/Amsterdam`). Confirm the offset on that date, including daylight-saving transitions; ask which occurrence the user intends for an ambiguous local time. `delay` and `wait_for_event` durations are elapsed seconds, not local calendar times. Contact `timezone`, when supplied, must be an IANA name.

Publishing creates an immutable workflow version and does not enroll anyone. Enrollment may send email or perform other side effects. Perform it when the user's task already authorizes that effect; otherwise leave a concrete validated draft for review. Keep workflow-version, contact, event, and idempotency IDs stable across retries.

Use Reflow's delivery action rather than direct Resend calls so the durable send ledger, suppressions, and Temporal lifecycle remain effective. Verified Resend webhooks update message state. An unknown send outcome after provider deduplication expires needs operator attention because an automatic replacement could duplicate email.

Human login uses the dashboard. For interactive CLI use, run `reflow auth login` to complete OAuth Authorization Code + PKCE, select a workspace, then use plain `reflow`; the saved active workspace scopes later CLI operations. Use `reflow workspace use` to switch. Machine callers use scoped OAuth client credentials or a user-bound API key. Initial administrator creation is a trusted deployment-host operation. Later account creation requires deployment-administrator permission; self-registration works only when `ALLOW_REGISTRATION=true`.

Read [workflows](references/workflows.md) for concrete authoring and recovery paths. Read [concepts](references/concepts.md) for the canonical vocabulary, the enrollment and message state machines, and what the operations console shows.
