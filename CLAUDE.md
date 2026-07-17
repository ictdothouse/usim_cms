# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `architecture.md` for the full product spec this scaffold implements.

## Commands

Package manager is pnpm (via corepack — run `corepack enable` once if `pnpm` isn't found).

- `pnpm install` — install all workspace dependencies
- `pnpm dev:api` — run the Fastify API in watch mode (`apps/api`, port 3000 by default)
- `pnpm dev:admin` — run the Vite admin dev server (`apps/admin`)
- `pnpm dev:frontend` — run the Astro SSR site renderer (`apps/frontend`)
- `pnpm build` — build all workspace packages
- `pnpm typecheck` — typecheck all workspace packages
- `pnpm --filter @usim-cms/api db:generate` — generate a Drizzle migration from `apps/api/src/db/schema.ts`
- `pnpm --filter @usim-cms/api db:migrate` — apply pending Drizzle migrations

`apps/api` needs a `DATABASE_URL` (see `apps/api/.env.example`) pointing at a Postgres instance before
routes that touch the database will work — `/health` does not need one. On a fresh DB, connect as a
superuser once and run `pnpm --filter @usim-cms/api db:setup-role`, then switch `DATABASE_URL` to the
`usim_cms_app` role it creates — the `pages` RLS policies (`src/db/migrations/0002_pages_rls.sql`) are
a silent no-op under a superuser connection. That role also needs `CREATEDB` (see the grant in
`scripts/setup-db-role.sql`): each tenant gets its own database, auto-provisioned on first request.

## Multi-tenancy: database-per-tenant

- `DATABASE_URL` holds only the **control plane** — the `tenants`/`users`/`roles`/`site_theme`/
  `shared_content` registry tables (`apps/api/src/db/tenant-pool.ts`'s fixed `pool`). Tenant content
  (`pages`, etc.) never lives there.
- Each row in `tenants` has a nullable `db_url`. Null means "derive it": the tenant's database lives on
  the same Postgres server as the control plane, named `tenant_<host>` (`tenantDbName`/
  `deriveTenantDbUrl`), created on demand (`CREATE DATABASE`) and migrated the first time that host is
  requested. An explicit `db_url` means the tenant's data lives on a different server that must already
  exist — topology is registry data, never code.
- `getTenantConnection(tenantHost)` is the only way a request gets a tenant's `db`: registry lookup on
  the control plane confirms the host is known and `active`, then resolves/derives its connection
  string, provisions+migrates it if this process hasn't seen it yet, and hands back a pooled client
  (`tenantPools` cached per connection string, not per host, so two hosts sharing a `db_url` share a
  pool). `plugins/tenant.ts` calls this on every request and attaches the result as `req.db`.
- This makes tenant DB isolation real (a compromised or buggy query against one tenant's `req.db`
  cannot see another tenant's rows — separate database, not just a `WHERE tenant_host = ...` filter),
  on top of the RLS `app.authenticated` session-variable gate already enforced per connection.
- The one sanctioned cross-tenant path is `publishSharedContent`/`listSharedContent` — an explicit
  author opt-in into the control-plane `shared_content` table, not a general query capability.

## Architecture

pnpm workspace monorepo with two apps:

- **`apps/api`** — Fastify + TypeScript backend, Postgres via Drizzle ORM.
  - `src/index.ts` boots the server and registers the tenant plugin + collection routes.
  - `src/plugins/tenant.ts` reads the `x-tenant-host` request header on every request and attaches
    `req.tenantHost` / `req.db` — this is how multi-tenancy is implemented (single instance, per-tenant
    DB pool, no per-tenant deployment).
  - `src/db/tenant-pool.ts` resolves each tenant host to its own database (see "Multi-tenancy:
    database-per-tenant" below) and lazily creates/caches one Drizzle/pg pool per connection string.
  - `src/db/schema.ts` defines the `pages` table. Page content is a dynamic block layout stored in the
    `layout` JSONB column, not as separate relational tables per block type.
  - `src/collections/config-types.ts` + `src/plugins/generic-crud.ts` are the code-first collection
    system: a `CollectionConfig` (slug, `access` functions keyed by role/department, `beforeChange`/
    `afterChange` hooks) is handed to `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`,
    which mount generic CRUD routes at `/api/:collectionSlug` — collections are not meant to get
    hand-written route handlers. `pages`, `posts`, and `templates` (`src/index.ts`) are wired up this
    way, each with real `access.create/update/delete` checks (`hasPermission`) and a `beforeChange`
    hook enforced in the handlers — `501` only fires for a config with no `table` at all, not as a
    general stub state.
  - Local API/SDK for same-process frontend access (bypassing HTTP) is not implemented yet.

- **`apps/admin`** — Vite + React + TypeScript, Tailwind CSS, Shadcn UI conventions (`components.json`,
  `src/lib/utils.ts`'s `cn` helper). No components have been added via the shadcn CLI yet — `pnpm dlx
  shadcn@latest add <component>` from `apps/admin` will place them under `src/components`. The page
  builder itself lives in `src/Designer.tsx`: drag-drop block canvas, a live-preview edit mode that
  renders the actual frontend page for click-to-select/inline editing, and a design template library.

- **`apps/frontend`** — Astro, `output: "server"` with the Node standalone adapter (not static:
  tenant identity comes from the request's `Host` header at runtime, so pages can't be pre-built
  per-tenant at build time). `src/pages/[...slug].astro` reads `Host`, fetches the matching page and
  merged theme from `apps/api`'s public scope (`src/lib/api.ts`), and renders each `layout[]` block by
  `type` (`hero` → `HeroBlock`, anything else → `GenericBlock` fallback — add a new `<TypeBlock>.astro`
  and a case in the page's switch as the admin block builder grows real block types).

## Deployment

- `docker-compose.yml` runs the whole stack: `db` (Postgres, runs
  `scripts/setup-db-role.sql` once via `docker-entrypoint-initdb.d` to create the
  `usim_cms_app` role), `api`, `frontend`, `admin` (static SPA served by nginx inside its
  own image, see `apps/admin/Dockerfile`), and `proxy`. Each service has a healthcheck;
  `depends_on: condition: service_healthy` sequences the startup order.
- `proxy` (`caddy:2-alpine`, config in `./Caddyfile`) is the public-facing reverse proxy
  and TLS terminator. Default behavior: automatic Let's Encrypt issuance/renewal for
  every domain in `ADMIN_DOMAIN`/`API_DOMAIN`/`TENANT_DOMAINS` (`.env.example`) — no
  manual cert steps. To use a certificate USIM's ICT centre issues instead (the
  cPanel-style flow), swap the matching `Caddyfile` site block to a `tls <cert> <key>`
  directive and mount the cert files in via the commented `./certs` volume on `proxy`.
  `TENANT_DOMAINS` needs a live tenant's host added to it before that department's site
  is reachable through the proxy.
- Tenant backup/restore/migration is `apps/api/src/backup.ts`, not `pg_dump`: JSON dump
  of a tenant's rows + its local uploads, zipped — restores across Postgres versions and
  onto a different server/host (rewrites `/uploads/<host>/` references on cross-host
  restore, which is how the admin's site-clone feature works). `exportStaticSite` renders
  every page/post through the real running frontend and bundles the HTML + assets for a
  static-host handover.
- `apps/api/scripts/backup.sh` is the instance-level counterpart: `pg_dump` (whole
  control-plane + tenant DBs, or a specific tenant's schema by host), meant to run on a
  cron job (`RETENTION_DAYS` prunes old dumps, defaults 14).
- Monitoring/alerting is not implemented — known gap. `restart: unless-stopped` +
  compose healthchecks only cover crash-restart, not metrics or alerting; revisit if/when
  the instance carries enough tenants that a silent outage would go unnoticed.

## Key constraints (from architecture.md)

- Single instance, not one deployment per tenant — tenant identity always comes from the
  `x-tenant-host` header, never from subdomain parsing or config at boot.
- Avoid heavy dependencies; prefer Tailwind + lightweight Fastify plugins over pulling in a framework.
- New collections should be added as `CollectionConfig` objects registered through
  `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`, not as one-off Fastify route files.
