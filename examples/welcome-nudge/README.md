# Welcome + nudge (small example)

This folder shows the smallest useful Reflow loop:

1. Publish email templates
2. Publish a workflow
3. Enroll a contact
4. Send mail (and optionally stop the nudge with an event)

The wait is **20 seconds** so you can test without waiting days.

## Prerequisites

- Local stack running (`pnpm dev`, `pnpm dev:worker`, `pnpm dev:dispatcher`)
- `reflow auth login` completed
- Resend key loaded if you want a real inbox delivery

## Quick run

```sh
# From repo root, after login:
./examples/welcome-nudge/run.sh you@your-resend-account.email
```

The script prints every operation and IDs. Use the Resend account email when you send with `onboarding@resend.dev`.

## What the workflow does

```text
welcome email
    → wait up to 20s for event "product.activated"
        → if event: end (activated)
        → if timeout: reminder email → end (nudged)
```

Template bodies use placeholders:

- `{{contact.firstName}}`
- `{{variables.productUrl}}`

## Manual steps (same as the script)

Replace `WS` with your workspace id (`reflow workspace list`).

### 1. Create and publish the welcome template

```sh
reflow call template.create --input '{
  "workspaceId": "WS",
  "name": "Welcome nudge / welcome",
  "subject": "Welcome, {{contact.firstName}}",
  "preheader": "Your account is ready.",
  "body": "Hi {{contact.firstName}},\n\nThanks for signing up.\nOpen the product: {{variables.productUrl}}\n\n- Reflow"
}'
```

Note `id` and `revision`, then:

```sh
reflow call template.publish --input '{
  "workspaceId": "WS",
  "templateId": "TEMPLATE_ID",
  "expectedRevision": 1
}'
```

Save the published version `id` as `WELCOME_VERSION_ID`.

### 2. Create and publish the reminder template

Same pattern with name `Welcome nudge / reminder` and subject `Still there, {{contact.firstName}}?`.
Save that version id as `REMINDER_VERSION_ID`.

### 3. Put version ids into the workflow

Copy `workflow.template.json` to a temp file and replace:

- `__WELCOME_VERSION_ID__`
- `__REMINDER_VERSION_ID__`

Build create / validate / simulate payloads that include that definition, then:

```sh
reflow call workflow.validate --file /tmp/welcome-nudge-validate.json
reflow call workflow.simulate --file /tmp/welcome-nudge-simulate.json
reflow call workflow.create --file /tmp/welcome-nudge-create.json
reflow call workflow.publish --input '{
  "workspaceId": "WS",
  "workflowId": "WORKFLOW_ID",
  "expectedRevision": 1
}'
```

`./run.sh` writes these temp files for you.

Save the published workflow version `id` as `WORKFLOW_VERSION_ID`.

### 4. Contact + enrollment

```sh
reflow call contact.upsert --input '{
  "workspaceId": "WS",
  "email": "you@example.com",
  "externalId": "welcome-nudge-demo",
  "fields": { "firstName": "Ada" }
}'

reflow call enrollment.create --input '{
  "workspaceId": "WS",
  "workflowVersionId": "WORKFLOW_VERSION_ID",
  "contactId": "CONTACT_ID",
  "idempotencyKey": "welcome-nudge-1",
  "variables": { "productUrl": "https://example.com/app" }
}'
```

Watch:

```sh
reflow call message.list --input '{"workspaceId":"WS"}'
reflow call enrollment.list --input '{"workspaceId":"WS"}'
```

### 5. Optional: cancel the reminder

Within 20 seconds of enrollment:

```sh
reflow call event.emit --input '{
  "workspaceId": "WS",
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "activation-1",
  "eventType": "product.activated",
  "data": {}
}'
```

Then only the welcome mail should send.

## Files

| File | Purpose |
| ---- | ------- |
| `run.sh` | End-to-end script |
| `workflow.template.json` | Graph with version placeholders |
