---
name: reflow
description: Authors and operates Rachet workflows through MCP, including templates, validation, simulation, publishing, and enrollment. Use when the user wants a welcome sequence, email workflow, or other durable journey created or changed in Rachet.
---

# Rachet

Use MCP. Do not use the CLI. Keep each email as a React Email component in the project that owns the journey. Do not put those files in a sample folder. Do not search the project for sample workflows unless the user asked for a sample.

## Steps

Copy this checklist and check items off as you go:

- [ ] Call `auth_whoami`. Use that workspace. Call `workspace_list` only when more than one workspace is returned.
- [ ] Call `template_list` and `workflow_list` together. Reuse a live template with the same job. Skip archived templates.
- [ ] Build the graph from the words the user used. See **Graph**.
- [ ] Before writing an email, read the HTML of one existing template from `template_list` and whatever design notes the project already has for color, type, and logo. Match that look in the React Email component. Do not assume a brand file or stylesheet path. A live template is the reference. If every template is archived, use its HTML as the look only. Do not republish it.
- [ ] For each new email, render the React Email component to HTML and a plain-text body, then call `template_create` with `sourceKind=html`, then `template_publish`. In the same step, call `event_type_define` for each event the graph waits on.
- [ ] Call `workflow_validate`. Fix the reported errors and validate again.
- [ ] Call `workflow_simulate` twice. First with `receivedEvents: []`. Then with the activation event and schema-valid `data`.
- [ ] Call `workflow_create` with the user's intent.
- [ ] Ask whether to connect this workflow to the app. See **Connect**. Do not publish or change the app before they answer.

## Connect

If they say yes, check these off:

- [ ] Call `workflow_publish`. Keep the returned workflow version id. Publishing does not send email.
- [ ] Wire a Node app with `@socialrobot-io/rachet-sdk`. If the app is not Node, call the same operations over HTTP. Call shapes are in [workflows](references/workflows.md).
- [ ] Where the product should start this journey, call `trigger()` with that version id, the contact, and a stable idempotency key. `trigger()` upserts the contact and enrolls them. Enrollment can send the first email.
- [ ] For each `wait_for_event`, call `event.emit` through `call()` from the product action that means that event. Use the enrollment id from `trigger()`, a stable event id, and data that matches the event schema.

If they say no, leave the workflow as a draft. If the graph waits on events, warn that those events will not arrive until the product emits them.

## Graph

Include only the emails, waits, and branches the user named. Do not add a node because an example has one.

- `email.send` sends one published template. Set `input.templateVersionId.literal` to the id from `template_publish`.
- A wait the user stated is `wait_for_event` or `delay`. `timeoutSeconds` and `durationSeconds` are elapsed seconds. Two days is `172800`. Do not insert another wait.
- `contact.update` merges fields onto the contact record, such as `{ "onboardingStatus": "workflow_created" }`. It does not change the email. Add it only when the user asked to store a field.
- Every `wait_for_event` has `onEvent` and `onTimeout`. Every `branch` has `onTrue` and `onFalse`. Every path reaches an `end` node.
- Name an event from the user's words, dotted and versioned, such as `workflow.created.v1`. Its schema `type` is `object`.

## Templates

Author each email as React Email in the project that owns the journey. Render it so the HTML still contains `{{contact.firstName}}` and `{{variables.workflowsUrl}}` when the copy needs them. Publish that HTML and a plain-text body. The server fills those placeholders when it sends. Do not upload `.tsx`.

`TEMPLATE_NAME_EXISTS` means call `template_revise`, then `template_publish`. Do not create a second template with a `v2` name. An archived template cannot be revised. Pick a new name.

## When the request needs more

A clock time without a timezone, a delete, or a live enrollment: read [workflows](references/workflows.md).

Console words such as Exit, enrollment, and message: read [concepts](references/concepts.md).
