# apps/frontend — additional context

Loaded when working under apps/frontend/. See the repo root CLAUDE.md for cross-cutting constraints.

- **`apps/frontend`** — Astro 7, `output: "server"` with the `@astrojs/node` adapter in `"middleware"`
  mode (not `"standalone"`: `server.mjs` owns the `http.Server` so it can close it gracefully on
  SIGTERM/SIGINT; not static: tenant identity comes from the request's `Host` header at runtime, so
  pages can't be pre-built per-tenant at build time). `src/pages/[...slug].astro` reads `Host`, fetches
  the matching page and merged theme from `apps/api`'s public scope (`src/lib/api.ts`), and renders
  each `layout[]` block by `type` (`hero` → `HeroBlock`, anything else → `GenericBlock` fallback — add a
  new `<TypeBlock>.astro` and a case in the page's switch as the admin block builder grows real block
  types). Styling is Tailwind CSS v4 + daisyUI, wired via the `@tailwindcss/vite` plugin
  (`astro.config.mjs`) and one global stylesheet (`src/styles/global.css`) imported by
  `BaseLayout.astro` — compile-time only, no client-side JS added, consistent with this project's
  "avoid heavy dependencies" constraint.
