# Build from repo root: docker build -f apps/admin/Dockerfile -t ucms-admin \
#   --build-arg VITE_API_URL=https://api.example.com .
# Static SPA — Vite envs are compile-time only, baked into the JS bundle here,
# not read at container runtime. No pnpm deploy needed: nginx just serves
# the built dist/, no node_modules at runtime.
FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/element-schema/package.json packages/element-schema/package.json
COPY packages/element-style/package.json packages/element-style/package.json
RUN pnpm install --frozen-lockfile
COPY packages/element-schema packages/element-schema
COPY packages/element-style packages/element-style
COPY apps/admin apps/admin
ARG VITE_API_URL=http://localhost:3000
ARG VITE_FRONTEND_URL=http://localhost:4321
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
# @ucms/element-schema/@ucms/element-style (apps/admin's own dependencies, see
# designer/elements.test.ts and package.json) ship no dist/ in the repo — build
# both before apps/admin's own test/build, which import their compiled output
# via the workspace symlink. See apps/api/Dockerfile's own identical comment —
# this exact class of mistake (missing build step for a new workspace package)
# already broke this image once for element-schema, don't repeat it here.
RUN pnpm --filter @ucms/element-schema build
RUN pnpm --filter @ucms/element-style build
# Test gate — see apps/api/Dockerfile's own comment for why this is enough
# on its own to block a bad deploy, no separate CI step needed.
RUN pnpm --filter @ucms/admin test
RUN pnpm --filter @ucms/admin build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
