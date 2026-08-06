# Global Language Registry — Design

**Phase 1 of 3** for the multi-language / i18n content feature. This phase only
builds the superadmin-curated master list of languages. Two follow-on phases
(not part of this spec) will build on top of it:

- Phase 2: per-tenant enabled subset of this master list, gated by a permission
  a superadmin grants to a webmaster.
- Phase 3: post-level language/translation field, with a manual-edit UI and an
  auto-translate button stubbed to a placeholder (no real translation API
  wired in yet — provider/budget decision deferred).

## Goal

Superadmin can define which languages exist system-wide. Defaults to Malay
(`ms`) and English (`en`). Superadmin can add more languages later, and
enable/disable existing ones. This list is the single source of truth phases
2 and 3 will read from.

## Data model

New control-plane table `languages` (public schema, alongside `roles` /
`tenants` — see `apps/api/src/db/schema.ts`):

```ts
export const languages = pgTable("languages", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // immutable after create, e.g. "ms", "en"
  label: text("label").notNull(), // display name, e.g. "Bahasa Melayu"
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

A migration seeds two rows: `ms`/"Bahasa Melayu" and `en`/"English", both
`enabled: true`.

`code` is validated against `^[a-z]{2,3}(-[a-z]{2,4})?$` (covers plain
ISO-639-1 codes like `en` and region variants like `zh-cn`) and is never
editable after creation — phases 2/3 will store `code` values as foreign
references, so allowing it to change later would silently break those
references.

## API

Hand-written routes in `apps/api/src/index.ts`, mirroring the existing
`/api/portal/roles` CRUD pattern exactly (control-plane data, not a tenant
collection, so this does NOT go through `registerProtectedCollectionRoutes` /
generic-crud). All four routes gated by `verifySuperadmin(req, reply)`, same
as the roles routes.

- `GET /api/portal/languages` → `{ languages: Language[] }`, ordered by
  `sortOrder` then `label`.
- `POST /api/portal/languages` body `{ code, label }` → 400 if `code` fails
  the regex above, or if a row with that `code` already exists. Created row
  defaults `enabled: true`, `sortOrder: 0`.
- `PATCH /api/portal/languages/:id` body `{ label?, enabled?, sortOrder? }` —
  `code` is not accepted in the body at all (ignored, not just rejected —
  matches how `roles`' PATCH treats `name` vs `permissions` distinctly).
- `DELETE /api/portal/languages/:id` → 400 `{ error: "at least one language
  must stay enabled" }` if this row is `enabled: true` and it's the only
  enabled row remaining. Otherwise hard-deletes.

## Admin UI

New "Languages" card inside the existing superadmin-only `SettingsPanel`
(`apps/admin/src/App.tsx`, the same component currently holding
backup/restore/static-export — no new nav tab, no new route). Card shows:

- A list of existing languages: code (read-only text), label (editable inline
  text), an enabled/disabled toggle, a delete button.
- An inline "add language" mini-form below the list: code input + label
  input + Add button — same visual pattern `CategoriesPanel`'s inline
  new-category input already uses.
- Delete button disabled (with a tooltip) on a row that's the last enabled
  one, mirroring the API's own guard — client-side convenience only, the API
  check is what's actually load-bearing.

New i18n keys needed (`apps/admin/src/i18n.ts`, ms+en pairs): a section
heading, add-language form labels/placeholder, the "last enabled language"
tooltip/error text, and a delete-confirmation string (reuses the existing
`useConfirm` hook, same as every other destructive action in this panel).

## Out of scope for this phase

- Nothing reads or enforces this list yet — no tenant, page, or post is
  aware of `languages` after this phase ships. It is purely a superadmin
  management screen. Phases 2 and 3 are what make the list mean anything.
- No permission string is added to `PERMISSIONS` in this phase — this whole
  feature is superadmin-only until phase 2 introduces a permission for
  webmaster-facing per-tenant control.
