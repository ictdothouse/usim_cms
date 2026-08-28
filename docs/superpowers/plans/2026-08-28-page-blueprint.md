# Page Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a page be created from a reusable blueprint (a ready-made section layout) instead of only a blank canvas, and let a webmaster save a finished page as a new blueprint for their own tenant.

**Architecture:** One new control-plane table (`page_blueprints`, visible instance-wide when unscoped, per-tenant when scoped) with hand-written CRUD routes reusing the existing page-layout validator; a new `BlueprintGallery` admin component (picker/manage modes) built on an extracted, reusable `TemplatePreview`; two small UI hooks (Create Page's blueprint picker, Designer's "Save as blueprint").

**Tech Stack:** Fastify + Drizzle (control-plane pool, `apps/api/src/db/tenant-pool.ts`), React + react-hook-form (`apps/admin`), existing `validateLayout` validator.

**Spec:** `docs/superpowers/specs/2026-08-28-page-blueprint-design.md`

## Global Constraints

- `page_blueprints` is a **control-plane** table (bootstrapped via
  `apps/api/src/db/bootstrap-public.sql`), never a per-tenant-DB migration —
  see the spec's "Why control-plane" section.
- No `thumbnailUrl` column — deliberately omitted, see spec.
- A new permission string (`blueprints.write`) must be added to BOTH
  `PERMISSIONS` in `apps/api/src/index.ts` AND the client-side `PERMISSIONS`
  list in `apps/admin/src/App.tsx` (line ~2636) — a permission only really
  exists once it's in both.
- No dedicated "use blueprint" / "save as blueprint" backend route — both
  flows compose the plain CRUD routes this plan adds, from the client.
- Section-lock, real thumbnails, and event/contact-form blueprints are out of
  scope for this plan.
- Existing convention in this codebase: `tenant-pool.ts` CRUD helpers for
  control-plane collections (`listLanguages`, `createLanguage`, etc.) have no
  unit tests (no DB fixture harness exists for them) — this plan does not add
  one for `pageBlueprints` either, matching that precedent. Verification for
  server-side work in this plan is `tsc --noEmit` + manual route review, not
  new automated tests, except where noted.

---

### Task 1: Schema + control-plane bootstrap + seed data

**Files:**
- Modify: `apps/api/src/db/schema.ts` (add `pageBlueprints` table, after `tenantLanguages`)
- Modify: `apps/api/src/db/bootstrap-public.sql` (add `CREATE TABLE IF NOT EXISTS "public"."page_blueprints"` + seed `INSERT`s, after the `tenant_languages` block at the end of the file)

**Interfaces:**
- Produces: `schema.pageBlueprints` (Drizzle table) with columns `id`,
  `tenantHost` (nullable), `name`, `description` (nullable), `category`
  (nullable), `layout` (jsonb, default `[]`), `settings` (jsonb, default
  `{}`), `createdBy` (nullable uuid), `createdByEmail` (nullable text),
  `createdAt`, `updatedAt`.

- [ ] **Step 1: Add the Drizzle table to schema.ts**

Add after the existing `tenantLanguages` table definition:

```ts
// Page Blueprint (Sprint 5 sub-project 2) — a ready-made section layout a
// page can start from. Control-plane, not a tenant-DB table: a null
// tenantHost means "system-wide, usable by every tenant" (mirrors how
// `languages` is instance-wide), a set tenantHost scopes it to one tenant's
// own library (mirrors tenantLanguages' bare tenant_host text column — not
// a FK, tenants are looked up by host). See
// docs/superpowers/specs/2026-08-28-page-blueprint-design.md for why this
// lives here instead of in design_templates' per-tenant-DB table.
export const pageBlueprints = pgTable("page_blueprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantHost: text("tenant_host"),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  layout: jsonb("layout").notNull().default([]),
  settings: jsonb("settings").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByEmail: text("created_by_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the bootstrap SQL + seed rows**

Append to the end of `bootstrap-public.sql`:

```sql
-- Page Blueprint (Sprint 5 sub-project 2). tenant_host NULL = system-wide.
CREATE TABLE IF NOT EXISTS "public"."page_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_host" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
	"created_by_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Seed system blueprints (docs/laporan-audit-ui-ux.md §5.6's practical
