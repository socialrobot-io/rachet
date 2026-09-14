FROM node:22.22.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
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
USER reflow
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
