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
- **No sideways page scroll (2026-10-15):** `global.css` sets `html, body { overflow-x: clip }` —
  anything crossing the viewport's side (a negative margin, `.ds-mega-full`'s 100vw, a too-wide
  element) is cut at the edge instead of letting a phone pan the whole page (user report: the
  device-frame Preview scrolled off-screen). `clip`, never `hidden`: no scroll container, so a future
  `position:sticky` header still sticks and margins still collapse. html's value goes to the
  viewport, body's then clips body itself. The cost is that wide content can't spill out anymore, so
  it scrolls inside its own box: `.ds-html table` (GitHub's `display:block;width:max-content;
  max-width:100%;overflow-x:auto`) and `.ds-html pre`; `.ds-html` is the Custom HTML element and a
  post's body (`posts/[slug].astro`). `body { overflow-wrap: break-word }` wraps a long URL instead.
  Any new element that can be legitimately wider than a phone (an embed, a wide chart) needs the
  same own-box scroll, or it will be silently cut.
- **Security response headers** (`server.mjs`'s `setSecurityHeaders`, added after a security audit
  found none set anywhere): `X-Content-Type-Options: nosniff` and `Referrer-Policy:
  strict-origin-when-cross-origin` on every response, plus a real `Content-Security-Policy` (added
  2026-09-11 — `apps/api`'s own `@fastify/helmet` deliberately sets `contentSecurityPolicy: false` and
  says this file is the real CSP surface, but no CSP existed here until now). Both are defense-in-depth
  around the Custom HTML element's documented raw-HTML trust boundary, not a substitute for it —
  `style-src` keeps `'unsafe-inline'` (Designer's inline `style=""` everywhere); `script-src` is
  `'self' 'nonce-…'` (per-response nonce, `x-ucms-csp-nonce` → `cspNonce`; the HTML cache stores a
  placeholder that middleware.ts swaps). So: every `is:inline` script needs `nonce={cspNonce}`; no inline
  event-handler attributes (`onload=""` etc. are blocked outright — the Google Fonts link used one and
  never applied, fixed 2026-10-14 with a nonce'd swap script); and component `<script>`s must stay
  external files — `astro.config.mjs`'s `assetsInlineLimit` refuses `.js` inlining, since Astro's inlined
  `<script type="module">` carries no nonce (tabs/announcement/map consent/menu were blocked in prod).
  Beyond that, blocks an injected `<script src="https://attacker.example/...">` (no external host in
  `script-src`) and exfiltration via `fetch`/`XHR` to a third-party server (`connect-src 'self'`). `img-src`/`frame-src` stay open to
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
- **`chrome-preview.astro`** — apps/admin's Header/Footer Designer (`kind === "siteChrome"`): its
  device-preview modal and, since 2026-10-17, its Live Edit. Reads `?id=&kind=header|footer`, fetches
  that row via `getSiteChromeById` (publicly readable regardless of draft/published status, so the id
  is the whole access check) and renders it through `BaseLayout`'s `headerChrome`/`footerChrome`
  props with placeholder body text. `?token=` overlays the unsaved layout (live-preview store);
  `designerEdit=1` with a token turns the Live Edit bridge on and passes BaseLayout `chromeEdit`.
- **What Live Edit edits (`BaseLayout.astro`, 2026-10-17)**: `data-ds-root` marks it — `<main>` for a
  page, the header/footer itself under `chromeEdit` (its SectionBlocks then get `designerEdit` paths).
  The editor's dashed box guides and the page-end zone are scoped to it; a page's header/footer used to
  get guides that promised edits that never happened. On a page's Live Edit, the header/footer carry
  `data-ds-chrome`/`data-ds-chrome-id` instead: a click posts `designer:editChrome` (admin opens that
  header/footer's Designer in a new tab) and doesn't follow its links. BaseLayout also loads the
  header/footer's own element fonts (`collectFonts`, which now covers `menu` and container children) —
  pages only ever collected their own layout's.
- **Menu styling (`MenuBlock.astro` + `global.css`, 2026-10-17)**: typography goes straight on the
  `<nav>` (`typoStyle`). The rest are `--ds-menu-*` custom properties: hover, accent, dropdown bg/text,
  gap, justify. Notes:
  - `menuEffect` → `ds-menu-fx-*`: underline/overline is an animated 2px line, pill/box a filled
    item. It shows on hover and on the current page's item, desktop only (≥769px).
  - The accent falls back to the theme's `--color-primary`.
  - The current page's item has its own text and effect colors (`--ds-menu-current`,
    `--ds-menu-current-accent`), each falling back to hover's. The effect reads
    `--ds-menu-item-accent`, which only the current item sets, because the nav-level variable is
    inherited by every item.
  - The current page's item gets `aria-current="page"` (same-origin pathname match). On
    `/chrome-preview` the first item stands in, so a header's Live Edit shows the effect.
  - Dropdowns and the mobile panel default to dark-on-white (`#1f2937`) instead of inheriting the
    bar's color, which made white items on a dark header white-on-white there.
  - On mobile, the hamburger follows the menu's `align`. A vertical menu (a footer's link column)
    stays a plain list instead of collapsing behind a hamburger.
  - Items with a dropdown/mega menu get a small caret.
