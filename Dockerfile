FROM node:22.22.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/cli/package.json ./packages/cli/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/mcp-ext-skills/package.json ./packages/mcp-ext-skills/
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
USER reflow
EXPOSE 3000
CMD ["node", "dist/apps/server/server.js"]
