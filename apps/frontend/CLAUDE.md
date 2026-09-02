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
- **Security response headers** (`server.mjs`'s `setSecurityHeaders`, added after a security audit
  found none set anywhere): `X-Content-Type-Options: nosniff` and `Referrer-Policy:
  strict-origin-when-cross-origin` on every response — defense-in-depth around the Custom HTML
  element's documented raw-HTML trust boundary, not a substitute for it. `frame-ancestors` (clickjacking
  protection) is only emitted once `ADMIN_ORIGIN` is set on this container (wired through both
  docker-compose.release.yml and docker-compose.trial.yml, empty-default) — it scopes framing to the
  admin panel's own origin, the one legitimate consumer (Designer's Live Edit preview iframe), instead of
  leaving every tenant page framable by any site. An install that hasn't set `ADMIN_ORIGIN` on the
  frontend container yet sees no behavior change.
