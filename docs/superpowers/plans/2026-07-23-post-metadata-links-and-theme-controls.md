# Post Metadata Links, Theme Display Toggles, and Title Font Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make post tags/category/author clickable (linking to new per-tenant archive pages), let a webmaster hide any of tags/category/author/published-date site-wide (Theme settings) or per-post (override), and make the post title's font size theme-configurable instead of hardcoded.

**Architecture:** Extend `site_theme.settings` (existing open JSONB bag) with 5 new string-encoded keys; add 4 nullable boolean override columns to `posts`; add 3 new Astro pages that reuse the existing public `GET /api/posts`/`GET /api/categories` list filters (no new API routes); update `posts/[slug].astro` to read both layers and render accordingly; add matching controls to `ThemeForm` and `PostEditorPage` in `apps/admin`.

**Tech Stack:** Fastify + Drizzle ORM (`apps/api`), Astro 7 SSR (`apps/frontend`), Vite + React (`apps/admin`), pnpm workspace.

## Global Constraints

- Every `site_theme.settings` value is a string on the wire, including the 5 new keys (`postTitleFontSize` as a numeric string, `showPost*` as `"true"`/`"false"`) — matches every existing key (colors, fonts) and avoids widening `Record<string, string>` across 7+ call sites in `apps/admin/src/lib/api.ts`. `""` always means "no override", same as existing keys.
- `posts.category` (the name) and the new `posts.categorySlug` are **virtual** fields computed by `postsAfterRead` — never real columns, never usable in `buildListFilters`. Only `posts.categoryId` is a real, filterable column.
- Per-post override columns (`showTags`, `showCategory`, `showAuthor`, `showPublishedDate`) are real nullable booleans on `posts`. `null` = inherit the theme's site-wide default.
- Resolution order everywhere it's rendered: `post.showX ?? (theme.showPostX !== "false")` — post-level wins when set (non-null), otherwise the theme default applies, and an absent/empty theme key defaults to showing the field.
- No changes to `apps/api/src/plugins/generic-crud.ts`'s filter mechanism — the category archive page works around the virtual-field limitation client-side (resolve slug → id via `GET /api/categories`, then filter posts by `categoryId`), not by teaching `buildListFilters` about virtual fields.
- `apps/api`'s local dev has no live Postgres connection available (see project notes) — the migration SQL file is hand-written (matching this repo's existing convention for migrations beyond a trivial `drizzle-kit generate` diff, e.g. `0009`/`0010`) and committed, but `db:migrate` is not run as part of this plan; note this in the task instead of attempting it.

---

## Task 1: API — theme settings keys (`postTitleFontSize`, `showPost*`)

**Files:**
- Modify: `apps/api/src/index.ts:95-130` (`THEME_COLOR_KEYS`/`FONT_KEYS`/`validateThemeSettings`)

**Interfaces:**
- Produces: 5 new accepted keys in `site_theme.settings` — `postTitleFontSize`, `showPostTags`, `showPostCategory`, `showPostAuthor`, `showPostDate` — all strings, all optional, `""` meaning "unset".

- [ ] **Step 1: Add the new keys and their validation to `validateThemeSettings`**

Read the current function first (`apps/api/src/index.ts:95-130`):

```ts
const THEME_COLOR_KEYS = ["primaryColor", "secondaryColor", "backgroundColor", "textColor"] as const;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Letters/digits/space only — this string ends up inside a Google Fonts URL
// built by apps/frontend, so it must not carry `/`, `?`, `<`, etc.
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;

// fontFamily = body font; headingFont/postTitleFont are the other two roles
// in the type system (Header/Title, Blog/Post Title) — all three end up in
// the same Google Fonts URL, so all three validate the same way.
const FONT_KEYS = ["fontFamily", "headingFont", "subHeadingFont", "postTitleFont"] as const;

// Shared by both theme write routes (per-tenant + global). site_theme.settings
// is an open JSONB bag but only these keys are ever read by apps/frontend
// (BaseLayout.astro) — reject anything else instead of silently storing it.
function validateThemeSettings(settings: Record<string, unknown>): string | null {
  const allowed = new Set([...THEME_COLOR_KEYS, ...FONT_KEYS, "logoUrl"]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) return `unknown theme key: ${key}`;
  }
  for (const key of THEME_COLOR_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && !HEX_COLOR_RE.test(value as string)) {
      return `${key} must be a hex color like #003399`;
    }
  }
  for (const key of FONT_KEYS) {
    const value = settings[key];
    if (value !== undefined && !FONT_FAMILY_RE.test(value as string)) {
      return `${key} must contain only letters, digits, and spaces`;
    }
  }
  if (settings.logoUrl !== undefined && typeof settings.logoUrl !== "string") {
    return "logoUrl must be a string";
  }
  return null;
}
```

Replace it with (adds `POST_DISPLAY_KEYS`, `postTitleFontSize`, and their checks):

```ts
const THEME_COLOR_KEYS = ["primaryColor", "secondaryColor", "backgroundColor", "textColor"] as const;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Letters/digits/space only — this string ends up inside a Google Fonts URL
// built by apps/frontend, so it must not carry `/`, `?`, `<`, etc.
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;

// fontFamily = body font; headingFont/postTitleFont are the other two roles
// in the type system (Header/Title, Blog/Post Title) — all three end up in
// the same Google Fonts URL, so all three validate the same way.
const FONT_KEYS = ["fontFamily", "headingFont", "subHeadingFont", "postTitleFont"] as const;

