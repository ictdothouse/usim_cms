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
COPY packages/element-style/package.json packages/element-style/package.json
# apps/api has no code dependency on @ucms/element-render (that's admin/
# frontend only) — its package.json is still needed here because `pnpm
# install --frozen-lockfile` resolves the WHOLE workspace graph against
# pnpm-lock.yaml, not just this image's own deps; a missing workspace
# package.json here is ERR_PNPM_WORKSPACE_PKG_NOT_FOUND even though nothing
# in this image imports it. Same class of miss as element-schema/element-style
# above (see apps/admin/Dockerfile's own comment) — a new workspace package
# needs its package.json in every app's Dockerfile, not just the ones that use it.
COPY packages/element-render/package.json packages/element-render/package.json
RUN pnpm install --frozen-lockfile
COPY packages/element-style packages/element-style
COPY packages/element-schema packages/element-schema
COPY apps/api apps/api
# @ucms/element-schema (apps/api's own dependency, see its package.json)
# ships no dist/ in the repo — build it before apps/api, which imports its
# compiled output via the workspace symlink. element-style must build first
# since element-schema's isSafeUrl now delegates to its sanitizeUrl.
RUN pnpm --filter @ucms/element-style build
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
# Created here (not left for storage.ts's own mkdir) so the ownership below
# actually applies to it: docker-compose mounts a named volume at this exact
# path (uploads must survive a blue-green swap, see docker-compose.yml), and
# an empty named volume mounted over a path that doesn't already exist in the
# image is created root:root — unwritable by the non-root `app` user below,
# breaking every upload with EACCES on a fresh deploy.
RUN mkdir -p uploads
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1
CMD ["node", "dist/index.js"]
