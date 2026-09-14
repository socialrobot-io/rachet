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
mkdir -p secrets
umask 077
openssl rand -base64 18 > secrets/admin_password
pnpm setup -- --email admin@example.com --name Admin --password-file ./secrets/admin_password
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
reflow auth login --email admin@example.com --password-file ./secrets/admin_password
reflow workspace use
```

Your session is stored under `~/.config/reflow/`. Later accounts need an admin (`account.create`). Open signup stays off unless `ALLOW_REGISTRATION=true`.

## 3. Send email (Resend)

Put your key in a secret file (do not commit it):

```sh
printf '%s' 're_...' > secrets/resend_api_key
chmod 600 secrets/resend_api_key
```

Add to `.env` or `.env.local`:

```sh
RESEND_API_KEY_FILE=./secrets/resend_api_key
REFLOW_FROM=Reflow <onboarding@resend.dev>
```

Restart `pnpm dev` and `pnpm dev:worker` so they reload the key.

With Resend’s test sender (`onboarding@resend.dev`), you can only send to the email on your Resend account. Use a verified domain for other recipients.

## 4. First project: welcome + nudge

A short worked example lives in [`examples/welcome-nudge/`](examples/welcome-nudge/). It:

1. Creates and publishes two email templates
2. Publishes a workflow (welcome → wait → reminder or done)
3. Upserts a contact and enrolls them
4. Optionally emits `product.activated` so the reminder is skipped

Run it after the stack is up and you are logged in:

```sh
cd examples/welcome-nudge
./run.sh socialrobotio@gmail.com
```

Read that folder’s README for each step and the JSON shapes.

## 5. Day-to-day commands

```sh
reflow call system.capabilities
reflow call workflow.actions
reflow call template.list --input '{"workspaceId":"YOUR_WORKSPACE_ID"}'
reflow call workflow.list --input '{"workspaceId":"YOUR_WORKSPACE_ID"}'
reflow call message.list --input '{"workspaceId":"YOUR_WORKSPACE_ID"}'
```

MCP clients talk to `http://localhost:3000/mcp` with a session token or API key. Cursor can use [`.cursor/mcp.json`](.cursor/mcp.json).

## Mental model

| Piece              | Role                                              |
| ------------------ | ------------------------------------------------- |
| Template           | Subject + body with `{{contact.*}}` / `{{variables.*}}` |
| Template version   | Immutable pin used by `email.send`                |
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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [skills/reflow/SKILL.md](skills/reflow/SKILL.md) | Agent operating skill |
