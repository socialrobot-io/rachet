![Reflow — agent-authored, durable by design](docs/assets/reflow-banner.png)

# Reflow

Reflow runs email workflows that survive restarts, long waits, and retries.

You describe the flow. An MCP agent (or you, via CLI) creates templates, saves a graph, publishes it, and enrolls contacts. Temporal keeps each enrollment alive. Resend sends the mail.

There is no operator dashboard. CLI and MCP use the same operations.

## What you need

- Node.js 22+
- pnpm 11+
- Docker Compose (Postgres + Temporal)
- A [Resend](https://resend.com) API key if you want real email (optional for validate/simulate)

## 1. Start the stack locally

```sh
cp .env.dev.example .env
pnpm install --frozen-lockfile
make dev-infra
pnpm migrate
umask 077
openssl rand -base64 18 > /tmp/reflow-admin-password
pnpm setup -- --email admin@example.com --name Admin --password-file /tmp/reflow-admin-password
```

Start three host processes (keep each terminal open):

```sh
pnpm dev              # API :3000
pnpm dev:worker       # Temporal worker
pnpm dev:dispatcher   # Outbox / webhook side work
```

Local ports:

| Service     | Address                 |
| ----------- | ----------------------- |
| API         | http://localhost:3000   |
| Postgres    | localhost:5433          |
| Temporal    | localhost:7233          |
| Temporal UI | http://localhost:8080   |

Stop infra with `make dev-infra-down`.

For production Compose with TLS, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## 2. Sign in

```sh
pnpm build
pnpm link --global   # once, so `reflow` is on your PATH

export REFLOW_URL=http://localhost:3000
reflow auth login --email admin@example.com --password-file /tmp/reflow-admin-password
reflow workspace use
rm /tmp/reflow-admin-password
```

Your session is stored under `~/.config/reflow/`. Later accounts need an admin (`account.create`). Open signup stays off unless `ALLOW_REGISTRATION=true`.

## 3. Send email (Resend)

Put your key in `.env.local` (do not commit it):

```sh
printf '%s\n' 'RESEND_API_KEY=re_...' >> .env.local
chmod 600 .env.local
```

Add to `.env.local`:

```sh
RESEND_API_KEY=re_...
REFLOW_FROM="Reflow <onboarding@resend.dev>"
```

Restart `pnpm dev` and `pnpm dev:worker` so they reload the key.

With Resend’s test sender (`onboarding@resend.dev`), you can only send to the email on your Resend account. Use a verified domain for other recipients. See the complete [Resend setup guide](docs/RESEND.md) for domain verification, webhooks, and safe test addresses.

## 4. Email templates (React Email)

Author `.tsx` locally. The CLI renders with [react-email `render`](https://react.email/docs/utilities/render) and uploads **HTML + plain text**. The API/worker never execute TSX; they only interpolate `{{contact.*}}` / `{{variables.*}}` at send time. Local templates can import whatever you need.

```sh
reflow template init                 # creates emails/welcome.tsx
reflow template preview              # React Email viewer on :3030
reflow template push emails/welcome.tsx \
  --name Welcome \
  --subject "Welcome, {{contact.firstName}}"
# Re-running with the same --name revises the draft and publishes a new version (no duplicate rows).
reflow template list
```

React Email 6 needs both `react-email` (components + CLI) and `@react-email/ui` (preview app) in the project that owns `emails/`. This repo already lists them. In another project, install matching versions (`pnpm add react-email@6.9.5 @react-email/ui@6.9.5`). Saying yes to the preview prompt only installs `@react-email/ui`; templates still import from `react-email`.

Add `Component.PreviewProps` on each template so `template preview` has sample data. `push` renders locally, creates + publishes, and prints `templateVersionId`. Pin that id on each `email.send` node.

`workflow.validate` / `workflow.publish` fail with `TEMPLATE_REFERENCE_INVALID` (plus `hint` + `details.nextSteps`) if a node points at a missing template. `template.archive` fails with `TEMPLATE_IN_USE` while any workflow draft or published version still pins it, and archived templates cannot be republished.

## 5. First project: welcome + nudge

Follow [`examples/welcome-nudge/README.md`](examples/welcome-nudge/README.md):

1. `reflow template preview` / `reflow template push` for the two `.tsx` emails
2. Pin the version ids in `workflow.template.json`
3. `workflow.validate` → `workflow.create` → `workflow.publish`
4. `contact.upsert` → `enrollment.create`

## 6. Day-to-day commands

```sh
reflow call system.capabilities
reflow call workflow.actions
reflow template list
reflow call workflow.list --input '{"workspaceId":"YOUR_WORKSPACE_ID"}'
reflow call message.list --input '{"workspaceId":"YOUR_WORKSPACE_ID"}'
```

MCP clients talk to `http://localhost:3000/mcp` with a session token or API key. Cursor can use [`.cursor/mcp.json`](.cursor/mcp.json).

## Mental model

| Piece              | Role                                              |
| ------------------ | ------------------------------------------------- |
| Template           | Subject + React Email TSX (or plain body) with `{{contact.*}}` / `{{variables.*}}` |
| Template version   | Immutable pin used by `email.send` (per-node override) |
| Workflow           | Graph of actions, waits, branches, ends           |
| Workflow version   | Immutable pin used by enrollment                  |
| Contact            | Recipient + fields (`firstName`, `locale`, …)     |
| Enrollment         | One durable Temporal run for one contact          |
| Event              | Named signal into a waiting enrollment            |

Installed actions today: `email.send`, `contact.update`. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Checks

```sh
make check
```

## Docs

| Doc | Topic |
| --- | ----- |
| [examples/welcome-nudge](examples/welcome-nudge/) | Small end-to-end tutorial |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Full operation catalog |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Auth and accounts |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production Compose |
| [docs/RESEND.md](docs/RESEND.md) | Resend API keys, sender domains, webhooks, and testing |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [skills/reflow/SKILL.md](skills/reflow/SKILL.md) | Agent operating skill |