-- list), only ever using element types that already exist. Kept
-- deliberately small — hero/text/cardgrid/ctabanner/postlist cover every
-- seed without inventing new element types. Guard on name (no natural
-- unique key on this table) so re-running this file stays idempotent.
INSERT INTO "public"."page_blueprints" ("tenant_host", "name", "description", "category", "layout")
SELECT NULL, v.name, v.description, v.category, v.layout::jsonb
FROM (VALUES
	('Landing page jabatan', 'Hero, quick links, statistik, highlight berita, CTA', 'Landing',
		'[{"type":"section","props":{"paddingY":"4rem"},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Nama Jabatan"}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"postlist","props":{"count":"3","columns":"3","postLayout":"grid"}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"ctabanner","props":{"heading":"Hubungi Kami","button1Label":"Hubungi","button1Href":"/hubungi"}}]}]}]}]'),
	('About / profil', 'Hero ringkas, pengenalan, visi/misi, CTA', 'About',
		'[{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Tentang Kami"}},{"type":"text","props":{"text":"Pengenalan ringkas organisasi."}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h2","text":"Visi"}},{"type":"text","props":{"text":""}}]},{"elements":[{"type":"heading","props":{"level":"h2","text":"Misi"}},{"type":"text","props":{"text":""}}]}]}]}]'),
	('Program / perkhidmatan', 'Hero, overview, feature cards, CTA', 'Program',
		'[{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Nama Program"}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"cardgrid","props":{"cards":"[]","columns":"3"}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"ctabanner","props":{"heading":"Mohon Sekarang","button1Label":"Mohon"}}]}]}]}]'),
	('News hub', 'Heading, post grid, CTA subscribe', 'News',
		'[{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Berita & Pengumuman"}}]}]}]},{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"postlist","props":{"count":"9","columns":"3","postLayout":"grid"}}]}]}]}]'),
	('Contact', 'Contact info, operating hours, location', 'Contact',
		'[{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Hubungi Kami"}},{"type":"text","props":{"text":"Alamat, waktu operasi dan maklumat hubungan."}}]}]}]}]'),
	('Simple content page', 'Page heading, rich text, related links', 'Content',
		'[{"type":"section","props":{},"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"h1","text":"Tajuk Halaman"}},{"type":"text","props":{"text":""}}]}]}]}]')
) AS v(name, description, category, layout)
WHERE NOT EXISTS (
	SELECT 1 FROM "public"."page_blueprints" pb WHERE pb.tenant_host IS NULL AND pb.name = v.name
);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/api exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/bootstrap-public.sql
git commit -m "feat(blueprints): add page_blueprints control-plane table + seed data"
```

---

### Task 2: Control-plane CRUD helpers in tenant-pool.ts

**Files:**
- Modify: `apps/api/src/db/tenant-pool.ts` (add helpers after `deleteLanguage`/the language-related block, near `getTenantLanguageSelection`)

**Interfaces:**
- Consumes: `schema.pageBlueprints` (Task 1), `pool`/`ensurePublicSchema`/`drizzle` (already in file).
- Produces:
  - `listPageBlueprints(tenantHost: string, category?: string): Promise<PageBlueprintRow[]>`
  - `createPageBlueprint(input: { tenantHost: string | null; name: string; description?: string | null; category?: string | null; layout: unknown; settings?: unknown; createdBy?: string | null; createdByEmail?: string | null }): Promise<PageBlueprintRow>`
  - `getPageBlueprint(id: string): Promise<PageBlueprintRow | undefined>`
  - `updatePageBlueprint(id: string, patch: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown }): Promise<void>`
  - `deletePageBlueprint(id: string): Promise<void>`
  - (all exported; `index.ts` Task 3 consumes every one of these by name)

- [ ] **Step 1: Add the import for `isNull`/`or`**

Change the existing drizzle-orm import line:

```ts
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
```

- [ ] **Step 2: Add the CRUD helpers**

Add after the `deleteLanguage` function (before the `getTenantLanguageSelection` i18n-Phase-2 comment block):

```ts
// Page Blueprint (Sprint 5 sub-project 2) — control-plane, tenantHost NULL
// means system-wide. See schema.ts's pageBlueprints comment.
export async function listPageBlueprints(tenantHost: string, category?: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const scopeFilter = or(isNull(schema.pageBlueprints.tenantHost), eq(schema.pageBlueprints.tenantHost, tenantHost));
    const where = category ? and(scopeFilter, eq(schema.pageBlueprints.category, category)) : scopeFilter;
    return db.select().from(schema.pageBlueprints).where(where).orderBy(asc(schema.pageBlueprints.name));
  } finally {
    client.release();
  }
}

export async function getPageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
    return row;
  } finally {
    client.release();
  }
}

export async function createPageBlueprint(input: {
  tenantHost: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  layout: unknown;
  settings?: unknown;
  createdBy?: string | null;
  createdByEmail?: string | null;
}) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db
      .insert(schema.pageBlueprints)
      .values({
        tenantHost: input.tenantHost,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        layout: input.layout ?? [],
        settings: input.settings ?? {},
        createdBy: input.createdBy ?? null,
        createdByEmail: input.createdByEmail ?? null,
      })
      .returning();
    return row;
  } finally {
    client.release();
  }
}

