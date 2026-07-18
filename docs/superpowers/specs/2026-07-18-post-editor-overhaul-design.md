# Post/Article Editor Overhaul — Design

**Date:** 2026-07-18
**Status:** Approved, pending implementation plan

## Problem

The Post/Article editor is an inline-expand-under-row editor inside `PostsPanel` (`apps/admin/src/App.tsx:782-894`, `896-1078`) — cramped, distracting, no dedicated space for metadata. Categories are freeform text with no management surface. There is no way to link to another post/page from within a post body. This design replaces the editing experience with a Ghost-style dedicated full-page editor, adds real category management, and adds an `@`-triggered internal-linking bookmark card.

## Non-goals

- No autosave (manual Save stays, matches current behavior).
- No cross-tenant/shared-portal content in `@` search — own tenant's posts/pages only.
- No live-refresh of bookmark card snapshots after insert (known staleness ceiling, see Phase 4).
- No generic reusable "SidePanel" abstraction — Post editor's settings panel is its own implementation, following Designer's precedent of an inline `<aside>`, not an extracted shared component (Designer's own Inspector aside isn't extracted either).

## Phases

Built and verified in this order — each is independently testable before the next starts.

1. **Router** — introduce `react-router-dom`, convert Shell/ContentManager tab state to real routes.
2. **Categories** — real `categories` table, CRUD API, management sub-tab, `posts.categoryId` FK.
3. **Post Editor** — full-page Ghost-style editor: featured image, toggleable right settings panel.
4. **Bookmark card** — BlockNote custom block, `@`-triggered suggestion menu, cross-post/page search.

---

## Phase 1: Routing

Add `react-router-dom`, `BrowserRouter`. Nginx currently has no SPA fallback (`apps/admin/Dockerfile:21` uses stock `nginx:alpine`, no `try_files`) — direct load or refresh of `/content/posts/123` would 404. Add `apps/admin/nginx.conf`:

```
location / {
  try_files $uri /index.html;
}
```

Mount it in the Dockerfile's runtime stage (`COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf`).

Route map — 1:1 wrap of the existing `Tab` (`App.tsx:3437`) and `ContentSubTab` (`App.tsx:3355`) values, no renaming of tab semantics:

```
/dashboard  /multisite  /users  /roles  /theme  /global-theme  /feed  /settings
/content/pages
/content/pages/:id          (Designer — was inline-mounted in PagesPanel, becomes its own route)
/content/posts
/content/posts/:id          (new full-page PostEditor)
/content/posts/categories   (new — category management)
/content/media
/content/theme
```

`/` redirects to the current default tab. Login gate is unchanged — renders `LoginForm` regardless of path when there's no session; no dedicated `/login` route.

`Shell`'s tab-button `onClick` handlers become `<Link>`/`navigate()` calls instead of `setTab`. `ContentManager`'s sub-tab buttons become nested `<Link>`s under `/content/*`. `designPage`/`editingId` state variables that currently gate conditional mounts (`App.tsx:381`, `899`) are replaced by route params (`useParams().id`).

---

## Phase 2: Categories

### Data model

New table in `apps/api/src/db/schema.ts` (tenant DB, same file as `posts` — categories are tenant-scoped, migrated via the existing tenant migration-replay mechanism):

```
categories
  id          (same id type/convention as posts.id)
  name        text, not null, unique
  slug        text, not null, unique (auto-derived from name)
  createdAt   timestamp
  updatedAt   timestamp
```

`posts.category` (text) → `posts.categoryId` (FK → `categories.id`, `ON DELETE RESTRICT`). The FK constraint itself is the "block delete if category in use" rule — no app-level check needed, Postgres enforces it.

`postRevisions.category` is unchanged (stays a plain text snapshot of the category name at the time of publish/private — a revision must not silently change meaning if the category is later renamed or deleted). When `postsCollection`'s `afterChange` hook builds a revision snapshot, it resolves `categoryId → categories.name` and stores the resolved text.

### Migration `0010_categories.sql`

1. `CREATE TABLE categories (...)`.
2. Backfill: `INSERT INTO categories (name, slug) SELECT DISTINCT category, <slug-expr> FROM posts WHERE category IS NOT NULL AND category != ''` (slug via `regexp_replace`/`lower`, matching the existing JS `slugify` behavior closely enough for backfilled rows — admin can rename after).
3. `ALTER TABLE posts ADD COLUMN category_id ... REFERENCES categories(id)`.
4. `UPDATE posts SET category_id = categories.id FROM categories WHERE posts.category = categories.name`.
5. `ALTER TABLE posts DROP COLUMN category`.
6. RLS: `categories` is public-readable (a post's category label is public data, and the public list route's existing generic query-filter support means `?categoryId=` should just work once the column exists) — `_select` policy is unrestricted; insert/update/delete follow the same authenticated-only pattern as other protected collections.

### API

`categoriesCollection` (`CollectionConfig`, slug `categories`) registered via `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes` exactly like `pages`/`posts`/`templates` (`apps/api/src/index.ts`). `access.create/update/delete` reuse the same permission check as `posts` (no new permission resource — categories is a sub-concern of posts, not a first-class permission).

