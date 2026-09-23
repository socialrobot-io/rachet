<!-- BEAUTIFIED -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/brand/rachet-logo-light.svg" />
    <img src="apps/dashboard/public/brand/rachet-logo.svg" alt="Rachet" width="320" />
  </picture>
</p>

<h1 align="center">Build customer journeys by asking.</h1>

<p align="center">
  <strong>Rachet is the open-source journey engine for AI agents.</strong>
  <br />
  <em>Describe what should happen. Your agent builds the workflow, tests every path, and Rachet runs it reliably for days, weeks, or months.</em>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Get_started-168363?style=for-the-badge" alt="Get started" /></a>
</p>

<p align="center">
  <a href="docs/AUTHENTICATION.md">MCP native</a> ·
  <a href="docs/ARCHITECTURE.md">Powered by Temporal</a> ·
  <a href="docs/DEPLOYMENT.md">Self-hostable</a>
</p>

<p align="center">
  <a href="https://github.com/socialrobot-io/rachet/actions/workflows/sanity.yml"><img src="https://github.com/socialrobot-io/rachet/actions/workflows/sanity.yml/badge.svg" alt="Repository checks" /></a>
  <a href="https://www.npmjs.com/package/@socialrobot-io/rachet"><img src="https://img.shields.io/npm/v/%40socialrobot-io%2Frachet?logo=npm&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@socialrobot-io/rachet"><img src="https://img.shields.io/npm/dm/%40socialrobot-io%2Frachet?logo=npm&label=downloads" alt="npm downloads" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3" /></a>
</p>

![Claude / Cursor chat connected over MCP: the agent creates a welcome template from the design system, builds the journey, validates both paths, and shows the graph](docs/assets/hero-composition.png)

<p align="center">
  <sub>Your agent authors and validates. You decide what goes live.</sub>
</p>

## From prompt to production

Tell your agent what should happen. Rachet handles the rest.

No drag-and-drop builder. No translating product logic into a maze of automation blocks.

Your agent can inspect your existing templates and workflows, build the journey, validate its graph, simulate every branch, and show you exactly what will happen before anything goes live.

![From a sentence to an email template and a durable journey graph](docs/assets/prompt-to-production.png)

| Agent authored | Built to keep running | You stay in control |
| --- | --- | --- |
| Create and modify journeys through MCP or the CLI. | Wait for hours or weeks. Survive deploys and restarts. Resume at exactly the right step. | Review journeys, inspect live enrollments and messages, and decide what gets published. |

## Quick Start

### Prerequisites

- Node.js 22 or newer
- pnpm 11+ and Docker Compose (local server only)

### 1. Install the CLI

```sh
npm install --global @socialrobot-io/rachet
rachet --version
```

The CLI connects to a Rachet server; it does not install the server.

### 2. Sign in

Open [rachet.dev/login](https://rachet.dev/login), or use the CLI:

```sh
rachet auth login
rachet call auth.whoami
```

The CLI uses `https://rachet.dev` by default. For your own server, pass `--url https://your-domain` to `rachet auth login`. It stores short-lived access and rotating refresh credentials in a protected local file, never your password or browser cookie.

### 3. Connect an MCP client

Copy the checked-in [`examples/mcp/cursor.json`](examples/mcp/cursor.json) to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rachet": {
      "url": "https://rachet.dev/mcp"
    }
  }
}
```

For your own server, replace `https://rachet.dev` with its URL. Do not add a static `Authorization` header. Rachet publishes OAuth discovery metadata; compatible clients register with PKCE, show the requested scopes, and save their own grant. Operators can revoke the grant from **Connected apps**. Redirect allowlists are described in [Authentication](docs/AUTHENTICATION.md).

The dashboard's **Connect your tools** section also has setup instructions for Claude Code, ChatGPT, VS Code, Windsurf, Zed, and other remote HTTP MCP clients. Cursor and VS Code have direct install buttons. Step 4 offers a short, copyable welcome journey prompt. Public clients may need their exact OAuth callback origin or scheme added to the deployment allowlist.

## Run locally

