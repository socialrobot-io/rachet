# Deployment

## Fastest path: one host

On a Linux server with Docker Engine, Docker Compose, public DNS, and ports 80/443 available, point the hostname at the server and run:

```sh
./scripts/deploy.sh reflow.example.com admin@example.com
```

The script generates secrets under `.reflow/`, builds and starts the complete stack, enables Caddy TLS, runs migrations, and performs idempotent first-admin setup. Re-run the same command to deploy an update. After the first successful login, move or securely delete `.reflow/production-admin-password`.

The sections below cover manual deployments, external ingress, Coolify, backups, and production customization.

## Prerequisites

Use a Linux host with Docker Engine and the Compose plugin, public DNS for `REFLOW_DOMAIN`, and an HTTPS ingress in front of `app:3000`. SMTP delivery also requires a verified Resend domain and a configured Resend webhook pointing to `https://REFLOW_DOMAIN/webhooks/resend`.

For local development without a public domain, use `compose.dev.yaml` and the host process workflow in [README.md](../README.md). Do not use `compose.yaml` on a laptop unless you have real DNS and a working HTTPS front door. Configure Resend using the [Resend setup guide](RESEND.md).

Copy `.env.example` to `.env.local` and set `REFLOW_DOMAIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `TEMPORAL_POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `REFLOW_FROM`, and optional OIDC/Resend settings. Quote values containing spaces or shell punctuation, for example `REFLOW_FROM="Example App <no-reply@mail.example.com>"`. Keep `.env.local` mode `0600` and never commit it. Compose interpolation uses these values when you run `docker compose --env-file .env.local ...`.

Start and inspect the deployment:

```sh
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
docker compose ps
docker compose --env-file .env.local logs migrate temporal-schema temporal-namespace
```

Create the one-time deployment administrator after migrations finish:

```sh
docker compose --env-file .env.local run --rm \
  app node dist/apps/server/setup.js \
  --email admin@example.com --name Admin \
  --password-file /path/to/admin_password
```

Setup is guarded by a PostgreSQL advisory lock and an initialization marker. A second run fails without creating another deployment administrator. Keep the one-time admin password outside the repository and remove it after setup.

## Ingress

By default the Compose stack does not publish host ports. Terminate TLS outside the stack (Coolify, Traefik, Cloudflare, nginx, or similar) and reverse-proxy to `app` on port `3000`. Set `REFLOW_DOMAIN`, `PUBLIC_URL`, and `TRUSTED_ORIGINS` to that HTTPS hostname. The operations console is served from the same `app` origin, so operators open `https://REFLOW_DOMAIN/` after signing in.

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

Reflow PostgreSQL and Temporal PostgreSQL use named volumes and are isolated from the public network. Application containers use read-only root filesystems, a non-root user, and `no-new-privileges`. When the `caddy` profile is enabled, only Caddy publishes host ports and obtains or renews TLS certificates.

Back up both PostgreSQL databases and, if you use the `caddy` profile, Caddy data. Test restore procedures regularly. Before upgrades, read release notes for Better Auth, Temporal server and SDK, PostgreSQL, Resend SDK, and (if used) Caddy. Build a new immutable Reflow image, run migrations, then recreate app, worker, and dispatcher. Published workflow definitions and the prebundled Temporal workflow interpreter remain compatible within schema version `1`; introduce a new schema version for incompatible graph changes.

Monitor `/health/ready`, container restarts, Temporal task-queue backlog, outbox attempts, `needs_attention` enrollments, unknown send intents, and unprocessed webhook events. Rotate Better Auth, database, OAuth, and provider credentials through `.env.local` or Coolify secret variables. Rotating a Resend webhook secret requires coordinated endpoint configuration.

Single-host Compose is suitable when the host, database volumes, backups, and restore targets meet the deployment's availability objective. Multi-host failover requires an external highly available PostgreSQL service, multiple Reflow workers and API replicas, and a production Temporal cluster or Temporal Cloud.

## Coolify

Coolify can deploy the checked-in `compose.yaml` directly. Leave the `caddy` profile disabled (the default) and attach your domain to the `app` service so Coolify's proxy terminates TLS and forwards to the container (which listens on `3000`). A plain `https://your.domain` Domains entry is enough; you do not need to put `:3000` in the domain field. That same hostname serves the API, MCP, webhooks, and the operations console. Set the variables below in the Coolify service environment; Coolify substitutes them into the Compose file at deploy time. The Temporal scripts and Temporal dynamic configuration are baked into their service images so the stack does not depend on Coolify's temporary checkout directory after deployment. Do not commit these values to Git, and restrict access to the Coolify project:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | random PostgreSQL password |
| `DATABASE_URL` | `postgresql://reflow:PASSWORD@postgres:5432/reflow` |
| `TEMPORAL_POSTGRES_PASSWORD` | random Temporal database password |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` output |
| `RESEND_API_KEY` | Resend API key (optional for simulation) |
| `RESEND_WEBHOOK_SECRET` | Resend signing secret (optional without webhooks) |
| `OAUTH_CLIENT_SECRET` | OIDC client secret, or leave empty when OIDC is disabled |
| `OAUTH_PUBLIC_REDIRECT_ORIGINS` | comma-separated exact HTTPS origins for reviewed web clients; empty by default |
| `OAUTH_PUBLIC_REDIRECT_SCHEMES` | comma-separated installed native-client schemes; defaults to `cursor` |

Set `REFLOW_DOMAIN`, `REFLOW_FROM`, `PUBLIC_URL`, and `TRUSTED_ORIGINS` to the same HTTPS hostname Coolify assigns, then deploy. `ACME_EMAIL` is not required unless you enable the `caddy` profile.

Leave `OAUTH_PUBLIC_REDIRECT_ORIGINS` empty for CLI and loopback MCP clients. `OAUTH_PUBLIC_REDIRECT_SCHEMES` defaults to `cursor`; keep it to the comma-separated native clients installed in your environment. Add only exact HTTPS origins for web MCP clients you have reviewed. Operators authorize clients in the dashboard and can revoke grants from **Connected apps**.

After the stack is healthy, run the one-time setup command from the Coolify server or an attached shell with a temporary password file outside the repository. Configure Resend's webhook URL as `https://<your-domain>/webhooks/resend` and verify `/health/ready` before signing in. Coolify should monitor the `app` health check; separately alert on worker/dispatcher restarts, Temporal backlog, and database volume backups.

### Temporal schema troubleshooting

The `temporal-schema` service is a one-shot migration container. If Coolify reports `service "temporal-schema" didn't complete successfully: exit 2`, open that service's own logs; the deployment summary only shows Compose orchestration. From a server shell, the equivalent command is:

```sh
docker compose --env-file .env.local logs --no-color temporal-schema
```

The schema bootstrap prints the failing database and phase. A password-authentication error usually means `TEMPORAL_POSTGRES_PASSWORD` was changed after the `temporal-db` named volume was initialized. PostgreSQL only applies `POSTGRES_PASSWORD` on first initialization, so restore the original Coolify variable for that volume and redeploy. For a brand-new installation with no data to preserve, delete the unused `temporal-db` volume from Coolify and deploy again; do not remove it from a live installation.

The `NODE_ENV=production` build warning is informational here: the image explicitly installs development dependencies while compiling, then copies only the production runtime into the final image.
