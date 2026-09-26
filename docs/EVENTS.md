# Sending product events

Product events resume enrollments waiting at a `wait_for_event` node. Define each event type and its JSON Schema with `event_type_define` before use. The event type must exactly match the node's `eventType`, and the event must target the specific enrollment—not merely the contact or workflow.

## Test from the CLI

Interactive CLI login remembers the active workspace, so only the enrollment and event fields are required:

```sh
rachet call event_type.define --input '{
  "eventType": "product.activated.v1",
  "schema": {
    "type": "object",
    "required": ["plan"],
    "properties": { "plan": { "type": "string" } },
    "additionalProperties": false
  }
}'
```

```sh
rachet call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "product-activation:ACTIVITY_ID",
  "eventType": "product.activated.v1",
  "data": { "plan": "pro" }
}'
```

Use an event ID derived from the upstream activity or database record. If delivery times out, retry the identical request with the same `eventId`; do not mint a new identity for the retry.

The first call returns an explicit receipt:

```json
{
  "accepted": true,
  "duplicate": false,
  "delivery": "delivered",
  "eventId": "product-activation:ACTIVITY_ID"
}
```

Repeating the same ID and payload is a successful idempotent no-op: it returns `accepted: false`, `duplicate: true`, and does not apply the event to the workflow again. Reusing the ID with a different event type or payload returns `IDEMPOTENCY_CONFLICT` (HTTP 409). `delivery: "queued"` means the event is safely stored and the dispatcher is retrying Temporal delivery; `delivery: "delivered"` means Temporal accepted it.

For a saved request, place the same object in `activation-event.json` and run:

```sh
rachet call event.emit --file activation-event.json
```

## Send from your application over HTTP

Create a machine credential with the `send` scope from the dashboard's **API keys** page, or use the operation with your organization ID:

```sh
rachet call credential.create --input '{
  "workspaceId": "WORKSPACE_ID",
  "name": "product-events",
  "scopes": ["send"]
}'
```

The secret is returned once. Store it in your secret manager and provide it to the application as `REFLOW_API_KEY`. Do not put the key in source code, command arguments, logs, or agent prompts.

```ts
const event = {
  workspaceId: process.env.REFLOW_WORKSPACE_ID,
  enrollmentId,
  eventId: `product-activation:${activityId}`,
  eventType: 'product.activated.v1',
  data: { plan },
};

const response = await fetch(`${process.env.REFLOW_URL}/v1/operations/event.emit`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.REFLOW_API_KEY!,
  },
  body: JSON.stringify(event),
});

if (!response.ok) {
  throw new Error(`Rachet event failed: ${response.status} ${await response.text()}`);
}
```

Persist or deterministically derive `eventId` before making the request. A network timeout does not prove Rachet rejected the event, so retry with the same ID rather than generating another one. Supply `REFLOW_URL`, `REFLOW_WORKSPACE_ID`, and `REFLOW_API_KEY` through the application's secret-managed environment.

## Send through MCP

The MCP tool name uses an underscore while the CLI and HTTP operation use a dot:

```text
event_emit({
  workspaceId: "WORKSPACE_ID",
  enrollmentId: "ENROLLMENT_ID",
  eventId: "product-activation:ACTIVITY_ID",
  eventType: "product.activated.v1",
  data: { plan: "pro" }
})
```

OAuth/MCP authorization must include `rachet:send`; API keys use the corresponding `send` scope. Workspace role checks still apply.

## Account welcome

Set `REFLOW_API_KEY` and `REFLOW_WORKSPACE_ID` together. The key needs the `send` scope in that organization. Rachet then uses `@socialrobot-io/rachet-sdk` against its own API.

When that organization has a published workflow named `Welcome first workflow`, each new account is enrolled in its latest published version. The call is `trigger()`. The enrollment idempotency key is `welcome-<userId>`.

| Variable | Value |
| --- | --- |
| `workflowsUrl` | `{PUBLIC_URL}/workflows` |
| `integrationsUrl` | `{PUBLIC_URL}/settings/integrations` |
| `replyMailto` | `mailto:` plus the address in `REFLOW_FROM` |
| `logoUrl` | `{PUBLIC_URL}/brand/rachet-logo.png` (follow-up emails) |
| `signatureUrl` | `{PUBLIC_URL}/brand/founder-signature.png` (welcome letter) |

`firstName` on the contact is the person's first name.

When that person creates a workflow, Rachet calls `event.emit` for `workflow.created.v1`. The event id is `workflow.created.v1:<workflowId>` and the data is `{ "workflowId": "<workflowId>" }`. Creating the workflow still succeeds if that enrollment is missing or already finished.

If the key is unset, or that workflow is not published, registration and workflow creation do nothing extra.

## Event behavior

- Events are accepted only for an existing enrollment in the same workspace.
- Event identity is scoped to the enrollment. Repeating an identical `(enrollmentId, eventId)` is a no-op, including after that enrollment completes; conflicting reuse is rejected.
- Rachet stores the event and its retry job atomically before delivery. A transient Temporal outage therefore produces `delivery: "queued"` instead of losing the event.
- An event can arrive before the enrollment reaches its matching wait; Temporal records it for deterministic progression.
- The first `event.emit` receipt is written to the enrollment audit trail with `eventType`, `eventId`, and `data`. The dashboard lists delivered receipts under **Events seen** and in **History**.
- A matching wait follows `onEvent`; if no matching event arrives before its deadline, it follows `onTimeout`.
- A branch is evaluated once when execution reaches it. An event delivered after a false `event_received` branch does not rewind execution; the dashboard labels the chosen route and calls out the late event in History.
- Events do not create enrollments and do not bypass send policy or suppression checks.
- Provider webhooks such as Resend delivery events are separate. Those arrive at each organization's `/webhooks/resend/<organization-id>` endpoint and update only matching sends; product events use `event.emit`.

See the runnable [welcome + nudge tutorial](../examples/welcome-nudge/) for a complete wait, event, and timeout journey.

See [Event data in workflows](EVENT_DATA.md) to use an event payload in a branch, contact update, or email.
