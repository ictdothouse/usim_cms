# Header/Footer Designer — Design

Status: approved (brainstormed 2026-09-04), ready for implementation planning.

Supersedes the header/footer half of
[2026-08-13-menu-header-footer-design.md](2026-08-13-menu-header-footer-design.md)
(`site_sections`), which was approved but never implemented. That spec's
**menu half already shipped** (`menus` table, Menu Designer element,
`MenuBlock.astro`) and is reused here unchanged — only the header/footer
builder itself is redesigned, per a 2026-09-04 brainstorm that surfaced a
different assignment model and new mobile-nav style requirements.

## Problem

`apps/frontend`'s `BaseLayout.astro` renders a hardcoded logo + optional
language switcher and no footer at all. Every tenant page is otherwise
header/footer-less. Tenants need to design one or more headers/footers using
the full Designer canvas, assign them per-page or site-wide, and control
mobile-nav presentation (hamburger style/color/position/animation).

## Scope decisions (from brainstorming)

- Reuses the existing Designer canvas (Section/Row/Column/Element system),
  not a new slot-based builder — full layout freedom, zero new canvas code.
- Any element allowed inside a header/footer (same palette as a page), plus a
  preset-layout picker (column-split templates) on create so authors don't
  start from a blank canvas.
- Multiple headers and multiple footers per tenant. Exactly one of each kind
  can be marked **Default** (site-wide fallback). Any page can either be
  assigned a specific header/footer (override) or explicitly hide it
  (exception) — resolved per page, not by a list living on the section.
- Auto-generated mobile hamburger nav from the header's existing Menu
  element (no separate mobile canvas), with author-configurable style: icon
  size, color, position (left/right), and drawer animation (slide/fade).
- New `headerFooter.write` permission, following the exact `menus.write`
  pattern (added to both server `PERMISSIONS` and admin's client-side
  `PERMISSIONS`/Roles-editor list in the same change — the i18n Phase 2
  lesson already in CLAUDE.md about permissions that exist only server-side).
- Preview reuses the existing blueprint live-edit preview token/route infra.

## Data model

### `siteChrome` (tenant DB, new `CollectionConfig`)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| kind | text | `"header"` \| `"footer"` |
| name | text | author-facing label |
| layout | jsonb | same Section/Row/Column/Element tree `pages.layout` uses |
| translations | jsonb default `{}` | per-locale `{ layout }`, same i18n Phase 5 pattern as pages/posts |
| settings | jsonb default `{}` | `{ sticky?, mobileNav?: { position, size, color, animation } }` |
| isDefault | boolean default false | exactly one `true` per `kind` per tenant |
| status | text | `"draft"` \| `"published"` — draft never renders publicly |
| createdAt/updatedAt | timestamptz | |

`siteChromeBeforeChange` enforces the one-default-per-kind invariant (same
shape as the existing "last enabled language" guard, enforcing "exactly one"
instead of "at least one"): setting `isDefault: true` flips any other row of
the same `kind` for this tenant to `false` in the same handler.

Routes: `registerProtectedCollectionRoutes`/public-GET split, same as
`menus`, gated on `headerFooter.write`. `POST /:id/publish` reuses the
existing generic collection publish route (status-column-aware already).

### `pages` — 4 new nullable columns

| column | type | notes |
|---|---|---|
| headerId | uuid, FK → siteChrome, nullable | explicit override; null = use default |
| footerId | uuid, FK → siteChrome, nullable | explicit override; null = use default |
| hideHeader | boolean default false | exception: no header regardless of default |
| hideFooter | boolean default false | exception: no footer regardless of default |

Resolution per page, per kind: `hideX` → nothing renders; `Xid` set → that
row; else → the `isDefault=true`, `status="published"` row for that kind; a
fresh tenant with none configured gets no header/footer (not an error).

This direction (FK lives on the page, not a `pageIds[]` array on the
section) was chosen over the old spec's section-owns-the-list model because
resolution becomes a single indexed lookup from the page row already being
fetched, and the exception case (`hideHeader`) needs a page-side flag either
way — putting the override FK next to it keeps all chrome-related fields for
a page in one place instead of split across two tables.

## Header/Footer builder UI

New "Header & Footer" admin section (mirrors `PagesPanel`'s quick-create-
then-navigate pattern), mounted the same way `theme`/`languages` are: a
superadmin sub-tab inside `ContentManager` (site picker first) and a
webmaster top-level `Tab`. Two lists (Headers, Footers); "+ New
Header"/"+ New Footer" opens the preset-layout picker (column-split
templates, same interaction pattern as the Templates modal), then navigates
into the Designer canvas. Each row shows a Default badge when applicable and
Edit/Delete/Publish actions.

Reuses `PageDesignerRoute`/`Designer` directly, routed at `siteChrome/:id`,
zero new canvas code. A `kind` prop (read from the fetched row) swaps the
top-of-canvas panel to a chrome-specific assignment/settings sub-panel:
- "Set as Default" toggle (flips the previous default off on save).
- A "Mobile navigation" style section (kind='header' only): icon
  position/size/color, drawer animation — applied to the hamburger the Menu
  element already renders below the mobile breakpoint, no separate mobile
  layout to design.

Per-page override/exception lives in the existing Page settings panel (where
category/slug/etc. already live): a header/footer picker (defaults to
"Site default") plus a "Hide header"/"Hide footer" checkbox.

## Rendering plumbing

`BlockRenderer.astro` (new, shared): the section/hero/text/image/generic
element switch currently duplicated between `[...slug].astro` and
`posts/[slug].astro` is extracted into one component both call — needed now
because header/footer rendering becomes a third and fourth caller of the
same switch. (Carried over from the superseded spec; still unbuilt, still
the right fix before adding more callers.)

`BaseLayout.astro`'s hardcoded logo/lang-switcher block is replaced by
optional `header`/`footer` props (each a resolved layout tree + Live-Edit
passthrough), rendered via `BlockRenderer` wrapping `<slot/>`.
`[...slug].astro`/`posts/[slug].astro` resolve the page's applicable
`siteChrome` rows (per the fallback rule above, via the page's own
`headerId`/`footerId`/`hideHeader`/`hideFooter`) before calling
`BaseLayout`. Mobile hamburger toggle ships as a small event-delegated
`<script>` bundled once per page (same convention the `tabs` element and the
Menu element's own mobile accordion already follow) — the one deliberate
exception to this app's no-client-JS-by-convention rule, reading the
author's chosen animation/position/color from data attributes.

## Permissions

`headerFooter.write` added to both the server `PERMISSIONS` set
(`apps/api/src/index.ts`) and the admin's client-side `PERMISSIONS` const +
Roles-editor checkbox list (`apps/admin/src/App.tsx`) in the same change.

## Out of scope (not built now)

- Per-item visibility rules beyond page assignment (role-based nav,
  schedule-based nav) — no such request was made.
- Multiple simultaneous mobile-nav "styles" selectable per breakpoint beyond
  the single configured style — one style config per header, not a library
  of presets to switch between at runtime.
- Cross-tenant default header/footer templates (superadmin-set global
  fallback applied to new tenants) — explicitly scoped out; "Global" in this
  design means "default within a tenant," not "default across tenants."
