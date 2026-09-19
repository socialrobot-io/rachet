![Reflow — journeys that keep moving](docs/assets/reflow-banner.png)

# Reflow

[![Repository checks](https://github.com/socialrobot-io/reflow/actions/workflows/sanity.yml/badge.svg)](https://github.com/socialrobot-io/reflow/actions/workflows/sanity.yml)
[![npm version](https://img.shields.io/npm/v/%40socialrobot-io%2Freflow?logo=npm&label=npm)](https://www.npmjs.com/package/@socialrobot-io/reflow)
[![npm downloads](https://img.shields.io/npm/dm/%40socialrobot-io%2Freflow?logo=npm&label=downloads)](https://www.npmjs.com/package/@socialrobot-io/reflow)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![MCP native](https://img.shields.io/badge/MCP-native-5A67D8)](docs/AUTHENTICATION.md)
[![Self-hosted](https://img.shields.io/badge/deploy-self--hosted-168363?logo=docker&logoColor=white)](docs/DEPLOYMENT.md)

**Open-source journey engine for agents.**

Enroll contacts in durable sequences that send, wait, branch, and react to events. Agents author journeys through MCP or the CLI; Temporal keeps every enrollment alive across restarts and retries. Email ships through Resend today, with push and other channels designed to fit the same action model.

Reflow also includes a small operations console for login, approvals, live runs, messages, and connected apps. Agents build. Humans stay in control.

## Why Reflow

- **Built for agents.** MCP and CLI expose the same typed operations, validation, and policy checks.
- **Durable by default.** A journey can wait for days, survive deploys, receive events, and resume exactly where it stopped.
- **Safe to retry.** Immutable versions, stable idempotency keys, suppression checks, and a durable send ledger protect delivery.
- **Your infrastructure.** Run Reflow with Docker Compose, PostgreSQL, Temporal, and your own Resend account.
- **More than email.** `email.send` is the first channel action. The journey graph is already channel-agnostic.

## Run it locally

You need Node.js 22+, pnpm 11+, and Docker Compose.

```sh
git clone https://github.com/socialrobot-io/reflow.git
cd reflow
pnpm install
pnpm dev
```

That one development command creates the local environment, starts PostgreSQL and Temporal, applies migrations, initializes the first administrator when needed, and runs the API, worker, dispatcher, and dashboard.

Open [http://localhost:5173](http://localhost:5173). Sign in as `admin@localhost`; the generated password is stored in `.reflow/dev-admin-password` with mode `0600`.

```sh
cat .reflow/dev-admin-password
```

Stop the application with `Ctrl+C`. Stop its Docker services with `pnpm dev:infra:down`.

## Install the CLI

```sh
npm install --global @socialrobot-io/reflow
reflow auth login --url http://localhost:3000
```

The CLI opens the Reflow dashboard and uses OAuth Authorization Code with PKCE. It stores short-lived access and rotating refresh credentials in a protected local file—never your password or browser cookie.

Once connected:

```sh
reflow workspace list
reflow template init
reflow template preview
reflow call system.capabilities
```

## Deploy on one host

Point a hostname at a Linux server with Docker, Docker Compose, and ports 80/443 available. Then run:

```sh
./scripts/deploy.sh reflow.example.com admin@example.com
```

The script generates deployment secrets, builds the images, initializes PostgreSQL and Temporal, obtains TLS through Caddy, runs migrations, and creates the first administrator. Re-running it is safe. Generated credentials live under `.reflow/` with restrictive permissions; move or delete the administrator password after the first successful login.

For Coolify, external databases, secret files, backups, and production topology, see [the deployment guide](docs/DEPLOYMENT.md).

## Connect an MCP client

Point the client at:

```text
https://your-reflow.example/mcp
```

Reflow publishes OAuth metadata for automatic client discovery. Public clients must use PKCE. The dashboard shows the requested scopes before approval, and users can revoke a CLI or MCP grant from **Connected apps**. Native callback schemes and web callback origins are operator allowlists.

Cursor users can start from [`.cursor/mcp.json`](.cursor/mcp.json).

## Create your first journey

The [welcome + nudge example](examples/welcome-nudge/) is the shortest complete path:

1. Author and preview two React Email templates.
2. Publish immutable template versions.
3. Validate and simulate the journey graph.
4. Publish it and enroll a contact.
5. Watch Temporal carry the contact through the wait and follow-up.

```text
enroll → welcome email → wait 2 days → activated?
                                      ├─ yes → end
                                      └─ no  → nudge email → end
```

React Email templates run locally as trusted code when pushed, so the CLI requires an explicit acknowledgement:

```sh
reflow template push emails/welcome.tsx \
  --name Welcome \
  --subject "Welcome, {{contact.firstName}}" \
  --allow-code-execution
```

The server and Temporal worker receive rendered HTML and plain text; they never execute uploaded TSX.

## How it fits together

```text
Agent / operator
      │
      ├── MCP ────────┐
      ├── CLI ────────┼── shared operations + authorization
      └── Dashboard ──┘                │
                                       ▼
                              PostgreSQL + Temporal
                                       │
                                       ▼
                                 Resend today
                          push / SMS / webhooks next
```

| Concept | What it means |
| --- | --- |
| Journey | A graph of actions, waits, branches, events, and end states |
| Journey version | Immutable graph used by new enrollments |
| Template version | Immutable rendered content pinned by a send action |
| Enrollment | One durable run for one contact |
| Event | A named signal that can resume a waiting enrollment |
| Action | A channel or data operation such as `email.send` or `contact.update` |

The current action catalog includes `email.send` and `contact.update`. Agents discover the installed catalog and schemas at runtime instead of guessing capabilities.

## Development

The Nx workspace contains the permanent dashboard, TypeScript server, shared contracts, and publishable CLI:

```text
apps/dashboard       React operations and OAuth UI
apps/server          Hono, Better Auth, Temporal, Resend
packages/contracts   shared operation and journey schemas
packages/cli         @socialrobot-io/reflow
```

Run the complete release gate with:

```sh
make check
```

It runs repository validation, linting, typechecks, unit and integration tests, Temporal replay checks, all builds, Compose validation, and an npm package dry run.

## Documentation

- [Welcome + nudge tutorial](examples/welcome-nudge/)
- [Operations catalog](docs/OPERATIONS.md)
- [Authentication and OAuth](docs/AUTHENTICATION.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Resend setup](docs/RESEND.md)
- [CLI release process](docs/RELEASING.md)
- [Agent skill](skills/reflow/SKILL.md)

Reflow is early. If you try it, open an issue and tell us where setup hurt, which journey actions you need next, and whether the MCP flow felt natural.
