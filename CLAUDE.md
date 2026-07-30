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
  `shared_content`/`theme_presets` registry tables (`apps/api/src/db/tenant-pool.ts`'s fixed `pool`).
  Tenant content (`pages`, etc.) never lives there. `theme_presets` is a personal, per-user favourites
  list in the admin's Theme panel (save/test/activate/delete a named color+font combo, or export/import
  it as a small `.md` file) — owned by `owner_user_id`, never tenant-scoped, never read by
  `getMergedTheme`/apps/frontend.
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
    `layout` JSONB column, not as separate relational tables per block type. `settings` (JSONB, migration
    `0012_page_settings.sql`) is page-wide Designer defaults — currently just `{ gap?: string }`, the
    default column gap a row falls back to when it doesn't set its own (`Row.gap`, below); its `gap` key is
    constrained to `GAP_PATTERN` (a bare number or number+unit) via `pagesCollection.createSchema`'s JSON
    schema, since it's interpolated straight into a raw CSS string by `SectionBlock.astro`
    (`` gap:${row.gap ?? pageGap ?? "2rem"} ``) — an unconstrained value would be a stored CSS-injection
    vector into every visitor's page. The much larger surface for the same risk is `layout` itself: every
    section/row/column/element prop (`El.props`/`Col.props`/`SectionProps` are all just
    `Record<string,string>`) ends up in a raw CSS string or attribute the same way, so
    `src/collections/validate-layout.ts`'s `validateLayout()` walks the whole tree in `pagesBeforeChange`
    and rejects (400, via a thrown `Error` carrying `.statusCode` — `beforeChange` has no `reply` to call
    directly) anything that isn't a recognized, safely-shaped value for its key: hex color, CSS length,
    an exact enum match (mirroring Designer.tsx's own `options: [...]` arrays), a scheme-checked URL, or
    (for `bgImage`/gallery `images`, which land in a raw `url(...)`, not a safe attribute) a URL with no
    quote/semicolon/paren/brace/whitespace. `html` (the Custom HTML element) is deliberately exempt — a raw
    HTML/CSS/JS embed is an intentional, documented trust boundary, not a gap to close. The legacy
    BlockBuilder's `hero` block gets the same `imageUrl` check (also a raw `url(...)`); `HeroBlock.astro`
    additionally got its own render-time `safeImageUrl` guard as defense-in-depth (it previously had none
    at all, unlike `SectionBlock.astro`'s `bgImage`/`safeUrl`), for any row written before this validator
    existed.
  - `src/collections/config-types.ts` + `src/plugins/generic-crud.ts` are the code-first collection
    system: a `CollectionConfig` (slug, `access` functions keyed by role/department, `beforeChange`/
    `afterChange` hooks — both receive `(data, args, req)`, so a hook can tell `POST` from `PATCH` via
    `req.method` and reach `req.db`/`req.user`) is handed to
    `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`, which mount generic CRUD routes
    at `/api/:collectionSlug` — collections are not meant to get hand-written route handlers. `pages`,
    `posts`, and `templates` (`src/index.ts`) are wired up this way, each with real
    `access.create/update/delete` checks (`hasPermission`) and a `beforeChange` hook enforced in the
    handlers — `501` only fires for a config with no `table` at all, not as a general stub state. The
    public list `GET` also applies generic query-string filters (`generic-crud.ts`'s
    `buildListFilters`) keyed off whichever columns a collection's table actually has: exact-match on any
    matching column name, `?tag=` as an array-contains against a `tags` column, `?from=`/`?to=` as a
    range against `publishedAt` — a collection without those columns just ignores the params. RLS (the
    per-table `_select` policy) is still the real visibility gate; these filters only narrow within what
    RLS already allows the request to see. `POST /:id/publish` (the "Share to portal" route) refuses to
    share any row whose `status` isn't `"published"` — draft and `posts`' `"private"` are both blocked,
    generically, for any collection with a `status` column.
  - `posts` (`src/db/schema.ts`) has a real `categoryId` FK into a `categories` table (`name`+`slug`,
    both unique; its own `categoriesCollection` in `index.ts` is gated on `posts.update`, not a new
    `categories.*` permission, since managing categories is a sub-concern of managing posts) declared
    `onDelete: "restrict"` — Postgres itself refuses to delete a category any post still references, and
    `generic-crud.ts`'s generic DELETE handler catches that FK-violation (Postgres error code `23503`)
    and turns it into a `409 { error: "still referenced by other records" }` instead of a raw 500,
    generically, for any collection with a restricted FK, not just categories. `tags` stays freeform
    `text[]` (no separate taxonomy table) — tags never needed a managed, renameable list the way category
    did. `authorId`/`authorEmail` (no DB-level FK — cross-database, see the multi-tenancy
    note below — stamped once on create by `postsCollection`'s `beforeChange`, never overwritten on
    update), and a 3-way `status`: `"draft" | "published" | "private"`. "private" reuses the exact same
    RLS branch as "draft" (`status = 'published' OR authenticated`) — it's a real publish event with its
    own `publishedAt` and history snapshot, just never visible to an anonymous visitor. Every time a
    request explicitly sets `status` to `"published"` or `"private"`, `postsCollection`'s `afterChange`
    hook inserts a full-content snapshot into `post_revisions` (own table, real FK to `posts.id`, admin-
    only RLS, migration `0009_posts_taxonomy_author_revisions.sql`) — a plain content edit via Save never
    snapshots. `post_revisions.category` deliberately stays a plain denormalized text column rather than
    its own `categoryId` FK back into `categories` — a revision snapshot should keep showing whatever
    category name the post had at that moment regardless of a later rename, and the `ON DELETE RESTRICT`
    above only ever blocks deleting a category a *live* post still points to, never one only a past
    revision mentions by name. `GET /api/posts/:id/revisions` + `POST
    /api/posts/:id/revisions/:id/restore`, `POST /api/posts/:id/preview-token` (same shape as the pages
    preview-token route — added because Preview was otherwise dead for a Draft/Private post; see
    `PostEditorPage`'s `preview()` in the `apps/admin` Posts paragraph below), and `GET
    /api/content-search` (own-tenant `ILIKE` match against `posts.title`/`pages.title`, capped at 10 rows
    per table — the admin's `@`-mention bookmark card is its only caller) are all hand-written in
    `index.ts`, the same kind of exception as the pages preview-token route: a real feature the generic
    collection-route mechanism doesn't cover, not a general stub state. Restoring a revision always sets
    the post back to `"draft"` (never auto-republishes) so a restored old version goes live only via a
    deliberate re-publish click.
  - Local API/SDK for same-process frontend access (bypassing HTTP) is not implemented yet.

- **`apps/admin`** — Vite + React + TypeScript, Tailwind CSS, Shadcn UI conventions (`components.json`,
  `src/lib/utils.ts`'s `cn` helper, which also holds the shared `slugify`/`oklchToHex` used by both
  `App.tsx` and `Designer.tsx`). No components have been added via the shadcn CLI yet — `pnpm dlx
  shadcn@latest add <component>` from `apps/admin` will place them under `src/components`. Routing is
  `react-router-dom`'s `BrowserRouter` (`App.tsx`'s default export): `Shell`'s `<Routes>` maps
  `/dashboard`, `/multisite`, `/users`, `/roles`, `/content/*`, `/theme`, `/global-theme`, `/feed`,
  `/settings` (the superadmin-only tabs redirect a webmaster session to `/dashboard` via `<Navigate>`,
  not a hidden-but-reachable route), and `ContentManager` — itself mounted at `/content/*` — nests its own
  sub-tree: `pages`, `pages/:id` (`PageDesignerRoute` → `Designer`), `posts`, `posts/categories`
  (`CategoriesPanel`), `posts/:id` (`PostEditorPage`), `media`, and, superadmin-only, `theme`. Both
  `Designer` and `PostEditorPage` are real routed pages reached by navigating to a row's id
  (`navigate(item.id)` right after quick-create, or a list row's Design/Edit button) — going back is a
  real `navigate("/content/pages")`/`navigate("/content/posts")`, not a `useState`-driven conditional
  mount the way `PagesPanel`'s `BlockBuilder` (the older inline page-block editor, still expand-under-row)
  remains. The page builder itself lives in `src/Designer.tsx`: drag-drop block canvas, **Live Edit**
  (opens by default — the real frontend page rendered in an iframe with click-to-select/inline editing via a postMessage
  bridge to `BaseLayout.astro`, always minted a preview token even for a published page so the bridge
  actually activates), and a design template library. A page's slug is auto-derived from its title on
  create (`PagesPanel`'s quick-create form) and stays editable afterward via a click-to-edit field in
  Designer's header. `ThemeForm` (Site Theme / Global Theme) offers a swatch picker labelled "UI Themes"
  (daisyUI is the real source of the color data — see `App.tsx`'s `THEME_PRESETS` comment — but the
  brand name and each theme's own name are deliberately not shown in the UI) + a random generator (both
  built on the same `oklchToHex` conversion), a 4-role Google Font system (Heading/Header-Title,
  Sub-heading, Blog/Post Title, Body — each a typeable/scrollable `FontField` with live per-row preview,
  and a "same as Heading font" note when two roles happen to match, since a pairing intentionally sets
  Heading/Sub-heading/Post-Title to the same face) with a "Generate font pairing" button that fills
  Heading+Sub-heading+Post-Title+Body from a curated ~30-entry `FONT_PAIRINGS` list (documented
  typography pairings, not a random freeform combination), a live preview panel, and — in its own box
  below the preview, not mixed into it, so it stays legible even when the theme it's judging isn't — an
  automatic WCAG contrast-ratio readability check (`lib/utils.ts`'s `contrastRatio`, worst-case across
  body text vs background and the primary button's label vs its background, shown as a percent +
  Good/OK/Poor label). The button check (and the real frontend) use `bestTextColor` — black or white,
  whichever actually contrasts — instead of assuming white text always; `BaseLayout.astro` computes the
  matching `--color-primary-content` and `SectionBlock.astro`'s `.ds-btn-primary` reads it, so a light
  primary color (several curated presets included) renders a readable button instead of invisible
  white-on-white. The live preview's secondary/accent button is filled the same way (background:
  secondaryColor, label: `bestTextColor(secondaryColor)`) — not outlined with secondaryColor used
  directly as text on the page background, which isn't how any real color system pairs an accent hue
  and made several legitimately-fine UI Themes presets score "poor" for a combination nothing actually
  renders. All 12 presets score "Good" under this model; a genuinely low-contrast accent (e.g. mid-gray)
  still moves the score down, by design. The same box also flags font legibility independently of color contrast — script/handwriting faces
  (`SCRIPT_FONTS`) are illegible in any role, display-only faces like Abril Fatface (`DISPLAY_ONLY_FONTS`)
  are only flagged when used as the body font, not heading — either caps the score/tone to "poor" even
  if the color contrast alone would pass. Also a personal saved-style collection
  (save/test/activate/delete, export/import as `.md`) backed by `theme_presets`. "Test" on a saved preset
  opens the real site's homepage with those not-yet-saved settings applied: `POST
  /api/theme-preview-token` (`verifyAnyUser`-gated) validates the settings the same way the real save
  route does and mints a short-lived (`previewOnly`, 5-min TTL) session-signed token carrying them;
  `GET /api/theme` overlays a valid token's settings on top of the real merged theme for that response
  only (empty-string fields skipped, so a partial test still falls back to what's actually persisted) —
  nothing is written to `site_theme`. `previewUrl`'s new `themeToken` param is independent of its
  page-draft `previewToken` (different purpose, both can be present at once); only the two tenant-scoped
  `ThemeForm` instances pass a `previewTenantHost` to enable this — Global Theme has no single site to
  open, so its Test still only updates the form's own local preview panel.
  `PostsPanel` ("Post / Article" in the UI — the underlying `posts` slug/table/i18n-key names are
  unchanged) follows the same quick-create pattern as `PagesPanel`: title only, auto-derived +
  de-duplicated slug, then `navigate(item.id)` straight into `PostEditorPage` — a real routed page now
  (`posts/:id`, see the route map above), not the old inline-expand-under-the-list-row `PostEditor`.
  `PostEditorPage` is a Ghost-style full-screen editor (`fixed inset-0` overlay over the whole shell): a
  header with a status badge, a Preview button (mints a post preview token via `POST
  /api/posts/:id/preview-token` so Draft/Private posts stay previewable), the two status actions that
  aren't the post's current one (Publish/Make private/Back to draft), Save, and a toggle for the settings
  panel; a feature-image band whose empty state opens `MediaPickerModal` — a small upload-or-pick modal
  (its own component, shared wherever the editor needs exactly one image) distinct from the full
  `MediaManager` panel's folders/search/bulk-select; the title/excerpt fields; and the BlockNote editor
  wrapped in its own fixed `EditorToolbar` (bold/italic/underline/strike/code, heading 1-3, quote, lists,
  alignment, link) — an always-visible bar for people used to a Word/Docs-style toolbar, layered on top of
  BlockNote's own slash-menu and selection popup rather than replacing them. The collapsible settings
  panel (`panelOpen`, open by default) holds a `<select>` of this tenant's `categories` plus an inline
  new-category name input + button that calls `POST /api/categories` and immediately selects the result,
  so creating a category never requires leaving the editor for `CategoriesPanel`'s own route
  (`posts/categories`, linked from `PostsPanel`'s header — a plain rename/delete list, no
  quick-create-into-editor pattern of its own, since a category has no content to edit); a
  comma-separated tags input; "Share to portal" (rendered only when `status === "published"`, matching
  the server-side gate — never for `"private"`); the author's email if set; and a collapsible
  `PostHistory` panel (fetched only when opened, not on every edit) listing `post_revisions` snapshots
  with one-click Restore. Typing `@` in the body opens a `SuggestionMenuController` wired to a custom
  `bookmarkCard` BlockNote block (`src/blocknote/bookmarkCard.tsx`): it calls `GET /api/content-search`
  and, on pick, inserts a card whose title/excerpt/image/url are a snapshot captured at insert time, not
  re-fetched on render — an accepted staleness ceiling (a later rename or delete of the linked post/page
  leaves the card showing the old snapshot; a background re-sync job is the upgrade path if that's ever a
  real complaint, not built now). Building that block surfaced two real deviations from the naive
  BlockNote API in the installed `@blocknote/react@0.51.4`: `createReactBlockSpec(config, implementation)`
  returns a factory function (`(options?) => BlockSpec`), not a `BlockSpec` itself, so it has to be
  invoked once (`createBookmarkCardBlockSpec()`) before going into `blockSpecs` alongside
  `defaultBlockSpecs`'s already-plain entries; and a React block spec's `toExternalHTML` is typed as a
  React FC returning JSX (same props as `render`, plus `context`), not the DOM-node-returning function
  `BlockImplementation` uses on the non-React `@blocknote/core` side — both are called out inline in
  `bookmarkCard.tsx` so the next block spec added there doesn't have to rediscover them. A section's
  `Row` (`sp.rows[]`) is independently selectable in Blocks mode — click its background/grid area or the
  hover-revealed "Row" tag, or click "Row N" in the Layers tab — surfacing its own Inspector panel
  (`sel.length === 2`, a case that never collides with section/column/element's `sel.length`
  1/3/4) with per-side `padding`, top/bottom `margin` (the gap *between* stacked rows — replaces the old
  fixed `space-y-*`/flex-`gap` spacing, so rows are plain block-flow now and adjacent rows' margins
  collapse like normal HTML), a plain px `gap` field for the gap *between this row's columns*
  (`Row.gap`, custom px only, no presets — falls back to the page-wide default in `pages.settings.gap`,
  set from the Inspector's "nothing selected" panel, then to a hardcoded 2rem), and
  duplicate/copy/paste/copy-style/paste-style/delete — the same `ClipLevel` clipboard mechanism
  (`"row"` alongside `"section"/"column"/"element"`) Column already used, Inspector-panel buttons only,
  no on-canvas widget or context menu (matches Column's pattern, not Section's). Mobile breakpoint
  preview (bp === "mobile") forces every row's `gridTemplateColumns` to `1fr`, stacking columns — mirrors
  `SectionBlock.astro`'s own `@media (max-width: 768px)` rule, which the canvas didn't previously
  simulate. The padding/margin spacing-overlay hatch band (blue = padding, amber = margin) only renders
  while its matching drag handle is hovered or actively dragged (`hoverBand` state) — the small "Npx"
  badge itself still always shows once selected; a persistent hatch on every side at once, just from
  selecting the item, was too visually noisy. The canvas's dashed section/row/column guide lines and
  empty-column hint text are drawn directly on top of that block's actual configured background (which
  a tenant can set to anything), so they no longer use a fixed admin-chrome gray (`border-line`) — that
  vanished on a bright/white section or column background. `overlayColors()` (next to `hexToRgba`) picks
  a dark- or light-tinted line/text color per block via the same `bestTextColor` black-vs-white contrast
  check `ThemeForm`'s button preview uses, keyed off that block's own resolved bg (`col.props.bg` falling
  back to the section's, falling back to the site theme's). Row's own grid container has no permanent
  dashed border (removed — it was purely redundant with each Column's own dashed border directly inside
  it); Row selection/hover still comes from the same `selCls([b, r])` outline every other level uses. The
  Section Inspector's Grouped Styles panel (`FieldGroupKey`) has a dedicated `"appearance"` card (Opacity +
  Shadow — Figma calls this "Appearance") split out from the `"border"` card, which now holds a real
  Stroke control (`borderWidth`/`borderColor`/`borderStyle`) instead of the old `border`
  none/thin/thick preset — `borderWidth` set wins over the legacy preset (`sectionBpStyle()` in
  Designer.tsx, mirrored in `SectionBlock.astro`), so existing pages saved before this field existed don't
  move. `opacity` (0-100, CSS `opacity` on the whole section — backdrop and content together) is a new
  Section-only field, same fallback-to-fully-opaque-when-unset convention as every other optional style
  prop here. The canvas's guide-line overlay tint (`overlayColors()`, previous paragraph) only ever
  substitutes for an *unset* border — it never overrides a real `borderColor`/legacy `border` preset the
  author actually picked, so a configured Stroke shows its true color while editing, not just on the
  published site. "Save as Template"/the Templates modal (`saveAsTemplate`/`templateKind`/`insertTemplate`,
  backed by `apps/api`'s `design_templates` table) reads whichever selection path is passed in — the
  right-click context menu passes its own `ctxMenu.path` explicitly rather than the left-click `sel` state,
  since right-clicking an unselected element never updates `sel` and silently no-opped there before this was
  fixed. `templateKind` recognizes 4 depths, not 3: `section` (path length 1), **`row`** (length 2), `column`
  (length 3), `element` (length 4) — row was added because clicking a section's background/grid area selects
  its Row (see the Row Inspector paragraph above), not the section itself, so "save the whole section" via a
  background click always hit a silently-disabled Save button until row became a valid template kind too.
  The modal also shows a hint line whenever nothing template-able is currently selected, instead of just a
  dead-looking disabled button. Naming a new template uses an in-app field inside the modal
  (`pendingTemplate`/`templateName` state, submitted via `confirmSaveTemplate()`), not `window.prompt()` —
  a browser that's already shown several JS dialogs in the same tab (alert/confirm/prompt) offers to
  "prevent this page from creating additional dialogs," and once that's ticked `prompt()` returns `null`
  instantly with zero visible sign anything happened, which made a real Save click look identical to a
  disabled one. `saveAsTemplate()` itself is synchronous now — it only stages `pendingTemplate` and opens
  the modal; the actual `POST /api/templates` call happens in `confirmSaveTemplate()` once a name is typed.
  Section and Column each also have their own explicit-path `saveAsTemplate([b])`/`saveAsTemplate([b, r, c])`
  button (`LayoutTemplate` icon) wired into every place their other per-level actions (copy/paste/copy-style/
  delete) already live — Section's canvas-header `BlockControls`, Column's Inspector button row, and both
  branches of `LiveEditToolbar`. Right-click (`ctxMenu`) is no longer Element-only either: the single
  `ctxMenu` render block branches on `templateKind(ctxMenu.path)` and shows the same 8-item menu (Edit,
  Duplicate, Copy, Paste, Copy style, Paste style, Save as template, Delete) at all 4 depths, calling
  whichever level's already-existing helper functions (`duplicateSection`/`duplicateRow`/`duplicateColumn`
  — the last one newly added, Column previously had no standalone duplicate — /`duplicateElement`, and
  their copy/paste/copy-style/paste-style/delete counterparts). Blocks mode's Section/Row/Column canvas
  containers each got their own `onContextMenu` (mirroring Element's, which already existed) that calls
  `setSel` + `setCtxMenu` with their own path. Live Edit's iframe bridge (`designer:contextmenu` in the
  postMessage handler) accepts path lengths 1/3/4 now, not just 4 — but never 2 (row): `SectionBlock.astro`
  only stamps `data-designer-path` on section/column/element nodes, not the row wrapper, so a live-mode
  right-click can never resolve to a Row; Row's context menu only works in Blocks mode. The Templates modal
  itself scales for a large personal library (a flat, ungrouped list was fine at a handful of saved templates,
  not at 100+): it's a wider grid (`w-[min(90vw,52rem)]`, 2-3 columns) with a name search box and kind-filter
  pills (All/Section/Row/Column/Element, `templateFilter`/`templateSearch` state, filtered client-side —
  no new API params, the full list is already fetched by `listTemplates`) above the grid, and each card
  renders `TemplatePreview`: a rough layout-only impression (stacked rows → columns → a bar per element,
  `rows.slice(0,4)`/`columns.slice(0,5)`/`elements.slice(0,3)` so one oversized template can't blow up a
  card), not a real screenshot — an actual rendered thumbnail would need a headless-browser pipeline just
  for this, and a rough shape is enough to recognize a saved layout at a glance. Every template kind
  normalizes to the same `rows[]` shape for this (`row`/`column`/`element` templates are treated as a
  1-row, and for column/element also 1-column, section), so `TemplatePreview` has one render path for all
  4 kinds. The Element Inspector (only Element — Section/Row/Column's own field lists have no `"content"`-
  bucket fields at all, so a Content tab there would always be empty) splits into Kandungan/Content and
  Gaya/Style tabs (`inspectorTab` state) once it actually has content fields (`hasContentFields`, checked
  against `FIELD_GROUP_BY_KEY`) — Content shows only the `"content"` bucket (Text/URL/HTML/items/etc, an
  element's raw data), Style shows the Padding/Radius/Margin `FourSideControl`s plus every other
  `GROUP_META` bucket (typography/background/size/appearance/border/advanced). `FieldGroups` grew an
  `only?: "content" | "style"` prop for this — its 3 existing call sites (Section/Column/Element field
  lists) are unaffected when the prop is omitted. Copy/paste/duplicate/delete stay outside the tabs
  (always visible), since they're actions, not settings to browse.

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
