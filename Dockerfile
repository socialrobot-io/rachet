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
  && groupadd --system reflow \
  && useradd --system --gid reflow --home /app reflow
WORKDIR /app
COPY --from=build --chown=reflow:reflow /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=reflow:reflow /app/node_modules ./node_modules
COPY --from=build --chown=reflow:reflow /app/dist ./dist
COPY --from=build --chown=reflow:reflow /app/migrations ./migrations
COPY --from=build --chown=reflow:reflow /app/skills ./skills
COPY --from=build --chown=reflow:reflow /app/packages/contracts ./packages/contracts
COPY --from=build --chown=reflow:reflow /app/packages/mcp-ext-skills ./packages/mcp-ext-skills
COPY --from=build --chown=reflow:reflow /app/packages/sdk ./packages/sdk
USER reflow

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
  && groupadd --system reflow \
  && useradd --system --gid reflow --home /app reflow
WORKDIR /app
COPY --from=build --chown=reflow:reflow /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=reflow:reflow /app/node_modules ./node_modules
COPY --from=build --chown=reflow:reflow /app/dist ./dist
COPY --from=build --chown=reflow:reflow /app/migrations ./migrations
COPY --from=build --chown=reflow:reflow /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build --chown=reflow:reflow /app/skills ./skills
COPY --from=build --chown=reflow:reflow /app/packages/contracts ./packages/contracts
COPY --from=build --chown=reflow:reflow /app/packages/mcp-ext-skills ./packages/mcp-ext-skills
COPY --from=build --chown=reflow:reflow /app/packages/sdk ./packages/sdk
COPY --chown=reflow:reflow docker/healthcheck-ready.js ./docker/healthcheck-ready.js
USER reflow
EXPOSE 3000

# No image HEALTHCHECK. Coolify scans the whole Dockerfile and waits for a
# healthy status on every app built from this file, including worker and
# dispatcher targets that do not serve HTTP. Compose and Coolify attach the
# readiness probe to the app service only.
FROM runtime-app AS app
CMD ["node", "dist/apps/server/server.js"]
