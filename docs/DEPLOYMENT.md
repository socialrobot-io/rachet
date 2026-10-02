# Deployment

## Fastest path: one host

On a Linux server with Docker Engine, Docker Compose, public DNS, and ports 80/443 available, point the hostname at the server and run:

```sh
./scripts/deploy.sh rachet.example.com admin@example.com
```

For a new installation, the script generates secrets under `.rachet/`, builds and starts the stack, enables Caddy TLS, and runs migrations. Re-run the same command to deploy an update. For an installation created before the rename, the script reuses its production environment file, database, and Temporal namespace. Configure magic-link or GitHub credentials in the selected production environment file, then open the dashboard and use its one-time first-admin page with the setup secret in that file.

The sections below cover manual deployments, external ingress, Coolify, backups, and production customization.

## Prerequisites

Use a Linux host with Docker Engine and the Compose plugin, public DNS for `RACHET_DOMAIN`, and an HTTPS ingress in front of `app:3000`. Workflow email requires each organization to connect its own verified Resend account and webhook at the organization-specific URL shown during onboarding.

For local development without a public domain, use `compose.dev.yaml` and the host process workflow in [README.md](../README.md). Do not use `compose.yaml` on a laptop unless you have real DNS and a working HTTPS front door. Configure Resend using the [Resend setup guide](RESEND.md).

Copy `.env.example` to `.env.local` and set `RACHET_DOMAIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `TEMPORAL_POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `RACHET_SETUP_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `UNSUBSCRIBE_SIGNING_KEYS`, `UNSUBSCRIBE_SUPPORT_EMAIL`, and either the authentication Resend or GitHub settings. Generate the integration and unsubscribe signing keys with `openssl rand -base64 32` and back them up; each key must be identical in the app, worker, and dispatcher. Keep the unsubscribe signing key stable so links in already-sent mail remain valid. Set the unsubscribe support email to a monitored address. Magic links require both `AUTH_RESEND_API_KEY` and `AUTH_EMAIL_FROM`; the sender domain must be verified in that separate authentication Resend account. Quote values containing spaces or shell punctuation. Keep `.env.local` mode `0600` and never commit it.

Start and inspect the deployment:

```sh
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
docker compose ps
docker compose --env-file .env.local logs migrate temporal-schema temporal-namespace
```

After migrations finish, open `https://RACHET_DOMAIN/auth/login`. The setup page appears only while there are no users and requires `RACHET_SETUP_SECRET`. Setup is guarded by database locking and an initialization marker; a concurrent or later attempt cannot create another deployment administrator.

## Ingress

By default the Compose stack does not publish host ports. Terminate TLS outside the stack (Coolify, Traefik, Cloudflare, nginx, or similar) and reverse-proxy to `app` on port `3000`. Set `RACHET_DOMAIN`, `PUBLIC_URL`, and `TRUSTED_ORIGINS` to that HTTPS hostname. The operations console is served from the same `app` origin, so operators open `https://RACHET_DOMAIN/` after signing in.

Optional built-in Caddy is available for bare hosts that need Compose to own ports 80/443 and ACME certificates. It is gated behind the Compose profile `caddy` and is off unless you enable it:

```sh
# one-shot
docker compose --env-file .env.local --profile caddy up -d

# or persistently
export COMPOSE_PROFILES=caddy
docker compose --env-file .env.local up -d
```

When the `caddy` profile is enabled, also set `ACME_EMAIL`, point DNS at the host, and allow inbound TCP 80/443. Do not enable the profile on a host where another proxy already binds those ports.

## Operations

Rachet PostgreSQL and Temporal PostgreSQL use named volumes and are isolated from the public network. Application containers use read-only root filesystems, a non-root user, and `no-new-privileges`. When the `caddy` profile is enabled, only Caddy publishes host ports and obtains or renews TLS certificates.

Back up both PostgreSQL databases, the integration encryption key, and, if you use the `caddy` profile, Caddy data. Test restore procedures regularly. Before upgrades, read release notes for Better Auth, Temporal server and SDK, PostgreSQL, Resend SDK, and (if used) Caddy. Build a new immutable Rachet image, run migrations, then recreate app, worker, and dispatcher. Published workflow definitions and the prebundled Temporal workflow interpreter remain compatible within schema version `1`; introduce a new schema version for incompatible graph changes.

Monitor `/health/ready`, container restarts, Temporal task-queue backlog, outbox attempts, `needs_attention` enrollments, unknown send intents, and unprocessed webhook events. Rotate Better Auth, database, and OAuth credentials through `.env.local` or Coolify secret variables. Organization admins rotate Resend credentials in the dashboard; review in-flight sends first. Rotating the integration encryption key requires re-encrypting every stored connection, not merely changing the environment variable.

