# Post metadata links, theme display toggles, and title font size

**Date:** 2026-07-23
**Status:** Approved (design), ready for implementation plan

## Motivation

`apps/frontend`'s post page (`src/pages/posts/[slug].astro`) currently renders
tag/category/author as plain, non-clickable text, has no way to hide any of
that metadata (or the published date), and hardcodes the title's font size.
Webmasters have no control over any of this short of editing the Astro file.

This adds:
1. Tag/category/author become links to new per-tenant archive pages listing
   every post that shares that tag/category/author.
2. A site-wide default (Theme settings) for whether tags/category/author/date
   show on a post at all, with a per-post override (3-state: inherit / show
   / hide).
3. A theme-configurable post-title font size (px), replacing the hardcoded
   value.

## Out of scope

- The `pages` collection has no tag/category/author/date columns, so none of
  this applies to Designer pages — only `posts`.
- Cross-tenant archives (pulling posts from other tenants) — archive pages
  read only the requesting tenant's own `posts` table, same isolation as
  every other public route.
- Per-post custom fonts/colors — only the font *size* is themeable here; the
  post-title *font family* toggle already exists (`postTitleFont`).

## A. Theme settings — new keys

`site_theme.settings` (`apps/api/src/db/schema.ts`'s `siteTheme` table) is an
open JSONB bag; `apps/api/src/index.ts`'s `validateThemeSettings` is the only
gate on what keys are accepted. Add:

| Key | Type | Validation | Meaning |
|---|---|---|---|
| `postTitleFontSize` | number (px) | `12 <= n <= 96` | Post `<h1>` font size. Unset → CSS default (`2rem`, today's implicit size). |
| `showPostTags` | boolean | — | Site-wide default for whether a post's tags render. Unset → treated as `true`. |
| `showPostCategory` | boolean | — | Site-wide default for category. Unset → `true`. |
| `showPostAuthor` | boolean | — | Site-wide default for author email. Unset → `true`. |
| `showPostDate` | boolean | — | Site-wide default for published date. Unset → `true`. |

`validateThemeSettings` adds these five keys to its `allowed` set and checks
`postTitleFontSize` is a finite number in range; the four `showPost*` keys
just need `typeof value === "boolean"` when present.

`apps/frontend/src/layouts/BaseLayout.astro`'s `themeVars` array gets one
more line, following the exact pattern already used for `postTitleFont`:

```js
theme.postTitleFontSize ? `--font-post-title-size:${theme.postTitleFontSize}px` : null,
```

## B. Archive pages — 3 new Astro routes, no API changes

New files under `apps/frontend/src/pages/`:
- `tag/[tag].astro`
- `category/[category].astro`
- `author/[email].astro`

Each follows the same tenant-resolution block already duplicated in
`[...slug].astro` and `posts/[slug].astro` (`Host` header, `DEV_TENANT_HOST`
+ `?__tenant=` fallback for local dev). Each calls
`apps/frontend/src/lib/api.ts`'s existing `listPosts(tenantHost, query)`:
- `tag/[tag].astro` → `listPosts(tenantHost, { tag: Astro.params.tag! })`
- `category/[category].astro` → `listPosts(tenantHost, { category: Astro.params.category! })`
- `author/[email].astro` → `listPosts(tenantHost, { authorEmail: Astro.params.email! })`

This needs zero backend work: `generic-crud.ts`'s `buildListFilters` already
supports exact-match `?category=`/`?authorEmail=` and array-contains `?tag=`
on the `posts` table, and the public GET already applies RLS (published-only
for anonymous visitors — an archive page never leaks draft/private posts to
a visitor, since no preview token is forwarded here).

Each page renders, inside `BaseLayout`: an `<h1>` naming the filter
("Tag: sukan" / "Category: bola" / the raw email for author — no separate
display-name field exists on `users`, only `email`), and a list of matching
posts as title + excerpt + formatted date, each linking to `/posts/:slug`.
Zero matches renders the same heading with a "no posts" message — not a 404
(the tag/category/author *itself* isn't a resource that can 404; an empty
result set is a normal state, same reasoning `GET /api/posts?tag=x` already
uses: an unfiltered-into-emptiness list, not an error).

## C. Post-level override + rendering

### Schema

`apps/api/src/db/schema.ts`'s `posts` table gets 4 new nullable boolean
columns: `showTags`, `showCategory`, `showAuthor`, `showPublishedDate`.
`null` (the default) means "inherit the theme's site-wide default";
`true`/`false` is an explicit per-post override. Generated via
`pnpm --filter @usim-cms/api db:generate` (Drizzle migration `0011_*.sql`) —
applying it (`db:migrate`) needs a live Postgres connection, not available
in this environment per project notes; the plan documents the command but
execution happens whenever a DB is next available.

### Rendering

`apps/frontend/src/lib/api.ts`'s `Post` interface gains the same 4 fields
(`showTags`/`showCategory`/`showAuthor`/`showPublishedDate`, each
`boolean | null`) — no backend change needed beyond the schema/migration
above, since the public GET already `select()`s every column.

`posts/[slug].astro` computes, once per field:

```js
const showTags = post.showTags ?? theme.showPostTags ?? true;
const showCategory = post.showCategory ?? theme.showPostCategory ?? true;
const showAuthor = post.showAuthor ?? theme.showPostAuthor ?? true;
const showDate = post.showPublishedDate ?? theme.showPostDate ?? true;
```

and gates each existing block on the matching variable. Tag/category/author
become real anchors:

```html
<a href={`/category/${encodeURIComponent(post.category)}`}>{post.category}</a>
<a href={`/author/${encodeURIComponent(post.authorEmail)}`}>{post.authorEmail}</a>
{post.tags.map((tag) => <a href={`/tag/${encodeURIComponent(tag)}`}>{tag}</a>)}
```

`<h1>`'s inline style changes from an implicit default to
`font-size:var(--font-post-title-size, 2rem)`.

## D. Admin UI

**ThemeForm** (`apps/admin/src/App.tsx`, wherever it currently lives) gets,
near the existing Post-Title `FontField`:
- A number input, "Post title size (px)", bound to `postTitleFontSize`,
  live-reflected in the existing preview panel's post-title sample.
- 4 checkboxes — "Show tags" / "Show category" / "Show author" / "Show
  date" — bound to `showPostTags`/`showPostCategory`/`showPostAuthor`/
  `showPostDate`.

**PostEditorPage** settings panel gets 4 tri-state controls (a `<select>`
each is enough — no need for a custom widget) next to the existing
category/tags fields:

```
Tags:      [ Ikut Tema ▾ ]   (Ikut Tema / Papar / Sorok)
Category:  [ Ikut Tema ▾ ]
Author:    [ Ikut Tema ▾ ]
Date:      [ Ikut Tema ▾ ]
```

mapping to `null` / `true` / `false` respectively, included in the payload
`save()` already sends to `PATCH /api/posts/:id`.

## Testing

- `apps/api`: extend `validateThemeSettings`'s existing test coverage (or add
  if none exists) for the 5 new keys — valid/invalid `postTitleFontSize`
  (in-range, out-of-range, non-number), valid/invalid `showPost*` (boolean,
  non-boolean).
- `apps/frontend`: no test harness currently exists for Astro pages in this
  repo (typecheck via `astro check` is the only automated gate) — verify the
  3 new archive pages and the updated `posts/[slug].astro` with `astro
  check` plus a manual smoke read of the rendered output structure.
- `apps/admin`: `tsc -b --noEmit` covers the new ThemeForm/PostEditorPage
  controls' type-correctness; no existing component test harness to extend.
