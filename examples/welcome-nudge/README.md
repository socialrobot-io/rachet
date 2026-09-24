# Welcome + nudge

Minimal example: two React Email templates, one workflow, one enrollment.

Waits are 20 seconds so you can test without waiting days.

## Prerequisites

- `pnpm dev`
- `npm install --global @socialrobot-io/reflow`
- `reflow auth login --url http://localhost:3000`
- Resend key loaded for real delivery

## 1. Preview templates

```sh
reflow template preview --dir examples/welcome-nudge/emails
# http://localhost:3030
```

## 2. Publish templates

`push` renders each reviewed `.tsx` on your machine (any imports you need), then uploads HTML + plain text. Because TSX is local code, the explicit acknowledgement flag is required. The server only interpolates `{{…}}` at send time.

```sh
reflow template push examples/welcome-nudge/emails/welcome.tsx \
  --name "Welcome nudge / welcome" \
  --subject "Welcome, {{contact.firstName}}" \
  --preheader "Your account is ready." \
  --allow-code-execution

reflow template push examples/welcome-nudge/emails/reminder.tsx \
  --name "Welcome nudge / reminder" \
  --subject "Still there, {{contact.firstName}}?" \
  --preheader "A quick nudge." \
  --allow-code-execution
```

Copy each printed `templateVersionId`.

## 3. Validate and create the journey

Edit `workflow.template.json` once: replace `__WELCOME_VERSION_ID__` and `__REMINDER_VERSION_ID__` with the IDs returned above. The file is a complete `workflow.create` request; validation ignores its extra `name` and `intent` fields.

```sh
reflow call workflow.validate \
  --file examples/welcome-nudge/workflow.template.json

reflow call workflow.create \
  --file examples/welcome-nudge/workflow.template.json
```

Publish with the `id` and `revision` from create:

```sh
reflow call workflow.publish --input '{
  "workflowId": "WORKFLOW_ID",
  "expectedRevision": 1
}'
```

## 4. Enroll

```sh
reflow call contact.upsert --input '{
  "email": "you@your-resend-account.email",
  "externalId": "welcome-nudge-demo",
  "fields": { "firstName": "Ada" }
}'

reflow call enrollment.create --input '{
  "workflowVersionId": "WORKFLOW_VERSION_ID",
  "contactId": "CONTACT_ID",
  "idempotencyKey": "welcome-nudge-1",
  "variables": { "productUrl": "https://example.com/app" }
}'
```

Optional: define the event type, then emit the product event within 20 seconds to skip the reminder. Keep `eventId` stable if your application retries the request:

```sh
rachet call event_type.define --input '{
  "eventType": "product.activated.v1",
  "schema": { "type": "object", "additionalProperties": false }
}'
```

```sh
rachet call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "activation-1",
  "eventType": "product.activated.v1",
  "data": {}
}'
```

For application HTTP and MCP examples, see [Sending product events](../../docs/EVENTS.md).

## Flow

```text
welcome → wait 20s for product.activated.v1
  → event: end (activated)
  → timeout: reminder → end (nudged)
```

## Files

| File | Purpose |
| ---- | ------- |
| `emails/welcome.tsx` | Welcome React Email |
| `emails/reminder.tsx` | Reminder React Email |
| `workflow.template.json` | Create request containing the graph and pinned template-version IDs |