The Compose stack runs the self-hosted `temporalio/server` binary with a persistent PostgreSQL history/visibility store and a separate schema migration container. The Rachet worker loads a prebuilt workflow bundle; it does **not** use `temporal server start-dev` or bundle workflows at startup. Production Compose uses `production-sql.yaml`, without the development-only cache-refresh override. This is production-mode software, but the one-host, one-Temporal-server layout is **not highly available** and its internal Temporal frontend has no mTLS. Keep the Compose network private; use Temporal Cloud or an appropriately secured, redundant cluster for stronger availability and isolation. Do not enable Temporal 1.29's preview fairness dynamic switch on a queue with existing backlog; that rollout can strand queued tasks. Rachet currently limits admission to 100 new and 1000 active enrollments per organization instead.

Single-host Compose is suitable when the host, database volumes, backups, and restore targets meet the deployment's availability objective. Multi-host failover requires an external highly available PostgreSQL service, multiple Rachet workers and API replicas, and a production Temporal cluster or Temporal Cloud.

### Rotate the integration encryption key

Do not change `INTEGRATION_ENCRYPTION_KEY` alone; that would make saved Resend connections unreadable. Back up the application database and the old key first. Stop the `app`, `worker`, and `dispatcher` containers so nothing can save or use connections during rotation. Put `DATABASE_URL`, `OLD_INTEGRATION_ENCRYPTION_KEY`, and a newly generated `NEW_INTEGRATION_ENCRYPTION_KEY` in a local, mode-`0600` `.env` file that is not committed. From a trusted host with database access and the repository dependencies installed, run:

```sh
node --env-file=.env.rotation --import tsx scripts/rotate-integration-key.ts
node --env-file=.env.rotation --import tsx scripts/rotate-integration-key.ts --apply
```

The first command decrypts every saved connection and rolls back, verifying the old key without changing data. `--apply` re-encrypts all connections and fingerprints in a single database transaction. After it succeeds, set `INTEGRATION_ENCRYPTION_KEY` to the new value in the deployment `.env` file and restart the stack. Keep the backup and old key until a connection test and webhook have succeeded; do not paste keys into logs or support tickets. The script does not rotate the Resend API keys themselves.

## Coolify

Coolify can deploy the checked-in `compose.yaml` directly. Leave the `caddy` profile disabled (the default) and attach your domain to the `app` service so Coolify's proxy terminates TLS and forwards to the container (which listens on `3000`). A plain `https://your.domain` Domains entry is enough; you do not need to put `:3000` in the domain field. That same hostname serves the API, MCP, webhooks, and the operations console. Set the variables below in the Coolify service environment; Coolify substitutes them into the Compose file at deploy time. The Temporal scripts and Temporal dynamic configuration are baked into their service images so the stack does not depend on Coolify's temporary checkout directory after deployment. Do not commit these values to Git, and restrict access to the Coolify project:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | random PostgreSQL password |
| `COMPOSE_PROJECT_NAME` | `rachet` for a new stack; keep the existing value for an upgrade |
| `RACHET_DB_NAME`, `RACHET_DB_USER` | `rachet` for a new database; keep the existing names for an upgrade |
| `DATABASE_URL` | `postgresql://rachet:PASSWORD@postgres:5432/rachet` for a new stack |
| `TEMPORAL_POSTGRES_PASSWORD` | random Temporal database password |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` output |
| `RACHET_SETUP_SECRET` | separate `openssl rand -base64 32` output |
| `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` | `rachet` and `rachet-enrollments` for a new stack; keep the existing values for an upgrade |
| `INTEGRATION_ENCRYPTION_KEY` | separate `openssl rand -base64 32` output; back up securely |
| `UNSUBSCRIBE_SIGNING_KEYS` | `openssl rand -base64 32` output; use the same value in API, worker, and dispatcher; back it up and keep it stable |
| `UNSUBSCRIBE_SUPPORT_EMAIL` | monitored support address shown on unsubscribe pages |
| `RACHET_API_KEY`, `RACHET_WORKSPACE_ID` | Optional. A send-scoped API key and its organization, used by the product welcome SDK client. Set both, or leave both empty. |
| `AUTH_RESEND_API_KEY` | magic-link key from a Resend account separate from workflow delivery |
| `AUTH_EMAIL_FROM` | explicit sender on a domain verified in the authentication Resend account; required for magic links |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials (alternative or additional sign-in) |
| `OAUTH_CLIENT_SECRET` | OIDC client secret, or leave empty when OIDC is disabled |
| `OAUTH_PUBLIC_REDIRECT_ORIGINS` | comma-separated exact HTTPS origins for reviewed web clients; empty by default |
| `OAUTH_PUBLIC_REDIRECT_SCHEMES` | comma-separated installed native-client schemes; defaults to `cursor` |

Set `RACHET_DOMAIN`, `PUBLIC_URL`, and `TRUSTED_ORIGINS` to the same HTTPS hostname Coolify assigns, then deploy. `ACME_EMAIL` is not required unless you enable the `caddy` profile.

When upgrading an existing stack, keep its Compose project name, database URL and names, named volumes, Temporal namespace and task queue, and all secrets. For releases that add required variables, add them to the Coolify environment for API, worker, and dispatcher before deploying. `RACHET_*` settings accept the earlier names as fallbacks. Change one setting at a time only after confirming the running stack still reads its saved data.

Leave `OAUTH_PUBLIC_REDIRECT_ORIGINS` empty for CLI and loopback MCP clients. Cursor's current MCP OAuth flow uses `https://www.cursor.com`; add that exact origin when enabling Cursor against a deployment. `OAUTH_PUBLIC_REDIRECT_SCHEMES` defaults to `cursor`; keep it to the comma-separated native clients installed in your environment. Add only exact HTTPS origins for web MCP clients you have reviewed. Operators authorize clients in the dashboard and can revoke grants from **Connected apps**.

