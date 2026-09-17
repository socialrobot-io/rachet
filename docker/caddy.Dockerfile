FROM caddy:2.10.2-alpine

# Bake the Caddyfile into the image so the runtime does not depend on the
# temporary Coolify checkout directory.
COPY docker/Caddyfile /etc/caddy/Caddyfile
