# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `docs/ARSITEKTUR.md` for the current implementation. `architecture.md` is the original product brief retained as historical context.

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
- pnpm --filter @ucms/api db:migrate is not the tenant migration runner. The API applies files from src/db/migrations under a PostgreSQL advisory lock and records each filename plus SHA-256 checksum in public.ucms_schema_migrations. Existing databases establish their baseline by replaying the idempotent history once; later deploys apply only new files. Add migrations as new files and do not edit an applied migration.

apps/api needs DATABASE_URL for control-plane access and DATABASE_PROVISIONER_URL for same-server tenant database creation. Run pnpm --filter @ucms/api db:setup-role as a PostgreSQL administrator. The usim_cms_app runtime role is NOBYPASSRLS and NOCREATEDB. Only usim_cms_provisioner has CREATEDB; keep that URL on a direct PostgreSQL connection. /health does not need either URL.

See apps/api/CLAUDE.md for tenant pooling, migration and auth details.
## Architecture

pnpm workspace monorepo with three apps:

- **`apps/api`** — Fastify + TypeScript + Drizzle ORM. See apps/api/CLAUDE.md for collection routes, pages/posts/menus schema, and the multi-tenant plugin. Local API/SDK for same-process frontend access is not implemented yet.

- **`apps/admin`** — Vite + React + TypeScript, the page-builder Designer, Tailwind/Shadcn conventions. See apps/admin/CLAUDE.md for the full Designer.tsx architecture, refactor layers, and element registry.

- **`apps/frontend`** — Astro 7 SSR renderer, Tailwind + daisyUI, no client-side JS by convention. See apps/frontend/CLAUDE.md for rendering details.

See .claude/skills/deployment/SKILL.md for deployment, docker-compose, blue-green, and ops details.

## Key constraints (from the current architecture)

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
