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
- `pnpm --filter @usim-cms/api db:generate` — generate a Drizzle migration `.sql` file from
  `apps/api/src/db/schema.ts` into `src/db/migrations` (authoring only — writes the file, applies nothing)
- `pnpm --filter @usim-cms/api db:migrate` — **do not run this against `DATABASE_URL` in normal use.**
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
superuser once and run `pnpm --filter @usim-cms/api db:setup-role`, then switch `DATABASE_URL` to the
`usim_cms_app` role it creates — the `pages` RLS policies (`src/db/migrations/0002_pages_rls.sql`) are
a silent no-op under a superuser connection. That role also needs `CREATEDB` (see the grant in
`scripts/setup-db-role.sql`): each tenant gets its own database, auto-provisioned on first request.

## Multi-tenancy: database-per-tenant

- `DATABASE_URL` holds only the **control plane** — the `tenants`/`users`/`roles`/`site_theme`/
  `shared_content`/`theme_presets`/`languages` registry tables (`apps/api/src/db/tenant-pool.ts`'s fixed
  `pool`). Tenant content (`pages`, etc.) never lives there. `theme_presets` is a personal, per-user
  favourites list in the admin's Theme panel (save/test/activate/delete a named color+font combo, or
  export/import it as a small `.md` file) — owned by `owner_user_id`, never tenant-scoped, never read by
  `getMergedTheme`/apps/frontend. `languages` is a superadmin-curated master list of language codes the
  whole instance may use (seeded `ms`/`en`, both `enabled` — see `apps/api/src/db/bootstrap-public.sql`),
  managed via `/api/portal/languages` (`listLanguages`/`createLanguage`/`updateLanguage`/`deleteLanguage`
  in `tenant-pool.ts`) and the admin's superadmin-only Settings tab (`SettingsPanel`'s "System Languages"
  card, `apps/admin/src/App.tsx`). `code` is immutable once created — both PATCH's body shape and the
  admin UI never offer to edit it — since later phases (per-tenant enabled subset; a post-level
  language/translation field) will reference `code` values directly, and letting it change would silently
  break those references. Disabling or deleting the last `enabled: true` row is rejected (400) by both
  `updateLanguage`/`deleteLanguage`'s shared `guardLastEnabled` check, so the instance can never end up
  with zero usable languages. Phase 1 of 3 for the broader i18n effort — see
  `docs/superpowers/specs/2026-08-06-global-language-registry-design.md`; nothing else in the codebase
  reads this table yet, it's purely a management screen until the next two phases (per-tenant subset,
  post-level translation) land.
- i18n Phase 2: per-tenant enabled-language subset. `tenant_languages` (control-plane, keyed by
  `tenant_host`, `enabled_codes text[]`) has no row for a tenant by default — absence means "inherit
  every currently globally-enabled language," re-resolved live on each read
  (`getTenantLanguageSelection` in `tenant-pool.ts` re-intersects any stored `enabled_codes` against the
  live `languages.enabled` set, so disabling a language globally instantly drops it from a tenant's
  selection too, even one that had explicitly picked it). Gated by a new `languages.write` permission
  (`PERMISSIONS` in `index.ts`) on `PUT /api/tenant-languages`; `GET /api/tenant-languages` has no
  permission check (any authenticated user of that tenant can view the current selection) — the same
  read-open/write-gated asymmetry `theme.write`/`PUT /api/theme` already uses. The admin UI
  (`TenantLanguagesForm`, `apps/admin/src/App.tsx`) is a checkbox list of the tenant's globally-enabled
  languages; checking every box sends an empty `codes` array (explicit "inherit all, including languages
  added later"), unchecking any box sends the exact remaining subset. Following the same convention as
  `theme.write` — this codebase has no client-side notion of "permissions granted to the current
  session" (`Session` only carries `role`/`tenantHost`/`tenantHosts`), so a webmaster without
  `languages.write` still sees this form; Save simply surfaces the server's 403 rather than the UI being
  hidden. Mounted twice, mirroring `theme`'s own placement: inside `ContentManager` as a
  superadmin-only sub-tab (`languages`, alongside `theme`, superadmin picks the site first) and as a
  webmaster's own top-level `Tab` (`contentTabs` gains `"languages"` for non-super sessions, a sibling of
  their own top-level `theme` tab) since a webmaster has no site picker to reach the `ContentManager`
  variant. Real bug hit right after shipping: `languages.write` was added to `PERMISSIONS` in
  `index.ts` but never to the admin's own Roles-editor checkbox list (a SEPARATE client-side `PERMISSIONS`
  const in `App.tsx`, `perm-*` i18n keys) — no role could actually grant it, so every webmaster save
  403'd with no way to fix it from the UI. Fixed by adding it there too; the lesson (worth remembering
  for any future permission string) is that a permission only really exists once it's in BOTH lists, not
  just the server-side enum.