```sh
git clone https://github.com/socialrobot-io/rachet.git
cd rachet
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL, Temporal, the API, worker, dispatcher, and dashboard. Open the dashboard URL printed by the launcher. For sign-in, configure either `AUTH_RESEND_API_KEY` with `AUTH_EMAIL_FROM`, or `GITHUB_CLIENT_ID` with `GITHUB_CLIENT_SECRET` in `.env.local`. On a fresh database, use the generated `REFLOW_SETUP_SECRET` to create the first administrator. Registration is disabled by default; set `ALLOW_REGISTRATION=true` in `.env.local` and restart to test new accounts.

After signing in, connect workflow delivery in **Integrations → Email → Resend**. To preview sample journeys, run `pnpm demo:seed --list` and then `pnpm demo:seed <workspace-slug>`. See [Local demo journeys](docs/DEMO_JOURNEYS.md) for details. Stop the app with `Ctrl+C` and its Docker services with `pnpm dev:infra:down`.

## Usage

### Create the first journey with MCP

Give your MCP-capable agent this prompt:

> Welcome new users with one friendly email, then end the journey.

Rachet's MCP skill guides the agent through discovery, authoring, validation, and simulation. The agent must ask before publishing or enrolling a real contact. For a more involved example with a reminder and activation event, follow the [welcome + nudge tutorial](examples/welcome-nudge/).

### Send product events

```sh
rachet call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "product-activation:ACTIVITY_ID",
  "eventType": "product.activated",
  "data": { "plan": "pro" }
}'
```

Keep `eventId` stable across retries. Production applications call the same `event.emit` operation over HTTP with a scoped machine credential, and MCP clients use `event_emit`. Complete CLI, HTTP, and MCP examples are in [Sending product events](docs/EVENTS.md).

### Trigger a journey from product code

```ts
import { RachetSdk } from '@socialrobot-io/rachet-sdk';

const rachet = new RachetSdk({
  url: process.env.REFLOW_URL,
  workspaceId: process.env.REFLOW_WORKSPACE_ID,
  apiKey: process.env.REFLOW_API_KEY, // user-bound key with the send scope
});

await rachet.trigger({
  workflowVersionId: 'WORKFLOW_VERSION_ID',
  contact: { email: 'user@example.com' },
  idempotencyKey: 'activation-welcome:user@example.com',
});
```

The SDK upserts the contact and starts an idempotent enrollment. Keep the API key server-side; browser bundles must call your own backend endpoint.

### Operate Rachet

```sh
rachet workflow show --name "Activation welcome"
rachet call enrollment.list
rachet call message.list
```

The operations console at [rachet.dev](https://rachet.dev) shows journey graphs, live enrollments, timelines, messages, OAuth consent, and connected apps.

Signed-out visitors see the public landing page at `/`; signed-in users continue to `/workflows`. The landing page is always available at `/welcome`, as a single-screen hero using the dashboard’s typography, colors, and UI components. Run `pnpm dev:dashboard` to preview the page independently of the backend. Sign-in and the operations console require the full development stack.

The public interface is branded **Rachet**, using Inter Tight and IBM Plex Mono. Logo assets and typography rules are documented in [Brand](docs/BRAND.md). The published CLI and SDK use the Rachet names; internal server contracts and environment variables retain historical `reflow` identifiers where they are part of the wire contract.

Production landing HTML is prerendered for crawlers, with a branded social preview, canonical URL, and structured metadata. The backend uses `PUBLIC_URL` for sharing URLs, `robots.txt`, and `sitemap.xml`; app and sign-in routes are excluded from indexing. See [Social preview and search](docs/BRAND.md#social-preview-and-search) for deployment verification.

## Architecture

![Rachet architecture: MCP, CLI, HTTP, and dashboard over shared operations and authorization, backed by PostgreSQL and Temporal, sending through Resend](docs/assets/architecture.png)

| Concept | Meaning |
| --- | --- |
| Journey / workflow | A graph of actions, waits, branches, events, and end states |
| Workflow version | Immutable graph used by new enrollments |
| Template version | Immutable rendered content pinned by a send action |
| Enrollment | One durable run for one contact |
| Event | A named product fact that can resume a waiting enrollment |
| Action | A channel or data operation such as `email.send` or `contact.update` |

See [Architecture](docs/ARCHITECTURE.md) for the full design.

## Configuration

Server variables, documented in [`.env.example`](.env.example):

| Variable | Purpose |
| --- | --- |
| `REFLOW_DOMAIN`, `PUBLIC_URL` | Public hostname and URL of the deployment |
| `GOOGLE_ANALYTICS_ID` | Optional Google Analytics measurement ID, for example `G-X7CL1NYLSM`; unset disables tracking |
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Auth signing secret, at least 32 random characters |
| `REFLOW_SETUP_SECRET` | High-entropy secret required by the one-time first-admin page |
| `ALLOW_REGISTRATION` | Public registration, disabled by default |
| `TRUSTED_ORIGINS` | Origins allowed to call the API |
| `OAUTH_PUBLIC_REDIRECT_ORIGINS`, `OAUTH_PUBLIC_REDIRECT_SCHEMES` | Explicit callback allowlists for public MCP clients |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` | Temporal connection and task routing |
| `INTEGRATION_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypting organization integrations; required in production and must be backed up |
| `AUTH_RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Separate Resend account/key and explicit verified sender used only for magic links; both are required to enable magic links |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub sign-in provider |
| `OAUTH_PROVIDER_ID`, `OAUTH_DISCOVERY_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | Optional human OAuth/OIDC provider |

CLI and SDK environments use `REFLOW_URL` plus `REFLOW_TOKEN` or `REFLOW_API_KEY`; the SDK also reads `REFLOW_WORKSPACE_ID`.

Validation and simulation work without Resend. Before a real enrollment can send email, connect the organization's Resend account in the dashboard and confirm a test send. Domain verification and webhook setup are covered in [Resend setup](docs/RESEND.md).

## API

Every operation is defined once and exposed three ways: HTTP `POST /v1/operations/<operation>`, an MCP tool with dots converted to underscores, and the generic `rachet call` CLI command.

| Operations | Effect |
| --- | --- |
| `system.capabilities`, `auth.whoami`, `workspace.list` | Discover runtime, current access, and workspaces |
| `account.create` | Deployment administrator authorizes a passwordless account registration |
| `credential.create`, `credential.list`, `credential.revoke` | Organization-bound SDK API keys; secrets are returned only at creation |
| `template.create`, `template.list`, `template.revise`, `template.publish`, `template.archive`, `template.render` | Manage, render, and publish HTML or plain templates |
| `workflow.actions` | List the installed action registry |
| `workflow.create`, `workflow.list`, `workflow.validate`, `workflow.simulate`, `workflow.publish` | Author, check, trace, and version capability graphs |
| `contact.upsert`, `contact.list` | Manage enrolled contacts |
| `enrollment.create`, `enrollment.list`, `enrollment.pause`, `enrollment.resume`, `enrollment.cancel` | Start, inspect, and control durable executions |
| `event.emit` | Durably accept a stable event ID; identical retries are no-ops |
| `message.list`, `webhook_event.list` | Inspect the send ledger and verified Resend events |

MCP also serves `reflow://operations`, `reflow://workflow/schema`, and `reflow://workflow/actions`, plus the `design-workflow` authoring prompt and the first-party agent skill. The full contract is in [Operations and MCP contract](docs/OPERATIONS.md).

