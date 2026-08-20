# Build from repo root: docker build -f apps/frontend/Dockerfile -t ucms-frontend .
# Runtime config via env vars only (API_URL, PORT, ...). No tenant identity is
# baked in here — it always comes from the request's Host header (CLAUDE.md).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile
COPY apps/frontend apps/frontend
RUN pnpm --filter @ucms/frontend build
RUN pnpm --filter @ucms/frontend deploy --prod --legacy /app/deploy/frontend

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy/frontend ./
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 4321
CMD ["node", "server.mjs"]
