# syntax=docker/dockerfile:1
FROM node:24-slim
# stdio 커넥터용 Python. PyPI 패키지는 커넥터별 venv에 설치한다
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/runner/package.json apps/runner/
COPY packages/shared/package.json packages/shared/
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "@mcp-outlet/runner..."
COPY packages/shared packages/shared
COPY apps/runner apps/runner
VOLUME /data
EXPOSE 4000
# 커넥터별 OS 사용자로 자식 프로세스를 띄워야 하므로 root로 실행한다
CMD ["node", "apps/runner/src/main.ts"]