- **Social Media logos (`RepeaterBlock.astro`, 2026-10-17)**: a `socials[].platform` found in
  `@ucms/element-render`'s `SOCIAL_ICONS` renders that brand's real logo (filled path, `aria-label` =
  brand title). Anything else (globe/mail/phone, older generic icon names) keeps the `ICON_PATHS`
  stroke icon. `socialStyle` → `ds-socialicons-outline|plain|brand`; brand sets `--ds-brand`/
  `--ds-brand-fg` per link (hex + `bestTextColor`). Plain keeps a 24px tap target.
- **Repeaters inside a Symbol (`SymbolBlock.astro`, 2026-10-17)**: the 8 repeater types now render
  through `RepeaterBlock` there too (they returned `null` before), wrapped in a `data-vis` div so their
  bp rules still match — one saved Social Media symbol can sit in a header, a page and a footer.
- **Image links (2026-10-17)**: an image element's `href` (e.g. a header logo to "/") wraps the
  `<img>` in a plain inline `<a>` inside `.ds-img-wrap` — ElementBlock, SymbolBlock and SliderBlock
  each do it. The img stays `display:block`, so only the picture is clickable, its alignment
  margins still apply, and a free slide image's 100% width/height still size against the wrapper.
  `alt` names the link. Live Edit's click handler already stops the navigation.
- **Pinned header/footer fallback (2026-10-17)**: `resolveHeaderFooter` (`lib/api.ts`) renders the
  default when a page's pinned `headerId`/`footerId` isn't visible to its anonymous read (a draft,
  or one moved to the admin list's Trash; RLS shows published rows only), as a hard delete's FK
  SET NULL would. It used to render no header at all.
- **Sticky/transparent header (2026-10-17)**: a header's `settings.sticky`/`settings.transparent`
  (`=== true` only) become `data-sticky`/`data-transparent` on `.ds-site-header`; `global.css` does
  the rest.
  - Sticky is `position:sticky;top:0`.
  - Transparent is `position:absolute` over the top of the page: out of flow, so the first section
    (a hero) starts under it. Its sections lose background and shadow via `!important`, which beats
    their per-breakpoint rules. The Floating preset's pill keeps its own background, since that is
    a container, not a section.
  - Both is `position:fixed`. A nonce'd inline script after `</header>` toggles `data-at-top`
    (`scrollY < 10`), and only at the top are the sections transparent. Without JS the header keeps
    its background, rather than leaving text over scrolled content.
  - z-index 50 sits above any element's own (0-10).
  - `chrome-preview.astro` puts a transparent header over a stand-in dark hero, and adds 150vh
    of scroll room under a sticky one.
