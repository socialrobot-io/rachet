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
password_file=".reflow/production-admin-password"

if [[ ! -f "$env_file" ]]; then
  postgres_password="$(openssl rand -hex 24)"
  temporal_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -base64 48 | tr -d '\n')"
  cat > "$env_file" <<EOF
REFLOW_DOMAIN=$domain
ACME_EMAIL=$admin_email
POSTGRES_PASSWORD=$postgres_password
DATABASE_URL=postgresql://reflow:$postgres_password@postgres:5432/reflow
TEMPORAL_POSTGRES_PASSWORD=$temporal_password
BETTER_AUTH_SECRET=$auth_secret
REFLOW_FROM="Reflow <onboarding@resend.dev>"
ALLOW_REGISTRATION=false
OAUTH_PUBLIC_REDIRECT_ORIGINS=
OAUTH_PUBLIC_REDIRECT_SCHEMES=cursor
EOF
  chmod 600 "$env_file"
fi

if [[ ! -f "$password_file" ]]; then
  openssl rand -base64 24 > "$password_file"
  chmod 600 "$password_file"
fi

docker compose --env-file "$env_file" --profile caddy up -d --build
docker compose --env-file "$env_file" run --rm \
  -v "$PWD/.reflow:/run/reflow-secrets:ro" \
  app node dist/apps/server/setup.js \
  --email "$admin_email" \
  --name Admin \
  --password-file /run/reflow-secrets/production-admin-password \
  --if-needed

echo
echo "Reflow is running at https://$domain"
echo "Admin email: $admin_email"
echo "Admin password: $password_file"
echo "After the first successful login, move or delete the password file securely."
