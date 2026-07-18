# Post/Article Editor Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline-expand-under-row Post/Article editor with a Ghost-style full-page editor, add real category management (FK'd table, not freeform text), and add `@`-triggered internal-link bookmark cards — per `docs/superpowers/specs/2026-07-18-post-editor-overhaul-design.md`.

**Architecture:** Four independently-shippable phases. (1) Introduce `react-router-dom` and convert the admin's tab-state navigation to real routes. (2) Add a `categories` table with a real FK from `posts`, replacing freeform text. (3) Rebuild the Post editor as a dedicated full-page route with a toggleable settings panel and a featured-image picker. (4) Add a custom BlockNote block for `@`-triggered internal-link bookmark cards, backed by a new cross-collection search route.

**Tech Stack:** Fastify + Drizzle + Postgres (`apps/api`), Vite + React + TypeScript + BlockNote (`apps/admin`), Astro (`apps/frontend`, untouched by this plan).

## Global Constraints

- No test framework exists in this repo (confirmed: no `vitest`/`jest`, no `test` script in any `package.json`, zero `*.test.ts` files). This plan does **not** introduce one. Every task's verification step is `pnpm --filter @usim-cms/api typecheck` / `pnpm --filter @usim-cms/admin typecheck` and the matching `build` script, plus a manual `curl` or browser check where the change has a runtime-observable effect — this matches the project's own established verification convention.
- Follow existing patterns exactly: Drizzle schema in `apps/api/src/db/schema.ts`, hand-written raw SQL migrations in `apps/api/src/db/migrations/NNNN_description.sql` (this project does not run `drizzle-kit generate` for these — every existing migration file is hand-written to match its exact RLS/policy conventions), `CollectionConfig` + `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes` for any new collection (never a one-off route unless it's a genuine cross-collection exception, same class as the existing preview-token/revision routes).
- `apps/admin/src/App.tsx` is already 3779 lines and is this project's established single-file convention for existing admin components — this plan edits it in place for routing/data-shape changes to *existing* components, but puts substantial *new* components (`PostEditorPage`, `MediaPickerModal`, `CategoriesPanel`, the bookmark-card block) in their own files under `apps/admin/src/`, since adding ~800+ more lines of unrelated new subsystems to one file would make it meaningfully harder to navigate — this is the "file has grown unwieldy, a split is reasonable" case, not a unilateral restructure of existing code.
- `apps/admin/src/App.tsx:74-80` (`inputCls`, `btnPrimary`, `btnGhost`, `card`) and `:67-71` (`I18nCtx`, `useT`) are not currently exported — Task 10/12 adds `export` to these so the new files can reuse them instead of duplicating.
- Every new i18n key is added to **both** the `ms` (default) and `en` objects in `apps/admin/src/i18n.ts` in the same task that introduces the UI using it.
- Malay is the UI default; keep i18n key names in English (matches every existing key), values in the correct language per object.

---

# Phase 1: Routing

## Task 1: Add `react-router-dom` and fix the SPA fallback

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/nginx.conf`
- Modify: `apps/admin/Dockerfile:20-23`

- [ ] **Step 1:** In `apps/admin/package.json`, add to `"dependencies"`: `"react-router-dom": "^6.28.0",`
- [ ] **Step 2:** Run `pnpm install`. Expected: lockfile updates, no errors.
- [ ] **Step 3:** Create `apps/admin/nginx.conf` (stock `nginx:alpine` has no SPA fallback — a direct load/refresh of `/content/posts/<id>` would 404):

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 4:** In `apps/admin/Dockerfile`'s runtime stage, add `COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf` after the existing `COPY --from=build ...` line.
- [ ] **Step 5:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build` — both pass.
- [ ] **Step 6:** Commit: `git add apps/admin/package.json pnpm-lock.yaml apps/admin/nginx.conf apps/admin/Dockerfile && git commit -m "feat(admin): add react-router-dom and nginx SPA fallback"`

---

## Task 2: Wrap the app in `BrowserRouter`, convert `Shell` to a route layout

**Files:** Modify `apps/admin/src/App.tsx:3553-3779` (`Shell`, `App`)

- [ ] **Step 1:** In `Shell` (App.tsx:3565-3569), delete `const [tab, setTab] = useState<Tab>("dashboard")`. Add `const location = useLocation(); const navigate = useNavigate(); const activeTab = (location.pathname.split("/")[1] || "dashboard") as Tab;` in its place.
- [ ] **Step 2:** In the sidebar `NavButton` maps (App.tsx:3616-3622), change `active={tab === tb}` to `active={activeTab === tb}` and `onClick={() => setTab(tb)}` to `onClick={() => navigate(\`/${tb}\`)}`.
- [ ] **Step 3:** In the header (App.tsx:3650), change `{t(TAB_META[tab].labelKey)}` to `{t(TAB_META[activeTab].labelKey)}`.
- [ ] **Step 4:** Replace the `<main>` content (App.tsx:3671-3708, the whole `{tab === "x" && <X/>}` block) with a single temporary line: `<Dashboard session={session} />` (Task 3 replaces this with the real route tree — this keeps Task 2 independently buildable).
- [ ] **Step 5:** In `App`'s default export (App.tsx:3765-3778), wrap the returned `<Shell .../>` in `<BrowserRouter><Routes><Route path="/*" element={<Shell .../>} /></Routes></BrowserRouter>` (keep every existing prop on `<Shell>` unchanged).
- [ ] **Step 6:** Add to the top-of-file imports: `import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";`
- [ ] **Step 7:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build` — both pass. Manual: `pnpm --filter @usim-cms/admin dev`, log in, click sidebar items — URL changes (e.g. `/multisite`) but main area still shows Dashboard (expected, Task 3 finishes the wiring).
- [ ] **Step 8:** Commit: `git add apps/admin/src/App.tsx && git commit -m "feat(admin): wrap app in BrowserRouter, convert Shell to a route-aware layout"`

---

## Task 3: Real routes for every tab, `ContentManager` becomes nested routes

**Files:** Modify `apps/admin/src/App.tsx:3357-3434` (`ContentManager`), the one line from Task 2 Step 4

- [ ] **Step 1:** Replace Task 2's temporary `<Dashboard session={session} />` line with:

```tsx
<Routes>
  <Route index element={<Navigate to="dashboard" replace />} />
  <Route path="dashboard" element={<Dashboard session={session} />} />
  <Route path="multisite" element={isSuper ? <TenantsPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
  <Route path="users" element={isSuper ? <UsersPanel token={session.token} onImpersonate={onImpersonate} /> : <Navigate to="/dashboard" replace />} />
  <Route path="roles" element={isSuper ? <RolesPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
  <Route path="content/*" element={<ContentManager isSuper={isSuper} showSitePicker={showSitePicker} siteHost={siteHost} setSiteHost={setSiteHost} tenants={siteOptions} token={session.token} />} />
  <Route path="theme" element={!isSuper && session.tenantHost ? (<ThemeForm title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(session.tenantHost!, session.token)} save={(s) => api.putTheme(session.tenantHost!, session.token, s)} token={session.token} allowDeactivate previewTenantHost={session.tenantHost!} />) : (<Navigate to="/dashboard" replace />)} />
  <Route path="global-theme" element={isSuper ? (<ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
  <Route path="feed" element={isSuper ? <PortalFeedPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
  <Route path="settings" element={isSuper ? <SettingsPanel token={session.token} tenants={tenants} /> : <Navigate to="/dashboard" replace />} />
</Routes>
```

Add `Navigate` to the react-router-dom import.

- [ ] **Step 2:** In `ContentManager` (App.tsx:3357), delete `const [subTab, setSubTab] = useState<ContentSubTab>("pages")`. Add `const location = useLocation(); const navigate = useNavigate(); const activeSubTab = (location.pathname.split("/")[2] || "pages") as ContentSubTab;`.
- [ ] **Step 3:** In the sub-tab buttons (App.tsx:3403-3413), change `onClick={() => setSubTab(id)}` to `onClick={() => navigate(id)}` and `subTab === id` to `activeSubTab === id`.
- [ ] **Step 4:** Replace the `{subTab === "x" && <X/>}` block (App.tsx:3415-3429) with:

```tsx
<Routes>
  <Route index element={<Navigate to="pages" replace />} />
  <Route path="pages" element={<PagesPanel tenantHost={siteHost} token={token} />} />
  <Route path="posts" element={<PostsPanel key={`posts-${siteHost}`} tenantHost={siteHost} token={token} />} />
  <Route path="media" element={<MediaManager key={`media-${siteHost}`} tenantHost={siteHost} token={token} />} />
  {isSuper && (
    <Route path="theme" element={<ThemeForm key={siteHost} title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(siteHost, token)} save={(s) => api.putTheme(siteHost, token, s)} token={token} allowDeactivate previewTenantHost={siteHost} />} />
  )}
</Routes>
```

- [ ] **Step 5:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build` — both pass. Manual: click every sidebar item and every Content Manager sub-tab, confirm URL changes and refresh keeps you there (dev server only — Task 1's nginx fix is for prod).
- [ ] **Step 6:** Commit: `git add apps/admin/src/App.tsx && git commit -m "feat(admin): convert every tab and Content Manager sub-tab to a real route"`

---

## Task 4: Route-ify the Designer and Post editor mount points

**Files:** Modify `apps/admin/src/App.tsx:376-623` (`PagesPanel`), `:896-1078` (`PostsPanel`)

Explicitly out of scope: `PagesPanel`'s separate `BlockBuilder` inline editor (`editingId` state, App.tsx:590-603) — unrelated older inline block editor, stays exactly as-is.

- [ ] **Step 1:** In `PagesPanel`, delete `const [designPage, setDesignPage] = useState<Record<string, unknown> | null>(null);` (line 381), add `const navigate = useNavigate();`. In `create()` (line ~415), change `setDesignPage(item);` to `navigate(item.id as string);`. On the "Design" button (line 559), change `onClick={() => setDesignPage(p)}` to `onClick={() => navigate(p.id as string)}`. Delete the `{designPage && (<Designer .../>)}` block (lines 609-620).
- [ ] **Step 2:** In `PostsPanel`, delete `const [editingId, setEditingId] = useState<string | null>(null);` (line 899), add `const navigate = useNavigate();`. In `create()` (line ~935), change `setEditingId(item.id as string);` to `navigate(item.id as string);`. On the "Edit" button (lines 1030-1035), replace with `<button onClick={() => navigate(p.id as string)} className="font-semibold text-accent hover:underline">{t("posts-edit")}</button>`. Delete the `{editingId === p.id && (<div className="mt-3"><PostEditor .../></div>)}` block (lines 1055-1070).
- [ ] **Step 3:** Add two new route-wrapper components (below `PagesPanel` and below `PostsPanel` respectively):

```tsx
function PageDesignerRoute({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    void api.getPages(tenantHost, token).then((pages) => setPage(pages.find((p) => p.id === id) ?? null));
  }, [tenantHost, id]);
  if (page === undefined) return null;
  if (page === null) return <p className="text-xs text-sub">{t("pages-empty")}</p>;
  return <Designer page={page} tenantHost={tenantHost} token={token} t={t} onClose={() => navigate("/content/pages")} />;
}
```

```tsx
function PostEditorRoute({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Array<Record<string, unknown>> | null>(null);
  useEffect(() => { void api.getPosts(tenantHost, token).then(setPosts); }, [tenantHost, id]);
  if (posts === null) return null;
  const post = posts.find((p) => p.id === id);
  if (!post) return <p className="text-xs text-sub">{t("posts-empty")}</p>;
  const categoryOptions = [...new Set(posts.map((p) => p.category as string | null).filter((c): c is string => Boolean(c)))];
  return <PostEditor key={post.id as string} post={post} tenantHost={tenantHost} token={token} categoryOptions={categoryOptions} onClose={() => navigate("/content/posts")} onSaved={() => navigate("/content/posts")} />;
}
```

(Phase 3 Task 15 replaces `PostEditorRoute` entirely — kept minimal on purpose.)

- [ ] **Step 4:** Add to `ContentManager`'s `<Routes>`: `<Route path="pages/:id" element={<PageDesignerRoute tenantHost={siteHost} token={token} />} />` and `<Route path="posts/:id" element={<PostEditorRoute tenantHost={siteHost} token={token} />} />`.
- [ ] **Step 5:** Add `useParams` to the react-router-dom import.
- [ ] **Step 6:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build` — both pass. Manual: create a page → navigates to `/content/pages/<id>`, Designer opens, Close returns to list. Same for a post.
- [ ] **Step 7:** Commit: `git add apps/admin/src/App.tsx && git commit -m "feat(admin): route-ify the page Designer and post editor mount points"`

---

# Phase 2: Categories

## Task 5: `categories` table + `posts.categoryId` in schema.ts

**Files:** Modify `apps/api/src/db/schema.ts`

- [ ] **Step 1:** Insert directly before `export const posts = pgTable(...)` (line 22):

```ts
// Real taxonomy table (unlike posts.tags, which stays freeform) — a post's
// category is a managed, renameable, FK'd reference, not a repeated string.
// ON DELETE RESTRICT on posts.categoryId (below) is the "can't delete a
// category that's in use" rule — enforced by Postgres, no app-level check.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

```

- [ ] **Step 2:** Replace `category: text("category"),` in `posts` with `categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),`. Update the stale comment above it (lines 31-33) to: `// Category is a real FK into \`categories\` (a managed taxonomy) — tags stay\n  // freeform text, no separate tags table; good enough for a per-tenant blog\n  // without inventing a managed-list UI for tags nobody asked for.` `postRevisions.category` (line 62) stays unchanged — a text snapshot on purpose (Task 8 explains why).
- [ ] **Step 3:** Verify: `pnpm --filter @usim-cms/api typecheck` — passes.
- [ ] **Step 4:** Commit: `git add apps/api/src/db/schema.ts && git commit -m "feat(api): add categories table, replace posts.category with posts.categoryId FK"`

---

## Task 6: Migration `0010_categories.sql`

**Files:** Create `apps/api/src/db/migrations/0010_categories.sql`

- [ ] **Step 1:** Write (mirrors `0009`/`0003`'s exact hand-written conventions):

```sql
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"slug" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Backfill: one category row per distinct existing posts.category value.
INSERT INTO "categories" ("name", "slug")
SELECT DISTINCT "category",
  trim(both '-' from regexp_replace(lower("category"), '[^a-z0-9]+', '-', 'g'))
FROM "posts"
WHERE "category" IS NOT NULL AND "category" != ''
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "categories"("id") ON DELETE RESTRICT;

UPDATE "posts" SET "category_id" = "categories"."id"
FROM "categories"
WHERE "posts"."category" = "categories"."name" AND "posts"."category_id" IS NULL;

ALTER TABLE "posts" DROP COLUMN IF EXISTS "category";

-- Public reference data — unrestricted SELECT; writes follow the same
-- defense-in-depth pattern as every other tenant table.
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select" ON "categories";
CREATE POLICY "categories_select" ON "categories" FOR SELECT USING (true);

DROP POLICY IF EXISTS "categories_insert" ON "categories";
CREATE POLICY "categories_insert" ON "categories" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "categories_update" ON "categories";
CREATE POLICY "categories_update" ON "categories" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "categories_delete" ON "categories";
CREATE POLICY "categories_delete" ON "categories" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
```

- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/api typecheck`. Then start the API against a real Postgres instance with a tenant that has posts with a `category` value, make one request to that tenant to trigger the lazy per-process migration replay (`apps/api/src/db/tenant-pool.ts`), then `psql` in: `SELECT * FROM categories;` should show one row per distinct prior value; `\d posts` should show `category_id`, no `category`.
- [ ] **Step 3:** Commit: `git add apps/api/src/db/migrations/0010_categories.sql && git commit -m "feat(api): migration for categories table and posts.category_id backfill"`

---

## Task 7: Generic FK-violation → 409 in `generic-crud.ts`

**Files:** Modify `apps/api/src/plugins/generic-crud.ts:175-189`

- [ ] **Step 1:** Replace the `DELETE` handler:

```ts
  app.delete(`${base}/:id`, async (req, reply) => {
    if (!table) {
      reply.code(501);
      return { error: "not implemented" };
    }
    if (!(await checkAccess(config.access?.delete, req, reply))) return;
    const { id } = req.params as { id: string };
    try {
      const [item] = await req.db.delete(table).where(sql`id = ${id}`).returning();
      if (!item) {
        reply.code(404);
        return { error: "not found" };
      }
      return { deleted: true, id };
    } catch (err) {
      // Postgres FK-violation (e.g. categories.id RESTRICTed by posts.category_id)
      // — a clean, generic 409 for any collection this applies to.
      if ((err as { code?: string }).code === "23503") {
        reply.code(409);
        return { error: "still referenced by other records" };
      }
      throw err;
    }
  });
```

- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/api typecheck && pnpm --filter @usim-cms/api build`. Manual (once Task 8 exists): delete an in-use category → expect `409`; delete an unused one → expect `200`.
- [ ] **Step 3:** Commit: `git add apps/api/src/plugins/generic-crud.ts && git commit -m "fix(api): return 409 instead of 500 when deleting a row still referenced by an FK"`

---

## Task 8: `categoriesCollection` + posts hooks/routes updated for `categoryId`

**Files:** Modify `apps/api/src/index.ts:766-799`, `:900-930`

- [ ] **Step 1:** Insert directly after `postsCollection`'s closing `};`:

```ts
const categoriesBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  record.updatedAt = new Date();
  return record;
};

// Gated on posts.* permissions (not a new categories.* resource) — managing
// categories is a sub-concern of managing posts.
const categoriesCollection: CollectionConfig = {
  slug: "categories",
  table: schema.categories,
  createSchema: {
    type: "object",
    required: ["name", "slug"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      slug: { type: "string", minLength: 1 },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "posts.update"),
    update: (a) => hasPermission(a, "posts.update"),
    delete: (a) => hasPermission(a, "posts.update"),
  },
  hooks: { beforeChange: categoriesBeforeChange },
};
```

- [ ] **Step 2:** Add `registerPublicCollectionRoutes(publicScope, categoriesCollection);` directly after the existing `registerPublicCollectionRoutes(publicScope, postsCollection);` (line 833), and `registerProtectedCollectionRoutes(protectedScope, categoriesCollection);` directly after `registerProtectedCollectionRoutes(protectedScope, postsCollection);` (line 878).
- [ ] **Step 3:** In `postsCollection.createSchema` (line 780), change `category: { type: "string" },` to `categoryId: { type: ["string", "null"] },`.
- [ ] **Step 4:** Replace `postsAfterChange` (lines 749-764):

```ts
const postsAfterChange = async (item: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const requested = (req.body as Record<string, unknown>)?.status;
  if (requested !== "published" && requested !== "private") return;
  const row = item as Record<string, unknown>;
  let categoryName: string | null = null;
  if (row.categoryId) {
    const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.id, row.categoryId as string));
    categoryName = cat?.name ?? null;
  }
  await req.db.insert(schema.postRevisions).values({
    postId: row.id as string,
    title: row.title as string,
    body: row.body as string,
    excerpt: row.excerpt as string | null,
    bannerImageUrl: row.bannerImageUrl as string | null,
    category: categoryName,
    tags: (row.tags as string[]) ?? [],
    status: row.status as string,
    publishedAt: row.publishedAt as Date | null,
  });
};
```

- [ ] **Step 5:** In the restore route (lines 900-930), before the `update` call, resolve name back to id:

```ts
    // Revision's category is a name snapshot — if a category with that exact
    // name still exists, restore points at it; if renamed/deleted since,
    // this goes to uncategorized rather than guessing (same known-ceiling
    // tradeoff as the bookmark card snapshot in Phase 4).
    let categoryId: string | null = null;
    if (revision.category) {
      const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.name, revision.category));
      categoryId = cat?.id ?? null;
    }
```

then change the `.set({ ... })` call's `category: revision.category,` to `categoryId,`.

- [ ] **Step 6:** Verify: `pnpm --filter @usim-cms/api typecheck && pnpm --filter @usim-cms/api build`. Manual: `curl -X POST http://localhost:3000/api/categories -H "x-tenant-host: <host>" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":"News","slug":"news"}'` → `201`; `curl http://localhost:3000/api/categories -H "x-tenant-host: <host>"` (no auth) → `200` list.
- [ ] **Step 7:** Commit: `git add apps/api/src/index.ts && git commit -m "feat(api): register categories collection, resolve categoryId<->name for revision snapshot/restore"`

---

## Task 9: Admin API client — categories

**Files:** Modify `apps/admin/src/lib/api.ts`

- [ ] **Step 1:** Insert after `restorePostRevision` (line 143):

```ts
export interface Category {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export const listCategories = (tenantHost: string, token: string) =>
  request("/api/categories", tenantHost, token).then((b) => b.items as Category[]);

export const createCategory = (tenantHost: string, token: string, name: string, slug: string) =>
  request("/api/categories", tenantHost, token, { method: "POST", body: JSON.stringify({ name, slug }) }).then((b) => b.item as Category);

export const updateCategory = (tenantHost: string, token: string, id: string, name: string) =>
  request(`/api/categories/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify({ name }) });

export const deleteCategory = (tenantHost: string, token: string, id: string) =>
  request(`/api/categories/${id}`, tenantHost, token, { method: "DELETE" });
```

- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/admin typecheck` — passes.
- [ ] **Step 3:** Commit: `git add apps/admin/src/lib/api.ts && git commit -m "feat(admin): add categories API client functions"`

---

## Task 10: `CategoriesPanel` + route

**Files:** Create `apps/admin/src/CategoriesPanel.tsx`; modify `apps/admin/src/App.tsx`, `apps/admin/src/i18n.ts`

- [ ] **Step 1:** Add `export` to `I18nCtx` (App.tsx:67), `useT` (:71), `inputCls` (:74), `btnPrimary` (:76), `btnGhost` (:78), `card` (:80) — six single-word insertions, no other change.
- [ ] **Step 2:** Write `apps/admin/src/CategoriesPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import { useT, inputCls, btnPrimary, btnGhost, card } from "./App";
import { slugify } from "@/lib/utils";

export default function CategoriesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCategories(await api.listCategories(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void refresh(); }, [tenantHost]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await api.createCategory(tenantHost, token, trimmed, slugify(trimmed));
      setName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateCategory(tenantHost, token, id, trimmed);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("categories-delete-confirm"))) return;
    try {
      await api.deleteCategory(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/content/posts" className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("posts-title")}
      </Link>
      <h2 className="font-display text-sm font-semibold text-ink">{t("categories-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} flex gap-2 p-4`}>
        <input className={inputCls} placeholder={t("categories-name")} value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={creating} className={`${btnPrimary} shrink-0`}>
          {creating ? t("categories-creating") : t("categories-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-xs">
            {editingId === c.id ? (
              <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void rename(c.id)} autoFocus />
            ) : (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{c.name}</span>
                <span className="font-mono text-sub">/{c.slug}</span>
              </span>
            )}
            <span className="flex items-center gap-3">
              {editingId === c.id ? (
                <>
                  <button onClick={() => void rename(c.id)} className={btnPrimary}>{t("categories-save")}</button>
                  <button onClick={() => setEditingId(null)} className={btnGhost}>{t("categories-cancel")}</button>
                </>
              ) : (
                <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} className="rounded p-1 text-body hover:bg-canvas" title={t("categories-rename")}>
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => void remove(c.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("categories-delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
        {categories.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("categories-empty")}</li>}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3:** Add i18n keys — `ms`: `"categories-title": "Kategori", "categories-name": "nama kategori", "categories-create": "Cipta kategori", "categories-creating": "Mencipta...", "categories-save": "Simpan", "categories-cancel": "Batal", "categories-rename": "Tukar nama", "categories-delete": "Padam", "categories-delete-confirm": "Padam kategori ini?", "categories-empty": "Tiada kategori lagi."`. `en`: `"categories-title": "Categories", "categories-name": "category name", "categories-create": "Create category", "categories-creating": "Creating...", "categories-save": "Save", "categories-cancel": "Cancel", "categories-rename": "Rename", "categories-delete": "Delete", "categories-delete-confirm": "Delete this category?", "categories-empty": "No categories yet."`
- [ ] **Step 4:** In `PostsPanel`'s heading (App.tsx:1001-1003), wrap in a flex row with a link: `<div className="flex items-center justify-between"><h2 ...>{existing heading content}</h2><Link to="categories" className="text-xs font-semibold text-accent hover:underline">{t("categories-title")}</Link></div>`.
- [ ] **Step 5:** In `ContentManager`'s `<Routes>`, add — **before** the `posts/:id` route (ordering matters, the literal path must be checked before the `:id` param route): `<Route path="posts/categories" element={<CategoriesPanel tenantHost={siteHost} token={token} />} />`. Add `import CategoriesPanel from "./CategoriesPanel";` at the top of `App.tsx`.
- [ ] **Step 6:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build`. Manual: open Posts → Categories, create/rename one, try deleting one in use (once Task 11 lands) and confirm the 409 message surfaces.
- [ ] **Step 7:** Commit: `git add apps/admin/src/App.tsx apps/admin/src/CategoriesPanel.tsx apps/admin/src/i18n.ts && git commit -m "feat(admin): add category management panel and route"`

---

## Task 11: Wire the existing `PostEditor`/`PostsPanel` to real categories

**Files:** Modify `apps/admin/src/App.tsx` (`PostEditor`, `PostsPanel`, `PostEditorRoute`)

This is intentionally throwaway — Phase 3 Task 15 deletes `PostEditor` entirely, replaced by `PostEditorPage`'s typeahead. Exists only so Phase 2 is independently shippable.

- [ ] **Step 1:** In `PostEditor`, change the props type's `categoryOptions: string[]` to `categories: api.Category[]`, and `const [category, setCategory] = useState((post.category as string | null) ?? "");` to `const [categoryId, setCategoryId] = useState((post.categoryId as string | null) ?? "");`. In `save()`, change `category: category.trim() || null,` to `categoryId: categoryId || null,`. Replace the `<input list=.../><datalist>` category block with:

```tsx
        <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("posts-category")}</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
```

- [ ] **Step 2:** In `PostsPanel`, replace the `categoryOptions` `useMemo` with:

```tsx
  const [categories, setCategories] = useState<api.Category[]>([]);
  useEffect(() => { void api.listCategories(tenantHost, token).then(setCategories); }, [tenantHost]);
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;
```

Replace the row badge (`{(p.category as string | null) && (...)}`) with:

```tsx
                  {categoryName(p.categoryId as string | null) && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                      {categoryName(p.categoryId as string | null)}
                    </span>
                  )}
```

- [ ] **Step 3:** In `PostEditorRoute` (Task 4), replace the `categoryOptions` computation with a direct fetch and pass `categories` instead:

```tsx
function PostEditorRoute({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Array<Record<string, unknown>> | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  useEffect(() => {
    void api.getPosts(tenantHost, token).then(setPosts);
    void api.listCategories(tenantHost, token).then(setCategories);
  }, [tenantHost, id]);
  if (posts === null) return null;
  const post = posts.find((p) => p.id === id);
  if (!post) return <p className="text-xs text-sub">{t("posts-empty")}</p>;
  return <PostEditor key={post.id as string} post={post} tenantHost={tenantHost} token={token} categories={categories} onClose={() => navigate("/content/posts")} onSaved={() => navigate("/content/posts")} />;
}
```

- [ ] **Step 4:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build`. Manual: select a category on a post, save, confirm list badge shows the name; publish, confirm `post_revisions` snapshots the name as text.
- [ ] **Step 5:** Commit: `git add apps/admin/src/App.tsx && git commit -m "feat(admin): wire post editor and list to real FK'd categories"`

---

# Phase 3: Full-page Post Editor

## Task 12: Export shared helpers (skip if Task 10 Step 1 already did it)

- [ ] **Step 1:** Confirm `I18nCtx`/`useT`/`inputCls`/`btnPrimary`/`btnGhost`/`card` are exported. If not, add `export` to each (App.tsx:67,71,74,76,78,80).
- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/admin typecheck`.
- [ ] **Step 3:** Commit only if Step 1 made changes: `git add apps/admin/src/App.tsx && git commit -m "refactor(admin): export shared UI helpers for reuse by new post-editor components"`

---

## Task 13: Posts preview-token route

**Files:** Modify `apps/api/src/index.ts` (~line 877), `apps/admin/src/lib/api.ts` (~line 93)

- [ ] **Step 1:** Directly after the pages preview-token route, before `registerProtectedCollectionRoutes(protectedScope, postsCollection);`:

```ts
  // Same shape as the pages preview-token route above — posts had none,
  // which made a Preview button dead for Draft/Private posts.
  protectedScope.post("/api/posts/:id/preview-token", async (req) => {
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
    });
    return { token };
  });
```

- [ ] **Step 2:** In `apps/admin/src/lib/api.ts`, after `getPagePreviewToken`:

```ts
export const getPostPreviewToken = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}/preview-token`, tenantHost, token, { method: "POST" }).then((b) => b.token as string);
```

- [ ] **Step 3:** Verify: `pnpm --filter @usim-cms/api typecheck && pnpm --filter @usim-cms/admin typecheck`. Manual: `curl -X POST http://localhost:3000/api/posts/<id>/preview-token -H "x-tenant-host: <host>" -H "Authorization: Bearer <token>"` → `200 { "token": "..." }`.
- [ ] **Step 4:** Commit: `git add apps/api/src/index.ts apps/admin/src/lib/api.ts && git commit -m "feat(api): add posts preview-token route, mirroring the existing pages one"`

---

## Task 14: `MediaPickerModal`

**Files:** Create `apps/admin/src/MediaPickerModal.tsx`; modify `apps/admin/src/i18n.ts`

- [ ] **Step 1:** Write:

```tsx
import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import * as api from "@/lib/api";
import { useT, btnPrimary, btnGhost } from "./App";

export default function MediaPickerModal({
  tenantHost, token, onSelect, onClose,
}: { tenantHost: string; token: string; onSelect: (url: string) => void; onClose: () => void }) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listMedia(tenantHost, token).then(setItems).catch((err) => setError((err as Error).message));
  }, [tenantHost]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const url = await api.uploadMedia(tenantHost, token, file);
      onSelect(url.startsWith("http") ? url : api.API_URL + url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{t("media-picker-title")}</h3>
          <button onClick={onClose} className="rounded p-1 text-sub hover:bg-canvas"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={`${btnPrimary} flex items-center gap-1.5 self-start`}>
          <Upload className="h-3.5 w-3.5" /> {uploading ? t("media-picker-uploading") : t("media-picker-upload-new")}
        </button>
        <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto">
          {items.filter((m) => (m.mimeType as string).startsWith("image/")).map((m) => (
            <button key={m.id as string} onClick={() => onSelect(m.url as string)} className="group relative aspect-square overflow-hidden rounded-lg border border-line/30 hover:border-accent">
              <img src={m.url as string} alt={(m.altText as string) ?? ""} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <button onClick={onClose} className={`${btnGhost} self-end`}>{t("media-picker-cancel")}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** i18n — `ms`: `"media-picker-title": "Pilih gambar", "media-picker-upload-new": "Muat naik baru", "media-picker-uploading": "Memuat naik...", "media-picker-cancel": "Batal"`. `en`: `"media-picker-title": "Choose an image", "media-picker-upload-new": "Upload new", "media-picker-uploading": "Uploading...", "media-picker-cancel": "Cancel"`
- [ ] **Step 3:** Verify: `pnpm --filter @usim-cms/admin typecheck`.
- [ ] **Step 4:** Commit: `git add apps/admin/src/MediaPickerModal.tsx apps/admin/src/i18n.ts && git commit -m "feat(admin): add reusable MediaPickerModal"`

---

## Task 15: `PostEditorPage` — the full-page editor

**Files:** Create `apps/admin/src/PostEditorPage.tsx`; modify `apps/admin/src/App.tsx`, `apps/admin/src/i18n.ts`

This **replaces** the `/content/posts/:id` route element — `PostEditorRoute` and the Phase-2-updated `PostEditor`/`PostHistory` are deleted from `App.tsx`, superseded entirely by this file.

- [ ] **Step 1:** Cut `PostHistory` (App.tsx, currently ~lines 715-780) verbatim into the top of the new file; delete it from `App.tsx`. Cut `EditorToolbar` (~lines 629-707) the same way (it's currently only used by the old `PostEditor` being deleted — move it into this new file too, unless `BlockBuilder`'s pages editor also uses it; if it does, add `export` to it in `App.tsx` instead of moving it, and `import { EditorToolbar } from "./App";` here).
- [ ] **Step 2:** Delete `PostEditor` and `PostEditorRoute` entirely from `App.tsx`.
- [ ] **Step 3:** Write `apps/admin/src/PostEditorPage.tsx` (full-page layout: toolbar with back/status pill/preview/publish-dropdown/save/panel-toggle; feature-image band; auto-grow title; excerpt; BlockNote body; toggleable right settings panel with category typeahead-with-create, tags, status buttons, metadata, collapsible history):

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { ArrowLeft, ExternalLink, History, ImagePlus, Settings2, X } from "lucide-react";
import * as api from "@/lib/api";
import { useT, inputCls, btnPrimary, btnGhost, EditorToolbar } from "./App";
import MediaPickerModal from "./MediaPickerModal";

function PostHistory({ tenantHost, token, postId, onRestored }: { tenantHost: string; token: string; postId: string; onRestored: () => void }) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<api.PostRevision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.listPostRevisions(tenantHost, token, postId).then(setRevisions).catch((err) => setError((err as Error).message)).finally(() => setLoaded(true));
  }, [postId]);
  async function restore(revisionId: string) {
    if (!confirm(t("posts-restore-confirm"))) return;
    try {
      await api.restorePostRevision(tenantHost, token, postId, revisionId);
      onRestored();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-line/30 bg-canvas/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink"><History className="h-3.5 w-3.5" /> {t("posts-history")}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {loaded && revisions.length === 0 && <p className="text-[11px] text-sub">{t("posts-history-empty")}</p>}
      <ul className="divide-y divide-line/20">
        {revisions.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-sub">{new Date(r.createdAt).toLocaleString()} · {r.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "private" ? "bg-violet-500/10 text-violet-700" : "bg-ok/10 text-ok"}`}>
              {r.status === "private" ? t("posts-private") : t("posts-published")}
            </span>
            <button onClick={() => void restore(r.id)} className="flex items-center gap-1 font-semibold text-accent hover:underline">{t("posts-restore")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PostStatus = "draft" | "published" | "private";

export default function PostEditorPage({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Array<Record<string, unknown>> | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useMemo(() => posts?.find((p) => p.id === id), [posts, id]);

  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PostStatus>("draft");

  useEffect(() => {
    void api.getPosts(tenantHost, token).then(setPosts);
    void api.listCategories(tenantHost, token).then(setCategories);
  }, [tenantHost, id]);

  useEffect(() => {
    if (!post) return;
    setTitle(post.title as string);
    setExcerpt((post.excerpt as string | null) ?? "");
    setCategoryId((post.categoryId as string | null) ?? "");
    setTagsInput(((post.tags as string[] | null) ?? []).join(", "));
    setBannerImageUrl((post.bannerImageUrl as string | null) ?? null);
    setStatus((post.status as PostStatus) || "draft");
  }, [post]);

  const editor = useCreateBlockNote({
    uploadFile: async (file: File) => {
      const url = await api.uploadMedia(tenantHost, token, file);
      return url.startsWith("http") ? url : api.API_URL + url;
    },
  });

  useEffect(() => {
    if (!post) return;
    const blocks = editor.tryParseHTMLToBlocks((post.body as string) || "");
    editor.replaceBlocks(editor.document, blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  async function save(nextStatus?: PostStatus) {
    if (!post) return;
    setSaving(true);
    try {
      const tags = [...new Set(tagsInput.split(",").map((s) => s.trim()).filter(Boolean))];
      await api.updatePost(tenantHost, token, post.id as string, {
        title, excerpt, categoryId: categoryId || null, tags, bannerImageUrl,
        body: await editor.blocksToHTMLLossy(editor.document),
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

  async function createCategoryInline() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    try {
      const created = await api.createCategory(tenantHost, token, trimmed, trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      setCategories((prev) => [...prev, created]);
      setCategoryId(created.id);
      setNewCategoryName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function share() {
    if (!post) return;
    try {
      await api.sharePost(tenantHost, token, post.id as string);
      alert(t("posts-shared"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function preview() {
    if (!post) return;
    const win = window.open("", "_blank", "noreferrer");
    if (!win) return;
    try {
      const previewToken = await api.getPostPreviewToken(tenantHost, token, post.id as string);
      win.location.href = api.previewUrl(tenantHost, `posts/${post.slug as string}`, previewToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  if (posts === null) return null;
  if (!post) return <p className="p-8 text-xs text-sub">{t("posts-empty")}</p>;

  const statusBadge: Record<PostStatus, string> = { draft: "bg-warn/10 text-warn", published: "bg-ok/10 text-ok", private: "bg-violet-500/10 text-violet-700" };
  const otherStatuses = (current: PostStatus): PostStatus[] => (["draft", "published", "private"] as PostStatus[]).filter((s) => s !== current);
  const statusActionKey: Record<PostStatus, api.Key> = { draft: "posts-set-draft" as api.Key, published: "posts-publish" as api.Key, private: "posts-make-private" as api.Key };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-line/40 px-6 py-3">
        <button onClick={() => navigate("/content/posts")} className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ArrowLeft className="h-4 w-4" /></button>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadge[status]}`}>{t(`posts-${status}` as api.Key)}</span>
        <span className="flex-1" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={() => void preview()} className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /> {t("posts-preview")}</button>
        {otherStatuses(status).map((s) => (<button key={s} onClick={() => void save(s)} disabled={saving} className={btnGhost}>{t(statusActionKey[s])}</button>))}
        <button onClick={() => void save()} disabled={saving} className={btnPrimary}>{saving ? t("blocks-saving") : t("posts-save")}</button>
        <button onClick={() => setPanelOpen((v) => !v)} className="rounded p-1.5 text-body hover:bg-canvas" title={t("posts-settings")}><Settings2 className="h-4 w-4" /></button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-8">
            {bannerImageUrl ? (
              <div className="group relative">
                <img src={bannerImageUrl} alt="" className="h-64 w-full rounded-lg object-cover" />
                <button onClick={() => setBannerImageUrl(null)} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button onClick={() => setShowMediaPicker(true)} className="flex h-32 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line/40 text-xs font-semibold text-sub hover:border-accent hover:text-accent">
                <ImagePlus className="h-4 w-4" /> {t("posts-add-feature-image")}
              </button>
            )}
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={1} placeholder={t("posts-title-placeholder")} className="w-full resize-none border-0 font-display text-3xl font-bold text-ink outline-none" onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }} />
            <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder={t("posts-excerpt")} className="w-full border-0 text-sm text-sub outline-none" />
            <div>
              <EditorToolbar editor={editor} />
              <div className="rounded-b-lg border border-line/30 bg-white py-2 [&_.bn-editor]:min-h-[400px]">
                <BlockNoteView editor={editor} theme="light" />
              </div>
            </div>
          </div>
        </div>
        {panelOpen && (
          <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-line/30 bg-canvas/30 p-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-category")}</label>
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t("posts-category-none")}</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
              <div className="flex gap-1.5 pt-1">
                <input className={inputCls} placeholder={t("posts-new-category")} value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void createCategoryInline()} />
                <button onClick={() => void createCategoryInline()} className={`${btnGhost} shrink-0`}>{t("categories-create")}</button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-tags")}</label>
              <input className={inputCls} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
            </div>
            {status === "published" && (<button onClick={() => void share()} className={`${btnGhost} w-full`}>{t("posts-share")}</button>)}
            {(post.authorEmail as string | null) && (<p className="text-[11px] text-sub">{t("posts-author")}: {post.authorEmail as string}</p>)}
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-sub hover:bg-canvas">
              <History className="h-3.5 w-3.5" /> {t("posts-history")}
            </button>
            {showHistory && (<PostHistory tenantHost={tenantHost} token={token} postId={post.id as string} onRestored={() => void api.getPosts(tenantHost, token).then(setPosts)} />)}
          </aside>
        )}
      </div>
      {showMediaPicker && (<MediaPickerModal tenantHost={tenantHost} token={token} onSelect={(url) => { setBannerImageUrl(url); setShowMediaPicker(false); }} onClose={() => setShowMediaPicker(false)} />)}
    </div>
  );
}
```

- [ ] **Step 4:** In `ContentManager`'s `<Routes>`, change `<Route path="posts/:id" element={<PostEditorRoute .../>} />` to `<Route path="posts/:id" element={<PostEditorPage tenantHost={siteHost} token={token} />} />`. Add `import PostEditorPage from "./PostEditorPage";`.
- [ ] **Step 5:** In `PostsPanel`'s row action buttons, remove the `otherStatuses(status).map(...)` block (now redundant with the editor's own status controls) — keep the status badge, "Share" (when published), "Edit" link, and "Delete" button as-is.
- [ ] **Step 6:** i18n — `ms`: `"posts-settings": "Tetapan", "posts-preview": "Pratonton", "posts-add-feature-image": "+ Tambah gambar utama", "posts-title-placeholder": "Tajuk post", "posts-category-none": "Tiada kategori", "posts-new-category": "kategori baru"`. `en`: `"posts-settings": "Settings", "posts-preview": "Preview", "posts-add-feature-image": "+ Add feature image", "posts-title-placeholder": "Post title", "posts-category-none": "No category", "posts-new-category": "new category"`
- [ ] **Step 7:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build`. Manual (`pnpm dev:admin` + `pnpm dev:api`): create a post, confirm the full-page editor opens; set a feature image (upload + pick from library); type title/excerpt/body; toggle the panel; create a category inline; publish and confirm the status pill + Share button; open History and Restore; click Preview and confirm it opens (draft/private too).
- [ ] **Step 8:** Commit: `git add apps/admin/src/App.tsx apps/admin/src/PostEditorPage.tsx apps/admin/src/i18n.ts && git commit -m "feat(admin): full-page Ghost-style post editor with toggleable settings panel"`

---

# Phase 4: Bookmark card (`@`)

## Task 16: `GET /api/content-search` route

**Files:** Modify `apps/api/src/index.ts`

- [ ] **Step 1:** Insert in the protected scope, after the posts revision-restore route:

```ts
  // Cross-collection search for the admin's @-mention bookmark-card feature —
  // spans posts+pages, which generic-crud's per-table routes can't do. Own
  // tenant only, no shared_content.
  protectedScope.get("/api/content-search", async (req) => {
    const { q } = req.query as { q?: string };
    const query = (q ?? "").trim();
    if (!query) return { items: [] };
    const like = `%${query}%`;
    const matchedPosts = await req.db.select().from(schema.posts).where(sql`${schema.posts.title} ILIKE ${like}`).limit(10);
    const matchedPages = await req.db.select().from(schema.pages).where(sql`${schema.pages.title} ILIKE ${like}`).limit(10);
    const items = [
      ...matchedPosts.map((p) => ({ type: "post" as const, id: p.id, title: p.title, excerpt: p.excerpt, bannerImageUrl: p.bannerImageUrl, url: `https://${req.tenantHost}/posts/${p.slug}` })),
      ...matchedPages.map((p) => ({ type: "page" as const, id: p.id, title: p.title, excerpt: null, bannerImageUrl: p.bannerImageUrl, url: `https://${req.tenantHost}/${p.slug}` })),
    ];
    return { items };
  });
```

Confirm `sql` is already imported from `drizzle-orm` at the top of `index.ts` (used elsewhere) — add it if missing.

- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/api typecheck && pnpm --filter @usim-cms/api build`. Manual: `curl "http://localhost:3000/api/content-search?q=intro" -H "x-tenant-host: <host>" -H "Authorization: Bearer <token>"` → `200` with tagged matches.
- [ ] **Step 3:** Commit: `git add apps/api/src/index.ts && git commit -m "feat(api): add cross-collection content-search route for internal-link mentions"`

---

## Task 17: Admin client — `searchContent`

**Files:** Modify `apps/admin/src/lib/api.ts`

- [ ] **Step 1:**

```ts
export interface ContentSearchResult {
  type: "post" | "page";
  id: string;
  title: string;
  excerpt: string | null;
  bannerImageUrl: string | null;
  url: string;
}

export const searchContent = (tenantHost: string, token: string, q: string) =>
  request(`/api/content-search?q=${encodeURIComponent(q)}`, tenantHost, token).then((b) => b.items as ContentSearchResult[]);
```

- [ ] **Step 2:** Verify: `pnpm --filter @usim-cms/admin typecheck`.
- [ ] **Step 3:** Commit: `git add apps/admin/src/lib/api.ts && git commit -m "feat(admin): add searchContent API client function"`

---

## Task 18: `bookmarkCard` BlockNote custom block

**Files:** Create `apps/admin/src/blocknote/bookmarkCard.tsx`

- [ ] **Step 1 (verify the API before writing against it):** Run `grep -r "createReactBlockSpec\|BlockNoteSchema\|defaultBlockSpecs" node_modules/@blocknote/react/dist/*.d.ts node_modules/@blocknote/core/dist/*.d.ts 2>/dev/null | head -20`. Expected: all three present (this project pins `@blocknote/*` at `^0.51.4`, `apps/admin/package.json:13-15`, and these are BlockNote's stable public custom-block APIs). If any signature in the `.d.ts` differs from Step 2 below, adjust Step 2 to match what's actually installed — do not guess past the type defs.
- [ ] **Step 2:** Write:

```tsx
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

// Snapshot captured at insert time — not live-refetched on render. Known
// ceiling: if the source post/page is later renamed/deleted, the card shows
// a stale snapshot. Acceptable for v1; upgrade path is a background re-sync
// job if this becomes a real complaint.
export const bookmarkCardBlockSpec = createReactBlockSpec(
  {
    type: "bookmarkCard",
    propSchema: {
      targetType: { default: "post" as const, values: ["post", "page"] as const },
      targetId: { default: "" },
      title: { default: "" },
      excerpt: { default: "" },
      imageUrl: { default: "" },
      url: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const { title, excerpt, imageUrl, url, targetType } = block.props;
      return (
        <a href={url} target="_blank" rel="noreferrer" style={{ display: "flex", gap: "12px", border: "1px solid #e2e2e2", borderRadius: "8px", padding: "12px", textDecoration: "none", color: "inherit", width: "100%" }}>
          {imageUrl && (<img src={imageUrl} alt="" style={{ width: "96px", height: "72px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />)}
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "inline-block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: "#6b7280", marginBottom: "4px" }}>
              {targetType === "post" ? "Post" : "Page"}
            </span>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>{title}</div>
            {excerpt && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{excerpt}</div>}
          </div>
        </a>
      );
    },
    // Self-contained inline-styled HTML — post bodies are stored/rendered as
    // raw sanitized HTML already, so this requires zero apps/frontend changes.
    toExternalHTML: ({ block }) => {
      const { title, excerpt, imageUrl, url, targetType, targetId } = block.props;
      const img = imageUrl ? `<img src="${imageUrl}" alt="" style="width:96px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0" />` : "";
      const excerptHtml = excerpt ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${excerpt}</div>` : "";
      const html = `<a href="${url}" data-bookmark-type="${targetType}" data-bookmark-id="${targetId}" data-bookmark-title="${title}" data-bookmark-excerpt="${excerpt}" data-bookmark-image="${imageUrl}" data-bookmark-url="${url}" style="display:flex;gap:12px;border:1px solid #e2e2e2;border-radius:8px;padding:12px;text-decoration:none;color:inherit;width:100%">${img}<div style="min-width:0;flex:1"><span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:4px">${targetType === "post" ? "Post" : "Page"}</span><div style="font-weight:600;font-size:14px">${title}</div>${excerptHtml}</div></a>`;
      const div = document.createElement("div");
      div.innerHTML = html;
      return { dom: div.firstElementChild as HTMLElement };
    },
    parse: (el) => {
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-bookmark-type")) return undefined;
      return {
        targetType: (el.getAttribute("data-bookmark-type") as "post" | "page") ?? "post",
        targetId: el.getAttribute("data-bookmark-id") ?? "",
        title: el.getAttribute("data-bookmark-title") ?? "",
        excerpt: el.getAttribute("data-bookmark-excerpt") ?? "",
        imageUrl: el.getAttribute("data-bookmark-image") ?? "",
        url: el.getAttribute("data-bookmark-url") ?? "",
      };
    },
  },
);

export const bookmarkCardSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, bookmarkCard: bookmarkCardBlockSpec },
});
```

- [ ] **Step 3:** Verify: `pnpm --filter @usim-cms/admin typecheck`. If the `propSchema`/`render`/`toExternalHTML`/`parse` shape doesn't match installed types, fix against the actual `.d.ts` from Step 1 — don't suppress the error.
- [ ] **Step 4:** Commit: `git add apps/admin/src/blocknote/bookmarkCard.tsx && git commit -m "feat(admin): add bookmarkCard BlockNote block"`

---

## Task 19: Wire the `@` suggestion menu into `PostEditorPage`

**Files:** Modify `apps/admin/src/PostEditorPage.tsx`

- [ ] **Step 1:** Change `useCreateBlockNote({ ... })` to `useCreateBlockNote({ schema: bookmarkCardSchema, uploadFile: ... })` (keep the existing `uploadFile` body). Add `import { bookmarkCardSchema } from "./blocknote/bookmarkCard";`.
- [ ] **Step 2 (verify the API before writing against it):** Run `grep -r "SuggestionMenuController\|triggerCharacter" node_modules/@blocknote/react/dist/*.d.ts 2>/dev/null | head -10`. Expected: both present. Adjust Step 3 if the installed signature differs.
- [ ] **Step 3:** Wrap the existing `<BlockNoteView editor={editor} theme="light" />` self-closing tag into an open/close pair with a child controller:

```tsx
<BlockNoteView editor={editor} theme="light">
  <SuggestionMenuController
    triggerCharacter="@"
    getItems={async (query) => {
      const results = await api.searchContent(tenantHost, token, query);
      return results.map((r) => ({
        title: r.title,
        subtext: r.type === "post" ? t("posts-title") : t("pages-title"),
        onItemClick: () => {
          editor.insertBlocks(
            [{ type: "bookmarkCard", props: { targetType: r.type, targetId: r.id, title: r.title, excerpt: r.excerpt ?? "", imageUrl: r.bannerImageUrl ?? "", url: r.url } } as never],
            editor.getTextCursorPosition().block,
            "after",
          );
        },
      }));
    }}
  />
</BlockNoteView>
```

Add `import { SuggestionMenuController } from "@blocknote/react";`.

- [ ] **Step 4:** Verify: `pnpm --filter @usim-cms/admin typecheck && pnpm --filter @usim-cms/admin build` — if `insertBlocks`'s signature or the item shape doesn't match installed types, fix against the `.d.ts`. Manual: type `@` + a title fragment in the post body, confirm the menu, pick a result, confirm the card renders inline, save, reload the editor, confirm it round-trips as a card (not raw HTML); check it renders correctly on the published frontend page too.
- [ ] **Step 5:** Commit: `git add apps/admin/src/PostEditorPage.tsx && git commit -m "feat(admin): wire @ suggestion menu for internal-link bookmark cards"`

---

## Task 20: Update `CLAUDE.md`

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1:** In the `apps/admin` bullet, document `react-router-dom`, the route map, and that Designer/the post editor are routes now, not conditional mounts.
- [ ] **Step 2:** In the `apps/api` bullet's `posts` paragraph, replace the "freeform category" description with the `categories` table, `posts.categoryId` FK + `ON DELETE RESTRICT`, the generic FK-violation → 409 in `generic-crud.ts`, and that `post_revisions.category` stays a denormalized text snapshot on purpose.
- [ ] **Step 3:** In the `apps/admin` Posts paragraph, replace the "inline-expand-under-row" description with `PostEditorPage`, its settings panel, `MediaPickerModal`, and the `@`-mention bookmark card + its snapshot/staleness tradeoff. In `apps/api`, add the posts preview-token route and `/api/content-search` to the hand-written-exception routes list.
- [ ] **Step 4:** Read the diff for coherence with surrounding text — no placeholders/TODOs.
- [ ] **Step 5:** Commit: `git add CLAUDE.md && git commit -m "docs: document post editor overhaul (router, categories, full-page editor, bookmark links)"`

---

## Self-Review Notes

- **Spec coverage:** Every design-doc phase has tasks (1-4 → Tasks 1-4, 5-11, 12-15, 16-19; docs → Task 20). Non-goals (no autosave, own-tenant-only search, no live bookmark refresh) are respected by omission — no task adds any of them.
- **Placeholder scan:** No task defers logic with vague language; the two `.d.ts`-verification steps (Tasks 18/19) are explicit anti-hallucination checks against a real third-party API, not placeholders for unwritten logic.
- **Type consistency:** `PostEditor`'s throwaway `categoryOptions: string[]` (Task 11) is explicitly superseded, not incrementally renamed, by `PostEditorPage`'s own `categoryId`/`categories` state (Task 15) — called out in each task so it isn't mistaken for a signature mismatch. `api.Category`/`api.ContentSearchResult` are defined once (Tasks 9/17) and referenced by that name everywhere downstream.
