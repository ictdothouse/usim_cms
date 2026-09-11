# apps/frontend — additional context

Loaded when working under apps/frontend/. See the repo root CLAUDE.md for cross-cutting constraints.

- **`apps/frontend`** — Astro 7, `output: "server"` with the `@astrojs/node` adapter in `"middleware"`
  mode (not `"standalone"`: `server.mjs` owns the `http.Server` so it can close it gracefully on
  SIGTERM/SIGINT; not static: tenant identity comes from the request's `Host` header at runtime, so
  pages can't be pre-built per-tenant at build time). `src/pages/[...slug].astro` reads `Host`, fetches
  the matching page and merged theme from `apps/api`'s public scope (`src/lib/api.ts`), and renders
  each `layout[]` block by `type` (`section` → `SectionBlock`, anything else → `GenericBlock` fallback —
  add a new `<TypeBlock>.astro` and a case in the page's switch as the admin block builder grows real
  block types). The retired BlockBuilder-era top-level `hero` block type never reaches this switch:
  `apps/api`'s `pagesAfterRead` hook upgrades any surviving one into a real `section` (heading+text
  elements) on every read, since Designer.tsx has no edit UI for a non-`section` block at all —
  `HeroBlock.astro` is kept only for this page's (and `posts/[slug].astro`'s) "not found" fallback.
  Styling is Tailwind CSS v4 + daisyUI, wired via the `@tailwindcss/vite` plugin
  (`astro.config.mjs`) and one global stylesheet (`src/styles/global.css`) imported by
  `BaseLayout.astro` — compile-time only, no client-side JS added, consistent with this project's
  "avoid heavy dependencies" constraint.
- **Security response headers** (`server.mjs`'s `setSecurityHeaders`, added after a security audit
  found none set anywhere): `X-Content-Type-Options: nosniff` and `Referrer-Policy:
  strict-origin-when-cross-origin` on every response, plus a real `Content-Security-Policy` (added
  2026-09-11 — `apps/api`'s own `@fastify/helmet` deliberately sets `contentSecurityPolicy: false` and
  says this file is the real CSP surface, but no CSP existed here until now). Both are defense-in-depth
  around the Custom HTML element's documented raw-HTML trust boundary, not a substitute for it —
  `script-src`/`style-src` keep `'unsafe-inline'` on purpose (Designer's inline `style=""` everywhere, the
  tabs/slider/menu elements' own inline `<script>`, and Custom HTML's own script tags all rely on it), so
  this CSP's real value is blocking an injected `<script src="https://attacker.example/...">` from ever
  loading (no external host in `script-src`) and blocking exfiltration via `fetch`/`XHR` to a third-party
  server (`connect-src 'self'`) — not stopping inline script outright. `img-src`/`frame-src` stay open to
  any `https:` host since a webmaster can point an image/bgImage/Custom-HTML iframe at any external URL
  by design; `style-src`/`font-src` allow exactly `fonts.googleapis.com`/`fonts.gstatic.com`
  (`BaseLayout.astro`'s Google Fonts `<link>`), nothing broader. `frame-ancestors` (clickjacking
  protection) is only appended to the same header once `ADMIN_ORIGIN` is set on this container (wired
  through both docker-compose.release.yml and docker-compose.trial.yml, empty-default) — it scopes
  framing to the admin panel's own origin, the one legitimate consumer (Designer's Live Edit preview
  iframe), instead of leaving every tenant page framable by any site. An install that hasn't set
  `ADMIN_ORIGIN` on the frontend container yet sees the same CSP minus that one directive, not a full
  behavior change.
- **`src/middleware.ts`** — the one place that gates every request on a tenant's maintenance-mode flag
  (`GET /api/tenant-status`, apps/api). Deliberately not a per-page check duplicated across
  `[...slug].astro`/`posts/[slug].astro`/etc (which already each duplicate their own Host-header
  tenantHost-resolution regex) — one middleware covers all of them. Returns the maintenance HTML directly
  (503) rather than `context.rewrite()`-ing to a dedicated page, since a rewrite re-enters this same
  middleware against the new path and would loop; `/_astro/`, `/_image`, and `/uploads/` are excluded so
  the maintenance page's own assets (and any admin preview iframe) still load. Fails open on an apps/api
  hiccup — a status-check failure never takes a healthy tenant's site down. **Same middleware also owns
  the rendered-HTML edge cache** (`lib/html-cache.ts`, Redis-backed, see the deployment skill's own
  paragraph on it) — checked right after the maintenance gate (so a maintenance response is never cached)
  and written right before returning, skipped for anything carrying a preview/theme-preview/Live-Edit
  token or a maintenance-bypass cookie.
- **`chrome-preview.astro`** — apps/admin Designer's Header/Footer device-preview modal (`kind ===
  "siteChrome"`). Reads `?id=&kind=header|footer`, fetches that row via `getSiteChromeById` (now
  exported — no preview token needed, since `GET /api/siteChrome/:id` is already publicly readable
  regardless of draft/published status), and renders it through `BaseLayout`'s existing
  `headerChrome`/`footerChrome` props with placeholder body text. View-only (no `designerEdit`
  bridge) — mirrors `blueprint-preview.astro`'s "reserved route, id is the whole access check" shape,
  just without that route's preview-token minting since siteChrome's read access is already open.
