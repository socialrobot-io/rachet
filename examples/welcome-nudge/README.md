# Welcome + nudge

Minimal example: two React Email templates, one workflow, one enrollment.

Waits are 20 seconds so you can test without waiting days.

## Prerequisites

- `pnpm dev`, `pnpm dev:worker`, `pnpm dev:dispatcher`
- `reflow auth login` and `reflow workspace use`
- Resend key loaded for real delivery
- `pnpm build && pnpm link --global`

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

## 3. Build the workflow

Edit `workflow.template.json`: replace `__WELCOME_VERSION_ID__` and `__REMINDER_VERSION_ID__` with those ids.

```sh
# validate (workspaceId comes from your active workspace)
reflow call workflow.validate --input "$(python3 - <<'PY'
import json
from pathlib import Path
print(json.dumps({"definition": json.loads(Path("examples/welcome-nudge/workflow.template.json").read_text())}))
PY
)"

reflow call workflow.create --input "$(python3 - <<'PY'
import json
from pathlib import Path
print(json.dumps({
  "name": "Welcome nudge",
  "intent": "Welcome, wait 20s for product.activated, else remind.",
  "definition": json.loads(Path("examples/welcome-nudge/workflow.template.json").read_text()),
}))
PY
)"
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

Optional: within 20s, skip the reminder:

```sh
reflow call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "activation-1",
  "eventType": "product.activated",
  "data": {}
}'
```

## Flow

```text
welcome → wait 20s for product.activated
  → event: end (activated)
  → timeout: reminder → end (nudged)
```

## Files

| File | Purpose |
| ---- | ------- |
| `emails/welcome.tsx` | Welcome React Email |
| `emails/reminder.tsx` | Reminder React Email |
| `workflow.template.json` | Graph (pin template version ids) |