export async function updatePageBlueprint(
  id: string,
  patch: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown },
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.pageBlueprints).set({ ...patch, updatedAt: new Date() }).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}

export async function deletePageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/api exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/tenant-pool.ts
git commit -m "feat(blueprints): add control-plane CRUD helpers for page blueprints"
```

---

### Task 3: Server permission + hand-written CRUD routes

**Files:**
- Modify: `apps/api/src/index.ts`
  - `PERMISSIONS` set (~line 103): add `"blueprints.write"`
  - Import block (~line 47): add `listPageBlueprints, getPageBlueprint, createPageBlueprint, updatePageBlueprint, deletePageBlueprint` to the existing `tenant-pool.js` import
  - Reuse the already-imported `validateLayout`
  - Route registration: add new routes inside the SAME `protectedScope.register(async (protectedScope) => { ... })` block that already holds the `/api/tenant-languages` routes (~line 2081-2118), right after them

**Interfaces:**
- Consumes: Task 2's five `tenant-pool.ts` functions; existing `hasPermission(args, permission)`; existing `validateLayout(layout): string | null`.
- Produces: `GET/POST/PATCH/DELETE /api/blueprints[/:id]` — consumed by Task 4's admin API client.

- [ ] **Step 1: Add the permission string**

In the `PERMISSIONS` set (~line 103-120), add a line:

```ts
  "blueprints.write",
```

- [ ] **Step 2: Add the tenant-pool.ts imports**

Extend the existing import from `./db/tenant-pool.js` to also pull in the five new functions:

```ts
  listPageBlueprints,
  getPageBlueprint,
  createPageBlueprint,
  updatePageBlueprint,
  deletePageBlueprint,
```

- [ ] **Step 3: Add the routes**

Insert right after the closing `});` of the `PUT /api/tenant-languages` route (~line 2118), still inside the same `protectedScope.register(...)` block:

```ts
  // Page Blueprint (Sprint 5 sub-project 2) — control-plane CRUD, hand-
  // written for the same reason /api/tenant-languages is (control-plane
  // data via tenant-pool.ts, not req.db — generic-crud.ts only ever
  // operates on a tenant's own database connection).
  function canWriteBlueprint(req: FastifyRequest, targetTenantHost: string | null): boolean {
    if (req.user.role === "superadmin") return true;
    if (targetTenantHost === null) return false; // only superadmin may touch a system blueprint
    return targetTenantHost === req.tenantHost && hasPermission({ role: req.user.role, permissions: req.user.permissions }, "blueprints.write");
  }

  protectedScope.get("/api/blueprints", async (req) => {
    const { category } = req.query as { category?: string };
    const items = await listPageBlueprints(req.tenantHost, category || undefined);
    return { items };
  });

  protectedScope.post("/api/blueprints", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string | null;
      category?: string | null;
      layout?: unknown;
      settings?: unknown;
      scope?: "system" | "tenant";
    };
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    const targetTenantHost = body.scope === "system" ? null : req.tenantHost;
    if (!canWriteBlueprint(req, targetTenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const layoutErr = validateLayout(body.layout ?? []);
    if (layoutErr) {
      reply.code(400);
      return { error: layoutErr };
    }
    const row = await createPageBlueprint({
      tenantHost: targetTenantHost,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      layout: body.layout ?? [],
      settings: body.settings ?? {},
      createdBy: req.user.id,
      createdByEmail: req.user.email,
    });
    return { item: row };
  });

  protectedScope.patch("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const body = req.body as { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown };
    if (body.layout !== undefined) {
      const layoutErr = validateLayout(body.layout);
      if (layoutErr) {
        reply.code(400);
        return { error: layoutErr };
      }
    }
    await updatePageBlueprint(id, body);
    return { saved: true };
  });

  protectedScope.delete("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    await deletePageBlueprint(id);
    return { deleted: true };
  });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ucms/api exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(blueprints): add blueprints.write permission + /api/blueprints CRUD routes"
