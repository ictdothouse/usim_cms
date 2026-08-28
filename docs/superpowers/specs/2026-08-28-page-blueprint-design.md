# Page Blueprint — Design

Sprint 5 sub-project 2 (`docs/laporan-audit-ui-ux.md` §5.6). Lets a page start
from a ready-made skeleton (hero, quick links, CTA, etc.) instead of a blank
canvas, and lets a webmaster save a finished page as a reusable starting point
for future pages on their own tenant. Section-lock (superadmin locking a
section so it survives every clone uneditable) is explicitly deferred to a
later phase — this phase ships blueprints as plain, fully-editable-after-clone
starting points.

## Data model

New control-plane table (`apps/api/src/db/schema.ts`, alongside
`themePresets`/`tenantLanguages` — resolved via the fixed control-plane pool
in `tenant-pool.ts`, never a per-tenant database):

```ts
export const pageBlueprints = pgTable("page_blueprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null = system-wide (usable by every tenant); otherwise scoped to one
  // tenant's own library. Not a FK — mirrors tenantLanguages' own bare
  // tenant_host text column, since tenants are looked up by host, not id.
  tenantHost: text("tenant_host"),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"), // free text, e.g. "Landing", "News", "Contact"
  layout: jsonb("layout").notNull().default([]), // same Block[] shape as pages.layout
  settings: jsonb("settings").notNull().default({}), // same shape as pages.settings
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByEmail: text("created_by_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**Why control-plane, not per-tenant-DB**: `theme_presets`/`tenant_languages`/
`languages` already establish this codebase's convention for a small curated
library (as opposed to bulk tenant content like pages/posts) — one shared
table, visibility resolved by a `tenantHost` column read in code, no RLS,
no per-tenant migration replay. `design_templates` (per-tenant-DB) exists for
a different reason: it's tenant CONTENT (section snippets authored and
consumed entirely within one tenant, RLS-appropriate). System-wide blueprints
need to be visible across every tenant, which a per-tenant-DB table can't do
without a second cross-tenant mechanism — the control-plane table gives that
for free, the same way `languages` is globally visible today.

**No `thumbnailUrl` column** (the audit report's own sketch includes one) —
nothing in this design ever populates a real screenshot (that needs a
headless-render pipeline, out of scope, same reasoning already documented for
`design_templates`' own `TemplatePreview`). A column nothing writes is dead
weight; the gallery's rough layout impression (below) satisfies the report's
"show a preview" criterion without it. Revisit if a real thumbnail pipeline is
ever built.

A migration seeds a handful of system blueprints matching the report's table
(§5.6 "Blueprint awal yang paling praktikal") — Landing page jabatan, About/
profil, Program/perkhidmatan, News hub, Contact, Simple content page (Event/
kempen is skipped here, matching the report's own note that an event listing
element needs an event model first — a blueprint referencing a `postlist`
element already covers "berita" without one). Each seed row is a small,
already-valid `layout` array using existing element types only (hero, text,
cardgrid, ctabanner, postlist, etc.) — no new element types needed.

## Permissions

New `blueprints.write` in `PERMISSIONS` (`apps/api/src/index.ts`) **and** the
admin's client-side Roles-editor `PERMISSIONS` list (`apps/admin/src/App.tsx`)
— both, per the i18n-phase-2 lesson already in CLAUDE.md: a permission only
really exists once it's in both lists. One permission covers create/update/
delete of a tenant-scoped blueprint, matching the newer single-permission
convention (`menus.write`, `languages.write`), not pages/posts' older
per-action split.

- **Read** (`GET /api/blueprints`): any authenticated user of the tenant, no
  permission check — same read-open/write-gated asymmetry as `theme.write`.
- **Write a `tenantHost: null` (system) row**: superadmin only, regardless of
  `blueprints.write`.
- **Write a row scoped to the caller's own tenant**: superadmin OR a user with
  `blueprints.write`.
- Nobody may create/edit/delete a blueprint scoped to a *different* tenant.

## API

Hand-written routes in `index.ts` (control-plane data via `tenant-pool.ts`,
not `req.db` — same reason `theme`/`tenant-languages`/`roles` are
hand-written, not generic-crud). Plain CRUD only — no dedicated "use
blueprint" or "save as blueprint" route, since both are just a client-side
composition of routes that already exist (see Admin UI below):

- `GET /api/blueprints` → rows where `tenant_host IS NULL OR tenant_host =
  req.tenantHost`, optional `?category=` exact-match filter.
- `POST /api/blueprints` — body `{ name, description?, category?, layout,
  settings?, scope?: "system" | "tenant" }`. `scope: "system"` (→
  `tenantHost: null`) is 403 unless the caller is superadmin; otherwise (or
  when omitted) the row is created with `tenantHost: req.tenantHost`, 403
  unless the caller is superadmin or has `blueprints.write`. `layout`
  validated through the existing `validateLayout()` pages already use — same
  trust boundary, same function, no new validator.
- `PATCH /api/blueprints/:id` — same permission matrix, re-checked against
  the EXISTING row's `tenantHost` (a webmaster can never touch a system row
  or another tenant's row, even by guessing an id).
- `DELETE /api/blueprints/:id` — same ownership check.

`createdBy`/`createdByEmail` stamped once on create (`req.method` check in a
shared handler), never overwritten on update — same convention as
`posts.authorId`.

## Admin UI

**Blueprint gallery** (new `apps/admin/src/BlueprintGallery.tsx`): fetches
`GET /api/blueprints`, category filter pills built from whatever `category`
values are actually present, grid of cards. Each card renders a rough
layout-impression preview — this reuses `design_templates`' existing
`TemplatePreview` (rows → columns → elements bars), extracted out of
`Designer.tsx` into `apps/admin/src/designer/TemplatePreview.tsx` as a pure,
prop-driven component so both the Templates modal (existing) and this new
gallery (new) render from the one implementation — a small, in-scope step of
the same God-Component extraction already underway (`designer/types.ts`,
`designer/parsers.ts`, etc., see CLAUDE.md's Designer.tsx paragraph). No new
preview renderer is written.

`BlueprintGallery` takes `{ tenantHost, token, mode: "picker" | "manage",
onUse? }`:
- **picker** mode (Create Page flow): each card shows a "Use this blueprint"
  button; clicking calls `onUse(blueprint)`.
- **manage** mode (a management screen): each card shows Edit (name/
  description/category) and Delete instead.

**Create Page flow** (`PagesPanel`'s existing quick-create form): gains a
second entry point, "Choose blueprint", opening `BlueprintGallery
mode="picker"` in a modal. `onUse` clones the blueprint's `layout`/`settings`
client-side and calls the SAME `POST /api/pages` create call the existing
quick-create already uses (title still typed by the user, slug still
auto-derived) — this is the "clone layout into a new draft page, not a shared
reference" requirement from the report, satisfied with zero new backend
route. The existing "Blank page" path is untouched.

**"Save as blueprint"** (Designer header, next to the existing "Save as
Template" action): opens a small named-field modal (name, description,
category, and — superadmin only — a system/tenant scope choice) using the
same in-app modal pattern `confirmSaveTemplate` already established (never
`window.prompt`, which silently no-ops once a browser has muted repeat JS
dialogs — a bug already hit and fixed once in this codebase for the Templates
modal). Submitting calls `POST /api/blueprints` with the page's current
in-memory `layout`/`settings` — again, no dedicated backend route.

**Management screen placement** mirrors `menus`/`languages`: a superadmin-only
`ContentManager` sub-tab (`"blueprints"`, site-picker required first) plus a
webmaster top-level `Tab` (a sibling of their own `theme`/`languages`/`menus`
tabs, since a webmaster has no site picker) — both render `BlueprintGallery
mode="manage"`. Per this codebase's established convention (no client-side
notion of which permissions the current session holds — see `TenantLanguagesForm`
in CLAUDE.md), the webmaster tab always renders; Edit/Delete simply surface
the server's 403 if the account lacks `blueprints.write`, never a hidden
button.

**i18n**: new `ms`/`en` key pairs for the gallery, category filter, "Choose
blueprint"/"Blank page" choice, and the Save-as-blueprint modal — same
registry pattern as every prior sprint.

## Out of scope (deferred)

- Section lock (superadmin-locked sections surviving clone uneditable) —
  needs Designer to read and enforce a per-section `locked` flag through the
  clone step; a real follow-up, not started here.
- Real screenshot thumbnails — needs a headless-render pipeline.
- Event/contact-form blueprints — blocked on features that don't exist yet
  (event model, form backend), per the report's own §5.6/§5.7 notes.
