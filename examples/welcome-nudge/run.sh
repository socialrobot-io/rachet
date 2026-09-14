#!/usr/bin/env bash
# Small Reflow demo: templates → workflow → enroll → (optional) event.
set -euo pipefail

EXAMPLE="$(cd "$(dirname "$0")" && pwd)"
RECIPIENT="${1:-}"
EMIT_EVENT="${EMIT_EVENT:-0}"

if [[ -z "$RECIPIENT" ]]; then
  echo "Usage: $0 <recipient-email>" >&2
  echo "Tip: with onboarding@resend.dev, use the email on your Resend account." >&2
  exit 1
fi

if ! command -v reflow >/dev/null 2>&1; then
  echo "reflow CLI not found. From the repo root run: pnpm build && pnpm link --global" >&2
  exit 1
fi

export REFLOW_URL="${REFLOW_URL:-http://localhost:3000}"

# reflow call prints the operation payload (already unwrapped).
field() {
  local json="$1" path="$2"
  python3 -c 'import json,sys; cur=json.load(sys.stdin)
for part in sys.argv[1].split("."):
  cur=cur[part]
print(cur)' "$path" <<<"$json"
}

echo "== workspace =="
WS_JSON="$(reflow call workspace.list --input '{}')"
WS="$(python3 -c 'import json,sys
rows=json.load(sys.stdin)
if isinstance(rows, dict):
  rows=rows.get("items") or rows.get("workspaces") or []
print(rows[0]["id"] if rows else "")' <<<"$WS_JSON")"
if [[ -z "$WS" ]]; then
  echo "No workspace. Run: reflow auth login && reflow workspace use" >&2
  echo "$WS_JSON" >&2
  exit 1
fi
echo "workspaceId=$WS"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== template: welcome =="
python3 - <<PY >"$TMP/welcome-create.json"
import json
print(json.dumps({
  "workspaceId": "$WS",
  "name": "Welcome nudge / welcome",
  "subject": "Welcome, {{contact.firstName}}",
  "preheader": "Your account is ready.",
  "body": "Hi {{contact.firstName}},\n\nThanks for signing up.\nOpen the product: {{variables.productUrl}}\n\n- Reflow",
}))
PY
WELCOME_DRAFT="$(reflow call template.create --file "$TMP/welcome-create.json")"
WELCOME_ID="$(field "$WELCOME_DRAFT" id)"
WELCOME_REV="$(field "$WELCOME_DRAFT" revision)"
python3 - <<PY >"$TMP/welcome-publish.json"
import json
print(json.dumps({"workspaceId": "$WS", "templateId": "$WELCOME_ID", "expectedRevision": int("$WELCOME_REV")}))
PY
WELCOME_PUB="$(reflow call template.publish --file "$TMP/welcome-publish.json")"
WELCOME_VERSION="$(field "$WELCOME_PUB" id)"
echo "welcomeVersionId=$WELCOME_VERSION"

echo "== template: reminder =="
python3 - <<PY >"$TMP/reminder-create.json"
import json
print(json.dumps({
  "workspaceId": "$WS",
  "name": "Welcome nudge / reminder",
  "subject": "Still there, {{contact.firstName}}?",
  "preheader": "A quick nudge.",
  "body": "Hi {{contact.firstName}},\n\nWe noticed you have not opened the product yet.\nTry again: {{variables.productUrl}}\n\n- Reflow",
}))
PY
REMINDER_DRAFT="$(reflow call template.create --file "$TMP/reminder-create.json")"
REMINDER_ID="$(field "$REMINDER_DRAFT" id)"
REMINDER_REV="$(field "$REMINDER_DRAFT" revision)"
python3 - <<PY >"$TMP/reminder-publish.json"
import json
print(json.dumps({"workspaceId": "$WS", "templateId": "$REMINDER_ID", "expectedRevision": int("$REMINDER_REV")}))
PY
REMINDER_PUB="$(reflow call template.publish --file "$TMP/reminder-publish.json")"
REMINDER_VERSION="$(field "$REMINDER_PUB" id)"
echo "reminderVersionId=$REMINDER_VERSION"

