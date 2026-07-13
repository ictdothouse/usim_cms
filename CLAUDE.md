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
a silent no-op under a superuser connection.

## Architecture

pnpm workspace monorepo with two apps:

- **`apps/api`** — Fastify + TypeScript backend, Postgres via Drizzle ORM.
  - `src/index.ts` boots the server and registers the tenant plugin + collection routes.
  - `src/plugins/tenant.ts` reads the `x-tenant-host` request header on every request and attaches
    `req.tenantHost` / `req.db` — this is how multi-tenancy is implemented (single instance, per-tenant
    DB pool, no per-tenant deployment).
  - `src/db/tenant-pool.ts` lazily creates and caches one Drizzle/pg pool per tenant host. It currently
    points every tenant at the same `DATABASE_URL`; resolving a tenant host to its own connection
    string is a TODO.
  - `src/db/schema.ts` defines the `pages` table. Page content is a dynamic block layout stored in the
    `layout` JSONB column, not as separate relational tables per block type.
  - `src/collections/config-types.ts` + `src/plugins/generic-crud.ts` are the code-first collection
    system: a `CollectionConfig` (slug, `access` functions keyed by role/department, `beforeChange`/
    `afterChange` hooks) is handed to `registerCollectionRoutes`, which mounts generic CRUD routes at
    `/api/:collectionSlug` — collections are not meant to get hand-written route handlers. Only the
    `pages` collection is wired up so far, and the CRUD handlers are stubs (GET returns empty/null,
    write methods return 501) — access checks and hooks are not yet enforced in the handlers.
  - Local API/SDK for same-process frontend access (bypassing HTTP) is not implemented yet.

- **`apps/admin`** — Vite + React + TypeScript, Tailwind CSS, Shadcn UI conventions (`components.json`,
  `src/lib/utils.ts`'s `cn` helper). No components have been added via the shadcn CLI yet — `pnpm dlx
  shadcn@latest add <component>` from `apps/admin` will place them under `src/components`.

- **`apps/frontend`** — Astro, `output: "server"` with the Node standalone adapter (not static:
  tenant identity comes from the request's `Host` header at runtime, so pages can't be pre-built
  per-tenant at build time). `src/pages/[...slug].astro` reads `Host`, fetches the matching page and
  merged theme from `apps/api`'s public scope (`src/lib/api.ts`), and renders each `layout[]` block by
  `type` (`hero` → `HeroBlock`, anything else → `GenericBlock` fallback — add a new `<TypeBlock>.astro`
  and a case in the page's switch as the admin block builder grows real block types).

## Key constraints (from architecture.md)

- Single instance, not one deployment per tenant — tenant identity always comes from the
  `x-tenant-host` header, never from subdomain parsing or config at boot.
- Avoid heavy dependencies; prefer Tailwind + lightweight Fastify plugins over pulling in a framework.
- New collections should be added as `CollectionConfig` objects registered through
  `registerCollectionRoutes`, not as one-off Fastify route files.
