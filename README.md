![Reflow — agent-authored, durable by design](docs/assets/reflow-banner.png)

# Reflow

Reflow is an agent-first workflow engine for durable email automation. People describe an automation in natural language to an MCP agent; the agent reads Reflow's workflow schema and installed action catalog, creates any React Email templates, validates and simulates a graph, and saves it through MCP. The same operations are available through the CLI and HTTP API. There is no operator UI.

The runtime is TypeScript with Hono, Better Auth, Temporal, PostgreSQL, React Email, and a pluggable provider layer. Resend is the first email provider and its signed webhooks update delivery state and suppress hard bounces and complaints.

## Natural-language workflow authoring

Connect an MCP client to `https://YOUR_DOMAIN/mcp` and use the `design-workflow` prompt with a request such as:

> When a trial starts, send a welcome email. Wait three days for an activation event. If it arrives, mark the contact activated; otherwise send a reminder.

The MCP agent translates that request into the validated graph at `reflow://workflow/schema`. It may only use actions listed at `reflow://workflow/actions`; currently these are `email.send` and `contact.update`. Adding a provider or integration registers more named actions without exposing arbitrary code or Temporal workflow names. `workflow_validate` and `workflow_simulate` let the agent resolve errors and show a side-effect-free trace before saving or publishing.

See the [example workflow](examples/onboarding.workflow.json), [product requirements](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [operation catalog](docs/OPERATIONS.md), [authentication](docs/AUTHENTICATION.md), and [deployment guide](docs/DEPLOYMENT.md).

## Local development

Requires Node.js 22, pnpm 11, and Docker Compose for local PostgreSQL + Temporal. No public domain or TLS is required: the API listens on `http://localhost:3000`, which matches `.cursor/mcp.json`.

```sh
cp .env.dev.example .env
pnpm install --frozen-lockfile
make dev-infra
pnpm migrate
mkdir -p secrets && umask 077 && openssl rand -base64 18 > secrets/admin_password
pnpm setup -- --email admin@example.com --name Admin --password-file ./secrets/admin_password
pnpm dev
pnpm dev:worker
pnpm dev:dispatcher
```

Build and link the local CLI once if you want to invoke it as `reflow` while developing:

```sh
pnpm build
pnpm link --global
```

`compose.dev.yaml` publishes Postgres on `localhost:5433`, Temporal on `localhost:7233`, and the Temporal Web UI on `http://localhost:8080` (default namespace `reflow`) with fixed local passwords (`reflow` / `temporal`). Port `5433` avoids clashing with a host Postgres on `5432`. Stop infra with `make dev-infra-down`. Do not use this file for production; production Compose is `compose.yaml` with Caddy and secret files.

MCP clients should use `http://localhost:3000/mcp` with a session bearer token or API key.

Call any operation through one stable CLI command:

```sh
export REFLOW_URL=http://localhost:3000
export REFLOW_TOKEN=YOUR_SESSION_OR_ACCESS_TOKEN
reflow call workflow.actions
reflow call workflow.validate --file ./workflow-input.json
reflow call workflow.simulate --file ./simulation-input.json
```

Log in once, select an available workspace, and open the interactive Ink terminal UI:

```sh
reflow auth login
reflow
```

The login prompt stores the server session and selected workspace in `~/.config/reflow/config.json` with owner-only permissions. `XDG_CONFIG_HOME` and `REFLOW_CONFIG_PATH` can relocate it. Run `reflow workspace list` or `reflow workspace use` to switch later. Environment variables remain temporary overrides.

Plain `reflow` opens the remembered workspace. Use arrow keys or `j`/`k` to select, `/` to filter, `m` to switch between the compact flow and rendered Mermaid diagram, arrow keys or `h`/`l` to pan a wide Mermaid view, `r` to refresh, and `q` to quit. The TUI calls the same authenticated `workspace.list` and `workflow.list` operations as MCP and `reflow call`; it does not connect directly to PostgreSQL or Temporal.

Running a protected command before login exits cleanly with `Run \`reflow auth login\``. An expired or rejected saved session gives the same recovery path without printing a JavaScript stack trace.

For scripts and terminal scrollback, render one workflow without starting the TUI:

```sh
reflow workflow show --name "Trial onboarding"
reflow workflow show --name "Trial onboarding" --format mermaid-terminal
reflow workflow show --name "Trial onboarding" --format mermaid > workflow.mmd
```

Both terminal views use Unicode box drawing and work in ordinary terminals and over SSH. The Mermaid view parses the generated Mermaid flowchart and lays it out as connected terminal boxes inside Ink. Mermaid source remains available for external Mermaid-compatible tools.

Human authentication supports email/password and a configured OIDC provider. Better Auth serves OAuth authorization-server metadata for MCP. `reflow auth login` currently performs an interactive email/password login without echoing the password; `--email` and `--password-file` remain available for automation. Session bearer tokens, OAuth access tokens, and user-bound API keys can authorize operations. Initial setup creates exactly one deployment administrator and workspace. Administrators create later accounts; self-registration is available only with `ALLOW_REGISTRATION=true`.

## Docker Compose deployment

Create `.env` from `.env.example` and create each file under `secrets/`. `secrets/database_url` should contain a URL such as `postgresql://reflow:PASSWORD@postgres:5432/reflow`, using the same password as `secrets/postgres_password`. Set `REFLOW_DOMAIN` and `ACME_EMAIL`, then run `docker compose build` and `docker compose up -d`.

Production Compose runs separate Reflow and Temporal PostgreSQL databases, explicit Temporal schema and namespace initialization, migrations, API, worker, outbox dispatcher, and Caddy TLS. Database volumes persist across restarts. The detailed initial-admin and backup procedure is in the [deployment guide](docs/DEPLOYMENT.md).

## Verification

```sh
make check
```

This runs repository hygiene, TypeScript type checking, lint, unit tests, a production build with a prebundled Temporal workflow, and Compose validation when the plugin is available.

The installable [Reflow agent skill](skills/reflow/SKILL.md) teaches agents the authoring and operating flow. Official implementation skills and pinned revisions are documented in [skills setup](docs/SKILLS.md).
