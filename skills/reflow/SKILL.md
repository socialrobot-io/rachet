---
name: reflow
description: Author and operate durable Reflow workflows through MCP or CLI from natural-language intent, including React Email templates, validation, simulation, publishing, enrollment, authentication, events, and recovery.
---

# Reflow

Prefer the authenticated MCP endpoint. Use CLI for the same operations or trusted host setup. Discover `system_capabilities`, read `reflow://workflow/actions` and `reflow://workflow/schema`, and use the `design-workflow` MCP prompt when starting from natural language. Never invent actions absent from the installed catalog.

Translate the user's intent into explicit triggers, actions, delays, event waits, branches, timeouts, and end states. Create and publish required templates first because `email.send` takes an immutable template version. Call `workflow_validate` and `workflow_simulate` with representative contact, variables, and events. Show the trace and repair errors before `workflow_create`. Simulation does not wait or run side effects.

Publishing creates an immutable workflow version and does not enroll anyone. Enrollment may send email or perform other side effects. Perform it when the user's task already authorizes that effect; otherwise leave a concrete validated draft for review. Keep workflow-version, contact, event, and idempotency IDs stable across retries.

Use Reflow's delivery action rather than direct Resend calls so the durable send ledger, suppressions, and Temporal lifecycle remain effective. Verified Resend webhooks update message state. An unknown send outcome after provider deduplication expires needs operator attention because an automatic replacement could duplicate email.

Human login uses configured OAuth or email/password. For interactive CLI use, run `reflow auth login`, select a workspace, then use plain `reflow`; the saved active workspace scopes later CLI operations. Use `reflow workspace use` to switch. Machine callers use scoped OAuth client credentials or a user-bound API key. Initial administrator creation is a trusted host CLI operation. Later account creation requires deployment-administrator permission; self-registration works only when `ALLOW_REGISTRATION=true`.

Read [workflows](references/workflows.md) for concrete authoring and recovery paths.