```

---

### Task 4: Admin API client + PERMISSIONS list entry

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (add `PageBlueprint` interface + `listBlueprints`/`createBlueprint`/`updateBlueprint`/`deleteBlueprint`; widen `createPage`'s param type)
- Modify: `apps/admin/src/App.tsx` (~line 2664, the client-side `PERMISSIONS` map: add `"blueprints.write": "perm-blueprints-write"`)

**Interfaces:**
- Consumes: `request()` helper (existing, `apps/admin/src/lib/api.ts`).
- Produces: `PageBlueprint` type + the four client functions — consumed by Task 6 (`BlueprintGallery`), Task 7 (`PagesPanel`), Task 8 (`Designer.tsx`).

- [ ] **Step 1: Add the `PageBlueprint` interface + client functions**

Add near the existing `DesignTemplate` interface/`listTemplates`/`createTemplate` (~line 332-346):

```ts
export interface PageBlueprint {
  id: string;
  tenantHost: string | null;
  name: string;
  description: string | null;
  category: string | null;
  layout: unknown[];
  settings: Record<string, unknown>;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export const listBlueprints = (tenantHost: string, token: string, category?: string) =>
  request(`/api/blueprints${category ? `?category=${encodeURIComponent(category)}` : ""}`, tenantHost, token).then(
    (b) => b.items as PageBlueprint[],
  );

export const createBlueprint = (
  tenantHost: string,
  token: string,
  data: { name: string; description?: string; category?: string; layout: unknown; settings?: unknown; scope?: "system" | "tenant" },
) => request("/api/blueprints", tenantHost, token, { method: "POST", body: JSON.stringify(data) }).then((b) => b.item as PageBlueprint);

export const updateBlueprint = (
  tenantHost: string,
  token: string,
  id: string,
  patch: { name?: string; description?: string; category?: string },
) => request(`/api/blueprints/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(patch) });

export const deleteBlueprint = (tenantHost: string, token: string, id: string) =>
  request(`/api/blueprints/${id}`, tenantHost, token, { method: "DELETE" });
```

- [ ] **Step 2: Widen `createPage`'s param type**

Change the existing `createPage` (~line 176):

```ts
export const createPage = (
  tenantHost: string,
  token: string,
  data: { slug: string; title: string; layout?: unknown; settings?: unknown },
) =>
  request("/api/pages", tenantHost, token, { method: "POST", body: JSON.stringify(data) }).then(
    (b) => b.item as Record<string, unknown>,
  );
```

- [ ] **Step 3: Add the client-side permission entry**

In `App.tsx`'s `PERMISSIONS` map (~line 2664, right after `"menus.write": "perm-menus-write"`):

```ts
  "blueprints.write": "perm-blueprints-write",
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/App.tsx
git commit -m "feat(blueprints): add admin API client + blueprints.write client-side permission entry"
```

---

### Task 5: Extract `TemplatePreview` into its own reusable file

**Files:**
- Create: `apps/admin/src/designer/TemplatePreview.tsx`
- Modify: `apps/admin/src/Designer.tsx` (remove the inline `TemplatePreview` function at ~line 2561-2587, import the extracted one instead)

**Interfaces:**
- Produces: `TemplatePreview({ rows }: { rows: Row[] })` — a pure, prop-driven component taking an already-normalized `rows[]` array (NOT the raw `tpl: api.DesignTemplate`/`tpl: api.PageBlueprint` — normalization happens at each call site, so this component has zero knowledge of "template" vs "blueprint" shapes). Consumed by `Designer.tsx`'s Templates modal and `BlueprintGallery.tsx` (Task 6).
- Consumes: `Row` type from `./types` (already exported there per the existing Layer-0 extraction).

- [ ] **Step 1: Create the extracted component**

```tsx
import type { Row } from "./types";

// Rough layout impression only ("susunan" — not a pixel-accurate render, no
// real colors/fonts/media) so a list of 100+ saved layouts (templates or
// blueprints) stays scannable without the cost/dependency of a real
// screenshot thumbnail (would need a headless-browser render pipeline just
// for this). Takes an already-normalized rows[] — callers with a
// section/row/column/element-shaped template, or a whole page's rows,
// normalize to this shape before rendering.
export function TemplatePreview({ rows }: { rows: Row[] }) {
  return (
    <div className="flex h-14 flex-col gap-0.5 overflow-hidden rounded-md border border-line/30 bg-canvas/40 p-1">
      {rows.slice(0, 4).map((row, i) => (
        <div key={i} className="flex flex-1 gap-0.5">
          {(row.columns ?? []).slice(0, 5).map((col, j) => (
            <div key={j} className="flex flex-1 flex-col justify-center gap-[1px] rounded-sm bg-white/70 p-[1px]">
              {(col.elements ?? []).slice(0, 3).map((_, k) => (
                <div key={k} className="h-[3px] w-full rounded-full bg-accent/40" />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Update Designer.tsx to use the extracted version**

Remove the inline `function TemplatePreview({ tpl }: { tpl: api.DesignTemplate }) { ... }` block (~line 2561-2587). Add the import at the top of `Designer.tsx`:

```ts
import { TemplatePreview } from "./designer/TemplatePreview";
```

Add a small local helper right where the old function was — the normalization it used to do internally (turning a `DesignTemplate`'s `kind`/`value` into `rows[]`) now happens at the call site instead:

```tsx
// Normalizes a DesignTemplate's kind/value into TemplatePreview's rows[]
// shape — same normalization the old inline TemplatePreview used to do
// internally, now a plain call-site helper so the preview component itself
// stays templates-vs-blueprints agnostic.
function templateRows(tpl: api.DesignTemplate): Row[] {
  const kind = (tpl.data?.kind as string | undefined) ?? "section";
  const value = tpl.data?.kind ? tpl.data.value : tpl.data;
  return kind === "section"
    ? ((value as SectionProps).rows ?? [])
    : kind === "row"
      ? [value as Row]
      : kind === "column"
        ? [{ columns: [value as Col] } as Row]
        : [{ columns: [{ elements: [value as El] }] } as Row];
}
```

Find every JSX call site that rendered `<TemplatePreview tpl={...} />` (grep `<TemplatePreview` in `Designer.tsx`) and change each to `<TemplatePreview rows={templateRows(tpl)} />` (keep whatever local variable name that call site already used in place of `tpl`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors — this step is a pure refactor, so a clean typecheck is the whole verification (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/designer/TemplatePreview.tsx apps/admin/src/Designer.tsx
git commit -m "refactor(designer): extract TemplatePreview into designer/TemplatePreview.tsx for reuse"
```

---

### Task 6: `BlueprintGallery` component

**Files:**
- Create: `apps/admin/src/BlueprintGallery.tsx`

**Interfaces:**
- Consumes: `api.listBlueprints`/`api.createBlueprint`/`api.updateBlueprint`/`api.deleteBlueprint`/`PageBlueprint` (Task 4), `TemplatePreview` (Task 5).
- Produces: `<BlueprintGallery tenantHost token mode onUse? isSuper />` — consumed by Task 7 (`PagesPanel`, `mode="picker"`) and Task 9 (`App.tsx`'s new sub-tab/tab, `mode="manage"`).

- [ ] **Step 1: Write the component**

`useT` is defined and exported directly from `App.tsx` (`export const useT = () => useContext(I18nCtx)`, ~line 69) — not a separate module, and not passed as a prop the way `Designer.tsx` receives `t`. `BlueprintGallery.tsx` imports it from there; this is a safe circular import (`App.tsx` imports `BlueprintGallery`, `BlueprintGallery` imports `useT` from `App.tsx`) since `useT` is only ever called inside a component function body, never at module-evaluation time.

```tsx
import { useEffect, useState } from "react";
import * as api from "./lib/api";
import { TemplatePreview } from "./designer/TemplatePreview";
import { useT } from "./App";
import type { Row } from "./designer/types";

function blueprintRows(bp: api.PageBlueprint): Row[] {
  // A blueprint's layout is a whole page's Block[] (section blocks only) —
  // flatten every section's own rows into one preview strip.
  const sections = (bp.layout ?? []) as Array<{ rows?: Row[] }>;
  return sections.flatMap((s) => s.rows ?? []);
}

export function BlueprintGallery({
  tenantHost,
  token,
  mode,
  onUse,
  isSuper,
}: {
  tenantHost: string;
  token: string;
  mode: "picker" | "manage";
  onUse?: (bp: api.PageBlueprint) => void;
  isSuper: boolean;
}) {
  const { t } = useT();
  const [blueprints, setBlueprints] = useState<api.PageBlueprint[]>([]);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setBlueprints(await api.listBlueprints(tenantHost, token, category || undefined));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, category]);

  async function remove(id: string) {
    try {
      await api.deleteBlueprint(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categories = Array.from(new Set(blueprints.map((b) => b.category).filter((c): c is string => Boolean(c))));

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger">{error}</p>}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory("")}
            className={`rounded-full px-3 py-1 text-xs font-medium ${category === "" ? "bg-accent text-white" : "bg-canvas text-body"}`}
          >
            {t("blueprints-all-categories")}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${category === c ? "bg-accent text-white" : "bg-canvas text-body"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {blueprints.map((bp) => (
          <div key={bp.id} className="space-y-2 rounded-lg border border-line/30 p-3">
            <TemplatePreview rows={blueprintRows(bp)} />
            <div>
              <p className="text-xs font-semibold text-ink">{bp.name}</p>
              {bp.description && <p className="text-[11px] text-sub">{bp.description}</p>}
              {bp.tenantHost === null && (
                <span className="mt-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
                  {t("blueprints-system-badge")}
                </span>
              )}
            </div>
            {mode === "picker" ? (
              <button
                onClick={() => onUse?.(bp)}
                className="w-full rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              >
                {t("blueprints-use")}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => void remove(bp.id)}
                  disabled={bp.tenantHost === null && !isSuper}
                  className="flex-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-40"
                >
                  {t("blueprints-delete")}
                </button>
              </div>
            )}
          </div>
        ))}
        {blueprints.length === 0 && <p className="text-xs text-sub">{t("blueprints-empty")}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/BlueprintGallery.tsx
git commit -m "feat(blueprints): add BlueprintGallery component (picker/manage modes)"
```

---

### Task 7: Create Page flow — blueprint picker in `PagesPanel`

**Files:**
- Modify: `apps/admin/src/App.tsx`
  - `PagesPanel` function body (~line 356-463): add picker-modal state + `useBlueprint` handler
  - All three responsive copies of the quick-create form (~line 502, 775, 2284): add a "Choose blueprint" button next to the existing submit button
  - `createPage` call already covered by Task 4's type widening — no further client typing needed here

**Interfaces:**
- Consumes: `api.createPage` (widened in Task 4), `BlueprintGallery` (Task 6).

- [ ] **Step 1: Add picker state + handler to `PagesPanel`**

Add near the top of `PagesPanel`, alongside the other `useState` calls (~line 359-365):

```ts
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);
```

Add a new handler next to `onCreate` (~after line 414):

```ts
  async function useBlueprint(bp: api.PageBlueprint) {
    const title = window.prompt(t("blueprints-name-prompt"));
    if (!title) return;
    const base = slugify(title) || "page";
    const existing = new Set(pages.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    try {
      const item = await api.createPage(tenantHost, token, { slug: candidate, title, layout: bp.layout, settings: bp.settings });
      setShowBlueprintPicker(false);
      await refresh();
      navigate(item.id as string);
    } catch (err) {
      setError((err as Error).message);
    }
  }
```

`window.prompt` is used here deliberately for this single plain-text
"what's the new page called" step — the previously-documented "don't use
`window.prompt`" lesson in this codebase concerns a browser muting REPEAT JS
dialogs across a session; if that risk applies here too in practice, swap
this one prompt for a tiny controlled `<input>` inside the blueprint-picker
modal instead before shipping (flag this to the user rather than silently
picking one, since it's a judgment call about an existing lesson's scope).

- [ ] **Step 2: Add the "Choose blueprint" button + modal**

At all three responsive copies of the quick-create form JSX (~line 502, 775, 2284 — each is `<form onSubmit={form.handleSubmit(onCreate)} ...>`), add a button immediately after the existing submit button:

```tsx
              <button
                type="button"
                onClick={() => setShowBlueprintPicker(true)}
                className="rounded-full border border-line/40 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
              >
                {t("blueprints-choose")}
              </button>
```

Add the modal once, at the end of `PagesPanel`'s returned JSX tree (sibling to the top-level wrapping `<div>`'s other children, rendered conditionally):

```tsx
      {showBlueprintPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBlueprintPicker(false)}>
          <div className="max-h-[85vh] w-[min(90vw,60rem)] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{t("blueprints-choose")}</p>
              <button onClick={() => setShowBlueprintPicker(false)} aria-label={t("designer-close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <BlueprintGallery tenantHost={tenantHost} token={token} mode="picker" onUse={(bp) => void useBlueprint(bp)} isSuper={false} />
          </div>
        </div>
      )}
```

Add the import at the top of `App.tsx` (if not already present):

```ts
import { BlueprintGallery } from "./BlueprintGallery";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "feat(blueprints): add blueprint picker to Create Page flow"
```

---

### Task 8: "Save as blueprint" in Designer

**Files:**
- Modify: `apps/admin/src/Designer.tsx`
  - Add state + `confirmSaveAsBlueprint` near the existing `saveAsTemplate`/`confirmSaveTemplate` (~line 1735-1766)
  - Add a button + small modal near the existing Templates button/modal (~line 5480-5545)

**Interfaces:**
- Consumes: `api.createBlueprint` (Task 4).

- [ ] **Step 1: Add state + handler**

Confirmed against `Designer.tsx`'s existing whole-page `save()` (~line
2128-2148): it sends `layout: merged[BASE_LANG]` (the post-language-split
base layout) and `settings: pageSettings`. A blueprint snapshot is simpler —
it doesn't need the multilang split, so this step uses the plain in-progress
`blocks` (the currently-on-canvas layout, same value `save()` clones into
`merged[BASE_LANG]`) and the real `pageSettings` variable directly.

Add state near `pendingTemplate`/`templateName` (~line 1111):

```ts
  const [showSaveBlueprint, setShowSaveBlueprint] = useState(false);
  const [blueprintName, setBlueprintName] = useState("");
  const [blueprintDescription, setBlueprintDescription] = useState("");
  const [blueprintCategory, setBlueprintCategory] = useState("");
  const [blueprintScope, setBlueprintScope] = useState<"system" | "tenant">("tenant");
  const [blueprintBusy, setBlueprintBusy] = useState(false);
```

Add the confirm handler near `confirmSaveTemplate` (~after line 1766):

```ts
  async function confirmSaveAsBlueprint() {
    const name = blueprintName.trim();
    if (!name) return;
    setBlueprintBusy(true);
    try {
      await api.createBlueprint(tenantHost, token, {
        name,
        description: blueprintDescription.trim() || undefined,
        category: blueprintCategory.trim() || undefined,
        layout: blocks,
        settings: pageSettings,
        scope: blueprintScope,
      });
      setShowSaveBlueprint(false);
      setBlueprintName("");
      setBlueprintDescription("");
      setBlueprintCategory("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlueprintBusy(false);
    }
  }
```

- [ ] **Step 2: Add the button + modal**

Add a button next to the existing "Templates" button (~line 5533-5538 area, same header/toolbar region):

```tsx
              <button
                onClick={() => setShowSaveBlueprint(true)}
                className="flex items-center gap-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#e8e8ed]"
              >
                <LayoutTemplate className="h-3.5 w-3.5" /> {t("blueprints-save-as")}
              </button>
```

Add the modal (same overlay pattern as the Templates modal at ~line 5480):

```tsx
      {showSaveBlueprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowSaveBlueprint(false)}>
          <div className="w-[min(90vw,28rem)] rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{t("blueprints-save-as")}</p>
              <button onClick={() => setShowSaveBlueprint(false)} aria-label={t("designer-close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void confirmSaveAsBlueprint();
              }}
              className="space-y-2"
            >
              <input
                autoFocus
                value={blueprintName}
                onChange={(ev) => setBlueprintName(ev.target.value)}
                placeholder={t("blueprints-name-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                value={blueprintDescription}
                onChange={(ev) => setBlueprintDescription(ev.target.value)}
                placeholder={t("blueprints-description-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                value={blueprintCategory}
                onChange={(ev) => setBlueprintCategory(ev.target.value)}
                placeholder={t("blueprints-category-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              {isSuper && (
                <select
                  value={blueprintScope}
                  onChange={(ev) => setBlueprintScope(ev.target.value as "system" | "tenant")}
                  className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs"
                >
                  <option value="tenant">{t("blueprints-scope-tenant")}</option>
                  <option value="system">{t("blueprints-scope-system")}</option>
                </select>
              )}
              <button
                type="submit"
                disabled={!blueprintName.trim() || blueprintBusy}
                className="w-full rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {t("blueprints-save-as")}
              </button>
            </form>
          </div>
        </div>
      )}
```

`isSuper` must be available as a prop on `Designer` for the scope selector
above to compile — check `Designer`'s existing prop list first; if it isn't
already threaded through, add `isSuper: boolean` to its props and pass the
same `isSuper` value `PageDesignerRoute`/`ContentManager` already compute
elsewhere in `App.tsx`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/Designer.tsx
git commit -m "feat(blueprints): add \"Save as blueprint\" action to Designer"
```

---

### Task 9: Management screen — ContentManager sub-tab + webmaster Tab

**Files:**
- Modify: `apps/admin/src/App.tsx`
  - `ContentSubTab` type (~line 3446): add `"blueprints"`
  - `ContentManager`'s `subTabs` array (~line 3467-3478): add a superadmin-only entry
  - `ContentManager`'s `<Routes>` (~line 3514-3529): add the `blueprints` route
  - Webmaster `contentTabs` array (~line 4400): add `"blueprints"`
  - Top-level `<Routes>` (~line 4520-4534): add the webmaster `blueprints` route
  - `Tab` union type and every place `"menus"` is separately wired (`TAB_META` label/icon map, etc.) — grep `"menus"` across `App.tsx` and add a matching `"blueprints"` entry everywhere it appears, the same way `"languages"` was added alongside it originally

**Interfaces:**
- Consumes: `BlueprintGallery` (Task 6, `mode="manage"`).

- [ ] **Step 1: Add to `ContentSubTab` + `subTabs`**

```ts
type ContentSubTab = "pages" | "posts" | "media" | "theme" | "languages" | "menus" | "blueprints";
```

In `subTabs` (~line 3471-3477), add inside the existing `isSuper ? [...]` array:

```ts
          { id: "blueprints" as const, labelKey: "blueprints-title" as const, icon: LayoutTemplate },
```

- [ ] **Step 2: Add the superadmin sub-route**

```tsx
            {isSuper && (
              <Route path="blueprints" element={<BlueprintGallery key={siteHost} tenantHost={siteHost} token={token} mode="manage" isSuper />} />
            )}
```

- [ ] **Step 3: Add the webmaster top-level tab + route**

```ts
  const contentTabs: Tab[] = isSuper ? ["content", "global-theme", "feed"] : ["content", "theme", "languages", "menus", "blueprints"];
```

```tsx
                <Route path="blueprints" element={!isSuper && session.tenantHost ? (<BlueprintGallery tenantHost={session.tenantHost} token={session.token} mode="manage" isSuper={false} />) : (<Navigate to="/dashboard" replace />)} />
```

- [ ] **Step 4: Wire the new tab into every place `"menus"` already appears as a `Tab`**

Grep `"menus"` across `App.tsx` (`Tab` union declaration, `TAB_META` label/icon map, any other switch keyed on `Tab`) and add a matching `"blueprints"` entry at each site, following the exact same shape `"menus"` uses (e.g. `TAB_META.blueprints = { labelKey: "blueprints-title", icon: LayoutTemplate }` if that's the map's shape).

- [ ] **Step 5: Add the `BlueprintGallery` import if Task 7 didn't already add it**

```ts
import { BlueprintGallery } from "./BlueprintGallery";
```

(Skip if already present from Task 7.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "feat(blueprints): add blueprint management sub-tab (superadmin) and tab (webmaster)"
```

---

### Task 10: i18n keys

**Files:**
- Modify: `apps/admin/src/i18n.ts` (both `ms` and `en` blocks)

**Interfaces:**
- Produces: every `t("blueprints-*")` key referenced by Tasks 6-9, plus `"perm-blueprints-write"` (the i18n key `PERMISSIONS`' map value points at, shown in the Roles editor checkbox list — same role `"perm-menus-write"` already plays).

- [ ] **Step 1: Add keys to the `ms` block**

Insert after the existing `"perm-menus-write"` key (or whichever permission key was added most recently):

```ts
  "perm-blueprints-write": "Urus Page Blueprint",
  "blueprints-title": "Page Blueprint",
  "blueprints-choose": "Pilih blueprint",
  "blueprints-use": "Guna blueprint ini",
  "blueprints-save-as": "Simpan sebagai blueprint",
  "blueprints-delete": "Padam",
  "blueprints-empty": "Tiada blueprint lagi.",
  "blueprints-all-categories": "Semua kategori",
  "blueprints-system-badge": "Sistem",
  "blueprints-name-prompt": "Nama halaman baharu:",
  "blueprints-name-placeholder": "Nama blueprint",
  "blueprints-description-placeholder": "Penerangan (pilihan)",
  "blueprints-category-placeholder": "Kategori (pilihan)",
  "blueprints-scope-tenant": "Tapak ini sahaja",
  "blueprints-scope-system": "Semua tapak (sistem)",
```

- [ ] **Step 2: Add the matching keys to the `en` block**

```ts
  "perm-blueprints-write": "Manage Page Blueprints",
  "blueprints-title": "Page Blueprint",
  "blueprints-choose": "Choose blueprint",
  "blueprints-use": "Use this blueprint",
  "blueprints-save-as": "Save as blueprint",
  "blueprints-delete": "Delete",
  "blueprints-empty": "No blueprints yet.",
  "blueprints-all-categories": "All categories",
  "blueprints-system-badge": "System",
  "blueprints-name-prompt": "New page name:",
  "blueprints-name-placeholder": "Blueprint name",
  "blueprints-description-placeholder": "Description (optional)",
  "blueprints-category-placeholder": "Category (optional)",
  "blueprints-scope-tenant": "This site only",
  "blueprints-scope-system": "Every site (system)",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/i18n.ts
git commit -m "feat(blueprints): add ms/en i18n keys for Page Blueprint UI"
```

---

### Task 11: Full-stack verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (new paragraph documenting the Page Blueprint subsystem, per this project's standing convention of keeping CLAUDE.md in sync with shipped features)

- [ ] **Step 1: Full verification pass**

Run, in order:
```bash
pnpm --filter @ucms/api exec tsc --noEmit
pnpm --filter @ucms/admin exec tsc --noEmit
pnpm --filter @ucms/admin test
pnpm --filter @ucms/frontend exec astro check
```
Expected: 0 errors on all four (the frontend check is unaffected by this
plan's changes — `page_blueprints` has no `apps/frontend` surface — rerun it
anyway as a regression guard, matching this project's existing habit after
any cross-cutting change).

- [ ] **Step 2: Add the CLAUDE.md paragraph**

Add a new paragraph under the `apps/api` section (near the other Sprint-5
paragraphs already documenting the new Designer elements), covering: the
`page_blueprints` control-plane table and why it isn't per-tenant-DB, the
`blueprints.write` permission, the CRUD routes, the extracted
`TemplatePreview`, and the two UI entry points (Create Page picker,
Designer's Save-as-blueprint) — matching the level of detail this file
already gives every other Sprint 5 addition.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Page Blueprint subsystem in CLAUDE.md"
```
