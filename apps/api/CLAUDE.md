# apps/api — additional context

Loaded when working under apps/api/. See the repo root CLAUDE.md for cross-cutting constraints.

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

## Auth hardening (rate limiting, audit log, MFA)

Built in response to a security audit's "wajib diperbaiki" (must-fix) findings — see the audit's own
callouts before assuming any of this is speculative hardening.

- **Login rate limiting.** `login_attempts` (control-plane, one row per attempt, both success and
  failure) backs `isLoginRateLimited(email, ip)`/`recordLoginAttempt` (`tenant-pool.ts`) — a DB table,
  not an in-memory counter, because blue-green/multi-replica means separate processes don't share memory.
  `POST /api/auth/login` checks the limit **before** even looking up the password (so a locked-out
  caller never gets a fresh timing oracle either) — 5 failed attempts per email OR per ip within 15
  minutes trips a 429. Old rows are pruned lazily on every write (24h retention), no separate cleanup
  cron.
- **Audit log.** `audit_log` (control-plane) records who did what to instance-wide/cross-tenant state —
  currently wired into tenant delete, user delete, the mfaEnabled toggle, and a user's own MFA enable/
  disable. Deliberately not wired into every read/list route or every possible mutation — see the
  table's own schema.ts comment for the intended scope (superadmin-answerable "who did this",
  not a full change-data-capture log). `insertAuditLog(entry)` is the one write path; there's no
  read/viewer UI yet — a fast-follow if this becomes a real ask, not built speculatively now.
