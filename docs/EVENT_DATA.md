# Event data in workflows

Define an event type before you use it. Event types use JSON Schema and cannot change after creation. Put the version in the name.

```json
{
  "workspaceId": "WORKSPACE_ID",
  "eventType": "product.activated.v1",
  "schema": {
    "type": "object",
    "required": ["plan"],
    "properties": {
      "plan": { "type": "string", "enum": ["free", "pro"] },
      "seats": { "type": "integer", "minimum": 1 }
    },
    "additionalProperties": false
  }
}
```

Call `event_type_define` with this object. To change the schema, define a new type such as `product.activated.v2`.

An event has a registered name and a JSON object in `data`.

```json
{
  "eventId": "activation:42",
  "eventType": "product.activated.v1",
  "data": { "plan": "pro", "seats": 5 }
}
```

Send it to one enrollment with `event.emit`. Rachet rejects an unknown event type or data that does not match its schema. The event name chooses a `wait_for_event` route. The payload is available to later branches and actions in that enrollment. It does not change contact fields or enrollment variables unless an action does so.

## Read a payload value

Use a value path in a branch or action input:

```json
{ "path": "event[\"product.activated.v1\"].data.plan" }
```

Use brackets around an event name. They are required when the name contains dots. Each received event has this shape:

```json
{
  "event": {
    "product.activated.v1": {
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
    "left": { "path": "event[\"product.activated.v1\"].data.plan" },
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
    "fields": { "path": "event[\"product.activated.v1\"].data" }
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
    "props": { "path": "event[\"product.activated.v1\"].data" }
  },
  "next": "end"
}
```

The `props` object is passed to the template. In this example, the template can use `plan` and `seats`.

## Simulate event data

`workflow.simulate` accepts event objects. It validates each payload against the registered schema.

```json
{
  "receivedEvents": [
    { "eventType": "product.activated.v1", "data": { "plan": "pro", "seats": 5 } }
  ]
}
```

Simulate the event and timeout paths before publishing.
