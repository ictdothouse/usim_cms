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
COPY packages/element-schema/package.json packages/element-schema/package.json
COPY packages/element-style/package.json packages/element-style/package.json
RUN pnpm install --frozen-lockfile
COPY packages/element-style packages/element-style
COPY apps/frontend apps/frontend
# @ucms/element-style (apps/frontend's own dependency, see
# SectionBlock.astro's import and package.json) ships no dist/ in the repo —
# build it before apps/frontend's own typecheck/build, which import its
# compiled output via the workspace symlink. See apps/admin/Dockerfile's own
# identical comment on why this step can't be skipped.
RUN pnpm --filter @ucms/element-style build
# Test gate — no test files here, but `astro build` alone doesn't fully
# type-check (unlike api/admin's tsc-based builds), so run `astro check`
# explicitly. See apps/api/Dockerfile's own comment for why this is enough
# on its own to block a bad deploy.
RUN pnpm --filter @ucms/frontend typecheck
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
