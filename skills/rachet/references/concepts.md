# Concepts and vocabulary

One vocabulary across MCP/CLI operations, the operations console, and storage. Use these terms verbatim in operator-facing prose so users can match what they read to what they see.

## Canonical terms

| Term | Meaning | Also appears as |
| --- | --- | --- |
| Workflow | The published automation: one trigger plus nodes and routes. | `sequences` / `sequence_versions` in storage. |
| Definition | The validated workflow graph JSON passed to `workflow_create`. | The console's "Definition" view renders it as a document. |
| Node / step | One unit of a definition: action, delay, branch, wait-for-event, or end. | API and graph JSON say "node"; the console says "step". |
| End | Terminal node with a reason. Every route must reach one. | Renders as "Exit · reason" in the console. |
| Template | Named, revisable email. HTML plus plain text, or plain text only. | `template_create`, `template_revise`, `template_publish`. |
| Template version | Immutable published snapshot of a template. `email.send` pins one. | `templateVersionId`. |
| Enrollment | One contact's live run through a workflow version. | "Currently enrolled" in the console. |
| Message | One row of the send ledger: a prepared email send. | `message_list` says "message"; the console says "email". Same rows. |
| Event | Product fact emitted to satisfy waits and branches. | `event_emit`; "Events seen" in the console. |
| `contact.update` | Merges fields onto the enrolled contact. It does not change the email. | The console shows `contact.update` and the fields it writes, such as `onboardingStatus = needs_nudge`. |

## Enrollment states

Defined by PRD FR-C04; the console shows them verbatim.

| State | Meaning |
| --- | --- |
| `pending_start` | Created; the Temporal execution has not started yet. |
| `running` | Executing between gates. |
| `waiting` | Parked at a delay or event wait. |
| `paused` | Operator-paused; resumes from the current gate. |
| `needs_attention` | Halted for an operator: an action failed with `onError: attention`, or a send outcome stayed ambiguous past the provider idempotency window. |
| `completed` | Reached an end node normally. |
| `cancelled` | Operator-cancelled; no further sends. |
| `suppressed` | Stopped because the recipient is suppressed (hard bounce, complaint, or unsubscribe). |
| `failed` | An action failed with `onError: fail`; the execution ended with an error. |

## Message (send) states

| State | Meaning |
| --- | --- |
| `prepared` | Intent persisted; not dispatched yet. |
| `dispatching` | Provider call in flight. |
| `accepted` | The provider admitted the message. Acceptance is not delivery; delivery requires a verified provider event. |
| `retryable` | Dispatch failed transiently; Temporal retries within the provider idempotency window. |
| `rejected` | The provider refused the send (invalid recipient, suppression, policy). |
| `unknown` | Outcome ambiguous after the provider dedupe window. Reconcile before any replacement send, because a replacement can duplicate. |
| `abandoned` | Operator closed an unresolved intent without a replacement. |

## Operations console

The `app` image serves a same-origin console with email/password sign-in. It is read-mostly; its controls call the same operations as MCP and CLI, so the vocabulary above matches what users see.

- **Workflows list**: published workflows with the count of active enrollments ("Active now").
- **Workflow detail, "Definition"**: the workflow as a structured document where branches nest and rejoin inline. A count badge on a step shows how many active enrollments sit there; clicking it filters the list below. Clicking an email step previews its pinned template rendered with sample data.
- **Enrollment detail, "Execution"**: the same document with one enrollment's path painted; untaken routes dim and the current step is marked. Clicking an email step shows the stored sent message when one exists, otherwise a preview rendered with that contact's data.
- **Pause / Resume / Cancel** map to `enrollment_pause` / `enrollment_resume` / `enrollment_cancel`. Pause takes effect at the next workflow gate and cannot recall an already accepted send. Cancel on an enrollment whose Temporal execution is gone reconciles the row to `cancelled`.

See [workflows](workflows.md) for authoring and recovery paths.