- **MFA (TOTP).** Implemented via `node:crypto` only — no otplib/speakeasy dependency for a standard
  RFC 6238 6-digit/30-second code (`generateTotpSecret`/`verifyTotpCode`/`totpAuthUri` in `db/auth.ts`).
  `verifyTotpCode` is verified against RFC 6238 Appendix B's official SHA1 test vector in
  `auth.test.ts`, not just self-consistency with its own encoder. Two-level toggle, deliberately:
  `platformSettings.mfaEnabled` is the instance-wide master switch (Settings tab's "Login Methods"
  card, superadmin-only) — while off, MFA is invisible everywhere; while on, the Security tab's
  enrollment flow becomes available to every user. `users.totpEnabled`/`totpSecret` is the per-user
  opt-in on top of that — a user isn't required to enroll just because the instance switch is on,
  but if they HAVE enrolled, login always requires their code regardless of the instance switch's
  current state (turning the instance switch off doesn't silently stop enforcing a user's own already-
  confirmed MFA — `setUserTotpEnabled(id, false)` is the only way to drop that, and it also clears the
  secret so a future re-enable needs a fresh enrollment, not a silently-reactivated old one).
  **Login flow**: password-only login is unchanged when `totpEnabled` is false. When true,
  `POST /api/auth/login` returns `{ mfaRequired: true, pendingToken }` instead of a real session — a
  5-minute-TTL `SessionPayload` with a new `pendingMfa: true` flag, rejected by every other route
  (`requireTenantAuth`/`verifySuperadmin`/`verifyAnyUser` in `plugins/auth.ts`, same treatment as the
  existing `previewOnly` flag) until `POST /api/auth/totp-verify` exchanges it for a real session.
  `totp-verify` is rate-limited the same way the password step is (`isLoginRateLimited`/
  `recordLoginAttempt`, keyed by the pending token's own email + the caller's ip) — a 6-digit code is
  only ~1M combinations, and a valid `pendingToken` already proves the password was correct, so an
  unthrottled verify route would let that alone brute-force the second factor away. **Enrollment** is
  two-step on purpose (`POST /api/auth/totp-setup` stores a secret with `totpEnabled` still false;
  `POST /api/auth/totp-confirm` only flips it true once a real code verifies) so a half-finished
  enrollment can never start requiring a code the user hasn't proven they can generate. Both
  `totp-setup` (when the account is ALREADY confirmed — i.e. a re-enrollment, not a first-time setup)
  and `totp-disable` require the CURRENT valid code in the request body before proceeding — a stolen
  bearer token alone (the session's own `localStorage` exposure, still on the to-do list below) must
  never be sufficient to strip a victim's MFA, since that would defeat the entire point of a second
  factor. `GET /api/auth/me` is the Security tab's own-status check
  (`{ totpEnabled }`) — deliberately separate from the superadmin-only
  `GET /api/portal/login-settings` (the instance switch), since a webmaster can't reach that route.
  **This is the extension point for Entra ID/SSO later** (already anticipated in `users`' own schema
  comment): the "Login Methods" Settings card shows Password (always on) + MFA (real, toggleable) +
  "Microsoft Entra ID / SSO — coming soon" (shown, not wired) — `signSession`/`SessionPayload` already
  don't care how a session was established, only that it ends up with the right shape, so a future SSO
  login route can issue the exact same token shape through a completely different first step.
- **Security tab** (`SecurityPanel`, a new top-level `Tab` reachable by both superadmin and webmaster —
  unlike Settings, which only a superadmin can reach) is where a user manages their OWN MFA
  enrollment, independent of the instance-wide switch's location.
- **`@fastify/helmet`** registered with `contentSecurityPolicy: false` (this API only ever returns JSON,
  never HTML it renders itself — apps/frontend's own headers are the real CSP surface, out of scope
  here) and `crossOriginResourcePolicy: false` (media/uploads are deliberately fetched cross-origin by
  the tenant frontend and Live Edit's iframe).
- **Session cookie + CSRF migration** (the item above marked "deliberately not done" is now done):
  the admin's real session no longer lives in `localStorage` as a bearer token — `POST /api/auth/login`/
  `/api/auth/totp-verify`/`/api/setup`/`/api/portal/impersonate` set it as an `httpOnly` cookie
  (`apps/api/src/lib/cookies.ts`'s `SESSION_COOKIE_NAME`, no `@fastify/cookie` dependency — a ~20-line
  manual parse/serialize was enough for the one cookie this app sets, per this project's "avoid heavy
  dependencies" constraint) instead of returning it in the response body. `requireTenantAuth`/
  `verifySuperadmin`/`verifyAnyUser` (`plugins/auth.ts`) read the cookie instead of an `Authorization`
  header now. Since a cookie is sent automatically by the browser (unlike a header the client had to
  build), every mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) additionally requires an `x-csrf-token`
  header matching a `csrfToken` claim embedded in the signed session itself (`checkCsrf` in
  `plugins/auth.ts`) — a synchronizer-token-in-session pattern, not a second cookie, since the admin
  panel and API can be on different subdomains where JS on one origin can't read a cookie scoped to the
  other. `Session.token` (`apps/admin/src/lib/api.ts`) is now this CSRF token, not a bearer secret — kept
  under the same field name deliberately, since renaming it would have touched the ~100 call sites that
  pass `session.token` down to every panel; only `request()`'s transport (now `credentials: "include"` +
  `x-csrf-token` header) and the login/setup/impersonate response-mapping actually changed.
  `elevateIfAuthenticated` (`generic-crud.ts`, the public-route draft-visibility elevation) now accepts
  either the cookie OR a forwarded `Authorization: Bearer` header — the latter is unchanged/still used by
  apps/frontend forwarding a preview/theme-preview token server-to-server, a completely different
  credential from the admin's own session that was never affected by this migration. **Impersonation**
  (`POST /api/portal/impersonate`) now overwrites the superadmin's own session cookie with the target
  webmaster's — exiting impersonation can no longer be a client-side restore of a stashed old token
  (there's nothing left to restore; the old cookie's raw value was never JS-readable to begin with), so
  a new `POST /api/portal/exit-impersonation` route re-signs the original superadmin's session from the
  `impersonatedBy` email the impersonation token carries and re-sets the cookie — a real server
  round-trip, not a localStorage trick. Postgres HA/replication and auto-rollback-after-promote still
  need real VPS topology decisions this repo can't make blind — see the audit's own phased roadmap.

- **`apps/api`** — Fastify + TypeScript backend, Postgres via Drizzle ORM.
  - `src/index.ts` boots the server and registers the tenant plugin + collection routes.
  - `src/plugins/tenant.ts` reads the `x-tenant-host` request header on every request and attaches
    `req.tenantHost` / `req.db` — this is how multi-tenancy is implemented (single instance, per-tenant
    DB pool, no per-tenant deployment).
  - `src/db/tenant-pool.ts` resolves each tenant host to its own database (see "Multi-tenancy:
    database-per-tenant" below) and lazily creates/caches one Drizzle/pg pool per connection string.
  - `src/db/schema.ts` defines the `pages` table. Page content is a dynamic block layout stored in the
    `layout` JSONB column, not as separate relational tables per block type. `settings` (JSONB, migration
    `0012_page_settings.sql`) is page-wide Designer defaults: `gap?: string` (default column gap a row
    falls back to when it doesn't set its own, `Row.gap`, below), `contentWidth?: "contained" | "full"` and
    `paddingX?: string` (same fallback role for `SectionBlock.astro`'s own `width`/`paddingX` — a section
    that sets its own value always wins), and `theme?: Record<string,string>` (an optional snapshot copy of
    one of the author's saved Theme Presets, picked from Designer's Page Settings panel — copied in at
    pick-time, not a live link, same "apply once, edit independently after" convention as everything else
    in this codebase; `[...slug].astro` overlays it onto the tenant's merged theme for that one page's
    render only, `apps/frontend`'s `Page.settings` type mirrors the shape). `gap`/`paddingX` are constrained
    to `GAP_PATTERN` (a bare number or number+unit) via `pagesCollection.createSchema`'s JSON schema and
    `pagesBeforeChange`, `contentWidth` to its 2-value enum, and `theme` through the exact same
    `validateThemeSettings` function `PUT /api/theme` already runs against `site_theme` — all three land in
    a raw CSS string/custom-property the same way `gap` already did, so each gets the same
    unconstrained-value-is-a-CSS-injection-vector treatment. The much larger surface for the same risk is `layout` itself: every
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
    range against `publishedAt` — a collection without those columns just ignores the params. Sprint 4 of
    the UX audit (`docs/laporan-audit-ui-ux.md`) added `?search=` (`ilike` against a `title` column, same
    ignore-if-absent shape as the others) for the admin's Pages/Posts list search box. The list route also
    now returns a `total` count, but only when the request sent `?limit=` — an unbounded caller (every
    existing one pre-Sprint-4, plus `apps/frontend`) pays no extra count query. `apps/admin/src/lib/api.ts`'s
    `listPagesPage`/`listPostsPage` are the only callers that pass these — `getPages`/`getPosts` stay
    unbounded/unfiltered for every other caller (dashboard counts, `MenuItemsEditor`'s picker,
    `PostEditorPage`'s related-post list). RLS (the
    per-table `_select` policy) is still the real visibility gate; these filters only narrow within what
    RLS already allows the request to see. `POST /:id/publish` (the "Share to portal" route) refuses to
    share any row whose `status` isn't `"published"` — draft and `posts`' `"private"` are both blocked,
    generically, for any collection with a `status` column.
  - Sprint 4 of the UX audit also touched `media` (`src/db/schema.ts`): a new `isDecorative` boolean
    (`migrations/0020_media_decorative.sql`, default false) lets an image opt out of the admin's
    alt-text-required rule — `MediaManager`'s edit form (`apps/admin/src/App.tsx`) disables/requires the alt
    field accordingly and blocks Save while alt is required-but-empty; the read view shows a small "No alt
    text" badge on any non-decorative image with a blank `altText`. `PATCH /api/media/:id` (hand-written,
    `src/index.ts` — media has no `CollectionConfig`, unlike pages/posts) allowlists `isDecorative` the same
    way it already allowlists `altText`/`description`/`folderId`. Separately, `PagesPanel`'s `setStatus` and
    `PostEditorPage`'s `save()` both gained a client-side pre-publish warning gate (reusing the existing
    `useConfirm()` dialog, no new DB/API): publishing a page with an empty block tree, or a post with a
    near-empty body or blank excerpt, shows a warning the author can proceed past or cancel — never a hard
    block, matching the audit's own "warn, don't gate" flow. `ListLoading`/`ListEmpty` (`App.tsx`) are the
    new shared loading/empty-state components wired into Pages/Posts/Media — the audit's "standard loading,
    empty dan error states" item; Categories/Menus panels were left as-is (small, unpaginated lists, judged
    not worth the same treatment yet).
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
  - `menus` (`src/db/schema.ts`) is a named, ordered navigation tree — `name` + a single `items` jsonb
    column holding the whole nested structure (top-level items, each optionally `children` for a simple
    dropdown OR `megaMenu` for a multi-column rich menu, never both), the same "one row holds the whole
    tree" shape `design_templates`/`site_theme` already use — there is no separate menu-items table.
    Gated on its own `menus.write` permission (not `pages.*`/`posts.*`, since managing site navigation is
    its own concern) and mounted as its own superadmin ContentManager sub-tab (site-picker required
    first, like `theme`/`languages`) plus a webmaster top-level `Tab` (a sibling of their own `theme`/
    `languages` tabs, since a webmaster has no site picker to reach the `ContentManager` variant) —
    `MenusPanel`/`App.tsx`. `menusBeforeChange` (`index.ts`) validates `items` through
    `src/collections/validate-menu.ts`'s `validateMenuItems()` on every create/update: each item's
    `linkType` (`page`/`post`/`category`/`custom`) requires either a `refId` or, for `custom`, a
    scheme-checked `url` (`isSafeUrl`); nesting caps at 3 levels deep (`MAX_DEPTH`), a mega-menu at 8
    columns × 20 items each (`MAX_COLUMNS`/`MAX_COLUMN_ITEMS`); a mega-menu column item's `icon` (a
    lucide-react name, looked up client-side only, never interpolated server-side) is checked against a
    plain identifier pattern and its `image` through the same `isSafeCssUrl` `bgImage`/gallery `images`
    already use — both reused from `validate-layout.ts` rather than re-declared. Every item/column can
    carry a `translations` map (`{code: {label}}` / `{code: {heading}}`) — the same per-string i18n shape
    posts/pages/categories use — edited in `MenuItemsEditor.tsx`'s language-pill row, gated behind the
    same `siteMultilangEnabled` global switch (`getTenantLanguages`) posts/pages/categories already gate
    their own translation UI behind, and auto-translated on first open via the same `/api/translate`
    `ensureTranslation` pattern `CategoryTranslations` uses.
  - The `"menu"` Designer element (`Designer.tsx`'s `ELS.menu`) is a thin reference, not a copy — it only
    holds a `menuId` (populated from a live `GET /api/menus` list via the Inspector's `"menu-select"`
    field kind, not baked into `ELS.menu.fields`' static `options` the way a closed enum would be) plus
    render options (`layout` horizontal/vertical, `dropdownTrigger` hover/click, `megaMenuWidth`
    contained/full-width) — the actual item tree lives on the `menus` row, edited only in the Menus admin
    panel. `validate-layout.ts` validates the 3 render-option enums the same generic `ENUM_VALUES` way as
    every other element field; `menuId` itself is exempt from any format check (`validateValue`'s
    `key === "menuId"` early-return) since it's only ever used as a parameterized DB lookup key
    (`getMenu`), never interpolated into CSS/HTML. On the real page, `SectionBlock.astro`'s `"menu"` case
    hands these straight to `MenuBlock.astro`, which calls `getMenu(tenantHost, menuId)` +
    `resolveMenuTree(items, lang, tenantHost)` (`apps/frontend/src/lib/api.ts`) — the latter resolves each
    item's `page`/`post`/`category` `refId` to a real `href` (a `custom` item's own `url` passes through
    unchanged) and its label/column-heading to the requested language's `translations` entry, the same
    `resolvePostContent`/`resolvePageLayout` pattern the post/page i18n phase already established.
    Rendering is plain CSS, no client-JS dependency added: a `[data-trigger="hover"]` attribute selector
    shows a `.has-dropdown`/`.has-mega` item's submenu on `:hover`/`:focus-within`; `dropdownTrigger:
    "click"` instead toggles an `.is-open-click` class via one small event-delegated `<script>`
    (`MenuBlock.astro`, same per-page-once convention as the `tabs` element); that same script also drives
    the mobile hamburger toggle (`.ds-menu-toggle`, active for every trigger mode, since touch has no
    hover at all), which only becomes visible under `global.css`'s `@media (max-width: 768px)` rule that
    also collapses `.ds-menu-list` into a fixed dropdown panel.
  - Local API/SDK for same-process frontend access (bypassing HTTP) is not implemented yet.
