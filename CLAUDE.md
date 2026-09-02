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
- `pnpm --filter @ucms/api db:generate` — generate a Drizzle migration `.sql` file from
  `apps/api/src/db/schema.ts` into `src/db/migrations` (authoring only — writes the file, applies nothing)
- `pnpm --filter @ucms/api db:migrate` — **do not run this against `DATABASE_URL` in normal use.**
  `schema.ts` defines tenant-content tables (`pages`/`posts`/`categories`/etc), but `DATABASE_URL` is the
  control-plane DB, which never holds those tables (see "Multi-tenancy" below) — running drizzle-kit's own
  migrate here would create them there anyway, alongside the registry tables that actually belong. The
  mechanism that actually applies these `.sql` files is `tenant-pool.ts`'s `ensureTenantDatabase`: every
  file in `src/db/migrations` is replayed (idempotent, `IF NOT EXISTS`/`DROP POLICY IF EXISTS` throughout)
  into each tenant's own database the first time that host is requested per process — no drizzle-kit
  migration-tracking table involved on the tenant side. `db:generate` is still the right way to author a
  new migration `.sql` file; `db:migrate` exists only because drizzle-kit requires a `migrate` command to
  exist for `db:generate` to work, not because it's part of the real deploy flow.

`apps/api` needs a `DATABASE_URL` (see `apps/api/.env.example`) pointing at a Postgres instance before
routes that touch the database will work — `/health` does not need one. On a fresh DB, connect as a
superuser once and run `pnpm --filter @ucms/api db:setup-role`, then switch `DATABASE_URL` to the
`usim_cms_app` role it creates — the `pages` RLS policies (`src/db/migrations/0002_pages_rls.sql`) are
a silent no-op under a superuser connection. That role also needs `CREATEDB` (see the grant in
`scripts/setup-db-role.sql`): each tenant gets its own database, auto-provisioned on first request.

See apps/api/CLAUDE.md for multi-tenancy (database-per-tenant, i18n phases 1-5) and auth hardening (rate limiting, audit log, MFA) details — loaded automatically when working in apps/api/.

## Architecture

pnpm workspace monorepo with two apps:

- **`apps/api`** — Fastify + TypeScript + Drizzle ORM. See apps/api/CLAUDE.md for collection routes, pages/posts/menus schema, and the multi-tenant plugin. Local API/SDK for same-process frontend access is not implemented yet.

- **`apps/admin`** — Vite + React + TypeScript, the page-builder Designer, Tailwind/Shadcn conventions. See apps/admin/CLAUDE.md for the full Designer.tsx architecture, refactor layers, and element registry.

- **`apps/frontend`** — Astro 7 SSR renderer, Tailwind + daisyUI, no client-side JS by convention. See apps/frontend/CLAUDE.md for rendering details.

See .claude/skills/deployment/SKILL.md for deployment, docker-compose, blue-green, and ops details.

## Key constraints (from architecture.md)

- Single instance, not one deployment per tenant — tenant identity always comes from the
  `x-tenant-host` header, never from subdomain parsing or config at boot.
- Avoid heavy dependencies; prefer Tailwind + lightweight Fastify plugins over pulling in a framework.
- New collections should be added as `CollectionConfig` objects registered through
  `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`, not as one-off Fastify route files.

## Usage & Cost Discipline

Applies to NEW decisions only (before spawning a new subagent, before starting a new
worktree, before invoking a skill) — never to interrupt, shorten, or change the outcome
of work already in progress.

- **Context management**: once a session's context passes ~150k tokens AND a phase of
  work has just finished (a feature/fix/test landed), suggest `/compact` before starting
  the next task — never mid-task. When a new, unrelated task starts, suggest `/clear` and
  a fresh session instead of carrying old context forward.
- **Subagent usage**: don't spawn a subagent for something quick enough to do directly in
  the main session (reading one file, editing one function, a simple answer). Only use a
  subagent when the work is genuinely independent, parallelizable, or needs isolation
  (exploring many files/a large repo, running several approaches at once). State briefly
  why a subagent is needed before spawning one. For routine/simple subagent work (git
  status, running a test, a file lookup), use a cheaper model (e.g. Haiku) where the
  workflow allows it.
- **Git worktrees**: don't auto-trigger `using-git-worktrees` or a worktree workflow
  unless the work genuinely needs 2+ branches active at once. For single-branch work, use
  plain `git checkout`/`git switch`. If unsure whether a worktree is warranted, ask first.
- **Skills**: don't auto-invoke a skill (e.g. from the `superpowers` plugin) for a small
  task that doesn't need that skill's full workflow — only invoke a skill when the task's
  scope actually matches its purpose.
- **General principle**: prefer token-efficient approaches without lowering the quality
  or correctness of the result.