## Project Structure

```text
apps/
├── dashboard/        # React operations console and OAuth UI
└── server/           # Hono API, Better Auth, Temporal workers, Resend adapter
packages/
├── contracts/        # Shared operation and journey schemas
├── cli/              # @socialrobot-io/rachet CLI
├── sdk/              # @socialrobot-io/rachet-sdk for server actions and UI backends
└── mcp-ext-skills/   # MCP skills extension shim
docs/                 # Architecture, authentication, deployment, operations, events guides
examples/             # welcome-nudge tutorial and MCP client configs
migrations/           # PostgreSQL migrations
scripts/              # Dev orchestration, deployment, workflow bundling
skills/               # First-party agent skill
tests/                # Repository validation suite
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 22+, TypeScript 5.9, pnpm 11 |
| API | Hono, Better Auth (OAuth provider, API keys), MCP SDK |
| Orchestration | Temporal durable workflows with replay checks |
| Data | PostgreSQL, Drizzle ORM |
| Email | React Email, Resend |
| Dashboard | React 19, Vite |
| Workspace | Nx 23, Docker Compose, Caddy TLS |

## Deployment

Before enabling public signups, review the [production readiness assessment](docs/PRODUCTION_READINESS.md).

Point a hostname at a Linux server with Docker and ports 80/443 available, then run:

```sh
./scripts/deploy.sh reflow.example.com admin@example.com
```

The script generates deployment secrets, builds the stack, configures Caddy TLS, runs migrations, and performs idempotent admin setup. See [Deployment](docs/DEPLOYMENT.md) for Coolify, external ingress, backups, and production topology.

CI runs the same `make check` gate on every push and pull request.

## Contributing

Contributions follow the standard fork, branch, commit, pull request workflow. Before opening a PR, run the complete release gate:

```sh
make check
```

It runs repository validation, linting, typechecks, backend and dashboard tests, Temporal replay checks, all builds, Compose validation, and an npm package dry run. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full rules, and update the docs and [agent skill](skills/reflow/SKILL.md) when behavior changes. The CLI release process is documented in [Releasing](docs/RELEASING.md).

Rachet is early. If you try it, open an issue and tell us where setup hurt, which journey actions you need next, and whether the MCP flow felt natural.

## License

Rachet is licensed under the [GNU Affero General Public License v3.0](LICENSE) only (`AGPL-3.0-only`).