Shared infra fix (benefits any FK'd collection, not just this one): generic-crud's `DELETE /:id` handler currently would let a raw Postgres FK-violation (error code `23503`) surface as an unhandled 500. Catch it once in the shared handler, return a clean `409` with a "still in use" message.

### Admin UI

- `CategoriesPanel` at `/content/posts/categories`: list (name, slug), inline rename, delete, create field. No post-count column — skip, doesn't earn its keep for this diff.
- `PostEditor`'s settings panel (Phase 3) category field becomes a typeahead: matches an existing category → select it; no match → "Create '<name>'" inserts a new category inline. This is the "select if exists, add if not" behavior asked for.
- `PostsPanel`'s `categoryOptions` (currently derived from post rows' text values, `App.tsx:974-977`) is replaced by `api.listCategories()`.

---

## Phase 3: Post Editor

Route `/content/posts/:id`, full-page component (same "plain fixed-layout component, not a route-independent reusable panel" pattern Designer already demonstrates — Designer's own right-hand Inspector `<aside>` isn't extracted either, so Post editor's settings panel follows that same precedent rather than inventing a new shared abstraction).

```
┌─ toolbar: ← Back | status pill | Preview | Publish▾ | Save | ⚙ panel toggle ─┐
│ ┌─ feature image band ("+ Add feature image" when empty, Ghost-style) ──┐   │
│ │ Title (big borderless input, auto-grow)                              │   │
│ │ Excerpt (subdued input, existing field restyled)                     │   │
│ │                                                           ┌───────────┤   │
│ │ BlockNote body (unchanged internals)                      │ Settings  │   │
│ │                                                           │ panel     │   │
│ │                                                           │ (toggle)  │   │
│ └───────────────────────────────────────────────────────────┴───────────┘   │
```

**Settings panel** (`<aside>`, toggle state is local/session-only, not persisted):
- category typeahead (Phase 2), tags input (existing field, restyled)
- status control — Draft/Published/Private, moved here from the list row (was `PostsPanel`'s row-level triangle buttons, `App.tsx:1036-1044`); "Share to portal" shown only when published, same rule as today, enforced server-side already
- metadata: author (readonly, stamped by `beforeChange`), created/published dates (readonly), slug (click-to-edit, mirrors Designer's page-slug field)
- revision history — collapsible section, reuses `PostHistory` (`App.tsx:715-780`) unchanged, fetched only on expand

**Feature image**: new `MediaPickerModal` — the first extracted, reusable media picker in the codebase (browse existing `Media` library grid, or upload new file). Sets `posts.bannerImageUrl` (column already exists, unused today per the architecture audit — this closes that gap). Built minimal: wraps the existing media-list fetch + upload primitives, no new backend surface needed.

**Preview gap closed as a direct dependency**: posts have no preview-token route today (pages do, `apps/api`'s pages preview-token route). Without one, the toolbar's Preview button would be dead for Draft/Private posts. Mirror the pages preview-token pattern for posts (`POST /api/posts/:id/preview-token`-equivalent) so Preview works for all three statuses — included because the toolbar button is meaningless without it, not as separate scope.

**List page** (`/content/posts`) simplifies: rows show title/slug/status badge/category chip + Edit (navigates to `/content/posts/:id` instead of inline-mounting `PostEditor`), Delete, Share-to-portal shortcut. Quick-create form is unchanged (title-only → `api.createPost` → navigate to the new post's editor route instead of inline-mounting).

---

## Phase 4: Bookmark card (`@`)

New BlockNote custom block `bookmarkCard`:
- props: `targetType` (`post`/`page`), `targetId`, and a **snapshot** captured at insert time: `title`, `excerpt`, `imageUrl`, `url`.
- Snapshot is not live-refetched on render. **Ceiling**: if the source post/page is later renamed or deleted, the card shows a stale snapshot. Acceptable for v1 — upgrade path is a background re-sync job if staleness becomes a real complaint, not built now.

**HTML export** (`toExternalHTML`): a fully self-contained `<a><div>...</div></a>` with inline styles baked in (thumbnail, title, excerpt, a small Post/Page badge) tagged with `data-bookmark-type`/`data-bookmark-id` attributes. Because post bodies are stored and rendered as raw sanitized HTML already (`blocksToHTMLLossy`/`tryParseHTMLToBlocks` round-trip in `PostEditor`, and the frontend injects the HTML blob directly) — **this requires zero changes in `apps/frontend`**. A custom parse rule matching `data-bookmark-type` reconstructs the block when BlockNote re-parses the HTML on editor load.

**Trigger**: BlockNote's Suggestion Menu API (already used internally for the `/` slash menu, per the existing `EditorToolbar` comment that the stock menus are kept as-is) supports a second instance with a custom trigger character — wire one to `@`, live-searching as the admin types.

**New backend route** (hand-written exception in `apps/api/src/index.ts`, same class as the existing revision-restore and preview-token routes — this spans two collections and generic-crud's per-table routes can't do a merged cross-table search): `GET /api/content-search?q=`, protected, tenant-scoped via `req.db`. Returns matching posts+pages from the requesting tenant only (own-tenant, no `shared_content`/cross-tenant per the earlier decision), each tagged `post`/`page` with `title`/`excerpt`/`bannerImageUrl`/`url`.

---

## i18n

New keys needed across `apps/admin/src/i18n.ts` (both `ms` and `en`): category management strings, settings-panel labels, feature-image button, bookmark-card badge text. Added alongside each phase that introduces the relevant UI, not batched separately.

## Documentation

`CLAUDE.md`'s admin section is updated at the end of implementation to describe: the router and its route map, the `categories` table and its RLS/permission shape, the full-page `PostEditor` layout and settings panel, the `MediaPickerModal`, the posts preview-token route, and the `bookmarkCard` block + `/api/content-search` route — following this file's existing level of detail for prior features.
