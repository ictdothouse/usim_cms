# Menu Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a webmaster create/edit/delete navigation menus (nested submenus + mega-menu columns, page/post/category/custom links, per-item translations) and place them anywhere via a new "Menu" Designer element.

**Architecture:** A new tenant-DB collection `menus` (jsonb item tree), managed through the standard `CollectionConfig`/generic-crud mechanism this codebase already uses for `pages`/`posts`/`categories`. A new admin panel (`MenusPanel` + `MenuItemsEditor`) edits the tree directly (not through Designer's per-field Inspector system — the tree is too structured for that). A new `"menu"` entry in Designer's `ELS` element registry lets an author drop a saved menu into any page/section/column; the Inspector only needs to pick *which* menu (`menuId`) and a few display options. `apps/frontend` resolves and renders the tree server-side in a new `MenuBlock.astro`, CSS-only for desktop dropdowns/mega-menu (`:hover`/`:focus-within`), with one small shared `<script>` for the mobile hamburger toggle.

**Tech Stack:** Fastify + Drizzle (apps/api), React + Vite + Tailwind (apps/admin), Astro (apps/frontend). No new dependencies.

## Global Constraints

- Tenant identity is always `req.tenantHost` / `x-tenant-host` header — never subdomain parsing.
- New collections are `CollectionConfig` objects registered through `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes` — no hand-written CRUD route files.
- Any new permission string (`menus.write`) must be added to **both** `apps/api/src/index.ts`'s `PERMISSIONS` set **and** `apps/admin/src/App.tsx`'s client-side `PERMISSIONS` const + Roles-editor checkbox list in the same task — a permission that exists only server-side can never be granted to a role from the UI (this exact bug already happened once with `languages.write`, see CLAUDE.md).
- Every prop value that ends up in a raw CSS string, `url()`, or href must be validated server-side in `validate-menu.ts`/`validate-layout.ts` — never trust the client.
- i18n: `apps/admin/src/i18n.ts` requires the exact same keys in both `ms` (default, first) and `en` — TypeScript's `Record<Key, string>` on `en` enforces this, so a missing key is a compile error, not a runtime surprise.
- Design spec for full context: `docs/superpowers/specs/2026-08-13-menu-header-footer-design.md`.

## Design refinement (decided during planning, not in the original spec)

The spec's `MenuItem.label` was described as "always mirrors the linked page/post/category's own title live, unless overridden." This plan simplifies that: **`label` is a plain, always-editable string, prefilled client-side from the linked item's title at the moment it's picked, then never auto-synced again.** This matches this codebase's existing convention for the exact same situation (slug auto-fill-then-editable in `PagesPanel`'s quick-create, and the recent "auto-fill code from name" language-label commit) and removes an entire class of live-resolution work from the frontend render path (no title lookups needed at all — only slug lookups for the href, when linking to a page/post/category). If a linked page is later renamed, the menu label does not silently change — the author edits it manually, same as they would a normal nav link on any other CMS.

---

### Task 1: `menus` table (schema + migration)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (add `menus` export, after the `categories` export block, before `posts`)
- Create: `apps/api/src/db/migrations/0018_menus.sql`

**Interfaces:**
- Produces: `schema.menus` (Drizzle `PgTable`) — columns `id, name, items (jsonb, default [])`, `createdAt`, `updatedAt`. Consumed by Task 3's `menusCollection`.

- [ ] **Step 1: Add the `menus` table to schema.ts**

Insert immediately after the `categories` export (after its closing `});`, before the `posts` export comment block):

```ts
// Navigation menus — a named, ordered tree of links an author builds once
// and places anywhere via the "menu" Designer element (see Designer.tsx's
// ELS registry). `items` is the full nested tree (top-level items, each
// optionally with `children` for a simple dropdown OR `megaMenu` for
// multi-column rich content) — never split into rows, there is nothing
// relational about a menu's structure. See validate-menu.ts for the shape.
export const menus = pgTable("menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  items: jsonb("items").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/db/migrations/0018_menus.sql`, mirroring `0010_categories.sql`'s table+RLS shape exactly (public SELECT, authenticated-only write):

```sql
CREATE TABLE IF NOT EXISTS "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Public reference data (apps/frontend needs to read a menu with no admin
-- session) — same defense-in-depth pattern as every other tenant table:
-- RLS still requires app.authenticated for any write.
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menus" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menus_select" ON "menus";
CREATE POLICY "menus_select" ON "menus" FOR SELECT USING (true);

DROP POLICY IF EXISTS "menus_insert" ON "menus";
CREATE POLICY "menus_insert" ON "menus" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "menus_update" ON "menus";
CREATE POLICY "menus_update" ON "menus" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "menus_delete" ON "menus";
CREATE POLICY "menus_delete" ON "menus" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
```

- [ ] **Step 3: Verify the migration is idempotent-safe and typechecks**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: PASS (schema.ts compiles; the migration file itself isn't type-checked, just SQL — read it once more to confirm every statement has `IF NOT EXISTS`/`DROP POLICY IF EXISTS`, matching this repo's convention so it can safely replay against a DB that already has some of these objects).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/0018_menus.sql
git commit -m "feat(api): add menus table schema + migration"
```

---

### Task 2: Menu item validation (`validate-menu.ts`)

**Files:**
- Modify: `apps/api/src/collections/validate-layout.ts` (export `isSafeUrl` and `isSafeCssUrl` — currently module-private)
- Create: `apps/api/src/collections/validate-menu.ts`
- Test: `apps/api/src/collections/validate-menu.test.ts`

**Interfaces:**
- Consumes: `isSafeUrl(v: string): boolean`, `isSafeCssUrl(v: string): boolean` from `validate-layout.ts`.
- Produces: `validateMenuItems(items: unknown): string | null` — returns an error message or `null` if valid. Consumed by Task 3's `menusBeforeChange`.

- [ ] **Step 1: Export the two URL-safety helpers**

In `apps/api/src/collections/validate-layout.ts`, change:
```ts
function isSafeUrl(v: string): boolean {
```
to:
```ts
export function isSafeUrl(v: string): boolean {
```
and:
```ts
function isSafeCssUrl(v: string): boolean {
```
to:
```ts
export function isSafeCssUrl(v: string): boolean {
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/collections/validate-menu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateMenuItems } from "./validate-menu.js";

describe("validateMenuItems", () => {
  it("accepts an empty menu", () => {
    expect(validateMenuItems([])).toBeNull();
  });

  it("accepts a simple custom-link item", () => {
    const items = [{ id: "a", label: "Home", linkType: "custom", url: "/", target: "_self" }];
    expect(validateMenuItems(items)).toBeNull();
  });

  it("rejects a javascript: URL", () => {
    const items = [{ id: "a", label: "Bad", linkType: "custom", url: "javascript:alert(1)" }];
    expect(validateMenuItems(items)).toMatch(/unsafe/i);
  });

  it("accepts one level of nested children", () => {
    const items = [
      {
        id: "a",
        label: "About",
        linkType: "custom",
        url: "/about",
        children: [{ id: "b", label: "History", linkType: "custom", url: "/about/history" }],
      },
    ];
    expect(validateMenuItems(items)).toBeNull();
  });

  it("accepts a mega menu with columns and icon/image items", () => {
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: {
          columns: [
            {
              heading: "Faculties",
              items: [
                { label: "Science", linkType: "custom", url: "/science", icon: "graduation-cap", image: "" },
              ],
            },
          ],
        },
      },
    ];
    expect(validateMenuItems(items)).toBeNull();
  });

  it("rejects a mega menu image with an unsafe URL", () => {
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: { columns: [{ items: [{ label: "X", linkType: "custom", url: "/x", image: "javascript:alert(1)" }] }] },
      },
    ];
    expect(validateMenuItems(items)).toMatch(/unsafe/i);
  });

  it("rejects nesting deeper than 3 levels", () => {
    const items = [{ id: "a", label: "L1", linkType: "custom", url: "/", children: [
      { id: "b", label: "L2", linkType: "custom", url: "/", children: [
        { id: "c", label: "L3", linkType: "custom", url: "/", children: [
          { id: "d", label: "L4", linkType: "custom", url: "/" },
        ] },
      ] },
    ] }];
    expect(validateMenuItems(items)).toMatch(/depth/i);
  });

  it("rejects an item missing a label", () => {
    expect(validateMenuItems([{ id: "a", linkType: "custom", url: "/" }])).toMatch(/label/);
  });

  it("rejects linkType page/post/category with no refId", () => {
    expect(validateMenuItems([{ id: "a", label: "X", linkType: "page" }])).toMatch(/refId/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @usim-cms/api exec vitest run validate-menu.test.ts`
Expected: FAIL — `Cannot find module './validate-menu.js'`

- [ ] **Step 3: Implement `validate-menu.ts`**

```ts
import { isSafeUrl, isSafeCssUrl } from "./validate-layout.js";

// Same style-value/URL safety posture as validate-layout.ts: icon is a
// lucide-react icon name looked up client-side, never interpolated into
// CSS/HTML server-side — a plain identifier pattern is enough to stop
// injection without having to mirror Designer's exact icon enum here (that
// enum is UI-only; an unrecognized name just renders nothing on the
// frontend, same "invalid-but-inert" posture LENGTH_RE's fallback already
// takes for an unrecognized keyword).
const ICON_NAME_RE = /^[a-z0-9-]*$/i;
const MAX_DEPTH = 3;
const MAX_COLUMNS = 8;
const MAX_COLUMN_ITEMS = 20;

type LinkType = "page" | "post" | "category" | "custom";
const LINK_TYPES: LinkType[] = ["page", "post", "category", "custom"];

function validateLinkFields(o: Record<string, unknown>, path: string): string | null {
  if (typeof o.linkType !== "string" || !LINK_TYPES.includes(o.linkType as LinkType)) {
    return `${path}.linkType must be one of ${LINK_TYPES.join("/")}`;
  }
  if (o.linkType === "custom") {
    if (typeof o.url !== "string" || !isSafeUrl(o.url)) return `${path}.url has an unsafe or missing URL`;
  } else {
    if (typeof o.refId !== "string" || !o.refId) return `${path}.refId is required for linkType "${o.linkType}"`;
  }
  if (o.target !== undefined && o.target !== "_self" && o.target !== "_blank") {
    return `${path}.target must be "_self" or "_blank"`;
  }
  return null;
}

function validateTranslations(o: Record<string, unknown>, path: string): string | null {
  if (o.translations === undefined) return null;
  if (typeof o.translations !== "object" || o.translations === null || Array.isArray(o.translations)) {
    return `${path}.translations must be an object`;
  }
  for (const [code, entry] of Object.entries(o.translations as Record<string, unknown>)) {
    const label = (entry as Record<string, unknown> | null)?.label;
    if (typeof label !== "string") return `${path}.translations.${code}.label must be a string`;
  }
  return null;
}

function validateMegaMenuItem(item: unknown, path: string): string | null {
  if (typeof item !== "object" || item === null) return `${path} must be an object`;
  const o = item as Record<string, unknown>;
  if (typeof o.label !== "string" || !o.label) return `${path}.label is required`;
  const linkErr = validateLinkFields(o, path);
  if (linkErr) return linkErr;
  const trErr = validateTranslations(o, path);
  if (trErr) return trErr;
  if (o.icon !== undefined && (typeof o.icon !== "string" || !ICON_NAME_RE.test(o.icon))) {
    return `${path}.icon has invalid characters`;
  }
  if (o.image !== undefined && o.image !== "" && (typeof o.image !== "string" || !isSafeCssUrl(o.image))) {
    return `${path}.image has an unsafe URL`;
  }
  return null;
}

function validateMegaMenu(mega: unknown, path: string): string | null {
  if (typeof mega !== "object" || mega === null) return `${path}.megaMenu must be an object`;
  const columns = (mega as Record<string, unknown>).columns;
  if (!Array.isArray(columns)) return `${path}.megaMenu.columns must be an array`;
  if (columns.length > MAX_COLUMNS) return `${path}.megaMenu has too many columns (max ${MAX_COLUMNS})`;
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    if (typeof col !== "object" || col === null) return `${path}.megaMenu.columns[${ci}] must be an object`;
    const c = col as Record<string, unknown>;
    if (c.heading !== undefined && typeof c.heading !== "string") return `${path}.megaMenu.columns[${ci}].heading must be a string`;
    const trErr = validateTranslations({ translations: c.translations }, `${path}.megaMenu.columns[${ci}]`);
    if (trErr) return trErr;
    if (!Array.isArray(c.items)) return `${path}.megaMenu.columns[${ci}].items must be an array`;
    if (c.items.length > MAX_COLUMN_ITEMS) return `${path}.megaMenu.columns[${ci}] has too many items (max ${MAX_COLUMN_ITEMS})`;
    for (let ii = 0; ii < c.items.length; ii++) {
      const err = validateMegaMenuItem(c.items[ii], `${path}.megaMenu.columns[${ci}].items[${ii}]`);
      if (err) return err;
    }
  }
  return null;
}

function validateItem(item: unknown, path: string, depth: number): string | null {
  if (typeof item !== "object" || item === null) return `${path} must be an object`;
  const o = item as Record<string, unknown>;
  if (typeof o.label !== "string" || !o.label) return `${path}.label is required`;
  const linkErr = validateLinkFields(o, path);
  if (linkErr) return linkErr;
  const trErr = validateTranslations(o, path);
  if (trErr) return trErr;
  if (o.children !== undefined && o.megaMenu !== undefined) {
    return `${path} cannot have both children and megaMenu`;
  }
  if (o.megaMenu !== undefined) return validateMegaMenu(o.megaMenu, path);
  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) return `${path}.children must be an array`;
    if (depth + 1 > MAX_DEPTH) return `${path}.children exceeds max nesting depth (${MAX_DEPTH})`;
    for (let i = 0; i < o.children.length; i++) {
      const err = validateItem(o.children[i], `${path}.children[${i}]`, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

export function validateMenuItems(items: unknown): string | null {
  if (!Array.isArray(items)) return "items must be an array";
  for (let i = 0; i < items.length; i++) {
    const err = validateItem(items[i], `items[${i}]`, 1);
    if (err) return err;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @usim-cms/api exec vitest run validate-menu.test.ts`
Expected: PASS (all 9 cases)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/collections/validate-layout.ts apps/api/src/collections/validate-menu.ts apps/api/src/collections/validate-menu.test.ts
git commit -m "feat(api): add menu item tree validation"
```

---

### Task 3: Register `menus` collection + `menus.write` permission (server + admin)

**Files:**
- Modify: `apps/api/src/index.ts` (add `menus.write` to `PERMISSIONS`, add `menusCollection`, register on both scopes)
- Modify: `apps/admin/src/App.tsx` (add `"menus.write": "perm-menus-write"` to client `PERMISSIONS`, add its checkbox to the Roles editor)
- Modify: `apps/admin/src/i18n.ts` (add `perm-menus-write` key, both languages)

**Interfaces:**
- Consumes: `schema.menus` (Task 1), `validateMenuItems` (Task 2), `CollectionConfig`, `registerPublicCollectionRoutes`/`registerProtectedCollectionRoutes`, `hasPermission(args, permission)` (all already in `index.ts`).
- Produces: `GET/POST/PATCH/DELETE /api/menus[/:id]` routes. Consumed by Task 4's admin client.

- [ ] **Step 1: Add the permission (server)**

In `apps/api/src/index.ts`, in the `PERMISSIONS` set (around line 74-87), add:
```ts
  "menus.write",
```
right after `"languages.write",`.

- [ ] **Step 2: Add `menusCollection`**

In `apps/api/src/index.ts`, immediately after the `categoriesCollection` definition (after its closing `};`), add:

```ts
const menusBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  const err = validateMenuItems(record.items ?? []);
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  record.updatedAt = new Date();
  return record;
};

const menusCollection: CollectionConfig = {
  slug: "menus",
  table: schema.menus,
  createSchema: {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      items: { type: "array" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "menus.write"),
    update: (a) => hasPermission(a, "menus.write"),
    delete: (a) => hasPermission(a, "menus.write"),
  },
  hooks: { beforeChange: menusBeforeChange },
};
```

Add the import at the top of `index.ts` (alongside the existing `validate-layout.js` import):
```ts
import { validateMenuItems } from "./collections/validate-menu.js";
```

- [ ] **Step 3: Register the routes**

In the `publicScope` registration block (after `registerPublicCollectionRoutes(publicScope, categoriesCollection);`), add:
```ts
  registerPublicCollectionRoutes(publicScope, menusCollection);
```

In the `protectedScope` registration block (after `registerProtectedCollectionRoutes(protectedScope, categoriesCollection);`), add:
```ts
  registerProtectedCollectionRoutes(protectedScope, menusCollection);
```

- [ ] **Step 4: Add the permission (admin client + Roles editor)**

In `apps/admin/src/App.tsx`, in the `PERMISSIONS` array/object (around line 2469-2495), add `"menus.write": "perm-menus-write",` right after `"languages.write": "perm-languages-write",`. Confirm the Roles editor renders its checkboxes by iterating this same object (it already does for every other permission, per the existing pattern) — no separate list to update if so; if the Roles editor instead hardcodes a JSX list of checkboxes, add one there too for `menus.write`.

- [ ] **Step 5: Add the i18n key**

In `apps/admin/src/i18n.ts`, add to both `ms` and `en`:
```ts
  "perm-menus-write": "Urus menu", // ms
```
```ts
  "perm-menus-write": "Manage menus", // en
```

- [ ] **Step 6: Typecheck and manually verify the route**

Run: `pnpm --filter @usim-cms/api typecheck && pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

Run (with `apps/api` dev server up and a valid tenant/superadmin token — see the project's existing manual-verification convention for other collections): `curl -X POST http://localhost:3000/api/menus -H "x-tenant-host: <dev tenant>" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":"Main Menu"}'`
Expected: `201` with `{ collection: "menus", item: { id, name: "Main Menu", items: [], ... } }`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/index.ts apps/admin/src/App.tsx apps/admin/src/i18n.ts
git commit -m "feat(api,admin): register menus collection + menus.write permission"
```

---

### Task 4: Admin API client (`lib/api.ts`)

**Files:**
- Modify: `apps/admin/src/lib/api.ts`

**Interfaces:**
- Produces: `MenuItem` type, `Menu` interface, `listMenus`, `createMenu`, `updateMenu`, `deleteMenu`. Consumed by Task 5-9's admin UI and Task 10's Designer element.

- [ ] **Step 1: Add types and client functions**

After the existing `deleteCategory` export in `apps/admin/src/lib/api.ts`, add:

```ts
export interface MenuLinkFields {
  linkType: "page" | "post" | "category" | "custom";
  refId?: string;
  url?: string;
  target?: "_self" | "_blank";
}

export interface MenuMegaColumnItem extends MenuLinkFields {
  label: string;
  translations?: Record<string, { label: string }>;
  icon?: string;
  image?: string;
}

export interface MenuMegaColumn {
  heading?: string;
  translations?: Record<string, { heading: string }>;
  items: MenuMegaColumnItem[];
}

export interface MenuItem extends MenuLinkFields {
  id: string;
  label: string;
  translations?: Record<string, { label: string }>;
  children?: MenuItem[];
  megaMenu?: { columns: MenuMegaColumn[] };
}

export interface Menu {
  id: string;
  name: string;
  items: MenuItem[];
  createdAt: string;
  updatedAt: string;
}

export const listMenus = (tenantHost: string, token: string) =>
  request("/api/menus", tenantHost, token).then((b) => b.items as Menu[]);

export const createMenu = (tenantHost: string, token: string, name: string) =>
  request("/api/menus", tenantHost, token, { method: "POST", body: JSON.stringify({ name }) }).then((b) => b.item as Menu);

export const updateMenu = (tenantHost: string, token: string, id: string, patch: Partial<Pick<Menu, "name" | "items">>) =>
  request(`/api/menus/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(patch) }).then((b) => b.item as Menu);

export const deleteMenu = (tenantHost: string, token: string, id: string) =>
  request(`/api/menus/${id}`, tenantHost, token, { method: "DELETE" });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/lib/api.ts
git commit -m "feat(admin): add menus API client"
```

---

### Task 5: `MenusPanel` (list, create, rename, delete) + routing + i18n

**Files:**
- Create: `apps/admin/src/MenusPanel.tsx`
- Modify: `apps/admin/src/App.tsx` (import + route + nav entry)
- Modify: `apps/admin/src/i18n.ts` (new keys)

**Interfaces:**
- Consumes: `api.Menu`, `api.listMenus/createMenu/updateMenu/deleteMenu` (Task 4).
- Produces: `<MenusPanel tenantHost token />`, mounted at `content/menus`. `onOpen(menu)` callback pattern for Task 6-8 to slot the item editor in.

- [ ] **Step 1: Write `MenusPanel.tsx`**

Model directly on `CategoriesPanel.tsx` (list + inline create + rename + delete), but each row also expands into its own `MenuItemsEditor` (Task 6) instead of navigating away — a menu's item tree is edited in place, not as a separate routed page, since (unlike Pages/Posts) there's no full-screen canvas needed, just a form:

```tsx
import { useEffect, useState } from "react";
import { Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, inputCls, card } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import MenuItemsEditor from "./MenuItemsEditor";

const createSchema = z.object({ name: z.string().trim().min(1, { message: "Required" }) });
type CreateForm = z.infer<typeof createSchema>;

export default function MenusPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [menus, setMenus] = useState<api.Menu[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  async function refresh() {
    try {
      setMenus(await api.listMenus(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  async function onCreate(values: CreateForm) {
    try {
      const created = await api.createMenu(tenantHost, token, values.name);
      form.reset();
      await refresh();
      setOpenId(created.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateMenu(tenantHost, token, id, { name: trimmed });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("menus-delete-confirm")))) return;
    try {
      await api.deleteMenu(tenantHost, token, id);
      if (openId === id) setOpenId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-sm font-semibold text-ink">{t("menus-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex gap-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input required placeholder={t("menus-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("menus-creating") : t("menus-create")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ul className={`${card} divide-y divide-line/20`}>
        {menus.map((m) => (
          <li key={m.id}>
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <button
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                className="flex items-center gap-2 font-semibold text-ink"
              >
                {openId === m.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {editingId === m.id ? (
                  <input
                    className={inputCls}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void rename(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  m.name
                )}
              </button>
              <span className="flex items-center gap-3">
                {editingId === m.id ? (
                  <>
                    <Button size="sm" onClick={() => void rename(m.id)}>{t("menus-save")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("menus-cancel")}</Button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditingId(m.id); setEditName(m.name); }}
                    className="rounded p-1 text-body hover:bg-canvas"
                    title={t("menus-rename")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => void remove(m.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("menus-delete")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
            {openId === m.id && (
              <div className="border-t border-line/20 bg-canvas/40 px-4 py-3">
                <MenuItemsEditor
                  tenantHost={tenantHost}
                  token={token}
                  menu={m}
                  onSaved={refresh}
                />
              </div>
            )}
          </li>
        ))}
        {menus.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("menus-empty")}</li>}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Mount the route**

In `apps/admin/src/App.tsx`:
1. Add `import MenusPanel from "./MenusPanel";` near the other panel imports.
2. Extend `type ContentSubTab = "pages" | "posts" | "media" | "theme" | "languages";` to include `"menus"`.
3. In `ContentManager`'s `subTabs` array, add an entry (after the `posts`-adjacent entries, before `theme`): `{ id: "menus" as const, labelKey: "menus-title" as const, icon: ListTree }` (import `ListTree` from `lucide-react` alongside the other icon imports).
4. In `ContentManager`'s `<Routes>`, add: `<Route path="menus" element={<MenusPanel tenantHost={siteHost} token={token} />} />`.
5. For a webmaster (non-superadmin) top-level tab, mirror the existing `languages` top-level route (around line 4051): add `<Route path="menus" element={!isSuper && session.tenantHost ? (<MenusPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />`, and add `"menus"` to the non-super `contentTabs` array (`isSuper ? [...] : ["content", "theme", "languages", "menus"]`) and to `TAB_META`/`Tab` union the same way `"languages"` already is.

- [ ] **Step 3: Add i18n keys**

In `apps/admin/src/i18n.ts`, add to both `ms` and `en`:
```ts
  "menus-title": "Menu", // ms — same word in both languages, keep as-is for ms
  "menus-name": "nama menu",
  "menus-create": "Cipta menu",
  "menus-creating": "Mencipta...",
  "menus-rename": "Tukar nama",
  "menus-save": "Simpan",
  "menus-cancel": "Batal",
  "menus-delete": "Padam",
  "menus-delete-confirm": "Padam menu ini?",
  "menus-empty": "Tiada menu lagi.",
```
```ts
  "menus-title": "Menus", // en
  "menus-name": "menu name",
  "menus-create": "Create menu",
  "menus-creating": "Creating...",
  "menus-rename": "Rename",
  "menus-save": "Save",
  "menus-cancel": "Cancel",
  "menus-delete": "Delete",
  "menus-delete-confirm": "Delete this menu?",
  "menus-empty": "No menus yet.",
```

- [ ] **Step 4: Typecheck (expect a stub failure, resolved by Task 6)**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: FAIL — `Cannot find module './MenuItemsEditor'` (created next task). This is expected; do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/MenusPanel.tsx apps/admin/src/App.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add MenusPanel list/create/rename/delete + routing"
```

---

### Task 6: `MenuItemsEditor` — top-level items (label, link type, target, add/remove/reorder)

**Files:**
- Create: `apps/admin/src/MenuItemsEditor.tsx`

**Interfaces:**
- Consumes: `api.Menu`, `api.MenuItem`, `api.updateMenu` (Task 4).
- Produces: `<MenuItemsEditor tenantHost token menu onSaved />`. Extended in Task 7 (nesting/mega) and Task 8 (translations) — this task ships a fully working flat-list editor on its own (nesting/mega are additive, not required for this task's own deliverable to be useful).

- [ ] **Step 1: Write the basic editor**

```tsx
import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import * as api from "@/lib/api";
import { useT, inputCls } from "./App";
import { Button } from "@/components/ui/button";

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyItem(): api.MenuItem {
  return { id: uid(), label: "", linkType: "custom", url: "", target: "_self" };
}

export default function MenuItemsEditor({
  tenantHost,
  token,
  menu,
  onSaved,
}: {
  tenantHost: string;
  token: string;
  menu: api.Menu;
  onSaved: () => Promise<void>;
}) {
  const { t } = useT();
  const [items, setItems] = useState<api.MenuItem[]>(() => menu.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(fn: (draft: api.MenuItem[]) => api.MenuItem[]) {
    setItems((prev) => fn(prev));
    setDirty(true);
  }

  function addItem() {
    update((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: string) {
    update((prev) => prev.filter((it) => it.id !== id));
  }

  function moveItem(id: string, dir: -1 | 1) {
    update((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  }

  function patchItem(id: string, patch: Partial<api.MenuItem>) {
    update((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateMenu(tenantHost, token, menu.id, { items });
      setDirty(false);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={item.id} className="space-y-2 rounded-lg border border-line/30 bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                placeholder={t("menus-item-label")}
                value={item.label}
                onChange={(e) => patchItem(item.id, { label: e.target.value })}
              />
              <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0} className="rounded p-1 text-body hover:bg-canvas disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => moveItem(item.id, 1)} disabled={idx === items.length - 1} className="rounded p-1 text-body hover:bg-canvas disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => removeItem(item.id)} className="rounded p-1 text-red-500 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={inputCls}
                value={item.linkType}
                onChange={(e) => patchItem(item.id, { linkType: e.target.value as api.MenuItem["linkType"], refId: undefined, url: "" })}
              >
                <option value="custom">{t("menus-link-custom")}</option>
                <option value="page">{t("menus-link-page")}</option>
                <option value="post">{t("menus-link-post")}</option>
                <option value="category">{t("menus-link-category")}</option>
              </select>
              {item.linkType === "custom" ? (
                <input
                  className={inputCls}
                  placeholder="/about or https://..."
                  value={item.url ?? ""}
                  onChange={(e) => patchItem(item.id, { url: e.target.value })}
                />
              ) : (
                <RefIdPicker
                  tenantHost={tenantHost}
                  token={token}
                  linkType={item.linkType}
                  value={item.refId}
                  onChange={(refId, title) => patchItem(item.id, { refId, label: item.label || title })}
                />
              )}
              <select
                className={inputCls}
                value={item.target ?? "_self"}
                onChange={(e) => patchItem(item.id, { target: e.target.value as "_self" | "_blank" })}
              >
                <option value="_self">{t("menus-target-self")}</option>
                <option value="_blank">{t("menus-target-blank")}</option>
              </select>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5" /> {t("menus-add-item")}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? t("menus-saving") : t("menus-save")}
        </Button>
      </div>
    </div>
  );
}

// Fetches the tenant's pages/posts/categories once and offers them as a
// <select> — reuses the same public list endpoints apps/frontend itself
// reads (no new backend route needed for this admin-only convenience).
function RefIdPicker({
  tenantHost,
  token,
  linkType,
  value,
  onChange,
}: {
  tenantHost: string;
  token: string;
  linkType: "page" | "post" | "category";
  value?: string;
  onChange: (refId: string, title: string) => void;
}) {
  const { t } = useT();
  const [options, setOptions] = useState<Array<{ id: string; title: string }>>([]);

  useState(() => {
    // Explicit per-type branching rather than a dynamic api[methodName] call
    // — keeps each fetch's real return type (Category has `name`, not
    // `title`) instead of erasing everything to a type-unsafe dynamic index.
    const load =
      linkType === "page"
        ? api.getPages(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id as string, title: r.title as string })))
        : linkType === "post"
          ? api.getPosts(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id as string, title: r.title as string })))
          : api.listCategories(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id, title: r.name })));
    void load.then(setOptions);
  });

  return (
    <select
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => {
        const opt = options.find((o) => o.id === e.target.value);
        onChange(e.target.value, opt?.title ?? "");
      }}
    >
      <option value="" disabled>
        {t("menus-pick-item")}
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Add i18n keys**

Add to both `ms`/`en` in `apps/admin/src/i18n.ts`:
```ts
  "menus-item-label": "label",
  "menus-link-custom": "URL Kustom",
  "menus-link-page": "Halaman",
  "menus-link-post": "Artikel",
  "menus-link-category": "Kategori",
  "menus-target-self": "Tab sama",
  "menus-target-blank": "Tab baharu",
  "menus-add-item": "Tambah item",
  "menus-saving": "Menyimpan...",
  "menus-pick-item": "Pilih...",
```
```ts
  "menus-item-label": "label",
  "menus-link-custom": "Custom URL",
  "menus-link-page": "Page",
  "menus-link-post": "Post",
  "menus-link-category": "Category",
  "menus-target-self": "Same tab",
  "menus-target-blank": "New tab",
  "menus-add-item": "Add item",
  "menus-saving": "Saving...",
  "menus-pick-item": "Choose...",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

- [ ] **Step 4: Manual verification**

Run `pnpm dev:admin` + `pnpm dev:api`, log in, open Content ▸ Menus, create a menu, expand it, add 2 items (one custom URL, one linked Page), reorder them, save, refresh the page, confirm both persist with the right link.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/MenuItemsEditor.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add MenuItemsEditor with flat item CRUD + reorder"
```

---

### Task 7: Nested children (dropdown) + mega-menu columns

**Files:**
- Modify: `apps/admin/src/MenuItemsEditor.tsx`

**Interfaces:**
- Consumes: same as Task 6.
- Produces: extends each top-level item row with a "Add submenu"/"Convert to mega menu" pair of actions (mutually exclusive, matching `validateMenuItems`'s rule).

- [ ] **Step 1: Add the mode toggle + nested/mega editors**

Add below the existing per-item link-fields row inside the `<li>` in `MenuItemsEditor.tsx` (after the `linkType`/target row, still inside the same `<li>`):

```tsx
            <div className="flex items-center gap-2 border-t border-line/20 pt-2">
              {!item.children && !item.megaMenu && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => patchItem(item.id, { children: [] })}>
                    {t("menus-add-submenu")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => patchItem(item.id, { megaMenu: { columns: [] } })}>
                    {t("menus-convert-mega")}
                  </Button>
                </>
              )}
              {(item.children || item.megaMenu) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500"
                  onClick={() => patchItem(item.id, { children: undefined, megaMenu: undefined })}
                >
                  {t("menus-remove-submenu")}
                </Button>
              )}
            </div>
            {item.children && (
              <div className="ml-4 space-y-2 border-l-2 border-line/30 pl-3">
                {item.children.map((child, ci) => (
                  <div key={child.id} className="flex items-center gap-2">
                    <input
                      className={inputCls}
                      placeholder={t("menus-item-label")}
                      value={child.label}
                      onChange={(e) =>
                        patchItem(item.id, {
                          children: item.children!.map((c, i) => (i === ci ? { ...c, label: e.target.value } : c)),
                        })
                      }
                    />
                    <input
                      className={inputCls}
                      placeholder="/child-path"
                      value={child.url ?? ""}
                      onChange={(e) =>
                        patchItem(item.id, {
                          children: item.children!.map((c, i) => (i === ci ? { ...c, url: e.target.value } : c)),
                        })
                      }
                    />
                    <button
                      onClick={() => patchItem(item.id, { children: item.children!.filter((_, i) => i !== ci) })}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchItem(item.id, { children: [...(item.children ?? []), { id: uid(), label: "", linkType: "custom", url: "" }] })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> {t("menus-add-item")}
                </Button>
              </div>
            )}
            {item.megaMenu && (
              <MegaMenuEditor
                mega={item.megaMenu}
                onChange={(mega) => patchItem(item.id, { megaMenu: mega })}
              />
            )}
```

- [ ] **Step 2: Add the `MegaMenuEditor` sub-component**

Append to the bottom of `apps/admin/src/MenuItemsEditor.tsx`:

```tsx
function emptyMegaColumnItem(): api.MenuMegaColumnItem {
  return { id: uid(), label: "", linkType: "custom", url: "", icon: "", image: "" } as api.MenuMegaColumnItem;
}

function MegaMenuEditor({
  mega,
  onChange,
}: {
  mega: { columns: api.MenuMegaColumn[] };
  onChange: (mega: { columns: api.MenuMegaColumn[] }) => void;
}) {
  const { t } = useT();

  function setColumns(columns: api.MenuMegaColumn[]) {
    onChange({ columns });
  }

  function addColumn() {
    setColumns([...mega.columns, { heading: "", items: [] }]);
  }

  function removeColumn(ci: number) {
    setColumns(mega.columns.filter((_, i) => i !== ci));
  }

  function patchColumn(ci: number, patch: Partial<api.MenuMegaColumn>) {
    setColumns(mega.columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
  }

  function addColumnItem(ci: number) {
    patchColumn(ci, { items: [...mega.columns[ci].items, emptyMegaColumnItem()] });
  }

  function patchColumnItem(ci: number, ii: number, patch: Partial<api.MenuMegaColumnItem>) {
    patchColumn(ci, { items: mega.columns[ci].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });
  }

  function removeColumnItem(ci: number, ii: number) {
    patchColumn(ci, { items: mega.columns[ci].items.filter((_, i) => i !== ii) });
  }

  return (
    <div className="ml-4 space-y-3 border-l-2 border-accent/40 pl-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mega.columns.map((col, ci) => (
          <div key={ci} className="space-y-2 rounded-lg border border-line/30 bg-canvas/40 p-2">
            <div className="flex items-center gap-1">
              <input
                className={inputCls}
                placeholder={t("menus-column-heading")}
                value={col.heading ?? ""}
                onChange={(e) => patchColumn(ci, { heading: e.target.value })}
              />
              <button onClick={() => removeColumn(ci)} className="rounded p-1 text-red-500 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {col.items.map((it, ii) => (
              <div key={it.id} className="space-y-1 rounded border border-line/20 bg-white p-2">
                <input
                  className={inputCls}
                  placeholder={t("menus-item-label")}
                  value={it.label}
                  onChange={(e) => patchColumnItem(ci, ii, { label: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="/link-path"
                  value={it.url ?? ""}
                  onChange={(e) => patchColumnItem(ci, ii, { url: e.target.value })}
                />
                <div className="flex gap-1">
                  <input
                    className={inputCls}
                    placeholder={t("menus-icon-name")}
                    value={it.icon ?? ""}
                    onChange={(e) => patchColumnItem(ci, ii, { icon: e.target.value })}
                  />
                  <input
                    className={inputCls}
                    placeholder={t("menus-image-url")}
                    value={it.image ?? ""}
                    onChange={(e) => patchColumnItem(ci, ii, { image: e.target.value })}
                  />
                  <button onClick={() => removeColumnItem(ci, ii)} className="rounded p-1 text-red-500 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => addColumnItem(ci)}>
              <Plus className="h-3.5 w-3.5" /> {t("menus-add-item")}
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={addColumn}>
        <Plus className="h-3.5 w-3.5" /> {t("menus-add-column")}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Add i18n keys**

Add to both `ms`/`en`:
```ts
  "menus-add-submenu": "Tambah submenu",
  "menus-convert-mega": "Jadikan mega menu",
  "menus-remove-submenu": "Buang submenu",
  "menus-column-heading": "tajuk lajur",
  "menus-add-column": "Tambah lajur",
  "menus-icon-name": "nama ikon",
  "menus-image-url": "URL imej",
```
```ts
  "menus-add-submenu": "Add submenu",
  "menus-convert-mega": "Convert to mega menu",
  "menus-remove-submenu": "Remove submenu",
  "menus-column-heading": "column heading",
  "menus-add-column": "Add column",
  "menus-icon-name": "icon name",
  "menus-image-url": "image URL",
```

- [ ] **Step 4: Typecheck + manual verification**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

Manually: add a submenu with 2 children to one item, save, reload, confirm it persists; on a different item, convert to mega menu, add 2 columns each with 1-2 items (one with an icon name and image URL), save, reload, confirm.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/MenuItemsEditor.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add nested submenu + mega menu column editing"
```

---

### Task 8: Per-item label translations

**Files:**
- Modify: `apps/admin/src/MenuItemsEditor.tsx`

**Interfaces:**
- Consumes: `api.translateText`, `api.getTenantLanguages` (both already exist, used identically by `CategoriesPanel.tsx`'s `CategoryTranslations`).
- Produces: a `translations` pill row per top-level item, gated behind the same `siteMultilangEnabled` switch every other translation UI in this codebase uses.

- [ ] **Step 1: Fetch site languages in `MenuItemsEditor`**

Near the top of the `MenuItemsEditor` function body, add:
```tsx
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);

  useState(() => {
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
    });
  });
```

- [ ] **Step 2: Render translation pills per top-level item**

After the link-type/target row inside each top-level item's `<li>` (before the submenu/mega toggle row added in Task 7), add:
```tsx
            {siteMultilangEnabled && (
              <ItemTranslations
                tenantHost={tenantHost}
                token={token}
                label={item.label}
                translations={item.translations ?? {}}
                siteLanguages={siteLanguages}
                onChange={(translations) => patchItem(item.id, { translations })}
              />
            )}
```

- [ ] **Step 3: Add the `ItemTranslations` sub-component**

Append to `apps/admin/src/MenuItemsEditor.tsx`, mirroring `CategoriesPanel.tsx`'s `CategoryTranslations` exactly but writing into local component state (via `onChange`) instead of an immediate server PATCH — a menu item's translations are part of the same in-memory tree the parent Save button commits, not saved individually:

```tsx
function ItemTranslations({
  tenantHost,
  token,
  label,
  translations,
  siteLanguages,
  onChange,
}: {
  tenantHost: string;
  token: string;
  label: string;
  translations: Record<string, { label: string }>;
  siteLanguages: api.SiteLanguage[];
  onChange: (translations: Record<string, { label: string }>) => void;
}) {
  const { t } = useT();
  const [translating, setTranslating] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  async function ensureTranslation(code: string) {
    const existing = translations[code];
    if (existing) {
      setEditingCode(code);
      setEditVal(existing.label);
      return;
    }
    if (!label) return;
    setTranslating(code);
    try {
      const translated = await api.translateText(tenantHost, token, label, code);
      onChange({ ...translations, [code]: { label: translated } });
      setEditingCode(code);
      setEditVal(translated);
    } finally {
      setTranslating(null);
    }
  }

  function saveEdit(code: string) {
    const trimmed = editVal.trim();
    if (!trimmed) return;
    onChange({ ...translations, [code]: { label: trimmed } });
    setEditingCode(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {siteLanguages.map((l) => {
        const entry = translations[l.code];
        if (editingCode === l.code) {
          return (
            <span key={l.code} className="flex items-center gap-1">
              <input
                className={`${inputCls} h-6 w-28 py-0 text-[11px]`}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit(l.code)}
                autoFocus
              />
              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => saveEdit(l.code)}>
                {t("menus-save")}
              </Button>
            </span>
          );
        }
        return (
          <button
            key={l.code}
            type="button"
            disabled={translating === l.code}
            onClick={() => void ensureTranslation(l.code)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
              entry ? "bg-canvas text-ink hover:bg-[#e8e8ed]" : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
            }`}
          >
            {l.label}: {entry ? entry.label : translating === l.code ? "…" : "+"}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + manual verification**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

Manually (on a tenant with multilang enabled and 2+ languages): open a menu item, click a language pill, confirm it auto-translates the label, edit it, save the menu, reload, confirm the translation persisted in `items[].translations`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/MenuItemsEditor.tsx
git commit -m "feat(admin): add per-item label translations to menu editor"
```

---

### Task 9: Designer "menu" element

**Files:**
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: `api.listMenus` (Task 4).
- Produces: a new `"menu"` `ElType`, selectable from the palette, with `menuId`/`layout`/`dropdownTrigger`/`megaMenuWidth` props. Consumed by Task 12's frontend render.

- [ ] **Step 1: Add `"menu"` to the `ElType` union**

In `apps/admin/src/Designer.tsx`, extend the `ElType` union (around line 190) to include `"menu"` (after `"slider"`).

- [ ] **Step 2: Add the `"menu-select"` field kind**

Extend the `FieldKind` union (around line 292-305) to include `"menu-select"`.

- [ ] **Step 3: Fetch the tenant's menus into component state**

Near the existing `const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);` in the main `Designer` component (around line 1743), add:
```tsx
  // "menu" element's Inspector needs a live list to populate its menuId
  // picker — dynamic per-tenant data, unlike every other field here which
  // is a static enum, so it's fetched once (like siteLanguages above) rather
  // than baked into ELS.menu.fields' static `options`.
  const [availableMenus, setAvailableMenus] = useState<api.Menu[]>([]);
  useEffect(() => {
    void api.listMenus(tenantHost, token).then(setAvailableMenus);
  }, [tenantHost]);
```
(Confirm `tenantHost`/`token` are already in scope in this component — they are, since `siteLanguages`'s own fetch uses them; match its exact call shape.)

- [ ] **Step 4: Add the ELS registry entry**

Import `Menu as MenuIcon` from `lucide-react` alongside the other icon imports (avoids clashing with the `ElType` value `"menu"`). In the `ELS` map (around line 513), add:
```tsx
  menu: {
    labelKey: "designer-el-menu",
    icon: MenuIcon,
    defaults: { menuId: "", layout: "horizontal", dropdownTrigger: "hover", megaMenuWidth: "contained" },
    fields: [
      { key: "menuId", labelKey: "designer-f-menu", kind: "menu-select" },
      { key: "layout", labelKey: "designer-f-menu-layout", kind: "select", options: ["horizontal", "vertical"] },
      { key: "dropdownTrigger", labelKey: "designer-f-menu-trigger", kind: "select", options: ["hover", "click"] },
      { key: "megaMenuWidth", labelKey: "designer-f-menu-width", kind: "select", options: ["contained", "full-width"] },
    ],
  },
```

- [ ] **Step 5: Add `FIELD_GROUP_BY_KEY` entries**

In the `FIELD_GROUP_BY_KEY` map (around line 813), add:
```tsx
  menuId: "content",
  dropdownTrigger: "content",
  megaMenuWidth: "content",
```
(`layout` is already a generic key used elsewhere in this map for other elements — check whether it already has an entry before adding a duplicate; if it's already mapped to `"content"` for another element, no change needed since the mapping is global by key name, not per-element.)

- [ ] **Step 6: Render the `"menu-select"` field kind in `FieldInput`**

In the `FieldInput` function (around line 2962), add a branch before the generic `"select"` handling:
```tsx
    if (field.kind === "menu-select") {
      return (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("designer-f-menu-none")}</option>
          {availableMenus.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    }
```
(`availableMenus` and `t` are both already in closure scope, since `FieldInput` is a nested function inside the same component as Step 3's state and the existing `t` usage elsewhere in `FieldInput`.)

- [ ] **Step 7: Add a canvas preview case in `ElPreview`**

Find the `ElPreview` function's `switch (el.type)` (cases visible around line 4825 for `"icon"`/`"list"`) and add:
```tsx
      case "menu": {
        const linked = availableMenus.find((m) => m.id === el.props.menuId);
        return (
          <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
            <MenuIcon className="h-3.5 w-3.5" />
            {linked ? linked.name : t("designer-f-menu-none")}
          </div>
        );
      }
```
(Confirm `ElPreview` is a nested function with closure access to `availableMenus`/`t`, matching every other case's pattern in this switch — if it instead receives its data via props, thread `availableMenus` through the same props object the other cases already read from.)

- [ ] **Step 8: Add i18n keys**

Add to both `ms`/`en` in `apps/admin/src/i18n.ts`:
```ts
  "designer-el-menu": "Menu",
  "designer-f-menu": "Menu",
  "designer-f-menu-layout": "Susunan",
  "designer-f-menu-trigger": "Cetus dropdown",
  "designer-f-menu-width": "Lebar mega menu",
  "designer-f-menu-none": "Pilih menu...",
```
```ts
  "designer-el-menu": "Menu",
  "designer-f-menu": "Menu",
  "designer-f-menu-layout": "Layout",
  "designer-f-menu-trigger": "Dropdown trigger",
  "designer-f-menu-width": "Mega menu width",
  "designer-f-menu-none": "Select a menu...",
```

- [ ] **Step 9: Typecheck + manual verification**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: PASS

Manually: open any Page in Designer, drag a "Menu" element into a column, confirm it appears in the palette with the right icon/label, pick a menu from the dropdown, save the page, reopen it, confirm the selection persisted.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/Designer.tsx apps/admin/src/i18n.ts
git commit -m "feat(admin): add Menu element to Designer's element palette"
```

---

### Task 10: `validate-layout.ts` — validate the `menu` element's `menuId`

**Files:**
- Modify: `apps/api/src/collections/validate-layout.ts`
- Modify: `apps/api/src/collections/validate-layout.test.ts` (create if it doesn't already exist, checking first)

**Interfaces:**
- Consumes: existing `validateValue`/`ENUM_VALUES`/`FREE_TEXT_KEYS` machinery in `validate-layout.ts`.
- Produces: `menuId`/`dropdownTrigger`/`megaMenuWidth` become recognized, validated keys — without this, saving a page containing a `"menu"` element 400s with `unknown field "menuId"` the same way the pre-existing `padding` gap did before it was added to `LENGTH_KEYS` (see CLAUDE.md's slider-work paragraph).

- [ ] **Step 1: Check for an existing test file**

Run: `ls apps/api/src/collections/validate-layout.test.ts` (or equivalent) to confirm whether one exists already; if it does, add cases to it instead of creating a new file.

- [ ] **Step 2: Add `menuId` handling + new enum values**

In `validate-layout.ts`'s `ENUM_VALUES` map, add:
```ts
  menuLayout: ["horizontal", "vertical"],
  dropdownTrigger: ["hover", "click"],
  megaMenuWidth: ["contained", "full-width"],
```
(Note: the Designer field key is `layout`, which the `menu` element also uses for `"horizontal"/"vertical"` — but `layout` isn't itself a top-level `ENUM_VALUES` key elsewhere in this file, so check for a collision first; if `layout` is unused as an `ENUM_VALUES` key, add `layout: ["horizontal", "vertical"]` directly instead of a separate `menuLayout` key, keeping the validator's key names in exact lockstep with what Designer.tsx actually sends, per this file's own stated convention.)

In `validateValue`, add a `menuId` branch before the generic `ENUM_VALUES` check:
```ts
  if (key === "menuId") return null;
```
(`menuId` just needs to be a non-empty-or-empty plain string — existence of the referenced menu is a runtime 404 concern for the frontend's `MenuBlock`, not a save-time concern, matching `categoryId`'s own posture. `validateValue` already returns `null` early for `value === ""`, so this branch only needs to accept any other string value, which it does by returning `null` unconditionally once reached — the important fix is that `menuId` no longer falls through to the final `unknown field` rejection.)

- [ ] **Step 3: Write the test cases**

Add to the test file:
```ts
it("accepts a menu element's props", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ type: "menu", props: { menuId: "abc-123", layout: "horizontal", dropdownTrigger: "hover", megaMenuWidth: "contained" } }] }] }],
      },
    },
  ];
  expect(validateLayout(layout)).toBeNull();
});

it("rejects an invalid menu dropdownTrigger", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ type: "menu", props: { dropdownTrigger: "double-click" } }] }] }],
      },
    },
  ];
  expect(validateLayout(layout)).toMatch(/unrecognized/);
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @usim-cms/api exec vitest run validate-layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/collections/validate-layout.ts apps/api/src/collections/validate-layout.test.ts
git commit -m "feat(api): validate the menu element's props in validate-layout"
```

---

### Task 11: Frontend `getMenu` + tree resolution (`apps/frontend/src/lib/api.ts`)

**Files:**
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `apiGet<T>(path, tenantHost, token?)` (already exists in this file).
- Produces: `MenuItem`/`Menu` types, `getMenu(tenantHost, id)`, `resolveMenuTree(items, lang, tenantHost)`. Consumed by Task 12's `MenuBlock.astro`.

- [ ] **Step 1: Add types + fetchers**

Append to `apps/frontend/src/lib/api.ts`:

```ts
export interface MenuItem {
  id: string;
  label: string;
  translations?: Record<string, { label: string }>;
  linkType: "page" | "post" | "category" | "custom";
  refId?: string;
  url?: string;
  target?: "_self" | "_blank";
  children?: MenuItem[];
  megaMenu?: {
    columns: Array<{
      heading?: string;
      translations?: Record<string, { heading: string }>;
      items: Array<{
        label: string;
        translations?: Record<string, { label: string }>;
        linkType: "page" | "post" | "category" | "custom";
        refId?: string;
        url?: string;
        target?: "_self" | "_blank";
        icon?: string;
        image?: string;
      }>;
    }>;
  };
}

export interface Menu {
  id: string;
  name: string;
  items: MenuItem[];
}

export async function getMenu(tenantHost: string, id: string): Promise<Menu | null> {
  if (!id) return null;
  const { item } = await apiGet<{ item: Menu | null }>(`/api/menus/${id}`, tenantHost);
  return item;
}

// Resolved, render-ready shape — href is always a plain string (already
// slug-resolved for page/post/category links), label is already the
// requested language's own translation (or the item's stored default).
export interface ResolvedMenuLink {
  label: string;
  href: string;
  target: "_self" | "_blank";
}
export interface ResolvedMenuItem extends ResolvedMenuLink {
  children?: ResolvedMenuItem[];
  megaMenu?: { columns: Array<{ heading: string; items: Array<ResolvedMenuLink & { icon?: string; image?: string }> }> };
}

async function resolveHref(tenantHost: string, linkType: MenuItem["linkType"], refId: string | undefined, url: string | undefined): Promise<string> {
  if (linkType === "custom") return url ?? "#";
  if (!refId) return "#";
  if (linkType === "page") {
    const { items } = await apiGet<{ items: Array<{ id: string; slug: string }> }>("/api/pages", tenantHost);
    const page = items.find((p) => p.id === refId);
    return page ? `/${page.slug}` : "#";
  }
  if (linkType === "post") {
    const { items } = await apiGet<{ items: Array<{ id: string; slug: string }> }>("/api/posts", tenantHost);
    const post = items.find((p) => p.id === refId);
    return post ? `/posts/${post.slug}` : "#";
  }
  const { items } = await apiGet<{ items: Array<{ id: string; slug: string }> }>("/api/categories", tenantHost);
  const category = items.find((c) => c.id === refId);
  return category ? `/category/${category.slug}` : "#";
}

function resolveLabel(label: string, translations: Record<string, { label: string }> | undefined, lang: string | null): string {
  if (lang && translations?.[lang]) return translations[lang].label;
  return label;
}

async function resolveLink(
  tenantHost: string,
  lang: string | null,
  o: { label: string; translations?: Record<string, { label: string }>; linkType: MenuItem["linkType"]; refId?: string; url?: string; target?: "_self" | "_blank" },
): Promise<ResolvedMenuLink> {
  return {
    label: resolveLabel(o.label, o.translations, lang),
    href: await resolveHref(tenantHost, o.linkType, o.refId, o.url),
    target: o.target ?? "_self",
  };
}

export async function resolveMenuTree(items: MenuItem[], lang: string | null, tenantHost: string): Promise<ResolvedMenuItem[]> {
  const resolved: ResolvedMenuItem[] = [];
  for (const item of items) {
    const link = await resolveLink(tenantHost, lang, item);
    const out: ResolvedMenuItem = { ...link };
    if (item.megaMenu) {
      out.megaMenu = {
        columns: await Promise.all(
          item.megaMenu.columns.map(async (col) => ({
            heading: (lang && col.translations?.[lang]?.heading) || col.heading || "",
            items: await Promise.all(
              col.items.map(async (colItem) => ({
                ...(await resolveLink(tenantHost, lang, colItem)),
                icon: colItem.icon,
                image: colItem.image,
              })),
            ),
          })),
        ),
      };
    } else if (item.children) {
      out.children = await resolveMenuTree(item.children, lang, tenantHost);
    }
    resolved.push(out);
  }
  return resolved;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck` (or the equivalent Astro check command this workspace uses — confirm the exact script name in `apps/frontend/package.json` first if `typecheck` isn't defined there; fall back to `pnpm --filter @usim-cms/frontend exec astro check`).
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "feat(frontend): add getMenu + menu tree resolution"
```

---

### Task 12: `MenuBlock.astro` + `SectionBlock.astro` wiring + desktop CSS

**Files:**
- Create: `apps/frontend/src/components/MenuBlock.astro`
- Modify: `apps/frontend/src/components/SectionBlock.astro` (add the `"menu"` element case)
- Modify: `apps/frontend/src/styles/global.css` (dropdown/mega-menu CSS)

**Interfaces:**
- Consumes: `getMenu`, `resolveMenuTree`, `ResolvedMenuItem` (Task 11).
- Produces: `<MenuBlock menuId layout dropdownTrigger megaMenuWidth tenantHost lang />`, rendering real nav markup on the live site.

- [ ] **Step 1: Write `MenuBlock.astro`**

```astro
---
import { getMenu, resolveMenuTree, type ResolvedMenuItem } from "../lib/api";

interface Props {
  menuId: string;
  layout?: "horizontal" | "vertical";
  dropdownTrigger?: "hover" | "click";
  megaMenuWidth?: "contained" | "full-width";
  tenantHost: string;
  lang: string | null;
}
const { menuId, layout = "horizontal", dropdownTrigger = "hover", megaMenuWidth = "contained", tenantHost, lang } = Astro.props;

const menu = await getMenu(tenantHost, menuId);
const items: ResolvedMenuItem[] = menu ? await resolveMenuTree(menu.items, lang, tenantHost) : [];
---

{items.length > 0 && (
  <nav class={`ds-menu ds-menu-${layout}`} data-trigger={dropdownTrigger}>
    <button class="ds-menu-toggle" type="button" aria-label="Menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <ul class="ds-menu-list">
      {items.map((item) => (
        <li class={`ds-menu-item ${item.children ? "has-dropdown" : ""} ${item.megaMenu ? "has-mega" : ""}`}>
          <a href={item.href} target={item.target}>{item.label}</a>
          {item.children && (
            <ul class="ds-menu-dropdown">
              {item.children.map((child) => (
                <li><a href={child.href} target={child.target}>{child.label}</a></li>
              ))}
            </ul>
          )}
          {item.megaMenu && (
            <div class={`ds-mega-menu ds-mega-${megaMenuWidth}`}>
              {item.megaMenu.columns.map((col) => (
                <div class="ds-mega-column">
                  {col.heading && <p class="ds-mega-heading">{col.heading}</p>}
                  <ul>
                    {col.items.map((mi) => (
                      <li>
                        <a href={mi.href} target={mi.target}>
                          {mi.image && <img src={mi.image} alt="" />}
                          {mi.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  </nav>
)}

<script>
  // One listener per rendered ds-menu, event-delegated — matches this
  // codebase's existing "tabs" element convention of a single small script
  // bundled once per page regardless of instance count. Handles two
  // concerns: click-to-toggle dropdowns/mega-menus when dropdownTrigger is
  // "click" (desktop, no hover), and the mobile hamburger toggle (all
  // triggers, since touch has no hover at all).
  document.querySelectorAll<HTMLElement>(".ds-menu").forEach((nav) => {
    const toggle = nav.querySelector<HTMLButtonElement>(".ds-menu-toggle");
    const list = nav.querySelector<HTMLUListElement>(".ds-menu-list");
    toggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    if (nav.dataset.trigger === "click") {
      nav.querySelectorAll<HTMLElement>(".has-dropdown > a, .has-mega > a").forEach((link) => {
        link.addEventListener("click", (e) => {
          const li = link.closest("li");
          if (!li) return;
          const isOpenAlready = li.classList.contains("is-open-click");
          nav.querySelectorAll("li.is-open-click").forEach((el) => el.classList.remove("is-open-click"));
          if (!isOpenAlready) {
            e.preventDefault();
            li.classList.add("is-open-click");
          }
        });
      });
    }
    list?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("is-open")));
  });
</script>
```

- [ ] **Step 2: Wire the `"menu"` case into `SectionBlock.astro`**

Find the element-level `switch` in `SectionBlock.astro` (cases visible around line 886 `"text"`, 902 `"image"`, 1000 `"html"`) and add, alongside those:
```astro
case "menu":
  return (
    <MenuBlock
      menuId={el.props.menuId ?? ""}
      layout={el.props.layout as "horizontal" | "vertical" | undefined}
      dropdownTrigger={el.props.dropdownTrigger as "hover" | "click" | undefined}
      megaMenuWidth={el.props.megaMenuWidth as "contained" | "full-width" | undefined}
      tenantHost={tenantHost}
      lang={requestedLang}
    />
  );
```
Add `import MenuBlock from "./MenuBlock.astro";` at the top of `SectionBlock.astro`. Confirm `tenantHost`/`requestedLang` are already available in this component's scope (check whether `SectionBlock.astro` currently receives them as props or reads them itself — if neither, thread them through as new optional props from `[...slug].astro`/`posts/[slug].astro`, which already compute both).

- [ ] **Step 3: Add CSS**

Append to `apps/frontend/src/styles/global.css`:
```css
.ds-menu-list { display: flex; gap: 1.5rem; list-style: none; margin: 0; padding: 0; }
.ds-menu-vertical .ds-menu-list { flex-direction: column; gap: 0.25rem; }
.ds-menu-item { position: relative; }
.ds-menu-item > a { text-decoration: none; color: inherit; }
.ds-menu-dropdown, .ds-mega-menu { display: none; position: absolute; top: 100%; left: 0; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 20; }
.ds-menu-dropdown { list-style: none; margin: 0; padding: 0.5rem 0; min-width: 12rem; }
.ds-menu-dropdown li { padding: 0; }
.ds-menu-dropdown a { display: block; padding: 0.5rem 1rem; text-decoration: none; color: inherit; }
.ds-mega-menu { padding: 1.5rem; gap: 2rem; }
.ds-mega-full { left: 0; right: 0; width: 100%; }
.ds-mega-contained { min-width: 40rem; }
.ds-mega-column ul { list-style: none; margin: 0; padding: 0; }
.ds-mega-column a { display: flex; align-items: center; gap: 0.5rem; text-decoration: none; color: inherit; padding: 0.35rem 0; }
.ds-mega-column img { width: 1.5rem; height: 1.5rem; object-fit: cover; border-radius: 0.25rem; }
.ds-mega-heading { font-weight: 700; margin: 0 0 0.5rem; }
[data-trigger="hover"] .ds-menu-item.has-dropdown:hover > .ds-menu-dropdown,
[data-trigger="hover"] .ds-menu-item.has-mega:hover > .ds-mega-menu,
.ds-menu-item.has-dropdown:focus-within > .ds-menu-dropdown,
.ds-menu-item.has-mega:focus-within > .ds-mega-menu,
.ds-menu-item.is-open-click > .ds-menu-dropdown,
.ds-menu-item.is-open-click > .ds-mega-menu {
  display: flex;
  flex-wrap: wrap;
}
.ds-menu-dropdown.is-open, .ds-menu-item.is-open-click > .ds-menu-dropdown { display: block; }
.ds-menu-toggle { display: none; flex-direction: column; gap: 4px; background: none; border: none; cursor: pointer; padding: 0.5rem; }
.ds-menu-toggle span { display: block; width: 22px; height: 2px; background: currentColor; }
@media (max-width: 768px) {
  .ds-menu-toggle { display: flex; }
  .ds-menu-list { display: none; flex-direction: column; position: absolute; top: 100%; left: 0; right: 0; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 1rem; z-index: 30; }
  .ds-menu.is-open .ds-menu-list { display: flex; }
  .ds-menu-dropdown, .ds-mega-menu { position: static; box-shadow: none; padding-left: 1rem; }
  .ds-mega-menu { display: none; flex-direction: column; }
  .ds-menu-item.is-open-click > .ds-mega-menu, .ds-menu-item.is-open-click > .ds-menu-dropdown { display: flex; }
}
```

- [ ] **Step 4: Manual verification**

Run `pnpm dev:frontend` (+ `pnpm dev:api`), view a page containing the Menu element on desktop width — confirm dropdown/mega-menu opens on hover (or click, if configured), then resize below 768px — confirm the hamburger toggle appears and the mobile menu opens/closes, and that a mega-menu item collapses to a vertical list on mobile.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/MenuBlock.astro apps/frontend/src/components/SectionBlock.astro apps/frontend/src/styles/global.css
git commit -m "feat(frontend): render menu element with responsive dropdown/mega-menu/hamburger"
```

---

### Task 13: End-to-end verification + typecheck/build

**Files:** none (verification only)

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS across `apps/api`, `apps/admin`, `apps/frontend`

- [ ] **Step 2: Full workspace build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Manual end-to-end pass**

With all three dev servers running against a real dev tenant:
1. Content ▸ Menus: create "Main Menu" with one plain link, one nested-children item, one mega-menu item (2 columns, icons/images), and (if the tenant has multilang on) a translated label on one item.
2. Open any Page in Designer, drop a Menu element into the header area of the page, select "Main Menu", save, publish.
3. View the live page: confirm all 3 item types render correctly, hover/click behavior matches the configured `dropdownTrigger`, and resizing to mobile width shows the hamburger + working mobile nav.
4. Confirm a `menus.write`-less role cannot create/edit menus (403), and that granting the permission via Roles editor fixes it without needing a server restart.

- [ ] **Step 4: Update CLAUDE.md**

Add a paragraph to `apps/api`'s collection-system section of `CLAUDE.md` documenting the new `menus` collection and `"menu"` Designer element, following this file's existing documentation depth/style for other collections (e.g. the `categories`/`design_templates` paragraphs) — this repo's CLAUDE.md is kept in sync with code changes as a matter of course.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the menus collection + Menu Designer element in CLAUDE.md"
```

---

## Follow-up (separate plan, not in this one)

The Header/Footer builder (spec's feature #2) depends on the `"menu"` Designer element shipped in Task 9 above but is otherwise independent — it gets its own plan (`site_sections` table, `BlockRenderer.astro` extraction, `PageDesignerRoute`/Designer reuse for header/footer, `BaseLayout.astro` wiring, `siteSections.write` permission) once this one has landed and been verified.
