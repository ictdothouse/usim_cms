# Build from repo root: docker build -f apps/admin/Dockerfile -t usim-cms-admin \
#   --build-arg VITE_API_URL=https://api.example.com .
# Static SPA — Vite envs are compile-time only, baked into the JS bundle here,
# not read at container runtime. No pnpm deploy needed: nginx just serves
# the built dist/, no node_modules at runtime.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile
COPY apps/admin apps/admin
ARG VITE_API_URL=http://localhost:3000
ARG VITE_FRONTEND_URL=http://localhost:4321
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
RUN pnpm --filter @usim-cms/admin build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
