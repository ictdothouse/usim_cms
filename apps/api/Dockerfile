# Build from repo root: docker build -f apps/api/Dockerfile -t ucms-api .
# Runtime config via env vars only (DATABASE_URL, PORT, SESSION_SECRET, ...)
# — see apps/api/.env.example. No .env file is baked into or read from the image.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/element-schema/package.json packages/element-schema/package.json
RUN pnpm install --frozen-lockfile
COPY packages/element-schema packages/element-schema
COPY apps/api apps/api
# @ucms/element-schema (apps/api's own dependency, see its package.json)
# ships no dist/ in the repo — build it before apps/api, which imports its
# compiled output via the workspace symlink.
RUN pnpm --filter @ucms/element-schema build
RUN pnpm --filter @ucms/api build
# Test gate: a failing test here fails this whole image build, which fails
# `docker compose build` in scripts/deploy.sh (set -e) before any live
# container is ever touched — see CLAUDE.md's Deployment section.
RUN pnpm --filter @ucms/api test
RUN pnpm --filter @ucms/api deploy --prod --legacy /app/deploy/api

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy/api ./
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1
CMD ["node", "dist/index.js"]
