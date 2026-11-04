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
# slim 이미지에는 curl·wget이 없어 node로 확인한다 (Coolify 헬스체크는 끄고 이것을 쓴다)
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/gateway/src/main.ts"]
