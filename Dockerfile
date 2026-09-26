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

FROM node:22.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && groupadd --system reflow && useradd --system --gid reflow --home /app reflow
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
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=10 \
  CMD ["node", "docker/healthcheck-ready.js"]
CMD ["node", "dist/apps/server/server.js"]
