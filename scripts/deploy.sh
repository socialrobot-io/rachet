#!/usr/bin/env bash
set -euo pipefail

domain="${1:-}"
admin_email="${2:-}"
if [[ -z "$domain" || -z "$admin_email" ]]; then
  echo "Usage: ./scripts/deploy.sh <domain> <admin-email>" >&2
  exit 1
fi
if [[ "$domain" == http://* || "$domain" == https://* || "$domain" == */* ]]; then
  echo "Domain must be a hostname such as reflow.example.com" >&2
  exit 1
fi

mkdir -p .reflow
chmod 700 .reflow
env_file=".reflow/production.env"

if [[ ! -f "$env_file" ]]; then
  postgres_password="$(openssl rand -hex 24)"
  temporal_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -base64 48 | tr -d '\n')"
  setup_secret="$(openssl rand -base64 48 | tr -d '\n')"
  integration_key="$(openssl rand -base64 32 | tr -d '\n')"
  cat > "$env_file" <<EOF
REFLOW_DOMAIN=$domain
ACME_EMAIL=$admin_email
POSTGRES_PASSWORD=$postgres_password
DATABASE_URL=postgresql://reflow:$postgres_password@postgres:5432/reflow
TEMPORAL_POSTGRES_PASSWORD=$temporal_password
BETTER_AUTH_SECRET=$auth_secret
REFLOW_SETUP_SECRET=$setup_secret
INTEGRATION_ENCRYPTION_KEY=$integration_key
AUTH_EMAIL_FROM=
AUTH_RESEND_API_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
ALLOW_REGISTRATION=false
OAUTH_PUBLIC_REDIRECT_ORIGINS=
OAUTH_PUBLIC_REDIRECT_SCHEMES=cursor
EOF
  chmod 600 "$env_file"
fi

docker compose --env-file "$env_file" --profile caddy up -d --build

echo
echo "Reflow is running at https://$domain"
echo "Open the dashboard to create the first administrator."
echo "The one-time setup secret and auth provider settings are in $env_file."
