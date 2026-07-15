# Build from repo root: docker build -f apps/api/Dockerfile -t usim-cms-api .
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
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter @usim-cms/api build
RUN pnpm --filter @usim-cms/api deploy --prod --legacy /app/deploy/api

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy/api ./
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1
CMD ["node", "dist/index.js"]
