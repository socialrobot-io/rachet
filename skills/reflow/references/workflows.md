# Schedules, deletion, and recovery

The create order is in [SKILL.md](../SKILL.md). Read this file only for a clock time, a delete, or a live enrollment.

## Clock time

Ask which IANA timezone the user means. Offer "your own timezone" as the choice. Do not infer it from the host, locale, contact, or workspace.

A `schedule` trigger needs both:

- `at`: an ISO 8601 datetime with `Z` or an explicit `±HH:MM` offset
- `timeZone`: the matching IANA name

Example: `2026-07-01T09:00:00+02:00` with `Europe/Amsterdam`. Confirm the offset on that date, including daylight-saving changes. If the local time happens twice, ask which one they mean.

`delay` and `wait_for_event` are elapsed seconds, not a local clock time. A contact `timezone`, when supplied, is an IANA name.

## Event payload

Read a dotted event name as `event["workflow.created.v1"].data.workflowId`. Brackets keep the event name as one key.

`workflow_simulate` treats received events as a set for the whole trace. An event in `receivedEvents` takes every `onEvent` route for that type. It cannot show "timeout, then the event on the second wait."

## Enrollment

Connect the app only after the user agrees in [SKILL.md](../SKILL.md). For a Node app, use `@socialrobot-io/rachet-sdk`. Keep the API key on the server.

`trigger()` upserts the contact and creates the enrollment. Pass the published workflow version id, the contact, and a stable `idempotencyKey` such as `welcome-<userId>`. Pass links in `variables`. Templates read them as `{{variables.workflowsUrl}}` and `{{variables.replyMailto}}`.

Emit a waited event with `call('event.emit', { workspaceId, enrollmentId, eventId, eventType, data })`. `enrollmentId` is the id `trigger()` returned. The same `eventId` on retry does not create a second event. `data` must match the event schema.

If the app is not Node, POST `contact.upsert`, `enrollment.create`, and `event.emit` to `/v1/operations/<operation>` with those same fields.

For a live test of a multi-day wait, use a second workflow with the same branches and `timeoutSeconds` in the tens of seconds. Do not shorten the workflow the user asked for.

## Delete

Copy this checklist and check items off as you go:

- [ ] Show the workflow name and id. Say that published versions and completed enrollment history will be removed.
- [ ] Ask the user to confirm.
- [ ] Call `workflow_delete` with `dangerouslyDeleteWorkflow: true`. If an enrollment is in progress, cancel it or wait until it finishes, then retry.

For one enrollment:

- [ ] Show the enrollment id and contact.
- [ ] Ask the user to confirm.
- [ ] Call `enrollment_delete`. This stops an active run and removes its event, send, and queued-job records. It cannot recall an email the provider already accepted.

Pause takes effect at the next wait. It cannot recall an accepted email.

## Message state

"Accepted" means the provider admitted the message. "Delivered" needs a verified provider event. A hard bounce or complaint adds a local suppression. On a timeout, retry with the same input and the same idempotency key.
