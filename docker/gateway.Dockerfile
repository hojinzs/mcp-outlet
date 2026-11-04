# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/builtin-connectors/package.json packages/builtin-connectors/

FROM base AS web
RUN pnpm install --frozen-lockfile --filter @mcp-outlet/web
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @mcp-outlet/web build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "@mcp-outlet/gateway..."
COPY packages/shared packages/shared
COPY packages/builtin-connectors packages/builtin-connectors
COPY apps/gateway apps/gateway
COPY --from=web /app/apps/web/dist apps/web/dist
ENV WEB_DIST_DIR=/app/apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/gateway/src/main.ts"]
