![Reflow — journeys that keep moving](docs/assets/reflow-banner.png)

# Reflow

[![Repository checks](https://github.com/socialrobot-io/reflow/actions/workflows/sanity.yml/badge.svg)](https://github.com/socialrobot-io/reflow/actions/workflows/sanity.yml)
[![npm version](https://img.shields.io/npm/v/%40socialrobot-io%2Freflow?logo=npm&label=npm)](https://www.npmjs.com/package/@socialrobot-io/reflow)
[![npm downloads](https://img.shields.io/npm/dm/%40socialrobot-io%2Freflow?logo=npm&label=downloads)](https://www.npmjs.com/package/@socialrobot-io/reflow)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![MCP native](https://img.shields.io/badge/MCP-native-5A67D8)](docs/AUTHENTICATION.md)
[![Self-hosted](https://img.shields.io/badge/deploy-self--hosted-168363?logo=docker&logoColor=white)](docs/DEPLOYMENT.md)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

## What this is

Reflow is an **open-source journey engine for agents**.

An agent creates a journey such as:

```text
new account → welcome email → wait for product.activated
                                  ├─ event received → finish
                                  └─ 24h timeout → reminder → finish
```

Reflow publishes that graph as an immutable version and runs one durable enrollment per contact. Temporal keeps waits, branches, events, and retries alive across restarts. Resend sends email today; push and other channel actions can use the same journey model.

The dashboard is the human control plane for login, OAuth consent, live runs, messages, and connected apps. Agents author through MCP or the CLI. Both use the same operations and authorization rules.

## Why this exists

Most messaging products assume a human will build automations by clicking through a dashboard. Reflow is designed for software agents and product code:

- **Agent-native:** typed MCP tools, discoverable schemas, and an equivalent CLI.
- **Durable:** multi-day waits survive deploys and resume at the correct step.
- **Safe to retry:** immutable versions, stable idempotency keys, suppressions, and a durable send ledger.
- **Human-controlled:** operators approve OAuth access and can inspect or revoke connected clients.
- **Self-hosted:** PostgreSQL, Temporal, the API, workers, dispatcher, and dashboard run in your infrastructure.

## 1. Install the CLI

Requires Node.js 22 or newer.

```sh
npm install --global @socialrobot-io/reflow
reflow --version
```

The CLI connects to a Reflow server; it does not install the server.

## 2. Install the server

For local development you need pnpm 11+ and Docker Compose:

```sh
git clone https://github.com/socialrobot-io/reflow.git
cd reflow
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL and Temporal, applies migrations, creates the initial administrator when needed, and runs the API, worker, dispatcher, and dashboard.

Open [http://localhost:5173](http://localhost:5173). On a fresh database, sign in with:

```text
Email:    admin@localhost
Password: stored in .reflow/dev-admin-password
```

Read the generated password without putting it in shell history:

```sh
cat .reflow/dev-admin-password
```

### Configure email delivery

Validation and simulation work without Resend. Before a real enrollment can send email, create `secrets/resend_api_key`, set its mode to `0600`, and add this to `.env.local`:

```sh
RESEND_API_KEY_FILE=./secrets/resend_api_key
REFLOW_FROM='Reflow <mail@your-verified-domain.example>'
```

Restart `pnpm dev` after changing configuration. For domain verification, signed delivery webhooks, and safe test addresses, follow [Resend setup](docs/RESEND.md).

Stop the application with `Ctrl+C`. Stop its Docker services with `pnpm dev:infra:down`.

### Deploy on one host

Point a hostname at a Linux server with Docker and ports 80/443 available, then run:

```sh
./scripts/deploy.sh reflow.example.com admin@example.com
```

That command generates deployment secrets, builds the stack, configures Caddy TLS, runs migrations, and performs idempotent admin setup. See [Deployment](docs/DEPLOYMENT.md) for Coolify, external ingress, backups, and production topology.

## 3. Log in with the CLI

```sh
reflow auth login --url http://localhost:3000
```

The CLI opens the dashboard and completes OAuth Authorization Code with PKCE. Approve the request, then choose a workspace. Reflow stores short-lived access and rotating refresh credentials in a protected local file—never your password or browser cookie.

Confirm the connection:

```sh
reflow call auth.whoami
reflow workspace list
reflow call system.capabilities
```

## 4. Connect an MCP client

The local MCP endpoint is:

```text
http://localhost:3000/mcp
```

For Cursor, copy the checked-in [`examples/mcp/cursor.json`](examples/mcp/cursor.json) to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "reflow": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Do not add a static `Authorization` header. Reflow publishes OAuth discovery metadata; compatible clients register with PKCE, open the dashboard, show the requested scopes, and save their own grant. Operators can revoke the grant from **Connected apps**.

For production, replace the URL with `https://your-reflow.example/mcp`. Redirect origins and native callback schemes are explicit operator allowlists described in [Authentication](docs/AUTHENTICATION.md).

## 5. Create the first journey with MCP

Open your product repository in an MCP-capable agent, connect Reflow, and give it this prompt:

> Create an activation welcome journey for new users: welcome them, give them 24 hours to activate, remind them once if they don't, and stop messaging them as soon as they activate.
>
>Hook it up to the app, reuse our existing setup and style, test it, and show me the result before anything goes live.

This prompt separates design from side effects: the agent can inspect, author, validate, and simulate, but must ask before publishing or enrolling a real contact.

For the explicit CLI path, template files, graph JSON, publishing, enrollment, and the 20-second event/timeout test, follow the [welcome + nudge tutorial](examples/welcome-nudge/).

## 6. Send product events

Events move a live enrollment through `wait_for_event` steps. A quick CLI test looks like this:

```sh
reflow call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "product-activation:ACTIVITY_ID",
  "eventType": "product.activated",
  "data": { "plan": "pro" }
}'
```

Production applications call the same `event.emit` operation over HTTP with a scoped machine credential. MCP clients use `event_emit`. Keep `eventId` stable across retries. [Sending product events](docs/EVENTS.md) contains complete CLI, TypeScript HTTP, credential, and MCP examples.

## Operate Reflow

```sh
reflow workflow show --name "Activation welcome"
reflow call enrollment.list
reflow call message.list
```

The operations console at [http://localhost:5173](http://localhost:5173) shows journey graphs, live enrollments, timelines, messages, OAuth consent, and connected apps.

## How it fits together

```text
Agent / product code / operator
          │
          ├── MCP ────────┐
          ├── CLI ────────┼── shared operations + authorization
          ├── HTTP ───────┤
          └── Dashboard ──┘
                           │
                           ▼
                  PostgreSQL + Temporal
                           │
                           ▼
                     Resend today
              push / SMS / webhooks next
```

| Concept | Meaning |
| --- | --- |
| Journey / workflow | A graph of actions, waits, branches, events, and end states |
| Workflow version | Immutable graph used by new enrollments |
| Template version | Immutable rendered content pinned by a send action |
| Enrollment | One durable run for one contact |
| Event | A named product fact that can resume a waiting enrollment |
| Action | A channel or data operation such as `email.send` or `contact.update` |

## Develop and verify

The Nx workspace contains:

```text
apps/dashboard       React operations and OAuth UI
apps/server          Hono, Better Auth, Temporal, Resend
packages/contracts   shared operation and journey schemas
packages/cli         @socialrobot-io/reflow
packages/sdk         @socialrobot-io/reflow-sdk for server actions and UI backends
```

Run the complete release gate with:

```sh
make check
```

Product UIs can trigger a published workflow with `@socialrobot-io/reflow-sdk`. Create a user-bound API key with the `send` scope, configure `REFLOW_URL`, `REFLOW_WORKSPACE_ID`, and `REFLOW_API_KEY` in the UI server/action environment, then call `reflow.trigger(...)`. The SDK upserts the contact and starts an idempotent enrollment. Keep the API key server-side; browser bundles must call your own backend endpoint.

It runs repository validation, linting, typechecks, backend and dashboard tests, Temporal replay checks, all builds, Compose validation, and an npm package dry run.

## Reference

- [Welcome + nudge tutorial](examples/welcome-nudge/)
- [Sending product events](docs/EVENTS.md)
- [Operations and MCP contract](docs/OPERATIONS.md)
- [Authentication and OAuth](docs/AUTHENTICATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Resend setup](docs/RESEND.md)
- [CLI release process](docs/RELEASING.md)
- [Agent skill](skills/reflow/SKILL.md)

## License

Reflow is licensed under the [GNU Affero General Public License v3.0](LICENSE) only (`AGPL-3.0-only`).

Reflow is early. If you try it, open an issue and tell us where setup hurt, which journey actions you need next, and whether the MCP flow felt natural.
