# Build from repo root: docker build -f apps/admin/Dockerfile -t ucms-admin .
# Static SPA served by nginx, no node_modules at runtime. Nothing
# organisation-specific is baked in: the API/frontend URLs come from the
# container's VITE_API_URL/VITE_FRONTEND_URL env at start (runtime-config.sh
# writes /config.js and the CSP), so one image serves any organisation.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/element-schema/package.json packages/element-schema/package.json
COPY packages/element-style/package.json packages/element-style/package.json
COPY packages/element-render/package.json packages/element-render/package.json
RUN pnpm install --frozen-lockfile
COPY packages/element-schema packages/element-schema
COPY packages/element-style packages/element-style
COPY packages/element-render packages/element-render
COPY apps/admin apps/admin
# @ucms/element-schema/@ucms/element-style (apps/admin's own dependencies, see
# designer/elements.test.ts and package.json) ship no dist/ in the repo — build
# both before apps/admin's own test/build, which import their compiled output
# via the workspace symlink. See apps/api/Dockerfile's own identical comment —
# this exact class of mistake (missing build step for a new workspace package)
# already broke this image once for element-schema, don't repeat it here.
# element-style builds first: element-schema's isSafeUrl now delegates to its
# sanitizeUrl, so element-schema's own build needs element-style's dist/ already present.
RUN pnpm --filter @ucms/element-style build
RUN pnpm --filter @ucms/element-schema build
RUN pnpm --filter @ucms/element-render build
# Test gate — see apps/api/Dockerfile's own comment for why this is enough
# on its own to block a bad deploy, no separate CI step needed.
RUN pnpm --filter @ucms/admin test
RUN pnpm --filter @ucms/admin build

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY --from=build --chown=101:0 /app/apps/admin/dist /usr/share/nginx/html
COPY --chown=101:0 apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
# Template: runtime-config.sh fills in the API origin at container start.
COPY --chown=101:0 apps/admin/security-headers.conf /etc/nginx/ucms-security-headers.conf
COPY --chmod=755 apps/admin/runtime-config.sh /docker-entrypoint.d/40-ucms-runtime-config.sh
EXPOSE 8080
