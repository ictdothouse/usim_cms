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

Every existing key in this bag is a string on the wire (colors are hex
strings, fonts are font-name strings) because `ThemeForm`'s `load`/`save`
props and every admin `api.ts` theme function are typed
`Record<string, string>` — widening that to a union type would touch 7+
call sites for no real benefit. The 5 new keys follow the same convention:
`postTitleFontSize` is sent as a numeric string (`"32"`), `showPost*` as
`"true"`/`"false"`. Like every existing key, `""` means "no override" (this
is what `deactivate()` sends for every field, and what an empty preset
round-trips as) — `validateThemeSettings` must accept `""` same as the
existing color/font keys do, only applying its real check when the value is
non-empty. So: `postTitleFontSize` accepts `""` or a value where
`Number(value)` is a finite integer in `[12, 96]`; each `showPost*` key
accepts `""`, `"true"`, or `"false"`. Reading them back:
`BaseLayout.astro` string-concatenates `postTitleFontSize` directly (no
`Number()` needed, it's going into a CSS string either way); `posts/
[slug].astro` treats "unset or anything other than the literal string
`\"false\"`" as show (`theme.showPostTags !== "false"`), so an absent key
defaults to visible.

`apps/frontend/src/layouts/BaseLayout.astro`'s `themeVars` array gets one
more line, following the exact pattern already used for `postTitleFont`:

```js
theme.postTitleFontSize ? `--font-post-title-size:${theme.postTitleFontSize}px` : null,
```

## B. Archive pages — 3 new Astro routes, no API changes

New files under `apps/frontend/src/pages/`:
- `tag/[tag].astro`
- `category/[slug].astro`
- `author/[email].astro`

Each follows the same tenant-resolution block already duplicated in
`[...slug].astro` and `posts/[slug].astro` (`Host` header, `DEV_TENANT_HOST`
+ `?__tenant=` fallback for local dev).

`tag` and `author` need zero backend work: `generic-crud.ts`'s
`buildListFilters` already supports array-contains `?tag=` and exact-match
`?authorEmail=` directly against real columns on the `posts` table (`tags`,
`authorEmail`) — `apps/frontend/src/lib/api.ts`'s existing
`listPosts(tenantHost, { tag })` / `{ authorEmail }` already does this.

`category` needs one extra step: `posts.categoryId` is the only real column
— `category` (the name) is a **virtual** field `postsAfterRead` (`index.ts`)
computes after the query runs, so `buildListFilters` (which only matches
real table columns) silently ignores a `?category=` param. `category/
[slug].astro` therefore resolves the URL's category **slug** to an id
first: call a new `listCategories(tenantHost)` (mirrors the admin's own
`listCategories`, but public/unauthenticated) hitting the already-public
`GET /api/categories` (`categoriesCollection` is registered on
`registerPublicCollectionRoutes`, `index.ts:932`), find the row whose `slug`
matches, then `listPosts(tenantHost, { categoryId: match.id })`. No match →
same empty-result rendering as a real category with zero posts (see below).

`postsAfterRead` also gains `categorySlug` (alongside the existing
`category` name lookup) so the *post page's* category link has a slug to
link to — see section C.

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
above, since the public GET already `select()`s every column. It also gains
`categorySlug: string | null`, populated by `postsAfterRead`'s existing
category lookup (same query, one more field read off the row it already
fetched — see section B).

`posts/[slug].astro` computes, once per field:

```js
// post.showX is a real nullable boolean column; theme.showPostX is a
// "true"/"false" string (or absent) — see section A.
const showTags = post.showTags ?? (theme.showPostTags !== "false");
const showCategory = post.showCategory ?? (theme.showPostCategory !== "false");
const showAuthor = post.showAuthor ?? (theme.showPostAuthor !== "false");
const showDate = post.showPublishedDate ?? (theme.showPostDate !== "false");
```

and gates each existing block on the matching variable. Tag/category/author
become real anchors:

```html
<a href={`/category/${encodeURIComponent(post.categorySlug)}`}>{post.category}</a>
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
