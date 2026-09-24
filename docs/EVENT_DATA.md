# Event data in workflows

An event has a name and a JSON object in `data`.

```json
{
  "eventId": "activation:42",
  "eventType": "product.activated",
  "data": { "plan": "pro", "seats": 5 }
}
```

Send it to one enrollment with `event.emit`. The event name chooses a `wait_for_event` route. The payload is available to later branches and actions in that enrollment. It does not change contact fields or enrollment variables unless an action does so.

## Read a payload value

Use a value path in a branch or action input:

```json
{ "path": "event[\"product.activated\"].data.plan" }
```

Use brackets around an event name. They are required when the name contains dots. Each received event has this shape:

```json
{
  "event": {
    "product.activated": {
      "eventId": "activation:42",
      "data": { "plan": "pro", "seats": 5 }
    }
  }
}
```

The last event of each type is available. A repeated event ID is ignored when its type and data match the first request. Reusing an ID with different data fails.

## Example: branch on a plan

```json
{
  "id": "check_plan",
  "type": "branch",
  "condition": {
    "op": "eq",
    "left": { "path": "event[\"product.activated\"].data.plan" },
    "right": { "literal": "pro" }
  },
  "onTrue": "send_pro_email",
  "onFalse": "end"
}
```

## Example: save event data on the contact

```json
{
  "id": "save_activation",
  "type": "action",
  "action": "contact.update",
  "input": {
    "fields": { "path": "event[\"product.activated\"].data" }
  },
  "next": "end"
}
```

## Example: pass event data to an email template

```json
{
  "id": "send_plan_email",
  "type": "action",
  "action": "email.send",
  "input": {
    "templateVersionId": { "literal": "TEMPLATE_VERSION_ID" },
    "props": { "path": "event[\"product.activated\"].data" }
  },
  "next": "end"
}
```

The `props` object is passed to the template. In this example, the template can use `plan` and `seats`.

## Simulate event data

`workflow.simulate` accepts either an event name or an object with the name and payload. The string form remains useful when only the route matters.

```json
{
  "receivedEvents": [
    { "eventType": "product.activated", "data": { "plan": "pro", "seats": 5 } }
  ]
}
```

Simulate the event and timeout paths before publishing.
