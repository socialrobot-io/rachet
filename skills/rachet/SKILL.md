---
name: rachet
description: Authors and operates Rachet workflows through MCP, including templates, validation, simulation, publishing, and enrollment. Use when the user wants a welcome sequence, email workflow, or other durable journey created or changed in Rachet.
---

# Rachet

Use MCP. Do not use the CLI. Keep each email as a React Email component in the project that owns the journey. Do not put those files in a sample folder. Do not search the project for sample workflows unless the user asked for a sample.

Do all Rachet MCP yourself in this turn. Never spawn subagents for template create/revise/publish, event definitions, validate/simulate, or workflow create/delete. Parallelize independent tool calls in one turn.

## Steps

Copy this checklist and check items off as you go:

- [ ] Call `auth_whoami`. Use that workspace. Call `workspace_list` only when more than one workspace is returned.
- [ ] Call `template_list` and `workflow_list` together. Reuse a live template with the same job. Skip archived templates.
- [ ] Build the graph from the words the user used. See **Graph**.
- [ ] Set `purpose` explicitly to `marketing` or `transactional`. For marketing, check `email_policy_get`. Pass `consent` on `trigger()` or `enrollment.create`, or call `contact.resubscribe` before enrollment.
- [ ] Lock tone before design. See **Tone**. Do not design branded chrome and strip it later.
- [ ] Author copy and React Email once for the emails the user named. Render HTML + plain-text body locally so placeholders such as `{{contact.firstName}}` and `{{variables.*}}` stay literal.
- [ ] Preview one representative email (prefer the first send) with `template_render` or local HTML before publishing the rest. Fix tone there, not after a full publish pass.
- [ ] Publish in one pass: for each template, `template_create` (or `template_revise` if the name exists) then `template_publish`. Batch those calls. In the same step, call `event_type_define` for each event the graph waits on. Keep a local name → published version id map for workflow pins.
- [ ] Call `workflow_validate`. Fix the reported errors and validate again.
- [ ] Call `workflow_simulate` twice. First with `receivedEvents: []`. Then with the activation event and schema-valid `data`.
- [ ] Call `workflow_create` with the user's intent.
- [ ] Ask whether to connect this workflow to the app. See **Connect**. Do not publish or change the app before they answer.

## Tone

Decide tone before matching any live template HTML.

- If the user says personal, founder, letter, plain text, or 1:1, use a **plain** layout for those emails: white background, system font, body paragraphs, text link, text signature. No logo strip, card, colored CTA button, or branded signature bar unless they asked for that chrome.
- If the user says branded, marketing, or product email, or the product already has a live branded template for this job, use a **branded** layout. Read one live template's HTML from `template_list` plus any design notes in the owning project. Match that look. Do not assume a brand file path.
- If tone is unclear and the email is the first message in an onboarding or welcome journey, default to **plain**. Ask one short question only when the remaining emails could go either way.
- Mix tones per email when the user asks (for example plain welcome, branded later). Do not force one layout on the whole sequence.

If every template is archived, use archived HTML as a branded look reference only when tone is branded. Do not republish an archived template.

## Speed

- One publish pass per user-approved copy set. Do not republish every template for a single-email tweak.
- After a copy or layout change: revise + publish only the changed templates, update the version map, then call `workflow_revise` with the complete graph and new pins. Use the draft's current `revision` as `expectedRevision`.
- Do not explore the repo for sample workflows, sample emails, or unrelated packages unless the user pointed at them.

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
- Marketing email gets a managed unsubscribe footer and mailbox headers at send time. Do not put a usable unsubscribe token in template copy or previews.
- Pass `marketingPreview: true` to `template_render` when previewing a marketing email; the footer uses an inert URL.
- A wait the user stated is `wait_for_event` or `delay`. `timeoutSeconds` and `durationSeconds` are elapsed seconds. Two days is `172800`. Do not insert another wait.
- `contact.update` merges fields onto the contact record, such as `{ "onboardingStatus": "workflow_created" }`. It does not change the email. Add it only when the user asked to store a field.
- Every `wait_for_event` has `onEvent` and `onTimeout`. Every `branch` has `onTrue` and `onFalse`. Every path reaches an `end` node.
- Name an event from the user's words, dotted and versioned, such as `workflow.created.v1`. Its schema `type` is `object`.

## Templates

Author each email as React Email in the project that owns the journey. Render it so the HTML still contains `{{contact.firstName}}` and `{{variables.workflowsUrl}}` when the copy needs them. Publish that HTML and a plain-text body. The server fills those placeholders when it sends. Do not upload `.tsx`.

Use `sourceKind=html` when you publish rendered React Email (multipart HTML + plain body). Use a plain layout in that HTML when tone is plain; do not add marketing chrome to "match" an unrelated branded template.

`TEMPLATE_NAME_EXISTS` means call `template_revise`, then `template_publish`. Do not create a second template with a `v2` name. An archived template cannot be revised. Pick a new name.

## When the request needs more

A clock time without a timezone, a delete, or a live enrollment: read [workflows](references/workflows.md).

Console words such as Exit, enrollment, and message: read [concepts](references/concepts.md).
