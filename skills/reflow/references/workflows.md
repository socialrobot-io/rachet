# Reflow workflow paths

## Author from natural language

1. Call `auth_whoami` and `system_capabilities`; read the action catalog and workflow schema resources.
2. Turn the request into a finite graph. Use only catalog actions. Every wait-for-event needs an explicit timeout route, every branch needs true and false routes, and all routes must reach an end node.
3. Create, render, and publish any React Email templates. Put the returned immutable template version UUID in `email.send.input.templateVersionId.literal`.
4. Call `workflow_validate`. Then call `workflow_simulate` with realistic contact fields, enrollment variables, and a list of received event names. Inspect resolved action inputs and both event/timeout scenarios.
5. Call `workflow_create` with the original natural-language `intent` and validated definition. Publish only when requested. Publishing returns the immutable workflow version used for enrollment.
6. Upsert contacts and call `enrollment_create` with a stable idempotency key when live execution is authorized.

The MCP host agent performs the natural-language interpretation. Reflow validates and executes the resulting capability graph; it does not execute generated code.

## Operate and recover

Use `event_emit` with a stable caller event ID to satisfy workflow event waits. Pause, resume, and cancel operate on an enrollment's Temporal execution. A pause takes effect at the next workflow gate and cannot recall an already accepted send.

Inspect enrollment and message lists separately. “Accepted” means the provider admitted a message; “delivered” requires a verified provider event. Hard bounce and complaint webhooks add local suppression. Preserve the same operation input and idempotency key when retrying a timeout.

Use trusted local stdio MCP only with `REFLOW_ACTOR_USER_ID` on the Reflow host. Remote agents should use the OAuth-protected HTTP MCP endpoint.
