FROM node:22.22.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/cli/package.json ./packages/cli/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/mcp-ext-skills/package.json ./packages/mcp-ext-skills/
COPY packages/sdk/package.json ./packages/sdk/
# The build needs TypeScript, tsx, and other devDependencies even when the
# deployment platform exposes NODE_ENV=production while building.
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm build

# Shared runtime for worker, dispatcher, and one-shot jobs (no HTTP health probe).
FROM node:22.22.0-bookworm-slim AS runtime-base
ENV NODE_ENV=production
RUN corepack enable \
  && groupadd --system rachet \
  && useradd --system --gid rachet --home /app rachet
WORKDIR /app
COPY --from=build --chown=rachet:rachet /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=rachet:rachet /app/node_modules ./node_modules
COPY --from=build --chown=rachet:rachet /app/dist ./dist
COPY --from=build --chown=rachet:rachet /app/migrations ./migrations
COPY --from=build --chown=rachet:rachet /app/skills ./skills
COPY --from=build --chown=rachet:rachet /app/packages/contracts ./packages/contracts
COPY --from=build --chown=rachet:rachet /app/packages/mcp-ext-skills ./packages/mcp-ext-skills
COPY --from=build --chown=rachet:rachet /app/packages/sdk ./packages/sdk
USER rachet

FROM runtime-base AS worker
CMD ["node", "dist/apps/server/worker.js"]

FROM runtime-base AS dispatcher
CMD ["node", "dist/apps/server/dispatcher.js"]

# Same-origin dashboard and Coolify HTTP health probes (curl in image).
FROM node:22.22.0-bookworm-slim AS runtime-app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --system rachet \
  && useradd --system --gid rachet --home /app rachet
WORKDIR /app
COPY --from=build --chown=rachet:rachet /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=rachet:rachet /app/node_modules ./node_modules
COPY --from=build --chown=rachet:rachet /app/dist ./dist
COPY --from=build --chown=rachet:rachet /app/migrations ./migrations
COPY --from=build --chown=rachet:rachet /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build --chown=rachet:rachet /app/skills ./skills
COPY --from=build --chown=rachet:rachet /app/packages/contracts ./packages/contracts
COPY --from=build --chown=rachet:rachet /app/packages/mcp-ext-skills ./packages/mcp-ext-skills
COPY --from=build --chown=rachet:rachet /app/packages/sdk ./packages/sdk
COPY --chown=rachet:rachet docker/healthcheck-ready.js ./docker/healthcheck-ready.js
USER rachet
EXPOSE 3000

# Readiness is not declared in this file. Coolify treats that keyword anywhere
# in the Dockerfile as a probe for every build target, then fails the deploy
# when a worker or dispatcher container has no health status. Compose and the
# Coolify HTTP check attach the probe to the app service only.
FROM runtime-app AS app
CMD ["node", "dist/apps/server/server.js"]