- i18n Phase 3/4 (posts/pages get a language + translations) went through two real designs — the first
  was built, shipped, then explicitly rejected by live feedback and replaced same-session. Documented
  here as the CURRENT (corrected) design only; the rejected first cut (a separate post/page row per
  language, linked by `translationGroupId`) is gone from the code and is not described below except where
  its retired DB columns/lessons still matter.
  **Current design — one row holds every language.** `posts`/`pages` each have `language` (a code from
  this tenant's enabled set, validated in `postsBeforeChange`/`pagesBeforeChange`, `null` until an author
  picks one — this is the row's own "base" language) and `translations` (jsonb, default `{}`,
  `migrations/0016_content_translations.sql`) — every OTHER language's content, keyed by code, living on
  this SAME row. For posts, a `translations[code]` entry is `{ title, excerpt, body }`; for pages it's
  `{ layout }` (pages have no per-language title — Designer has no title-editing control at all, title is
  set once at creation and shared across every language). `translations` is a normal client-writable
  field (in both collections' `createSchema`, `{ type: "object" }` — the real shape isn't ajv-validated,
  only checked in `beforeChange`) saved through the ordinary `PATCH /api/posts/:id`/`PATCH /api/pages/:id`
  generic-crud routes — there is no dedicated translation-create endpoint, because there is nothing to
  create: adding a language just adds a key to this row's own jsonb column. `postsBeforeChange` sanitizes
  `translations[code].body` through the exact same `sanitizePostBodyHtml` helper (extracted from the old
  inline call) as the top-level `body` — a translation's HTML is exactly as much of a trust boundary as
  the base one. `pagesBeforeChange` likewise runs `validateLayout` on every `translations[code].layout`,
  not just the top-level `layout`.
  **Admin editor — one editor, a language pill switcher, never a new row.** `PostEditorPage` holds a
  `content: Record<string, {title,excerpt,body}>` map plus `activeLang` state; `BASE_LANG` (a sentinel
  string, never a real language code) is the key for the row's own base content. The visible title/
  excerpt/BlockNote-editor fields always reflect `content[activeLang]`. Clicking a language pill
  (`clickLanguagePill` → `switchLanguage`) snapshots the currently-visible fields into
  `content[activeLang]` (so nothing typed is lost), then loads `content[target]` into those same fields —
  stub-copying the just-left slot verbatim into `target` first if `target` has no content yet (this is
  "Auto-translate": a real translation API is still a follow-up, per
  `docs/superpowers/specs/2026-08-06-global-language-registry-design.md`). `save()` commits whatever slot
  is on screen into `content`, then splits it: `content[BASE_LANG]` becomes the top-level `title`/
  `excerpt`/`body` PATCH fields, everything else becomes the `translations` PATCH field — one
  `updatePost` call, one row, always. Designer's `PageDesignerRoute` mirrors this exactly with
  `content: Record<string, Block[]>` (no title/excerpt, `blocks` IS the currently-active language's
  layout) and `switchPageLanguage`/`clickPageLanguagePill`; switching also resets the undo stack
  (`history.current`/`future.current` refs) since undo is scoped to whichever language's layout is
  currently open. The post-load effect that resyncs `title`/`excerpt`/`content`/etc from the fetched post
  is keyed on `post?.id`, not the `post` object itself — `save()` always refreshes the whole posts list
  afterward, which gives `post` a new object identity for the SAME row; keying on the object would have
  re-fired this effect after every save and snapped `activeLang` back to `BASE_LANG` mid-edit.
  **Why this replaced the separate-row design**: the first cut spawned a whole new post/page per
  language (own slug/status/id), which visibly multiplied the content list (a screenshot showed a dozen
  near-duplicate rows from testing) and required navigating away to a different editor session just to
  add or review a translation. Live feedback ("taknak mcm ni, dia jd duplicate post... tapi kat post
  editor boleh switch") asked for exactly one row per post/page with an in-editor switch instead — this
  is that correction. The retired `posts.translationGroupId`/`pages.translationGroupId` columns
  (`migrations/0013_posts_i18n.sql`/`0014_pages_i18n.sql`) are left in the DB, unused by any code, rather
  than dropped — a harmless nullable leftover, matching this codebase's general non-destructive-migration
  convention.
  **Public frontend**: `apps/frontend`'s `Post`/`Page` types gained `translations`; `resolvePostContent(post,
  code)`/`resolvePageLayout(page, code)` (`lib/api.ts`) pick the base fields/layout when `code` is
  null/matches the row's own `language`/has no matching key, otherwise that language's stored entry.
  `posts/[slug].astro`/`[...slug].astro` read a `?lang=` query param and resolve through these — the SAME
  slug/row serves every language now, so the header switcher's option hrefs are `?lang=<code>` on that one
  URL (base language omits the param), never a link to a different post/page. `BaseLayout.astro`'s
  `langSwitcher` prop shape (`{current, options: {code,label,href}[]} | null`) is unchanged from the
  original design; it still only renders when there are 2+ options and `showHeaderSwitcher` is on.
  **Real auto-translate**: `switchLanguage`'s (PostEditorPage)/`ensureTranslation`'s (CategoryTranslations,
  below) translate calls go through `apps/api/src/translate.ts` → MyMemory's free `/get` endpoint (no API
  key). MyMemory's own top-ranked `responseData.translatedText` can be a noisy crowd-sourced
  translation-memory hit; `translatePlainText` prefers a `matches[]` entry tagged `"created-by":"MT!"`
  (real machine translation) when one exists. `translateHtmlBody` strips tags to plain text, translates,
  then re-wraps each line as `<p>${escapeHtml(line)}</p>` — the `escapeHtml` matters because this
  endpoint's own output must be safe HTML on its own merits (it's general-purpose, not guaranteed to flow
  through the posts/pages sanitize-on-save hooks). Calls to `/api/translate` from the SAME editor action
  (e.g. translating title+excerpt+body together) must be sequential `await`s, never `Promise.all` — firing
  them concurrently against a cold/unmigrated tenant DB connection raced `ensureTenantDatabase`'s own DDL
  and produced a real Postgres `40P01` deadlock.
  **Per-language resync-on-save**: when a post/page's base content changes on Save and other language
  slots already exist, `askResyncLangs(langs): Promise<string[]>` (a small promise-based modal, same shape
  as `useConfirm` but returning which languages were picked rather than a yes/no) asks per-language which
  slots to re-translate — protects a hand-edited translation from being silently overwritten just because
  the base changed. Skipping the prompt (or unchecking everything) leaves every existing translation as-is.
  **Default-language pill**: the language pill matching the item's own base `language` gets an amber ring
  + a leading "★" (PostEditorPage/Designer) so it reads as visually distinct from a plain translated slot.
  **Locale-aware date**: `posts/[slug].astro`'s published-date formatting uses
  `new Date(...).toLocaleDateString(dateLocale, ...)` where `dateLocale = requestedLang ?? post.language ??
  "ms"` — bare language codes (`"ar"`, `"zh"`, etc.) work directly as `Intl` locales, no code→region
  mapping table needed.
  **Category i18n follow-up**: `categories` gained the same `translations`/`multilangEnabled` pair as
  posts/pages (`migrations/0017_category_translations.sql`) but no `language` column — a category has no
  separate "base" slot, `name` itself always is the base, so there's nothing to switch away from. Off
  (default) means `name` is shown for every language, unchanged ("keep the original name"); on, a
  category's own `PATCH` accepts `translations: {code: {name}}`, validated in `categoriesBeforeChange`
  (each entry's `name` must be a string, 400 otherwise). `CategoriesPanel.tsx`'s `CategoryTranslations`
  renders one language pill per site language for a `multilangEnabled` category — an empty pill
  auto-translates `name` via `/api/translate` then opens for inline edit, a filled pill just opens for
  edit — gated behind the SAME `siteMultilangEnabled` global switch (`getTenantLanguages`) posts/pages
  already gate their own translation UI behind. `postsAfterRead` (index.ts) now also returns
  `categoryTranslations` (the joined category's `translations`, or `{}` when that category's own
  `multilangEnabled` is off) alongside the existing `category`/`categorySlug`; the frontend's
  `resolveCategoryName(post, code)` (`lib/api.ts`) picks `categoryTranslations[code].name` when present,
  else falls back to `category` — the fallback IS the "keep original name" behavior, not a separate flag.
  `posts/[slug].astro`'s category link uses this instead of `post.category` directly. The category
  archive page (`category/[slug].astro`) is unchanged/not language-aware — this follow-up only reached the
  post metadata line that triggered the request, not the archive listing.
- **Fastify route-table lesson (from the retired design, still worth keeping)**: registering the same
  GET path on both `publicScope` and `protectedScope` is a fatal `FST_ERR_DUPLICATED_ROUTE` at boot —
  Fastify's route table is global across the whole app regardless of `.register()` encapsulation
  (encapsulation scopes decorators/hooks, not route uniqueness). This bit the original
  `GET /api/posts/:id/translations` (now removed along with the rest of that design). Any future
  hand-written route that wants "public read, richer for an authenticated caller" must be ONE route with
  inline elevation (see `elevateIfAuthenticated` in generic-crud.ts for the pattern), never a
  public+protected pair on the same path.
- i18n Phase 5 (WPML-style opt-in, requested before the design correction above and still current): a
  tick-first master switch at two levels, gating the language pill switcher that would otherwise be
  offered any time a tenant had 2+ languages. `tenant_languages.multilangEnabled` (migration: `ALTER` in
  `bootstrap-public.sql`, boolean, default `false`) is the site-wide switch a webmaster/superadmin flips
  in `TenantLanguagesForm` (`apps/admin/src/App.tsx`) before anything else in that form becomes usable —
  the language-subset checkboxes and the header-switcher checkbox are `disabled`+dimmed while it's off,
  though the codes/showHeaderSwitcher values themselves are untouched so re-enabling restores the prior
  selection. `posts.multilangEnabled`/`pages.multilangEnabled` (`migrations/0015_multilang_toggle.sql`,
  same boolean-default-false shape) are the per-row switch: a checkbox next to that row's own Language
  field in `PostEditorPage`/Designer's Inspector, only rendered at all once the site switch is on. The
  pill switcher is only rendered when BOTH switches are true — `siteMultilangEnabled && multilangEnabled`
  in `PostEditorPage`, `siteMultilangEnabled && pageMultilangEnabled` in Designer's Inspector — so a
  post/page with its own switch off falls back to a plain single-language `<select>`/`<select>`, matching
  the ask ("tick dulu nak multilanguage ke tak" before any translate action appears). `getTenantLanguageSelection`/
  `setTenantLanguageSelection` (`tenant-pool.ts`) both gained a `multilangEnabled` field/param alongside the
  existing `showHeaderSwitcher` one, read/written together in the same upsert so toggling one never clobbers
  the other. Public `GET /api/languages` deliberately does NOT expose `multilangEnabled` (it's an authoring-
  side gate, not something the public frontend's language-switcher decision needs) — only the protected
  `GET/PUT /api/tenant-languages` carries it.
- i18n Phase 5 follow-up (same session, requested right after shipping): `tenant_languages.defaultLanguage`
  (nullable text, `ALTER` in `bootstrap-public.sql`) — the language a post/page's own Language field
  defaults to when never explicitly set, so new content follows the site's main language automatically
  while still being freely overridable per-item. Picked from a `<select>` in `TenantLanguagesForm` scoped
  to the currently-*selected* subset (`allEnabled.filter(l => selected.has(l.code))`, not the full
  globally-enabled list — a default outside what this tenant actually offers would be meaningless);
  `save()` additionally drops it to `null` if the chosen code got deselected from the subset in the same
  edit, rather than sending a now-invalid value the server would reject. `getTenantLanguageSelection`
  re-validates it against `allEnabled` on every read the same way `selectedCodes` already does (a global
  disable of that code silently clears the default, never a dangling reference). `PUT /api/tenant-languages`
  validates a submitted `defaultLanguage` is a member of the request's own `codes` (or of `allEnabled` when
  `codes` is empty/"inherit all"). Applied in `PostEditorPage`/Designer via a small effect keyed on
  `siteDefaultLanguage`/`page.id` that ONLY fires `setLanguage`/`setPageLanguage` when that post/page's own
  `language` is still null — once a row has ever been saved with an explicit language (including
  explicitly "None"), a later-changed or newly-set site default never silently overwrites it.
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
  Designer's header. Element types (`ELS` registry) span the basics (heading/text/image/button/spacer/
  divider/embed/icon/list/html/gallery) plus 4 richer ones for real-world department-site content:
  **accordion** and **tabs** (each `items` field is `Question|Answer`/`Label|Content` pairs, one per
  line — same plain delimited-line convention `list`'s items already uses), **info box** (icon+heading+text
  "feature card" — pairs naturally with a themeable Column as its card background, per `COLUMN_FIELDS`,
  rather than having its own bg/border), and **slider/banner**. Accordion/tabs' stored format is still
  the plain `a|b`-per-line string (`validate-layout.ts`/`SectionBlock.astro` parse it exactly as before) —
  only the Inspector's editing UI is structured: `FieldKind` grew `"pairs"` (add/remove item cards with two
  labeled inputs each, labels driven by each field's `subLabels`), so authors never hand-type the
  `|`-delimited line themselves; `parsePairs` converts between the array the UI edits and the flat string
  that's actually saved. Interactivity stays proportional to `apps/frontend`'s "no client-side JS"
  convention below: accordion is native `<details>`/`<summary>` (zero JS, `name`-grouped only when the
  author opts into "one open at a time"); tabs is the one exception needing a real click handler, a small
  event-delegated `<script>` Astro bundles once per page regardless of how many instances render.
  Slider/banner's `slides` field is a **JSON array**, one object per slide (`imageUrl`, `heading`,
  `subtitle`, `textPosition` — left/center/right —, `overlayColor`+`overlayOpacity` for the darkening
  scrim, and a `buttons` array — each button its own card in the Inspector (not a cramped single-line
  row) with `label`/`href`, `variant` (primary/outline), `size` (sm/md/lg), an optional hex `color`/
  `textColor` override (empty = theme default; `textColor` also recolors an outline button's border
  since its CSS uses `currentColor`), an optional `radius` (px), and `position` — `"flow"` (default,
  laid out inside the slide's text block same as before) or `"custom"` (absolutely placed anywhere in
  the slide via `x`/`y` percent). Custom placement is set either by dragging inside a small position
  minimap next to each button (`dragPosition()` in Designer.tsx — plain pointerdown/pointermove/pointerup
  against the minimap's own bounding rect, not a hook, safe to call from inside the buttons `.map()`) or
  by clicking one of 9 preset dots (`POSITION_PRESETS`, just canonical x/y shortcuts — there's no
  separate named-preset enum to keep in sync across admin/frontend/validator, a preset is only ever
  `{x, y}` like a hand-dragged one). SectionBlock.astro splits a slide's buttons into `flowButtons`
  (rendered inside `.ds-slide-content` as before) and `freeButtons` (rendered as `.ds-slide-btn-free`
  siblings, `position:absolute; left:{x}%; top:{y}%` on `.ds-slide`, which already has `position:relative`)
  — `slideButtonStyle()` turns color/textColor/radius/`fontSize` into inline style overrides, each
  re-checked against a hex/numeric regex at render time (defense-in-depth, same as `bgImage`'s
  `safeCssUrl` guard) on top of `validate-layout.ts`'s write-time check. `.ds-btn`'s padding is `em`, not
  `rem` — an inline `fontSize` override scales the whole pill (label + padding) together instead of just
  enlarging the text inside a fixed-size button.
  A button also has an optional `fontSize` (px, "" = derive from `size`) — the canvas's drag-to-resize
  handle (below) sets this directly; the `size` sm/md/lg dropdown is still the quick discrete preset,
  `fontSize` is the continuous override on top of it, same additive relationship as `color`/`radius`.
  The Inspector's small per-button minimap (drag-or-preset-click to set `x`/`y`) coexists with a second,
  richer way to do the same thing directly on the canvas: `ElPreview`'s `"slider"` case (Blocks-mode
  canvas preview, not Live Edit) renders slide 1's actual buttons with their real style/position — a flow
  button inline next to heading/subtitle, a custom one absolutely placed at its `x`/`y` — and every button
  chip is itself draggable (`startMove`, mirrors `dragPosition`'s pointerdown/pointermove/pointerup-on-
  window pattern, but resolves the containing slide box via `closest("[data-slide-box]")` instead of using
  its own small rect, and works from either starting position — dragging a "flow" button switches it to
  "custom" at the drop point) and has a small corner handle for drag-to-resize (`startResize`, horizontal
  drag delta scales `fontSize` px, clamped 10-40 — same interaction shape as this file's existing
  padding/margin edge-drag handles, just driving a font size instead of a length prop). Both write through
  `updateButtonAt()`, which — like the heading/text canvas-edit `commit()` above it — always re-reads the
  current `slides` off the fresh `bs` inside `mutate()` rather than off a value captured at render time,
  since a drag fires many pointermove events against what would otherwise be a stale closure. Both
  surfaces (the Inspector minimap and each canvas button chip) are also keyboard-focusable
  (`tabIndex={0}`) with an arrow-key nudge (`nudgeButton()`, shared by both) — 2% per press, clamped
  0-100, for anyone who doesn't want to hand-drag or needs a precise realign; nudging a still-"flow"
  button starts it from `BUTTON_DEFAULTS`' center and switches it to `"custom"`, same as a drag would.
  Dragging on the canvas also shows Figma-style smart guides: a red center-alignment line on whichever
  axis the button is within 3% of the slide's own center (and snaps to exactly 50 on that axis), plus
  red spacing ticks on BOTH axes — vertical (top/bottom) and horizontal (left/right) — against whichever
  candidate is nearest, where a candidate is the heading/subtitle text block or any OTHER button on the
  same slide (`edgeGap()`, module-level: only returns a mark when the two rects don't overlap on the
  requested axis but do overlap on the other, so the tick has a sensible perpendicular anchor point;
  `startMove` calls it once per axis per candidate and keeps only the smallest/nearest result per axis, so
  a slide with several buttons doesn't draw a cluttered mark against every one of them at once). This reads
  real DOM rects (`sliderPreviewRefs`, keyed by `el.id` like `editingText` above it — a flat single ref
  would get clobbered by whichever slider block rendered last if a page has more than one — and holding a
  `buttons: Record<number, HTMLElement | null>` map too, keyed by button index, since a button's own
  rendered size varies with its `fontSize`/padding and can't be derived from the x/y percent model the rest
  of this feature uses) rather than that percent model, since alignment-to-actual-rendered-content needs
  real pixel geometry — the dragged button itself doesn't have a live DOM rect mid-drag (it's still
  animating toward its new spot), so its own rect is reconstructed as a same-shaped `EdgeRect` from the
  live cursor position plus its pre-drag size snapshot. `sliderGuide` (transient React state, tagged with
  `elId` so only the slider block actually being dragged draws its own guide) drives the overlay and is
  cleared on pointerup. Each tick also shows its own rounded px length as a small label at its midpoint —
  a bare tick mark didn't read as meaningfully different at a glance without the actual number.
  Heading and subtitle get most of this same treatment — position (flow/custom x/y), color, and fontSize —
  not just buttons: `heading`/`subtitle` evolved from plain strings to a `SlideText` object
  `{text, color, fontSize, align, position, x, y}` (`parseSlideText()`, same string-input-means-legacy-
  content fallback as everywhere else here), and `Positionable` (`{position, x, y}`) is the shape
  `SlideButton` and `SlideText` both structurally satisfy — `dragPosition`/`nudgePosition`/`POSITION_PRESETS`
  all operate on `Positionable` generically rather than being duplicated per item kind. On the canvas,
  `ElPreview`'s `"slider"` case is generalized the same way: `previewRefs.items` is one flat
  `Record<string, HTMLElement|null>` keyed `"heading"|"subtitle"|"btn-<i>"` (not separate text/button ref
  buckets), `ItemRef` (`{kind:"heading"}|{kind:"subtitle"}|{kind:"button",bi}`) is what
  `startMove`/`startResize`/`updateItem` take instead of a bare button index, and the smart-guide candidate
  search just iterates every OTHER key in that one map — so heading-vs-subtitle, heading-vs-button, and
  button-vs-button spacing/alignment all fall out of the same code path instead of three special cases.
  Heading/subtitle stayed fully hand-drag/resizable on the canvas, exactly like buttons — that part was
  never in question. What changed, after a first pass got this wrong: the Inspector's per-button minimap
  (`renderPositionEditor()`, drag-or-preset-click on a small preview box) stayed **button-only** — heading/
  subtitle "tiba2 jd tak best...sama macam button" with a minimap of their own, so instead they get
  `renderTextAlign()`, the exact same left/center/right icon-button row (`ALIGN_ICON`) the standalone
  heading/text element types already render for their own `align` field (`FieldInput`'s
  `field.kind === "select" && field.key === "align"` branch) — no manual fontSize input either; resizing a
  heading/subtitle, like a button, is canvas-drag-only. `align` only affects a flow item's own text-align;
  a custom-positioned one ignores it (there's no "alignment" for an absolutely-placed floating box).
  Heading/subtitle also got a real Typography section in the Inspector (fontFamily/fontWeight/lineHeight/
  letterSpacing/textTransform/fontStyle/textDecoration) — added by literally reusing `TYPOGRAPHY_FIELDS`
  (the same field list the standalone heading/text element types render in their own Style tab) and calling
  `FieldInput` directly as a plain function (it holds no hooks of its own, same reasoning that already lets
  `ElPreview` be called directly), rather than hand-writing a second set of font controls that could drift
  out of sync. On the canvas, the single bottom-right resize dot was replaced with a proper 4-corner
  resize box (dashed border + a small square handle at each corner, all four driving the same
  `startResize()` — there's only one dimension to scale, fontSize, so all corners are equivalent, this is
  purely about reading as a real resizable object like a standard shape/text box, not a floating dot).
  Getting that box to hug the actual rendered text required `whitespace-nowrap` on the chip: an
  `inline-block` that DOES wrap (a long heading vs. the slide's `max-w-[80%]`) shrink-to-fits to the
  *available* width, not the widest wrapped line, so the box floated visibly past the glyphs whenever a
  heading wrapped to 2+ lines — forcing single-line in this canvas approximation (the real published page
  in SectionBlock.astro still wraps normally) keeps the box meaningful.
  That Typography section's `fontFamily`/`lineHeight`/`letterSpacing` fields got two more `FieldKind`s (not
  slider-specific — `TYPOGRAPHY_FIELDS` is shared with the standalone heading/text/list elements' own Style
  tab, so both picked up the same upgrade for free): `"font"` renders `FontPickerInput`, a typeable input
  with a dropdown of matches from `GOOGLE_FONTS` (moved to `lib/utils.ts` so both this and App.tsx's
  `ThemeForm`/`FontField` draw from one list) where every option is styled `fontFamily: f` so it previews in
  its own face instead of just naming itself — freeform names typed by hand still work, the dropdown is a
  narrowing filter, not a closed enum. Designer.tsx also preloads the whole curated list as one batched
  Google Fonts stylesheet on mount (`id="admin-font-picker-preview"`, same guarded-`<link>` approach
  `ThemeForm` already used) so every dropdown option actually renders in its real font immediately, not just
  whichever fonts happen to already be in use on the page (the existing per-block font-scanning effect below
  it still covers hand-typed names outside the curated list). `"stepper"` renders a "−/+ flanking a number
  input" control (Field gained an optional `step?: number`) — the same visual pattern the shadow panel's
  X/Y/blur/spread fields already used via `NumberStepper`, inlined here without that component's own
  `<label>` wrapper since `FieldInput`'s other kinds are all bare controls (FieldGroups/
  renderTypographyFields already render each field's label above it).
  `startMove`'s smart guides gained sibling-to-sibling center alignment (a pink line, distinct from the
  red page-center/spacing-tick lines) — before this, `vCenter`/`hCenter` only snapped to the slide box's
  own 50% center; now, while dragging any item, its center is also compared against every OTHER item's
  center on the box (`previewRefs.items`, same candidate set `vGap`/`hGap` already iterate) and snaps
  there within a small px tolerance when close (nearest-match only, mirrors the `vGap`/`hGap` "keep
  smallest" pattern) — e.g. two buttons lining up with each other, or a button centering under the
  heading. `sliderGuide` gained `alignX`/`alignY` (box-relative px, null when no match) for this.
  Two more canvas-only bugs surfaced once Typography/align were actually used: the resize box's default
  line-height (unset → browser's ~1.2 "normal") left visible space above/below the glyphs inside the
  dashed box — worse the larger fontSize got — so `textChip`'s style now defaults `lineHeight` to `"1"`
  when the field is unset (an explicit Typography lineHeight still wins; only the un-set default changed).
  Separately, per-item `align` had silently stopped doing anything the moment `whitespace-nowrap` (above)
  made the chip shrink-to-fit its own single line — `text-align` only has a visible effect when a box is
  wider than its content, and shrink-to-fit means it never is. Fixed by moving alignment out of the chip's
  own `text-align` and into `justify-content` on a `w-full` flex wrapper each flow-mode heading/subtitle
  now renders inside (`ALIGN_JUSTIFY`) — the wrapper takes the full row width, `justify-*` positions the
  shrink-wrapped chip within it. This also made the slide's older `first.textPosition`-driven
  `text-left`/`text-center`/`text-right` classes on the outer block dead weight (they only ever affected
  inline/inline-block children, and both text items are now wrapped in block-level flex divs) — removed,
  keeping just `textPosition`'s `self-start ml-6`/`self-end mr-6` block-position classes.
  Equal-spacing detection was added alongside the existing nearest-neighbor `vGap`/`hGap` tick: while
  dragging, besides the dragged item's own gap to its nearest neighbor, `set()` also walks every pair of
  OTHER (non-dragged) items and, if any of THEIR gaps on that axis already equals the dragged item's gap
  (±2px), pushes an extra tick for it (`vGapMatches`/`hGapMatches`) — e.g. dragging the middle item of 3 in
  a row now also confirms when the two outer buttons are already exactly as far apart as the gap just
  formed, not just showing the one nearest tick. Rendered identically to `vGap`/`hGap` (same red tick +
  px-label style), just once per match found.
  Sibling alignment (`alignX`) was center-only at first — a screenshot showed 3 stacked items flush-left
  (heading/subtitle/a button all sharing the same left edge) asking for that case to get its own guide
  line too, not just centered stacks. Since `alignX` already stores "where dragRect's own center would
  have to sit" for a match (so one line/snap value covers every case), this only needed more candidate
  targets per sibling: besides that sibling's own center-x, also its `left + halfW` (the center position
  that makes dragRect's left edge land on the sibling's left edge) and `right - halfW` (same for the right
  edge) — whichever of the three is nearest wins, same as before. `alignY` stayed center-only (not asked
  for; Y-axis top/bottom edge guides would be the same pattern if ever requested).
  Equal-spacing matching (previous paragraph) originally compared raw gap length within a ±2px float
  tolerance, which a screenshot caught showing three simultaneous ticks reading "31px"/"32px"/"32px" —
  correctly flagged as "matching" by that tolerance, but visually reading as a bug since matched ticks
  showed disagreeing numbers. Root cause: flex layout can round two CSS-identical gaps to different
  device-pixel widths (sub-pixel drift in child box sizing, not an actual spacing difference), so the raw
  float distance between them can be up to ~1-2px even when they're "the same" gap. Fixed by comparing
  `Math.round(length)` equality instead of a float tolerance — a match is now only flagged when the two
  ticks would display the exact same rounded number, which is the only thing the user can actually see.
  Left/right-edge `alignX` (previous paragraph) shipped with a real bug: it drew the guide line at the same
  value used to reposition the dragged item's own center, but for an edge match that snap-center is offset
  from the sibling's true edge by the dragged item's own half-width — so the line visibly sat away from the
  actual left/right edge whenever the two items weren't the same width (worked fine for center-matches only
  because there the two values happen to coincide). Fixed by tracking them separately: each X candidate now
  carries both `snap` (screen-space target for repositioning, unchanged math) and `line` (the sibling's real
  matched coordinate — its own left/center/right, never offset by the dragged item's size) — `snapCenterX`
  drives the reposition, `alignX` (from `line`) drives only where the pink guide is drawn.
  Heading/subtitle also gained an explicit numeric Size field in the Inspector (`SLIDE_TEXT_SIZE_FIELD`,
  reusing the `"stepper"` kind and the standalone text element's own `designer-f-size` label) — the canvas
  drag handle was the only way to resize before this, fast but imprecise; typing isn't clamped to the
  drag's 10-40 range, since a specific-number ask shouldn't inherit the drag handle's comfortable bounds.
  Shown value falls back to `TEXT_BASE_PX.heading`/`.subtitle` when `fontSize` is still `""` (unset), same
  fallback the canvas chip itself already uses, so the stepper starts from the size actually on screen
  instead of 0. `startResize`'s own drag also dropped its 10-40px clamp right after — asked not to cap how
  big a drag can make text/buttons; only a 1px floor remains (avoids zero/negative). No server-side change
  needed — `validate-layout.ts`'s `fontSize` check was already just a numeric-format regex, no upper bound.
  Removing that cap surfaced a real responsiveness gap: `slideTextStyle()`/`slideButtonStyle()` emitted a
  literal `font-size:{px}px`, a fixed number that rendered exactly as large on a phone as on a desktop —
  reported as text "tak fit" once an author actually used a big custom size. Fixed with a new
  `fluidFontSize(pxStr)` helper (SectionBlock.astro) that wraps the author's px value in `clamp(floor,
  vw, ceiling)`: the ceiling is the author's own chosen size (never rendered bigger than they set), the
  floor is `max(14, size*0.55)` (stays legible), and the vw middle term is calibrated (`size/10` vw) so it
  equals the ceiling at a ~1000px "designed at this width" viewport and shrinks below that — same fluid-type
  technique `.ds-slide-heading`'s own default `clamp(1.5rem, 4vw, 2.5rem)` already used, just derived
  per-value instead of one hardcoded rule. Neither heading/subtitle/button text has `white-space: nowrap` on
  the real site (only Designer's own canvas approximation does, for its resize-box hugging), so long text
  already wraps to 2+ lines within its container's `max-width` — the missing piece was purely the font-size
  itself not shrinking. Verified this reaches Live Edit's actual mobile preview: its iframe container really
  narrows to `24rem` when the mobile breakpoint is selected (`bp === "mobile"` in Designer.tsx), so the real
  SectionBlock.astro CSS — now fluid — renders exactly as it would on an actual phone, not just a simulated
  grid layout.
  Generalized right after to every element with an author-set font-size, not just the slider — split
  `fluidFontSize` into a shared `fluidClamp(px, ceiling)` plus two callers: `fluidFontSize(pxStr)` (unchanged,
  slider's bare-px strings) and `fluidTextSize(v)` (new — the standalone Text element's own free-form `size`
  field, which allows px/rem/em/% via the "length" field kind). `fluidTextSize` converts rem/em to a
  px-equivalent for the floor/vw math only (assumes the 16px root, same assumption `pxLabel()` in
  Designer.tsx already makes) but keeps the ceiling term in the author's original unit; `%` (or anything
  unrecognized) passes through untouched since it's already relative, not a fixed size that can overflow a
  narrow screen. Heading elements don't have their own free-form size (they pick a `level` h1-4, sized purely
  by the `.ds-h1`-`.ds-h4` CSS classes) — h1/h2 already used `clamp()`, but h3/h4 were still a fixed
  `1.5rem`/`1.2rem`, an inconsistency fixed in the same pass (`clamp(1.3rem, 3.2vw, 1.5rem)` /
  `clamp(1.1rem, 2.6vw, 1.2rem)`, same proportions as h1/h2's own clamps). Icon's own `size` field (also
  "length" kind, also free-form) was deliberately left alone — it sets an `<svg>` `width`/`height`
  *attribute*, not a CSS `font-size` property, and `clamp()` support in SVG presentation attributes is far
  less consistent across browsers than in CSS; icons are also a much smaller overflow risk than a paragraph
  of text, so this wasn't worth the same treatment without being asked specifically.
  Live-testing the mobile breakpoint preview surfaced a real gap the fluid-CSS fix above didn't cover: the
  Blocks canvas's slider heading/subtitle/buttons stayed at full literal px size regardless of the "bp"
  toggle, overflowing the (correctly narrowed) simulated mobile box. Root cause: `vw`/`clamp()` — which
  works perfectly in the real site's actual iframe — can't work here, because the canvas's "bp" preview is
  just a `max-width` box (Designer.tsx's `style={{ maxWidth: ... }}` on the canvas) sitting inside the
  admin's own full, actually-wide browser window; `vw` always measures that real window, never the
  simulated container, so it never visibly shrinks. Fixed with `fluidPreviewPx(px, bp)` — a JS
  reimplementation of the same floor/scaled/ceiling clamp math, evaluated against a fixed reference width
  per breakpoint (`BP_REFERENCE_PX`: desktop 1000, tablet 768, mobile 384) instead of a live `vw` unit —
  gives the canvas an accurate preview of how the real fluid size will look small. `btnChip`/`textChip` now
  compute both `rawFontPx` (the true stored value) and `fontPx` (the bp-adjusted display value); only
  `rawFontPx` is ever passed to `startResize`, so resizing while previewing "mobile" can't accidentally
  persist a shrunk-for-preview size as the real one — drag always continues from the true size regardless
  of which bp you're looking at.
  Slider height also got the same free-length upgrade as everything else here: the `height` field was a
  closed `select` (sm/md/lg/full keywords only) even though `SectionBlock.astro`'s own render
  (`lengthValue(p.height, SLIDER_HEIGHT, SLIDER_HEIGHT.md)`) and `validate-layout.ts` (`height` already in
  `LENGTH_KEYS`, `LENGTH_RE` already includes `vh`/`vw`) both already fully supported an arbitrary literal
  length — the UI itself was the only thing that couldn't express one. Changed to `kind: "length"` (that
  shared control gained `vh`/`vw` alongside its existing px/%/em/rem, benefiting every other field using it
  too, e.g. icon size) and `defaults.height` from the keyword `"md"` to the literal `"32rem"` it already
  resolved to, so a freshly-added slider looks identical to before. Legacy pages keep whatever keyword they
  already have — `lengthValue()` still resolves it the same way, silently upgrades to a literal value the
  next time anyone edits that field, same non-migration convention as every other schema evolution here.
  The Blocks canvas's own slide box was a hardcoded `aspect-[21/9]` regardless of this field — never
  actually reflected the chosen height, even before this change — so it now resolves the same
  keyword-or-literal value (a small `SLIDER_HEIGHT` table mirror, same duplication convention as every
  other shared table between the two apps) into an explicit `style.height`, falling back to the aspect
  ratio only if it somehow resolves empty.
  Two more bugs from that same round, confirmed live by the user (not guessed): (1) the heading resize box
  was STILL floating away from the text despite the earlier `whitespace-nowrap`/`lineHeight:1` fixes (a
  third attempt, `w-fit`, also failed — see the fitTextBox paragraph below for why every CSS-only attempt
  at this was doomed). (2) the shared `"length"`
  FieldInput control (number + unit dropdown) was unusable in a narrow Inspector sidebar — its number input
  used `base`'s own `w-full` as a flex-basis, which combined with the unit `<select>`'s fixed width simply
  didn't fit a ~240-280px panel, squeezing the number input to the point of being hard to click/type into.
  Fixed generically (benefits every `"length"` field, not just slider height): the number input now uses
  `min-w-0 flex-1` instead of `w-full` so it actually shares the row properly, and the unit select shrank
  slightly (`w-20`→`w-16`) to leave it more room.
  A real-browser screenshot then caught the Blocks canvas actively lying about the real site: the editor
  showed heading/subtitle stacked cleanly, but the actual published page showed the heading wrapping to 2
  lines and a custom-positioned subtitle overlapping right through it — invisible in the editor purely
  because `whitespace-nowrap` forced the heading to stay single-line there, something the real site never
  does. Removed `whitespace-nowrap` from the chip so the canvas wraps exactly like `SectionBlock.astro`.
  Keeping the dashed resize box tight around *wrapped* text then needed `fitTextBox()` — and this is the
  part worth remembering, because three separate CSS-only attempts (`whitespace-nowrap`, `lineHeight:1`,
  `w-fit`) all failed before the actual constraint was understood: **no CSS width value can size a box to
  the widest rendered line of wrapped text.** `width: fit-content` resolves to
  `min(max-content, max(min-content, available))`, and the instant text wraps, `max-content` (its full
  unwrapped width) exceeds `available` — so it collapses to the *container's* width, which is exactly the
  floating box being reported. The only real answer is measurement: `Range.getClientRects()` over the chip's
  text node returns one rect per rendered line box, so the widest of those is the true ink width.
  `fitTextBox` sets that as an explicit px width (plus the chip's own padding/border, since Tailwind's
  global `box-sizing: border-box` would otherwise clip the last glyph), and is called from an inline `ref`
  callback rather than a layout effect — a new function identity each render means React re-runs it on
  every render, which is what `ElPreview` needs since it's a plain function that can't hold hooks. It
  mutates the DOM directly (never React state), so there's no re-render loop. It does, however, need its
  containing block to have a **definite** width, which cost one more round to discover: a heading started
  wrapping to two lines on its own with most of the slide still empty, because `.ds-slide-content` (and the
  canvas's mirror of it) had `max-width` but no `width`, leaving it a shrink-to-fit flex item that hugs its
  children. The explicit width `fitTextBox` set on the heading therefore fed straight back into its
  parent's width, which became the heading's available width on the next measure — a ratchet that shrank
  the text column until the text wrapped and stabilized there. Fixed by giving that column a definite width
  on both sides (`width: 100%` on `.ds-slide-content`; `w-full max-w-[36rem] p-6` on the canvas div, which
  also closed a parity gap — the canvas had been using `max-w-[80%]` against the real site's absolute
  `36rem`, and had no equivalent of its `1.5rem` padding). This also fixed something quietly broken well
  before any of it: `text-align`/`justify-*` on the flow heading/subtitle had nothing to align *within*
  while their container hugged them exactly, so the align control was a no-op in flow mode on both the
  canvas and the real site. The general rule worth keeping: never set a measured width on an element whose
  own available width is derived from that element. The custom-position wrapper
  divs (`!headingFlow`/`!subtitleFlow` branches) also gained `max-w-[80%]`, matching `.ds-slide-text-free`'s
  real constraint — previously unconstrained in the canvas, another small accuracy gap. This is a genuine
  author-visible-now, author-fixable-by-repositioning issue, not something auto-resolvable in code short of
  a full collision-avoidance layout system — the fix here is "let the editor tell the truth," not "prevent
  the collision."
  The same screenshot also showed a slider button rendering with invisible (background-colored) text on the
  real site, correct in the canvas. Root cause: when an author sets a custom `btn.color` (background) but no
  `textColor`, `.ds-btn-primary`'s CSS default color is `var(--color-primary-content)` — computed for the
  SITE THEME's own primary color, not this button's overridden one, so it can end up near-invisible against
  an unrelated custom background. `slideButtonStyle()` now falls back to the exact same dark/light default
  (`#111827`/`#ffffff` by variant) Designer.tsx's own canvas preview already used for this case, only when a
  custom background is actually set — a button using the theme's own default color (no override) still
  correctly inherits the theme-aware contrast variable, unchanged.
  A report that an added button "tak muncul" (never appears) turned out to be a structural gap, not a
  rendering bug: `ElPreview`'s slider case did `const first = slides[0]`, so the Blocks canvas only ever
  drew the **first** slide while the Inspector edits every slide — adding a button to slide 2 genuinely
  showed nothing anywhere. The dots along the bottom of the canvas preview (previously decorative `<span>`s
  with the first one always highlighted) are now real buttons driving `sliderSlideIdx` (per-element-id
  state, same keying as `sliderPreviewRefs`, clamped on read since deleting a slide can strand the index
  past the end of the array), plus an `N/M` counter that only appears for a multi-slide slider — dots alone
  never communicated that the canvas was showing one slide out of several, which is what made this read as
  "the button wasn't added" instead of "you're looking at a different slide". Fixing this also required
  fixing a latent bug it would otherwise have exposed: `updateItem` wrote to `currentSlides[0]` hard-coded,
  which was harmless only while the preview could never leave slide 1 — it now writes to `slideIdx`, so a
  drag/resize while previewing slide 2 no longer silently rewrites slide 1.
  A slide button with no custom colour previewed as a plain white pill on the canvas while rendering in the
  site theme's colour on the real page — `btnChip` hard-coded `#fff`/`#111827` as its unset fallback, where
  the real `.ds-btn-primary` resolves `var(--color-primary, #0f62fe)` / `var(--color-primary-content, #fff)`.
  It now uses those same two CSS custom properties (already set on the canvas root from `siteTheme`, and
  already what the standalone button element's own preview uses), so an untouched slide button previews in
  the theme colour; an explicitly-set `btn.color` still wins, and keeps the fixed dark label
  `slideButtonStyle()` falls back to for that case. The Inspector's two swatches also stopped showing an
  arbitrary `#2563eb`/`#ffffff` for an unset value — they now preview what's actually in effect
  (`themePrimary`, and `bestTextColor()` of it), since a blue swatch on a button that renders pink reads as
  a real setting rather than "unset". The existing `×` next to each swatch is the reset-to-theme-default
  control and gained a `designer-reset-default` tooltip; it stays hidden when nothing is overridden.
  `SectionBlock.astro` mirrors this: `slideTextStyle()` (color/fontSize/text-align/typography inline
  overrides, same pattern as `slideButtonStyle()`, each new field checked against the same
  `FONT_FAMILY_RE`/`LENGTH_RE`/enum shapes validate-layout.ts already uses for every other element's
  Typography fields) plus a `headingFlow`/`subtitleFlow` split identical to buttons'
  `flowButtons`/`freeButtons` — a flow heading/subtitle renders in `.ds-slide-content` as before, a custom
  one renders as a new `.ds-slide-text-free` (`position:absolute`, `transform:translate(-50%,-50%)`, mirrors
  `.ds-slide-btn-free`) sibling. `validate-layout.ts`'s `isSafeSlideText()` accepts either a plain string
  (legacy) or the new object shape (now including `align`), same dual-format convention as
  `isSafeSlideButton`/`isSafeSlide` themselves. This was a deliberate schema evolution off the original
  needed once slides gained more fields than a flat line can hold. `parseSlides`/`stringifySlides`
  (Designer.tsx) and their SectionBlock.astro mirror both accept **either** shape — `JSON.parse` first,
  falling back to the old pipe-line parse on failure — so a page saved before this change keeps
  rendering/saving untouched and silently upgrades to JSON the next time its slider is edited; never a
  hard migration. Rendering uses **Embla Carousel** (`embla-carousel` + `embla-carousel-autoplay`,
  apps/frontend's only real npm UI dependency beyond Tailwind/daisyUI — headless, ~6kb, vanilla JS, no
  React) instead of the original hand-rolled `translateX()` script: `.ds-slider-viewport` >
  `.ds-slider-track` > `.ds-slide` is exactly Embla's expected viewport/container/slide structure, giving
  real touch/drag/swipe/momentum/loop for free. The `<script>` just wires the existing prev/next/dot
  buttons + an optional autoplay plugin to Embla's API (`scrollPrev`/`scrollNext`/`scrollTo`/`on("select")`)
  instead of computing scroll percentages by hand. `apps/api/src/collections/validate-layout.ts` validates
  every field the same way as every other prop — `slides`' new JSON shape gets its own
  `isSafeSlide`/`isSafeSlideButton` checks (image through the same `isSafeCssUrl` as `bgImage`, since both
  land in a raw `url(...)`; button `href` through `isSafeUrl`), with the same JSON-then-legacy-pipe
  fallback as the parsers above so an unedited old page's layout keeps validating on every save, not just
  ones already rewritten to the new shape. This slider work also surfaced two real gaps unrelated to
  itself, worth remembering: `validate-layout.ts`'s `LENGTH_KEYS` was missing the bare `"padding"` key
  (Column/Element's own legacy fallback — distinct from Section's `paddingY`/`paddingX` split — see
  `COLUMN_SPACING_KEYS` and every `sideValue(..., "padding")` call), which 400'd on the very first
  save/publish of any page saved before that validator existed; and `apps/admin/src/lib/api.ts`'s
  `request()` only read `body.error`, but Fastify's default error handler for a thrown `.statusCode` Error
  puts the real reason in `body.message` and just the generic HTTP phrase ("Bad Request") in `body.error`
  — every validation-rejection toast was showing that useless generic phrase instead of the actual
  problem. Both fixed in the same pass; `request()` now reads `body.message ?? body.error`.
  `ThemeForm` (Site Theme / Global Theme) offers a swatch picker labelled "UI Themes"
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
  Slider heading/subtitle text boxes got a Canva-style resize model on the canvas: 4 corner dots
  (`startCornerScale`, `RESIZE_CORNERS`' `sign` per corner) scale `fontSize` and an explicit `width` (px)
  together, proportional to horizontal drag distance over the box's own current width; 2 side dots
  (`startWidthResize`) resize `width` only, font unchanged, and dragging narrower lets normal CSS wrapping
  push text to a second line (no forced `white-space:pre`) — `SlideText.width` mirrors this in
  `slideTextStyle()` (`SectionBlock.astro`) as a hard `width` + `overflow-wrap:break-word` safety net for a
  since-enlarged single word. Double-clicking a heading/subtitle on the canvas edits it in place
  (`contentEditable`, `sliderEditingItem`/`editingSliderText` — same stable-snapshot-ref pattern the
  standalone heading/text elements' own `editingText`/`commit()` already used, so React re-renders from the
  onInput round-trip don't reset the caret) instead of only through the Inspector's `BufferedTextarea`;
  Enter inserts a literal `\n` via `execCommand("insertText", false, "\n")` rather than the browser's
  default block-splitting behavior. A slide also gained a real `bgColor` (hex, optional flat fill behind
  `imageUrl` — the only previous way to get a solid-color slide was an accidental side effect of the
  overlay sitting over the page's own backdrop) and `.ds-slide` picked up a default `color:#fff`: a
  custom-positioned (`ds-slide-text-free`) heading/subtitle is a CSS **sibling** of `.ds-slide-content`, not
  a descendant, so it never inherited that div's own `color:#fff` and instead inherited the page's global
  theme text color from `body` — confirmed live via computed-style inspection before the fix, re-verified
  after. `ElPreview`'s Blocks-canvas slide box also stopped hardcoding a fake `bg-black/70` placeholder —
  it now renders the slide's real `bgColor`/`imageUrl` background plus an actual overlay div at the real
  `overlayColor`/`overlayOpacity`, so the canvas preview matches what publishes instead of a decorative
  approximation.
  The slider element also grew 3 more top-level fields (element props, not per-slide): `navStyle`
  ("arrows"/"minimal"/"none" — the prev/next button look, or hidden entirely), `dotsStyle`
  ("dots"/"lines"/"numbers"/"none" — the pagination indicator shape, or hidden), and `transition`
  ("slide"/"fade"). All 3 are plain `"select"`-kind `SLIDER_FIELDS` entries validated the same generic way
  as `autoplay`/`textPosition` (`validate-layout.ts`'s `ENUM_VALUES` map — closed allowlist, no pattern
  needed for a closed enum) and rendered onto the real `.ds-slider` as `data-nav`/`data-pagination`/
  `data-transition` attributes, styled purely via CSS attribute selectors (no new classes to keep in sync).
  `transition:"fade"` is a real branch in the `<script>`, not an Embla plugin — Embla's own
  `.ds-slider-track` assumes a horizontal scroll strip, which can't crossfade, so fade mode skips
  `EmblaCarousel(...)` entirely for that slider and hand-rolls index/opacity state instead (prev/next/dot
  clicks and an optional `setInterval` autoplay all just call the same `show(next)`, toggling each
  `.ds-slide`'s `is-active-fade` class): rung-5-lazy, no new dependency, since CSS `position:absolute` +
  `opacity` transition covers it. This is Blocks-canvas-cosmetic-only for now — `ElPreview`'s slider case
  doesn't reflect `navStyle`/`dotsStyle`/`transition` (the canvas preview isn't a live carousel to begin
  with), so those 3 only visibly change anything on the real published/Live-Edit render.
  Section/Row/Column/Element already had a per-breakpoint STYLE-override system (the `bp` toggle —
  `Monitor`/`Tablet`/`Smartphone` icons — routes Inspector field edits into each node's own `bp: Record
  <string,string>` bag, keyed `"tablet:<fieldKey>"`/`"mobile:<fieldKey>"`, resolved by `bpGetValue`/
  `sideValue`/`sectionBpStyle`/`bpColStyle`/`bpPaddingStyle`/`bpMarginStyle`), but it started
  **admin-preview-only** — apps/frontend didn't read `bp` at all, it only narrowed the Designer canvas
  itself to simulate how the page would look. Real per-screen VISIBILITY was added first, as a separate,
  simpler feature: `VisibilityToggle` (3 icon buttons, same Monitor/Tablet/Smartphone icons, "active"/
  highlighted = hidden on that screen) sits at the top of all 4 Inspector levels (Section/Row/Column/
  Element) and writes plain `hideDesktop`/`hideTablet`/`hideMobile` ("true" | unset) keys directly onto
  that node's own props (Row's are typed fields on the `Row` interface itself, like its existing
  `marginTop`; Section's are flat `SectionProps` fields; Column/Element read/write through their existing
  generic `props` bag — no new bag shape, no `bp:` prefix, since a visibility flag has no desktop-value
  fallback chain to speak of, it's just 3 independent boolean-shaped keys). Validated generically via
  `ENUM_VALUES` (`["true"]` — `""` is already skipped by `validateValue`'s own `value === ""` early return)
  plus `ROW_OWN_KEYS` picking up the 3 keys for Row's non-bagged fields.
  The STYLE-override bag was then wired into `SectionBlock.astro` for real too, for Section and Column
  (Row/Element style-override stays admin-preview-only — see below for why): `sectionStyle`'s build logic
  was extracted from a one-shot inline array reading the destructured Props consts directly into a real
  function, `buildSectionStyle(p: Record<string,string>)`, called once against `baseSectionProps` (those
  same consts collected back into a plain bag) for the normal desktop render — `colStyle(cp)` already
  had this shape, no extraction needed. `bpMerge(base, bp, tier)` copies `base` and overlays whichever
  `"tablet:"`/`"mobile:"`-prefixed keys exist in the node's `bp` bag for that tier; `bpStyleRules(selector,
  bp, base, build)` re-runs `build()` against each tier's merged copy (only for a tier that actually has
  at least one override — skips the other entirely) and appends ` !important` to every resulting
  declaration, because an inline `style=""` attribute (which is how the desktop value always renders)
  outranks any external stylesheet rule regardless of media-query specificity — without `!important` the
  override would be dead code that validates and saves fine but never visibly does anything. `respId(id,
  visProps, bp?, base?, build?)` is the single per-node entry point both features now share: it decides
  whether a node needs a `data-vis` id at all (a real hide flag, OR — only when `bp`/`base`/`build` are
  passed — at least one style override present), and if so pushes every applicable rule (visibility
  first, then style) into one page-render-scoped `responsiveRules` array, scoped to `[data-vis="id"]`.
  Row and Element omit the `bp`/`base`/`build` arguments (2-arg `respId` calls) — Row still has no `bp`
  bag on the real data model at all (`Row` interface literally has no `bp` field, unlike Section/Col/El,
  a pre-existing gap this round didn't need to close since Row's own margin/padding/gap fields are already
  desktop-only); Element's style is built inline, differently per element `type`'s own switch case (no
  single reusable `build(p)` function the way Section/Column have), so giving it the same real-render
  treatment would mean extracting a per-type style-builder out of every one of ~14 switch branches — a
  separate, much bigger task, intentionally deferred rather than done half-way. Cutoffs: desktop
  `min-width:1025px`, tablet `641px`-`1024px`, mobile `max-width:640px` — independent of Row's own
  pre-existing `@media (max-width:768px)` column-stacking rule, which is untouched, and of Designer.tsx's
  own `BP_REFERENCE_PX` (canvas-simulation reference widths, a different concern from either of these real
  breakpoints). Only nodes that actually need a rule get a `data-vis` attribute at all (cheap — no markup
  added to the common no-override case). Section/Row/Column already have a real wrapper element to hang
  the attribute on directly; Element did not (each element type renders its own root tag with no common
  wrapper) — reused the SAME `display:contents` wrapper `designerEdit` mode already uses for its
  `data-designer-path` bridge attribute, so adding visibility (and, if ever extended, style overrides)
  didn't need touching every element type's own render branch. The `<style set:html={responsiveRules
  .join("")}/>` is emitted once, as the last child inside `<section>` — safe because Astro/JSX evaluates
  children in source order, so every row/column/element beneath it has already run (and pushed into the
  array) by the time it's read.
  A node hidden at the currently-previewed bp is never actually hidden in the Blocks canvas itself
  (Elementor/Webflow convention) — it renders faded (`opacity:0.35`) with a small red "Hidden" badge
  (`HiddenAtBpBadge`) instead, at all 4 levels (Section/Row/Column/Element), so an author can still reach
  and edit it while it's hidden on the breakpoint they're looking at. Every bp-aware field (every
  `FieldGroups` field, every `FourSideControl` padding/radius/margin group) also grew a `BpToggle`: a
  small clickable Tablet/Smartphone icon next to the field's own label (only rendered once `bp` leaves
  desktop) — accent-colored when that field (or, for a `FourSideControl`, any of its side keys) actually
  has a real override at the current bp, muted when it's just inheriting the desktop value. Clicking
  toggles it: enabling seeds the override at `""` (falls through the field's own default-preset
  resolution until typed over) rather than copying the resolved desktop value, disabling removes it —
  `bpKeysOverridden`/`toggleBpKeys` are the two small pure helpers both behaviors share. This mirrors (and
  visually reuses the same 3 icons as) the Visibility toggle, but is a distinct concern: Visibility is a
  real per-screen boolean rendered on the published site; the `bp` style-override bag it sits next to is
  still admin-preview-only for most fields — **except** slide heading/subtitle's own Text size and Align
  controls, which got the exact same BpToggle treatment but wired for real: `SlideText` grew its own `bp`
  bag (only ever storing `fontSize`/`align`, not a general escape hatch), validated in
  `validate-layout.ts`'s `isSafeSlideText` (rejects any other key in the bag), and rendered for real by
  `SectionBlock.astro`'s `slideTextVisId(txt, id)` — a thin adapter over the same `bpStyleRules`/
  `responsiveRules` machinery Section/Column already use for their own real bp overrides, just reusing
  `slideTextStyle(txt)` itself as the `build()` function (a merged-bp copy of a `SlideText` object is
  still structurally a valid `SlideText`, so no separate style-builder was needed here the way Section's
  own `buildSectionStyle` extraction was). Making that real also required moving the Blocks canvas's own
  reads and writes in the same pass, which is the part that bit first: `ElPreview`'s `textChip` read
  `txt.fontSize`/`txt.align` directly and the flow wrappers read `first.heading.align` directly, so a
  mobile-only size or alignment saved correctly and rendered correctly on the real site while the canvas
  kept showing the desktop value — indistinguishable from the control being broken. Both now go through
  `bpGetValue` (`slideAlign()` for the align case, used by `textChip`'s `textAlign` AND the
  `ALIGN_JUSTIFY` flow wrapper, since in flow mode it's the wrapper's `justify-content` that actually
  positions the shrink-wrapped chip). `updateItem` had to follow: with reads bp-aware, a canvas
  drag-resize while previewing mobile would otherwise write the base `fontSize` that the mobile override
  then out-ranks on screen, so the handle would visibly do nothing — it now routes a `fontSize` patch
  into the same `bp` bag the Inspector's stepper writes to whenever `bp !== "desktop"`, leaving
  width/position/x/y (which have no bp override) on the base object.
  That still didn't make a tablet/mobile-only Alignment/Text size click visibly do anything — confirmed
  live (Playwright against the running admin + a direct `GET /api/pages/:id`, not guessed): the real bug
  was one level up. The Element Inspector's shared `fieldGroupsProps` (used by the generic `<FieldGroups>`
  for EVERY field on a slider element, "slides" included) treated `slides` as just another bp-overridable
  value — so editing anything inside the slides editor while `bp !== "desktop"` wrote a whole SECOND
  stringified copy of the entire slide array into `el.bp["mobile:slides"]`/`el.bp["tablet:slides"]`
  instead of the real `el.props.slides`. The Inspector's own `getValue` reads through `bpGetValue` too, so
  it happily read that duplicate back and looked correct (align showed "center", the button turned blue)
  — but `ElPreview`'s canvas reads `el.props.slides` directly, never `el.bp`, so it kept rendering the
  untouched original every time. Fixed by excluding `f.kind === "slides"` from the generic bp routing
  entirely in `fieldGroupsProps` (`getValue`/`setValue` always read/write `el.props.slides`, `hasOverride`
  always false, `onToggleOverride` a no-op for it) and from `FieldGroups`' own `BpToggle` rendering — the
  slides field manages its own per-breakpoint overrides internally (each `SlideText.bp`), it was never
  meant to have a whole-field bp variant of its own. Verified live afterward: Desktop still resolves the
  base heading (`align:left`, `41px`), Mobile now genuinely resolves its own override (`align:center`,
  `23px`), independently. This asymmetry (slide text real, everything else preview-only)
  exists because slide text's `bp` bag only ever holds 2 known keys — genuinely cheap to make real — while
  Section/Column/Element's `bp` bag covers dozens of arbitrary style keys, where doing the same for real
  would mean the same kind of per-node-type style-builder work `navStyle`/`dotsStyle`/`transition` above
  already opted out of for Element specifically; extending realness further is a distinct, larger,
  not-yet-scoped task if ever asked for.

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
- `install.sh` (one-shot VPS installer, docker or bare-metal mode) prompts for a
  superadmin email/password up front and, once its mode's stack is verified reachable,
  POSTs them straight to the running API's own `POST /api/setup` (`apps/api/src/index.ts`'s
  self-disabling first-run route — refuses once any user row exists) via a `create_superadmin`
  helper — so the very first login works without depending on the admin UI ever reaching
  the API from a browser first. `--admin-only` skips the whole install and just re-runs
  this step against an already-installed stack (reads the API port back out of `.env`'s
  `API_PORT` for docker mode or `apps/api/.env`'s `PORT` for bare-metal, rather than
  re-picking a free one). `--admin-email=`/`--admin-password=` (or `SUPERADMIN_EMAIL`/
  `SUPERADMIN_PASSWORD` env vars) supply these non-interactively; a non-interactive run
  with neither set is a hard error, same as an unset `SESSION_SECRET` elsewhere in the
  script.
  **Multi-distro + reachability hardening** (see
  `docs/superpowers/specs/2026-08-12-installer-hardening-design.md`): `detect_os_family()`
  reads `/etc/os-release` and sets `PKG_MGR`/`FIREWALL_TOOL` (`apt`/`ufw` for Debian-family,
  `dnf`/`firewalld` for RHEL-family — AlmaLinux/Rocky/RHEL/CentOS Stream — hard error on
  anything else rather than silently guessing `apt`), used by `pkg_install()` and
  `open_firewall_ports()` (renamed from `open_ufw_ports`); `ensure_postgres` installs
  `postgresql-server` + runs `postgresql-setup --initdb` on RHEL-family, since unlike
  Debian's `postgresql` package it doesn't auto-initialize its data directory. Both modes
  now call `ensure_reachable_or_selfheal` right after starting the stack instead of a bare
  "poll /health, assume done" loop: `verify_external_reachability` hits the API/admin/
  frontend published ports the same way a real browser would (`wait_for_api_health` for
  the API's own 200, `curl_reachable`'s any-HTTP-response-means-reachable check for the
  other two) — this is the fix for two real bugs hit in the same live session that a purely
  in-container/in-process healthcheck can't see: an app bound to Fastify's default
  `127.0.0.1` (unreachable from the host's `docker-proxy`/NAT even though its own
  healthcheck, run from the same network namespace, looked fine) and Docker's own iptables
  chains resetting forwarded connections after `docker-proxy` already accepted them. On
  failure it runs `diagnose_reachability` (dumps `docker compose ps`/`ss -ltnp`/`iptables -L
  FORWARD` or the systemd unit status), tries exactly one self-heal (`systemctl restart
  docker` in docker mode, a service restart in bare-metal mode), re-verifies once, and on a
  second failure aborts **without** printing the "Done" success banner — the previous loop
  printed it unconditionally regardless of whether anything actually answered. `--diagnose`
  reruns just `verify_external_reachability`/`diagnose_reachability` (no self-heal, no
  credential prompt) against an already-running stack via the same `resolve_running_ports`
  helper `--admin-only` uses (extended to also resolve `ADMIN_PORT`/`FRONTEND_PORT`, from
  `.env` for docker mode or `/etc/usim-cms-monitor.env` for bare-metal) — meant to replace a
  manual `curl`/`ss`/`iptables` debugging session with one command.
- `install-dev.mjs` is the LOCAL-DEV counterpart — `node install-dev.mjs`, same command on
  Mac/Windows/Linux, Docker-only (no bare-metal path: Docker Desktop is assumed, so there's
  no 3-different-OS systemd-equivalent to maintain). Mirrors `install.sh`'s docker mode
  (same `.env` keys, same `/api/setup` flow, same `--admin-only`/`--diagnose` flags, same
  "verify reachability before declaring success" philosophy via Node's global `fetch`
  instead of `curl`) but drops everything VPS-only: no public-IP detection (always
  `localhost`), no systemd/monitor/firewall/proxy/cert work, and no iptables diagnostics in
  `--diagnose` (Docker Desktop's own networking backend doesn't hit the iptables-FORWARD
  class of bug `install.sh` diagnoses — only `docker compose ps` output). Uses
  `execFileSync` with argv arrays (never a shell string) for every Docker CLI call.
- Monitoring/alerting is not implemented — known gap. `restart: unless-stopped` +
  compose healthchecks only cover crash-restart, not metrics or alerting; revisit if/when
  the instance carries enough tenants that a silent outage would go unnoticed.

## Key constraints (from architecture.md)

- Single instance, not one deployment per tenant — tenant identity always comes from the
  `x-tenant-host` header, never from subdomain parsing or config at boot.
- Avoid heavy dependencies; prefer Tailwind + lightweight Fastify plugins over pulling in a framework.
- New collections should be added as `CollectionConfig` objects registered through
  `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`, not as one-off Fastify route files.