// Site-wide default for whether a post shows its tags/category/author/date —
// per-post can override this (posts.showTags etc., nullable booleans, null =
// inherit these). "true"/"false" strings, same wire convention as every
// other theme key (see postTitleFontSize below) — "" means unset/inherit.
const POST_DISPLAY_KEYS = ["showPostTags", "showPostCategory", "showPostAuthor", "showPostDate"] as const;
const POST_TITLE_FONT_SIZE_MIN = 12;
const POST_TITLE_FONT_SIZE_MAX = 96;

// Shared by both theme write routes (per-tenant + global). site_theme.settings
// is an open JSONB bag but only these keys are ever read by apps/frontend
// (BaseLayout.astro, posts/[slug].astro) — reject anything else instead of
// silently storing it.
function validateThemeSettings(settings: Record<string, unknown>): string | null {
  const allowed = new Set([...THEME_COLOR_KEYS, ...FONT_KEYS, ...POST_DISPLAY_KEYS, "logoUrl", "postTitleFontSize"]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) return `unknown theme key: ${key}`;
  }
  for (const key of THEME_COLOR_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && !HEX_COLOR_RE.test(value as string)) {
      return `${key} must be a hex color like #003399`;
    }
  }
  for (const key of FONT_KEYS) {
    const value = settings[key];
    if (value !== undefined && !FONT_FAMILY_RE.test(value as string)) {
      return `${key} must contain only letters, digits, and spaces`;
    }
  }
  if (settings.logoUrl !== undefined && typeof settings.logoUrl !== "string") {
    return "logoUrl must be a string";
  }
  const fontSize = settings.postTitleFontSize;
  if (fontSize !== undefined && fontSize !== "") {
    const n = Number(fontSize);
    if (!Number.isFinite(n) || n < POST_TITLE_FONT_SIZE_MIN || n > POST_TITLE_FONT_SIZE_MAX) {
      return `postTitleFontSize must be a number between ${POST_TITLE_FONT_SIZE_MIN} and ${POST_TITLE_FONT_SIZE_MAX}`;
    }
  }
  for (const key of POST_DISPLAY_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && value !== "true" && value !== "false") {
      return `${key} must be "true" or "false"`;
    }
  }
  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: no errors.

- [ ] **Step 3: Manual spot-check**

`apps/api` has no existing test file for `validateThemeSettings` (it's a private, unexported function; there's no `apps/api/src/index.test.ts` in this repo today) — this task does not introduce a new testing pattern the codebase doesn't already have. Spot-check the new branches by temporarily adding and removing a throwaway call, or trust Task 7's real ThemeForm save as the end-to-end exercise. Confirm by reading the diff that:
- `postTitleFontSize: "32"` passes (32 is in [12, 96])
- `postTitleFontSize: "5"` fails (out of range)
- `postTitleFontSize: "abc"` fails (`Number("abc")` is `NaN`, not finite)
- `showPostTags: "false"`, `""`, and `"true"` all pass; `showPostTags: "no"` fails

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): accept postTitleFontSize and showPost* theme settings keys"
```

---

## Task 2: API — posts table override columns + `categorySlug`

**Files:**
- Modify: `apps/api/src/db/schema.ts:34-57` (`posts` table)
- Create: `apps/api/src/db/migrations/0011_posts_display_overrides.sql`
- Modify: `apps/api/src/index.ts:823-832` (`postsAfterRead`)

**Interfaces:**
- Produces: `posts.showTags`, `posts.showCategory`, `posts.showAuthor`, `posts.showPublishedDate` (all `boolean | null`, real columns). `postsAfterRead` now also returns `categorySlug: string | null` on every row (alongside the existing `category: string | null`).

- [ ] **Step 1: Add the 4 columns to the Drizzle schema**

In `apps/api/src/db/schema.ts`, find the `posts` table:

```ts
  authorId: text("author_id"),
  authorEmail: text("author_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Change to:

```ts
  authorId: text("author_id"),
  authorEmail: text("author_email"),
  // Per-post override of the theme's site-wide show/hide default for each
  // field (apps/api's validateThemeSettings' showPost* keys). null = inherit
  // the theme default; true/false = explicit override for this post only.
  showTags: boolean("show_tags"),
  showCategory: boolean("show_category"),
  showAuthor: boolean("show_author"),
  showPublishedDate: boolean("show_published_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Check the top-of-file import from `drizzle-orm/pg-core` already includes `boolean`:

```bash
grep -n "^import.*pg-core" apps/api/src/db/schema.ts
```

If `boolean` is missing from that destructured import list, add it.

- [ ] **Step 2: Write the migration SQL by hand**

Create `apps/api/src/db/migrations/0011_posts_display_overrides.sql`:

```sql
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_tags" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_category" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_author" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_published_date" boolean;
```

This repo hand-writes non-trivial migrations rather than relying on `drizzle-kit generate` (see `0009_posts_taxonomy_author_revisions.sql`/`0010_categories.sql`, both hand-authored with logic beyond a plain diff) — `db:generate`'s local snapshot metadata (`apps/api/src/db/migrations/meta/_journal.json`) only has one entry despite 10 migration files existing, so running `db:generate` now is unreliable; do not run it. Do not run `db:migrate` either — this environment has no live Postgres connection (per this repo's `CLAUDE.md`); the SQL file is committed and applied whenever a DB is next available.

- [ ] **Step 3: Add `categorySlug` to `postsAfterRead`**

In `apps/api/src/index.ts`, find `postsAfterRead`:

```ts
const postsAfterRead = async (items: unknown[], req: FastifyRequest) => {
  const rows = items as Record<string, unknown>[];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId as string | null).filter((v): v is string => Boolean(v)))];
  const byId = new Map<string, string>();
  if (categoryIds.length > 0) {
    const cats = await req.db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds));
    for (const cat of cats) byId.set(cat.id, cat.name);
  }
  return rows.map((r) => ({ ...r, category: r.categoryId ? byId.get(r.categoryId as string) ?? null : null }));
};
```

Replace with (fetches `slug` in the same query, no extra round trip):

```ts
const postsAfterRead = async (items: unknown[], req: FastifyRequest) => {
  const rows = items as Record<string, unknown>[];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId as string | null).filter((v): v is string => Boolean(v)))];
  const byId = new Map<string, { name: string; slug: string }>();
  if (categoryIds.length > 0) {
    const cats = await req.db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds));
    for (const cat of cats) byId.set(cat.id, { name: cat.name, slug: cat.slug });
  }
  return rows.map((r) => {
    const cat = r.categoryId ? byId.get(r.categoryId as string) : undefined;
    return { ...r, category: cat?.name ?? null, categorySlug: cat?.slug ?? null };
  });
};
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/0011_posts_display_overrides.sql apps/api/src/index.ts
git commit -m "feat(api): add per-post display-override columns and categorySlug"
```

---

## Task 3: Frontend — `lib/api.ts` types and `listCategories`

**Files:**
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (this app has no compile-time dependency on `apps/api`'s TypeScript — it's a separate workspace package calling a JSON HTTP API).
- Produces: `Post.categorySlug: string | null`, `Post.showTags/showCategory/showAuthor/showPublishedDate: boolean | null`; `interface Category { id: string; name: string; slug: string }`; `listCategories(tenantHost: string): Promise<Category[]>`.

- [ ] **Step 1: Extend the `Post` interface**

Current (after this session's earlier `status` addition):

```ts
export interface Post {
  id: string;
  slug: string;
  title: string;
  body: string; // sanitized HTML (apps/api sanitizes on write)
  excerpt: string | null;
  bannerImageUrl: string | null;
  publishedAt: string | null;
  category: string | null;
  tags: string[];
  authorEmail: string | null;
  status: "draft" | "published" | "private";
}
```

Change to:

```ts
export interface Post {
  id: string;
  slug: string;
  title: string;
  body: string; // sanitized HTML (apps/api sanitizes on write)
  excerpt: string | null;
  bannerImageUrl: string | null;
  publishedAt: string | null;
  category: string | null;
  categorySlug: string | null;
  tags: string[];
  authorEmail: string | null;
  status: "draft" | "published" | "private";
  // Per-post override of the theme's site-wide show/hide default; null =
  // inherit the theme's showPost* setting (see getTheme's returned keys).
  showTags: boolean | null;
  showCategory: boolean | null;
  showAuthor: boolean | null;
  showPublishedDate: boolean | null;
}
```

- [ ] **Step 2: Add `Category` and `listCategories`**

Add after `listPosts` (following the existing `getPostBySlug`/`listPosts` pair):

```ts
export interface Category {
  id: string;
  name: string;
  slug: string;
}