echo "== workflow =="
python3 - <<PY
import json
from pathlib import Path
text = Path("$EXAMPLE/workflow.template.json").read_text()
text = text.replace("__WELCOME_VERSION_ID__", "$WELCOME_VERSION")
text = text.replace("__REMINDER_VERSION_ID__", "$REMINDER_VERSION")
defn = json.loads(text)
Path("$TMP/definition.json").write_text(json.dumps(defn))
Path("$TMP/validate.json").write_text(json.dumps({"workspaceId": "$WS", "definition": defn}))
Path("$TMP/simulate.json").write_text(json.dumps({
  "workspaceId": "$WS",
  "definition": defn,
  "contact": {"firstName": "Ada", "email": "$RECIPIENT"},
  "variables": {"productUrl": "https://example.com/app"},
  "receivedEvents": [],
}))
Path("$TMP/create.json").write_text(json.dumps({
  "workspaceId": "$WS",
  "name": "Welcome nudge",
  "intent": "Demo: welcome, wait 20s for product.activated, else remind.",
  "definition": defn,
}))
PY

reflow call workflow.validate --file "$TMP/validate.json" >/dev/null
echo "validate: ok"
SIM="$(reflow call workflow.simulate --file "$TMP/simulate.json")"
echo "simulate: $(python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("endReason") or j.get("reason") or "ok")' <<<"$SIM")"

WF_CREATE="$(reflow call workflow.create --file "$TMP/create.json")"
WF_ID="$(field "$WF_CREATE" id)"
WF_REV="$(field "$WF_CREATE" revision)"
python3 - <<PY >"$TMP/publish.json"
import json
print(json.dumps({"workspaceId": "$WS", "workflowId": "$WF_ID", "expectedRevision": int("$WF_REV")}))
PY
WF_PUB="$(reflow call workflow.publish --file "$TMP/publish.json")"
WF_VERSION="$(field "$WF_PUB" id)"
echo "workflowVersionId=$WF_VERSION"

echo "== contact + enrollment =="
python3 - <<PY >"$TMP/contact.json"
import json
print(json.dumps({
  "workspaceId": "$WS",
  "externalId": "welcome-nudge-demo",
  "email": "$RECIPIENT",
  "fields": {"firstName": "Ada"},
}))
PY
CONTACT="$(reflow call contact.upsert --file "$TMP/contact.json")"
CONTACT_ID="$(field "$CONTACT" id)"
IDEM="welcome-nudge-$(date +%s)"
python3 - <<PY >"$TMP/enroll.json"
import json
print(json.dumps({
  "workspaceId": "$WS",
  "workflowVersionId": "$WF_VERSION",
  "contactId": "$CONTACT_ID",
  "idempotencyKey": "$IDEM",
  "variables": {"productUrl": "https://example.com/app"},
}))
PY
ENROLL="$(reflow call enrollment.create --file "$TMP/enroll.json")"
ENROLL_ID="$(field "$ENROLL" id)"
echo "enrollmentId=$ENROLL_ID"

if [[ "$EMIT_EVENT" == "1" ]]; then
  echo "== emit product.activated =="
  python3 - <<PY >"$TMP/event.json"
import json
print(json.dumps({
  "workspaceId": "$WS",
  "enrollmentId": "$ENROLL_ID",
  "eventId": "activation-$IDEM",
  "eventType": "product.activated",
  "data": {},
}))
PY
  reflow call event.emit --file "$TMP/event.json" >/dev/null
  echo "event emitted; reminder should be skipped"
else
  echo "No event emitted. After ~20s a reminder should send."
  echo "To skip the reminder next time: EMIT_EVENT=1 $0 $RECIPIENT"
fi

echo "== done =="
echo "Check inbox for $RECIPIENT"
echo "reflow call message.list --input '{\"workspaceId\":\"$WS\"}'"
echo "reflow call enrollment.list --input '{\"workspaceId\":\"$WS\"}'"