After the stack is healthy, verify `/health/ready`, open the dashboard, and complete the one-time setup page. The onboarding screen provides the exact per-organization Resend webhook URL.

### Health checks

| Probe | Path | Use |
| --- | --- | --- |
| Liveness | `GET /health/live` | Process is up; does not query PostgreSQL. |
| Readiness | `GET /health/ready` | Returns `200` when PostgreSQL answers; `503` otherwise. |

The production **app** image includes `curl` and `docker/healthcheck-ready.js`, which calls readiness on `127.0.0.1:3000`. The Dockerfile does **not** declare an image `HEALTHCHECK`. Coolify treats any `HEALTHCHECK` line in that file as required for every application built from it, including worker and dispatcher targets, and will roll back a deploy that never reports `healthy`. The Compose `app` service sets the probe instead. Worker and dispatcher images have no probe.

For a **single Compose stack**, use the repository root `docker-compose.yaml` (which includes `compose.yaml`), attach domains to the `app` service, and enable the HTTP health check on `app` only: path `/health/ready`, port `3000`, scheme `http`, host `localhost`, expected status `200`. A `start_period` of at least 40 seconds avoids false negatives while migrations and Temporal bootstrap finish.

For **split Coolify applications** (separate resources for API, worker, and dispatcher), create three Dockerfile-based apps from `socialrobot-io/rachet` on the same server and Docker network. Copy environment variables from the API app to worker and dispatcher. Set **Docker build stage target** on each resource:

| Coolify application | Dockerfile target | Domains | Coolify HTTP health check |
| --- | --- | --- | --- |
| API (e.g. `ratchet-app`) | `app` | Your public hostname | Enabled (`/health/ready` on port `3000`) |
| `ratchet-worker` | `worker` | None | Disabled (no image-level probe) |
| `ratchet-dispatcher` | `dispatcher` | None | Disabled |

Run database migrations on the API app only (`node dist/apps/server/db/migrate.js` as pre-deployment command). Deploy all three from the same commit on each release so the workflow bundle matches the API. Before sending from an existing workflow, review its email purpose (`transactional` or `marketing`) and republish it; versions published before this release have no recorded purpose review and their sends will pause until republished. Monitor worker and dispatcher through runtime logs and restart counts, Temporal backlog, and database volume backups.

### Temporal schema troubleshooting

The `temporal-schema` service is a one-shot migration container. If Coolify reports `service "temporal-schema" didn't complete successfully: exit 2`, open that service's own logs; the deployment summary only shows Compose orchestration. From a server shell, the equivalent command is:

```sh
docker compose --env-file .env.local logs --no-color temporal-schema
```

The schema bootstrap prints the failing database and phase. A password-authentication error usually means `TEMPORAL_POSTGRES_PASSWORD` was changed after the `temporal-db` named volume was initialized. PostgreSQL only applies `POSTGRES_PASSWORD` on first initialization, so restore the original Coolify variable for that volume and redeploy. For a brand-new installation with no data to preserve, delete the unused `temporal-db` volume from Coolify and deploy again; do not remove it from a live installation.

The `NODE_ENV=production` build warning is informational here: the image explicitly installs development dependencies while compiling, then copies only the production runtime into the final image.