// GET /api/categories is public (registerPublicCollectionRoutes in
// apps/api's index.ts) — used by category/[slug].astro to resolve a
// category's URL slug to its id before filtering posts, since posts.category
// is a virtual (afterRead-computed) field and can't be filtered directly —
// see generic-crud.ts's buildListFilters, which only matches real columns.
export async function listCategories(tenantHost: string): Promise<Category[]> {
  const { items } = await apiGet<{ items: Category[] }>("/api/categories", tenantHost);
  return items;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck`
Expected: no errors (nothing yet consumes the new fields, so this only checks the interface itself is well-formed).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "feat(frontend): add categorySlug/showX fields to Post, add listCategories"
```

---

## Task 4: Frontend — `BaseLayout.astro` post-title size CSS var

**Files:**
- Modify: `apps/frontend/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `theme.postTitleFontSize` (string, from Task 1's new theme key, read off the object `getTheme()` already returns — no new fetch).
- Produces: CSS custom property `--font-post-title-size` on `:root`, consumed by Task 6's `posts/[slug].astro`.

- [ ] **Step 1: Add the new `themeVars` line**

Find the `themeVars` array:

```ts
const themeVars = [
  theme.primaryColor ? `--color-primary:${theme.primaryColor}` : null,
  theme.secondaryColor ? `--color-secondary:${theme.secondaryColor}` : null,
  theme.backgroundColor ? `--color-bg:${theme.backgroundColor}` : null,
  theme.textColor ? `--color-text:${theme.textColor}` : null,
  theme.fontFamily ? `--font-family:${theme.fontFamily}` : null,
  theme.headingFont ? `--font-heading:${theme.headingFont}` : null,
  theme.subHeadingFont ? `--font-subheading:${theme.subHeadingFont}` : null,
  theme.postTitleFont ? `--font-post-title:${theme.postTitleFont}` : null,
]
  .filter(Boolean)
  .join(";");
```

Change to:

```ts
const themeVars = [
  theme.primaryColor ? `--color-primary:${theme.primaryColor}` : null,
  theme.secondaryColor ? `--color-secondary:${theme.secondaryColor}` : null,
  theme.backgroundColor ? `--color-bg:${theme.backgroundColor}` : null,
  theme.textColor ? `--color-text:${theme.textColor}` : null,
  theme.fontFamily ? `--font-family:${theme.fontFamily}` : null,
  theme.headingFont ? `--font-heading:${theme.headingFont}` : null,
  theme.subHeadingFont ? `--font-subheading:${theme.subHeadingFont}` : null,
  theme.postTitleFont ? `--font-post-title:${theme.postTitleFont}` : null,
  theme.postTitleFontSize ? `--font-post-title-size:${theme.postTitleFontSize}px` : null,
]
  .filter(Boolean)
  .join(";");
```

(`theme.postTitleFontSize` is the string `"32"` etc. from Task 1 — `""` is falsy in JS, so an unset/deactivated value correctly produces no CSS var and Task 5's `var(--font-post-title-size, 2rem)` fallback applies.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/layouts/BaseLayout.astro
git commit -m "feat(frontend): wire postTitleFontSize theme setting into --font-post-title-size"
```

---

## Task 5: Frontend — `posts/[slug].astro` links, toggles, title size

**Files:**
- Modify: `apps/frontend/src/pages/posts/[slug].astro`

**Interfaces:**
- Consumes: `Post.categorySlug`/`showTags`/`showCategory`/`showAuthor`/`showPublishedDate` (Task 3), `theme.showPostTags`/`showPostCategory`/`showPostAuthor`/`showPostDate` (Task 1, read off the same `getTheme()` call this file already makes), `--font-post-title-size` (Task 4).

- [ ] **Step 1: Compute the 4 effective visibility flags after loading post+theme**

Current tail of the frontmatter block:

```ts
const post = await getPostBySlug(tenantHost, Astro.params.slug!, previewToken);
if (!post) {
  return new Response("Not found", { status: 404 });
}
const theme = await getTheme(tenantHost);
---
```

Change to:

```ts
const post = await getPostBySlug(tenantHost, Astro.params.slug!, previewToken);
if (!post) {
  return new Response("Not found", { status: 404 });
}
const theme = await getTheme(tenantHost);

// post.showX is a real per-post override (null = inherit); theme.showPostX
// is a "true"/"false" string default (absent/"" also means "show") — see
// apps/api's validateThemeSettings and this repo's design spec
// docs/superpowers/specs/2026-07-23-post-metadata-links-and-theme-controls-design.md.
const showTags = post.showTags ?? (theme.showPostTags !== "false");
const showCategory = post.showCategory ?? (theme.showPostCategory !== "false");
const showAuthor = post.showAuthor ?? (theme.showPostAuthor !== "false");
const showDate = post.showPublishedDate ?? (theme.showPostDate !== "false");
---
```

- [ ] **Step 2: Gate and link the metadata block**

Current:

```html
    <h1 style="color:var(--color-primary,#1d1d1f);font-family:var(--font-post-title,var(--font-heading,inherit));">{post.title}</h1>
    <p style="color:#86868b;font-size:0.85rem;">
      {post.publishedAt &&
        new Date(post.publishedAt).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}
      {post.category && <span> · {post.category}</span>}
      {post.authorEmail && <span> · {post.authorEmail}</span>}
    </p>
    {post.tags.length > 0 && (
      <p style="margin:0.5rem 0 1rem;">
        {post.tags.map((tag) => (
          <span style="display:inline-block;margin:0 0.4rem 0.4rem 0;padding:0.15rem 0.6rem;border-radius:999px;background:#f2f2f2;font-size:0.75rem;color:#555;">
            {tag}
          </span>
        ))}
      </p>
    )}
```

Change to:

```html
    <h1 style="color:var(--color-primary,#1d1d1f);font-family:var(--font-post-title,var(--font-heading,inherit));font-size:var(--font-post-title-size,2rem);">{post.title}</h1>
    <p style="color:#86868b;font-size:0.85rem;">
      {showDate && post.publishedAt &&
        new Date(post.publishedAt).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}
      {showCategory && post.category && post.categorySlug && (
        <span> · <a href={`/category/${encodeURIComponent(post.categorySlug)}`} style="color:inherit;">{post.category}</a></span>
      )}
      {showAuthor && post.authorEmail && (
        <span> · <a href={`/author/${encodeURIComponent(post.authorEmail)}`} style="color:inherit;">{post.authorEmail}</a></span>
      )}
    </p>
    {showTags && post.tags.length > 0 && (
      <p style="margin:0.5rem 0 1rem;">
        {post.tags.map((tag) => (
          <a
            href={`/tag/${encodeURIComponent(tag)}`}
            style="display:inline-block;margin:0 0.4rem 0.4rem 0;padding:0.15rem 0.6rem;border-radius:999px;background:#f2f2f2;font-size:0.75rem;color:#555;text-decoration:none;"
          >
            {tag}
          </a>
        ))}
      </p>
    )}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck`
Expected: `0 errors`.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/pages/posts/[slug].astro
git commit -m "feat(frontend): link post tags/category/author to archives, add display toggles and title size"
```

---

## Task 6: Frontend — 3 archive pages (tag, category, author)

**Files:**
- Create: `apps/frontend/src/pages/tag/[tag].astro`
- Create: `apps/frontend/src/pages/category/[slug].astro`
- Create: `apps/frontend/src/pages/author/[email].astro`

**Interfaces:**
- Consumes: `listPosts(tenantHost, query)` (existing, unchanged), `listCategories(tenantHost)` (Task 3), `getTheme(tenantHost)` (existing).

- [ ] **Step 1: Create the tag archive page**

Create `apps/frontend/src/pages/tag/[tag].astro`:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { listPosts, getTheme } from "../../lib/api";

// Same tenant resolution as posts/[slug].astro: Host header, with the
// DEV_TENANT_HOST fallback (or a `?__tenant=` override) for local dev.
const rawHost = Astro.request.headers.get("host") ?? "";
const tenantHost =
  import.meta.env.DEV && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (Astro.url.searchParams.get("__tenant") ?? import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;

const tag = Astro.params.tag!;
const posts = await listPosts(tenantHost, { tag });
const theme = await getTheme(tenantHost);
---
<BaseLayout title={`Tag: ${tag}`} theme={theme}>
  <main style="max-width:44rem;margin:0 auto;padding:2rem 1rem;">
    <h1 style="color:var(--color-primary,#1d1d1f);">Tag: {tag}</h1>
    {posts.length === 0 && <p style="color:#86868b;">No posts with this tag yet.</p>}
    <ul style="list-style:none;padding:0;">
      {posts.map((post) => (
        <li style="margin-bottom:1.5rem;">
          <a href={`/posts/${post.slug}`} style="font-size:1.1rem;font-weight:700;color:var(--color-primary,#1d1d1f);text-decoration:none;">
            {post.title}
          </a>
          {post.publishedAt && (
            <p style="color:#86868b;font-size:0.8rem;margin:0.2rem 0;">
              {new Date(post.publishedAt).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
          {post.excerpt && <p style="margin:0.2rem 0;">{post.excerpt}</p>}
        </li>
      ))}
    </ul>
  </main>
</BaseLayout>
```

- [ ] **Step 2: Create the author archive page**

Create `apps/frontend/src/pages/author/[email].astro`:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { listPosts, getTheme } from "../../lib/api";

const rawHost = Astro.request.headers.get("host") ?? "";
const tenantHost =
  import.meta.env.DEV && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (Astro.url.searchParams.get("__tenant") ?? import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;

const email = Astro.params.email!;
const posts = await listPosts(tenantHost, { authorEmail: email });
const theme = await getTheme(tenantHost);
---
<BaseLayout title={`Author: ${email}`} theme={theme}>
  <main style="max-width:44rem;margin:0 auto;padding:2rem 1rem;">
    <h1 style="color:var(--color-primary,#1d1d1f);">Author: {email}</h1>
    {posts.length === 0 && <p style="color:#86868b;">No posts by this author yet.</p>}
    <ul style="list-style:none;padding:0;">
      {posts.map((post) => (
        <li style="margin-bottom:1.5rem;">
          <a href={`/posts/${post.slug}`} style="font-size:1.1rem;font-weight:700;color:var(--color-primary,#1d1d1f);text-decoration:none;">
            {post.title}
          </a>
          {post.publishedAt && (
            <p style="color:#86868b;font-size:0.8rem;margin:0.2rem 0;">
              {new Date(post.publishedAt).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
          {post.excerpt && <p style="margin:0.2rem 0;">{post.excerpt}</p>}
        </li>
      ))}
    </ul>
  </main>
</BaseLayout>
```

- [ ] **Step 3: Create the category archive page (resolves slug → id first)**

Create `apps/frontend/src/pages/category/[slug].astro`:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { listPosts, listCategories, getTheme } from "../../lib/api";

const rawHost = Astro.request.headers.get("host") ?? "";
const tenantHost =
  import.meta.env.DEV && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (Astro.url.searchParams.get("__tenant") ?? import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;

const slug = Astro.params.slug!;
// posts.category (the name) is a virtual, computed field — buildListFilters
// only matches real columns, so filtering posts requires the real
// categoryId. Resolve the URL's slug to an id via the public categories
// list first (see apps/frontend/src/lib/api.ts's listCategories).
const categories = await listCategories(tenantHost);
const category = categories.find((c) => c.slug === slug);
const posts = category ? await listPosts(tenantHost, { categoryId: category.id }) : [];
const theme = await getTheme(tenantHost);
---
<BaseLayout title={`Category: ${category?.name ?? slug}`} theme={theme}>
  <main style="max-width:44rem;margin:0 auto;padding:2rem 1rem;">
    <h1 style="color:var(--color-primary,#1d1d1f);">Category: {category?.name ?? slug}</h1>
    {posts.length === 0 && <p style="color:#86868b;">No posts in this category yet.</p>}
    <ul style="list-style:none;padding:0;">
      {posts.map((post) => (
        <li style="margin-bottom:1.5rem;">
          <a href={`/posts/${post.slug}`} style="font-size:1.1rem;font-weight:700;color:var(--color-primary,#1d1d1f);text-decoration:none;">
            {post.title}
          </a>
          {post.publishedAt && (
            <p style="color:#86868b;font-size:0.8rem;margin:0.2rem 0;">
              {new Date(post.publishedAt).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
          {post.excerpt && <p style="margin:0.2rem 0;">{post.excerpt}</p>}
        </li>
      ))}
    </ul>
  </main>
</BaseLayout>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck`
Expected: `0 errors`. (`astro check` will report if any of the 3 new files reference a field that doesn't exist on `Post`/`Category` — cross-check against Task 3's types if so.)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pages/tag apps/frontend/src/pages/category apps/frontend/src/pages/author
git commit -m "feat(frontend): add tag/category/author archive pages"
```

---

## Task 7: Admin — `ThemeForm` controls (post title size + 4 show/hide checkboxes)

**Files:**
- Modify: `apps/admin/src/App.tsx` (the `ThemeForm` function)
- Modify: `apps/admin/src/i18n.ts`

**Interfaces:**
- Produces: 5 new form fields wired into the exact same `save`/`load`/preset/import-export plumbing every existing `ThemeForm` field already goes through.

- [ ] **Step 1: Add i18n keys**

In `apps/admin/src/i18n.ts`, find the Malay object (`const ms`) — insert right after `"theme-font-body": "Fon Teks (Body)",`:

```ts
  "theme-font-body": "Fon Teks (Body)",
  "theme-post-title-size": "Saiz fon tajuk post (px)",
  "theme-show-tags": "Papar tag",
  "theme-show-category": "Papar kategori",
  "theme-show-author": "Papar penulis",
  "theme-show-date": "Papar tarikh",
```

Find the English object (`const en`) — insert right after `"theme-font-body": "Body Font",`:

```ts
  "theme-font-body": "Body Font",
  "theme-post-title-size": "Post title size (px)",
  "theme-show-tags": "Show tags",
  "theme-show-category": "Show category",
  "theme-show-author": "Show author",
  "theme-show-date": "Show date",
```

- [ ] **Step 2: Add state, include in every settings object**

In `apps/admin/src/App.tsx`'s `ThemeForm`, find the state block:

```ts
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [textColor, setTextColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [headingFont, setHeadingFont] = useState("");
  const [subHeadingFont, setSubHeadingFont] = useState("");
  const [postTitleFont, setPostTitleFont] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
```

Add 5 new state vars right after `postTitleFont`'s line:

```ts
  const [postTitleFont, setPostTitleFont] = useState("");
  const [postTitleFontSize, setPostTitleFontSize] = useState("");
  const [showPostTags, setShowPostTags] = useState("");
  const [showPostCategory, setShowPostCategory] = useState("");
  const [showPostAuthor, setShowPostAuthor] = useState("");
  const [showPostDate, setShowPostDate] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
```

Update `currentColors()`:

```ts
  const currentColors = () => ({
    primaryColor,
    secondaryColor,
    backgroundColor,
    textColor,
    fontFamily,
    headingFont,
    subHeadingFont,
    postTitleFont,
    postTitleFontSize,
    showPostTags,
    showPostCategory,
    showPostAuthor,
    showPostDate,
    logoUrl,
  });
```

Update the `load()` effect:

```ts
  useEffect(() => {
    void load().then((th) => {
      setPrimaryColor(th.primaryColor ?? "");
      setSecondaryColor(th.secondaryColor ?? "");
      setBackgroundColor(th.backgroundColor ?? "");
      setTextColor(th.textColor ?? "");
      setFontFamily(th.fontFamily ?? "");
      setHeadingFont(th.headingFont ?? "");
      setSubHeadingFont(th.subHeadingFont ?? "");
      setPostTitleFont(th.postTitleFont ?? "");
      setPostTitleFontSize(th.postTitleFontSize ?? "");
      setShowPostTags(th.showPostTags ?? "");
      setShowPostCategory(th.showPostCategory ?? "");
      setShowPostAuthor(th.showPostAuthor ?? "");
      setShowPostDate(th.showPostDate ?? "");
      setLogoUrl(th.logoUrl ?? "");
    });
    void refreshPresets();
  }, []);
```

Update `loadPreset()`:

```ts
  function loadPreset(p: api.ThemePreset) {
    setPrimaryColor(p.settings.primaryColor ?? "");
    setSecondaryColor(p.settings.secondaryColor ?? "");
    setBackgroundColor(p.settings.backgroundColor ?? "");
    setTextColor(p.settings.textColor ?? "");
    setFontFamily(p.settings.fontFamily ?? "");
    setHeadingFont(p.settings.headingFont ?? "");
    setSubHeadingFont(p.settings.subHeadingFont ?? "");
    setPostTitleFont(p.settings.postTitleFont ?? "");
    setPostTitleFontSize(p.settings.postTitleFontSize ?? "");
    setShowPostTags(p.settings.showPostTags ?? "");
    setShowPostCategory(p.settings.showPostCategory ?? "");
    setShowPostAuthor(p.settings.showPostAuthor ?? "");
    setShowPostDate(p.settings.showPostDate ?? "");
    setLogoUrl(p.settings.logoUrl ?? "");
  }
```

Update `deactivate()`'s `empty` object:

```ts
  async function deactivate() {
    const empty = {
      primaryColor: "",
      secondaryColor: "",
      backgroundColor: "",
      textColor: "",
      fontFamily: "",
      headingFont: "",
      subHeadingFont: "",
      postTitleFont: "",
      postTitleFontSize: "",
      showPostTags: "",
      showPostCategory: "",
      showPostAuthor: "",
      showPostDate: "",
      logoUrl: "",
    };
```

Update `importDesignMd()`:

```ts
      setPrimaryColor(parsed.primaryColor ?? primaryColor);
      setSecondaryColor(parsed.secondaryColor ?? secondaryColor);
      setBackgroundColor(parsed.backgroundColor ?? backgroundColor);
      setTextColor(parsed.textColor ?? textColor);
      setFontFamily(parsed.fontFamily ?? fontFamily);
      setHeadingFont(parsed.headingFont ?? headingFont);
      setSubHeadingFont(parsed.subHeadingFont ?? subHeadingFont);
      setPostTitleFont(parsed.postTitleFont ?? postTitleFont);
      setPostTitleFontSize(parsed.postTitleFontSize ?? postTitleFontSize);
      setShowPostTags(parsed.showPostTags ?? showPostTags);
      setShowPostCategory(parsed.showPostCategory ?? showPostCategory);
      setShowPostAuthor(parsed.showPostAuthor ?? showPostAuthor);
      setShowPostDate(parsed.showPostDate ?? showPostDate);
      setLogoUrl(parsed.logoUrl ?? logoUrl);
```

Update `submit()`:

```ts
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await save({
        primaryColor,
        secondaryColor,
        backgroundColor,
        textColor,
        fontFamily,
        headingFont,
        subHeadingFont,
        postTitleFont,
        postTitleFontSize,
        showPostTags,
        showPostCategory,
        showPostAuthor,
        showPostDate,
        logoUrl,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }
```

- [ ] **Step 3: Add the UI controls**

Find:

```tsx
            <FontField label={t("theme-font-posttitle")} value={postTitleFont} onChange={setPostTitleFont} placeholder="Poppins" />
            {sameFontNote(postTitleFont, headingFont)}
            <FontField label={t("theme-font-body")} value={fontFamily} onChange={setFontFamily} placeholder="Inter" />
          </div>
```

Change to (adds the number input right after the Post-Title font field, checkboxes as a new block right after the font block's closing `</div>`):

```tsx
            <FontField label={t("theme-font-posttitle")} value={postTitleFont} onChange={setPostTitleFont} placeholder="Poppins" />
            {sameFontNote(postTitleFont, headingFont)}
            <label className="block text-xs font-medium text-body">
              {t("theme-post-title-size")}
              <input
                type="number"
                min={12}
                max={96}
                className={`${inputCls} mt-1`}
                value={postTitleFontSize}
                onChange={(e) => setPostTitleFontSize(e.target.value)}
                placeholder="32"
              />
            </label>
            <FontField label={t("theme-font-body")} value={fontFamily} onChange={setFontFamily} placeholder="Inter" />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-medium text-body">
              <input type="checkbox" checked={showPostTags !== "false"} onChange={(e) => setShowPostTags(e.target.checked ? "" : "false")} />
              {t("theme-show-tags")}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-body">
              <input type="checkbox" checked={showPostCategory !== "false"} onChange={(e) => setShowPostCategory(e.target.checked ? "" : "false")} />
              {t("theme-show-category")}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-body">
              <input type="checkbox" checked={showPostAuthor !== "false"} onChange={(e) => setShowPostAuthor(e.target.checked ? "" : "false")} />
              {t("theme-show-author")}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-body">
              <input type="checkbox" checked={showPostDate !== "false"} onChange={(e) => setShowPostDate(e.target.checked ? "" : "false")} />
              {t("theme-show-date")}
            </label>
          </div>
```

(Checkboxes store `""` for "checked/show" and `"false"` for "unchecked/hide" — never `"true"`. `validateThemeSettings` from Task 1 accepts `""`/`"true"`/`"false"`, and the reader `theme.showPostX !== "false"` treats `""` and `"true"` identically as "show". This also means `deactivate()`'s empty-string reset correctly re-checks every box.)

`inputCls` is already imported at the top of `App.tsx` and used elsewhere in `ThemeForm` (e.g. inside `FontField`) — no new import needed.

- [ ] **Step 4: Reflect the font size in the live preview**

Find:

```tsx
            <p className="text-sm font-semibold opacity-80" style={{ fontFamily: postTitleFont || undefined }}>
              {t("theme-preview-posttitle")}
            </p>
```

Change to:

```tsx
            <p className="text-sm font-semibold opacity-80" style={{ fontFamily: postTitleFont || undefined, fontSize: postTitleFontSize ? `${postTitleFontSize}px` : undefined }}>
              {t("theme-preview-posttitle")}
            </p>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add post title size and show/hide controls to ThemeForm"
```

---

## Task 8: Admin — `PostEditorPage` per-post override controls

**Files:**
- Modify: `apps/admin/src/PostEditorPage.tsx`
- Modify: `apps/admin/src/i18n.ts`

**Interfaces:**
- Consumes: `posts.showTags`/`showCategory`/`showAuthor`/`showPublishedDate` (Task 2, real nullable booleans returned by `GET /api/posts`, already fetched by this page's existing `api.getPosts` call — no new fetch).
- Produces: the same 4 fields included in `updatePost`'s payload.

- [ ] **Step 1: Add i18n keys**

In `apps/admin/src/i18n.ts`, Malay object — insert right after `"posts-author": "Penulis",`:

```ts
  "posts-author": "Penulis",
  "posts-display-inherit": "Ikut Tema",
  "posts-display-show": "Papar",
  "posts-display-hide": "Sorok",
  "posts-show-tags": "Tag",
  "posts-show-category": "Kategori",
  "posts-show-author": "Penulis",
  "posts-show-date": "Tarikh",
```

English object — insert right after `"posts-author": "Author",`:

```ts
  "posts-author": "Author",
  "posts-display-inherit": "Follow theme",
  "posts-display-show": "Show",
  "posts-display-hide": "Hide",
  "posts-show-tags": "Tags",
  "posts-show-category": "Category",
  "posts-show-author": "Author",
  "posts-show-date": "Date",
```

(`"posts-show-tags"`/`"posts-show-category"`/`"posts-show-author"`/`"posts-show-date"` are field *labels* for the 4 selects below — distinct keys from Task 7's `"theme-show-tags"` etc., which label the theme-level checkboxes. They read similarly but belong to different screens and must stay separate keys so either can be reworded independently later.)

- [ ] **Step 2: Add the `DisplayOverride` type and helpers**

In `apps/admin/src/PostEditorPage.tsx`, find:

```ts
type PostStatus = "draft" | "published" | "private";
```

Change to:

```ts
type PostStatus = "draft" | "published" | "private";
type DisplayOverride = "inherit" | "show" | "hide";

function toDisplayOverride(value: boolean | null | undefined): DisplayOverride {
  return value === true ? "show" : value === false ? "hide" : "inherit";
}

function fromDisplayOverride(value: DisplayOverride): boolean | null {
  return value === "show" ? true : value === "hide" ? false : null;
}
```

- [ ] **Step 3: Add state, load from `post`, include in `save()`'s payload**

Find the state block:

```ts
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PostStatus>("draft");
```

Add 4 new state vars right after `status`'s line:

```ts
  const [status, setStatus] = useState<PostStatus>("draft");
  const [showTags, setShowTags] = useState<DisplayOverride>("inherit");
  const [showCategory, setShowCategory] = useState<DisplayOverride>("inherit");
  const [showAuthor, setShowAuthor] = useState<DisplayOverride>("inherit");
  const [showPublishedDate, setShowPublishedDate] = useState<DisplayOverride>("inherit");
```

Find the post-load effect:

```ts
  useEffect(() => {
    if (!post) return;
    setTitle(post.title as string);
    setExcerpt((post.excerpt as string | null) ?? "");
    setCategoryId((post.categoryId as string | null) ?? "");
    setTags((post.tags as string[] | null) ?? []);
    setTagDraft("");
    setBannerImageUrl((post.bannerImageUrl as string | null) ?? null);
    setStatus((post.status as PostStatus) || "draft");
  }, [post]);
```

Change to:

```ts
  useEffect(() => {
    if (!post) return;
    setTitle(post.title as string);
    setExcerpt((post.excerpt as string | null) ?? "");
    setCategoryId((post.categoryId as string | null) ?? "");
    setTags((post.tags as string[] | null) ?? []);
    setTagDraft("");
    setBannerImageUrl((post.bannerImageUrl as string | null) ?? null);
    setStatus((post.status as PostStatus) || "draft");
    setShowTags(toDisplayOverride(post.showTags as boolean | null | undefined));
    setShowCategory(toDisplayOverride(post.showCategory as boolean | null | undefined));
    setShowAuthor(toDisplayOverride(post.showAuthor as boolean | null | undefined));
    setShowPublishedDate(toDisplayOverride(post.showPublishedDate as boolean | null | undefined));
  }, [post]);
```

Find `save()`:

```ts
  async function save(nextStatus?: PostStatus) {
    if (!post) return;
    setSaving(true);
    try {
      const body = await editor.blocksToHTMLLossy(editor.document);
      await api.updatePost(tenantHost, token, post.id as string, {
        title, excerpt: excerpt.trim() || autoExcerpt(body), categoryId: categoryId || null, tags, bannerImageUrl,
        body,
        ...(nextStatus ? { status: nextStatus, publishedAt: nextStatus === "draft" ? null : new Date().toISOString() } : {}),
      });
      if (nextStatus) setStatus(nextStatus);
      setPosts(await api.getPosts(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
```

Change the `updatePost` payload to:

```ts
  async function save(nextStatus?: PostStatus) {
    if (!post) return;
    setSaving(true);
    try {
      const body = await editor.blocksToHTMLLossy(editor.document);
      await api.updatePost(tenantHost, token, post.id as string, {
        title, excerpt: excerpt.trim() || autoExcerpt(body), categoryId: categoryId || null, tags, bannerImageUrl,
        body,
        showTags: fromDisplayOverride(showTags),
        showCategory: fromDisplayOverride(showCategory),
        showAuthor: fromDisplayOverride(showAuthor),
        showPublishedDate: fromDisplayOverride(showPublishedDate),
        ...(nextStatus ? { status: nextStatus, publishedAt: nextStatus === "draft" ? null : new Date().toISOString() } : {}),
      });
      if (nextStatus) setStatus(nextStatus);
      setPosts(await api.getPosts(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add the 4 tri-state selects to the settings panel**

Find the tags field's closing tag followed by the Share button:

```tsx
                  placeholder={tags.length ? "" : t("posts-tags")}
                  className="min-w-[60px] flex-1 border-0 bg-transparent text-xs outline-none"
                />
              </div>
            </div>
            {status === "published" && (<button onClick={() => void share()} className={`${btnGhost} w-full`}>{t("posts-share")}</button>)}
```

Insert a new block between the tags field's closing `</div>` and the Share button:

```tsx
                  placeholder={tags.length ? "" : t("posts-tags")}
                  className="min-w-[60px] flex-1 border-0 bg-transparent text-xs outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-display-inherit")}</label>
              {(
                [
                  ["showTags", t("posts-show-tags"), showTags, setShowTags],
                  ["showCategory", t("posts-show-category"), showCategory, setShowCategory],
                  ["showAuthor", t("posts-show-author"), showAuthor, setShowAuthor],
                  ["showPublishedDate", t("posts-show-date"), showPublishedDate, setShowPublishedDate],
                ] as Array<[string, string, DisplayOverride, (v: DisplayOverride) => void]>
              ).map(([key, label, value, setValue]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-body">{label}</span>
                  <select className={`${inputCls} w-28`} value={value} onChange={(e) => setValue(e.target.value as DisplayOverride)}>
                    <option value="inherit">{t("posts-display-inherit")}</option>
                    <option value="show">{t("posts-display-show")}</option>
                    <option value="hide">{t("posts-display-hide")}</option>
                  </select>
                </div>
              ))}
            </div>
            {status === "published" && (<button onClick={() => void share()} className={`${btnGhost} w-full`}>{t("posts-share")}</button>)}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/PostEditorPage.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add per-post tags/category/author/date display override controls"
```

---

## Final verification

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm typecheck`
Expected: all 3 packages report 0 errors.

- [ ] **Step 2: Push**

```bash
git push
```
