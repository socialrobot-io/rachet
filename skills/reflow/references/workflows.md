# Rachet workflow paths

## Author from natural language

1. Call `auth_whoami` and `system_capabilities` (read `agentCookbook`); read the action catalog and workflow schema resources.
2. Call `template_list` and `workflow_list`. Reuse before inventing. Check `examples/` for graph patterns (`welcome-nudge/` for the React Email push flow, `onboarding.workflow.json` for a multi-step graph).
3. Turn the request into a finite graph. Use only catalog actions. Every wait-for-event needs an explicit timeout route, every branch needs true and false routes, and all routes must reach an end node.
   If the user gives a local time without a timezone, ask which IANA timezone to use and suggest "your own timezone". For a schedule, supply `trigger.at` with an explicit offset and `trigger.timeZone` with the matching IANA name. Check DST gaps and folds with the user; delays remain elapsed seconds.
4. Review the local React Email source, then create/revise it with CLI `reflow template push ... --allow-code-execution` (upserts by `--name`). Put the returned immutable `templateVersionId` in `email.send.input.templateVersionId.literal`. Prefer this over MCP `template_create` for TSX sources; the server never executes TSX.
5. Define each event type first with `event_type_define` and an immutable JSON Schema. Call `workflow_validate`. Then call `workflow_simulate` twice: once with `receivedEvents: []`, once with the activation events the product will emit. Use `{ "eventType": "product.activated.v1", "data": { ... } }` when a branch or action reads the payload. Inspect resolved action inputs and both event/timeout scenarios.
6. Call `workflow_create` with the original natural-language `intent` and validated definition. Publish only when requested. Publishing returns the immutable workflow version used for enrollment.
7. Upsert contacts and call `enrollment_create` with a stable idempotency key when live execution is authorized.

The MCP host agent performs the natural-language interpretation. Rachet validates and executes the resulting capability graph; it does not execute generated code.

## Template edit loop

- Names are unique per workspace (`template_name_unique`). Re-pushing the same `--name` must revise + publish, not create a sibling.
- `template.create` on a taken name returns `TEMPLATE_NAME_EXISTS` with a hint. Use `template.revise` then `template.publish`, or `reflow template push`.
- Archived templates cannot be revised or republished; pick a new name.

## Event vocabulary (product wiring)

Prefer dotted, product-stable names so app hooks and workflow branches stay aligned:

| Event | Meaning |
|-------|---------|
| `account.connected` | User connected an external account |
| `post.scheduled` | User scheduled (non-draft) a post |
| `posts.queued` | Habit success: enough posts queued (product-defined threshold) |

Contact fields can mirror progress (`contact.accountConnected`) for enrollment-time state when events have not been emitted yet.

When the product already emits analytics names (e.g. PostHog `post_created`), either map them at the emit boundary or use those exact strings in the graph. Do not mix both without a mapping layer.

To read event data, use `event["product.activated.v1"].data.field`. Brackets keep a dotted event name as one key. Pass the whole `data` object to `email.send.input.props` or `contact.update.input.fields` when the template or contact needs it. See [event data](../../../docs/EVENT_DATA.md).

## Enrollment variables

Pass deep links as enrollment `variables` (interpolated as `{{variables.*}}` in templates). Typical set:

```json
{
  "accountsUrl": "https://app.example.com/accounts",
  "composeUrl": "https://app.example.com/compose",
  "calendarUrl": "https://app.example.com/calendar?view=week",
  "replyMailto": "mailto:founder@example.com?subject=What's%20getting%20in%20the%20way"
}
```

Idempotency key pattern: `welcome-first-week-<userId>` (or email when no user id yet).

## Long sequences and live QA

For multi-day delays, keep a **fast-test twin** (same branches, `timeoutSeconds` / `durationSeconds` in the tens of seconds) for enrollment smoke tests.

## Operate and recover

Use `event_emit` with a stable caller event ID to satisfy workflow event waits. Pause, resume, and cancel operate on an enrollment's Temporal execution. A pause takes effect at the next workflow gate and cannot recall an already accepted send.

Inspect enrollment and message lists separately. “Accepted” means the provider admitted a message; “delivered” requires a verified provider event. Hard bounce and complaint webhooks add local suppression. Preserve the same operation input and idempotency key when retrying a timeout.

Use trusted local stdio MCP only with `REFLOW_ACTOR_USER_ID` on the Rachet host. Remote agents should use the OAuth-protected HTTP MCP endpoint.
