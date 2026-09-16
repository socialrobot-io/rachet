# Deployment

## Prerequisites

Use a Linux host with Docker Engine, the Compose plugin, public DNS for `REFLOW_DOMAIN`, and inbound TCP 80/443. SMTP delivery also requires a verified Resend domain and a configured Resend webhook pointing to `https://REFLOW_DOMAIN/webhooks/resend`.

For local development without a public domain, use `compose.dev.yaml` and the host process workflow in [README.md](../README.md). Do not use `compose.yaml` on a laptop unless you have real DNS and ACME email. Configure Resend using the [Resend setup guide](RESEND.md).

Copy `.env.example` to `.env`. Set `REFLOW_DOMAIN`, `ACME_EMAIL`, `TRUSTED_ORIGINS`, `REFLOW_FROM`, and optional OIDC settings. Create mode-0600 files:

- `secrets/postgres_password`
- `secrets/database_url`, containing `postgresql://reflow:PASSWORD@postgres:5432/reflow`
- `secrets/temporal_postgres_password`
- `secrets/better_auth_secret`, at least 32 random bytes
- `secrets/resend_api_key`
- `secrets/resend_webhook_secret`
- `secrets/oauth_client_secret`, which may be empty when external OIDC is disabled
- `secrets/admin_password`, at least 12 characters, used only for initial setup

Start and inspect the deployment:

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose logs migrate temporal-schema temporal-namespace
```

Create the one-time deployment administrator after migrations finish:

```sh
docker compose run --rm \
  -v ./secrets/admin_password:/run/secrets/admin_password:ro \
  app node dist/src/cli.js setup \
  --email admin@example.com --name Admin \
  --password-file /run/secrets/admin_password
```

Setup is guarded by a PostgreSQL advisory lock and an initialization marker. A second run fails without creating another deployment administrator. Remove the mounted admin password file after setup.

## Operations

Caddy obtains and renews TLS certificates. Only Caddy publishes host ports. Reflow PostgreSQL and Temporal PostgreSQL use named volumes and are isolated from the public network. Application containers use read-only root filesystems, a non-root user, and `no-new-privileges`.

Back up both PostgreSQL databases and Caddy data. Test restore procedures regularly. Before upgrades, read release notes for Better Auth, Temporal server and SDK, PostgreSQL, Resend SDK, and Caddy. Build a new immutable Reflow image, run migrations, then recreate app, worker, and dispatcher. Published workflow definitions and the prebundled Temporal workflow interpreter remain compatible within schema version `1`; introduce a new schema version for incompatible graph changes.

Monitor `/health/ready`, container restarts, Temporal task-queue backlog, outbox attempts, `needs_attention` enrollments, unknown send intents, and unprocessed webhook events. Rotate Better Auth, database, OAuth, and provider credentials through secret files. Rotating a Resend webhook secret requires coordinated endpoint configuration.

Single-host Compose is suitable when the host, database volumes, backups, and restore targets meet the deployment's availability objective. Multi-host failover requires an external highly available PostgreSQL service, multiple Reflow workers and API replicas, and a production Temporal cluster or Temporal Cloud.

## Coolify

Coolify can deploy the checked-in `compose.coolify.yaml` as a Docker Compose service. Keep the service in raw Compose mode so the `depends_on` conditions, named volumes, Caddy ports, and container security settings are preserved. Set the variables from the table below in the service environment. The regular `compose.yaml` remains the preferred file for hosts where Docker file-backed secrets are available.

Coolify's variant passes secret values as masked runtime environment variables because Coolify Compose services treat the Compose file as the source of truth for mounts. Do not commit these values to Git, and restrict access to the Coolify project:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | random PostgreSQL password |
| `DATABASE_URL` | `postgresql://reflow:PASSWORD@postgres:5432/reflow` |
| `TEMPORAL_POSTGRES_PASSWORD` | random Temporal database password |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` output |
| `RESEND_API_KEY` | Resend API key (optional for simulation) |
| `RESEND_WEBHOOK_SECRET` | Resend signing secret (optional without webhooks) |
| `OAUTH_CLIENT_SECRET` | OIDC client secret, or leave empty when OIDC is disabled |

Set `REFLOW_DOMAIN`, `ACME_EMAIL`, `REFLOW_FROM`, `PUBLIC_URL`, and `TRUSTED_ORIGINS` to the same HTTPS hostname, then deploy. Add a DNS record for the hostname and allow inbound TCP 80/443 so Caddy can obtain its certificate.

After the stack is healthy, run the one-time setup command from the Coolify server or an attached shell, mounting `secrets/admin_password` as documented above. Configure Resend's webhook URL as `https://<your-domain>/webhooks/resend` and verify `/health/ready` before signing in. Coolify should monitor the `app` health check; separately alert on worker/dispatcher restarts, Temporal backlog, and database volume backups.
