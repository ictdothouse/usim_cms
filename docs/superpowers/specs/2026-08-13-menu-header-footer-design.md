# Menu Management + Header/Footer Builder — Design

Status: approved (brainstormed 2026-08-13), ready for implementation planning.

## Problem

USIM CMS has no navigation-menu system and no header/footer. `apps/frontend`'s
`BaseLayout.astro` renders only a bare logo + optional language switcher —
every tenant page is otherwise header/footer-less. Two features are needed:

1. **Menu management** — create/edit/delete navigation menus, with nested
   submenus and rich mega-menu columns, place items anywhere.
2. **Header/Footer builder** — design one or more headers/footers, each
   assignable to specific pages (or as the site-wide default), containing
   whichever saved menu(s) the author wants.

Both must render responsively across desktop/tablet/mobile.

## Scope decisions (from brainstorming)

- Menus support nested dropdown submenus **and** mega menus (multi-column,
  each item optionally carrying an icon/image) — "advanced, custom,
  professional-CMS" was explicit user intent, not a minimal flat list.
- Menu items can link to a Page, Post, Category, or a custom URL.
- The Menu is a **Designer element**, usable inside Header, Footer, or any
  regular page canvas — not locked to a "header location" concept.
- Header/Footer building **reuses the existing Designer canvas**
  (Section/Row/Column/Element system) rather than a new slot-based builder —
  chosen over a simpler "Customizer"-style panel because it gives full layout
  freedom (custom multi-row headers, footer columns, backgrounds) for zero new
  canvas code, directly serving the "advance, custom" requirement.
- Assignment model: one header + one footer marked **Default** apply
  site-wide; additional headers/footers can be created and assigned to a
  specific list of pages, which override the default on those pages only.
- Menu item labels are translatable per-language, consistent with this
  codebase's existing posts/pages/categories i18n system (`translations`
  jsonb, gated behind the same site `multilangEnabled` switch).

## Data model

### `menus` (tenant DB, new `CollectionConfig`)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | e.g. "Main Menu", "Footer Links" |
| items | jsonb | tree, see shape below |
| createdAt/updatedAt | timestamptz | |

`items: MenuItem[]`:

```ts
type MenuItem = {
  id: string;
  label: string;
  translations?: Record<string, { label: string }>;
  useCustomLabel: boolean; // false = label always mirrors the linked page/post/category's own title live
  linkType: "page" | "post" | "category" | "custom";
  refId?: string;   // id into pages/posts/categories, when linkType isn't "custom"
  url?: string;     // custom URL, only when linkType === "custom"
  target?: "_self" | "_blank";
  children?: MenuItem[];       // simple nested dropdown (UI practically limits to 2 levels)
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
        icon?: string;   // icon name, same enum-checked convention as the existing Icon element
        image?: string;  // media URL
      }>;
    }>;
  };
};
```

A top-level item has `children` OR `megaMenu`, never both (mega wins if
somehow both are present — the editor UI itself won't allow setting both).
`refId`-linked items resolve their href from the live page/post/category slug
at render time (never stored), same "don't cache what can go stale" posture
as the bookmark-card block's accepted staleness ceiling is deliberately NOT
applied here — a renamed page must not silently break nav links.

Validated in `menusBeforeChange`, mirroring `validate-layout.ts` conventions:
`url` through the existing `isSafeUrl` check, `icon` against the same enum
Icon element uses, `image` through `isSafeCssUrl` (this one renders as a real
`<img src>` attribute, not a CSS `url()`, so a plain scheme/quote check
suffices — not the raw-`url()` check `bgImage` needs). Nesting depth and
column/item counts get sane caps (e.g. depth 3, 8 columns, 20 items/column)
to keep the jsonb bounded — a defensive limit, not a UI restriction users will
realistically hit.

Routes: `registerProtectedCollectionRoutes` for full CRUD (gated on new
`menus.write` permission), plus a public-scope `GET /api/menus/:id` (same
elevate-if-authenticated pattern as other public reads) since the frontend's
render path needs to resolve a menu without an admin session.

### `site_sections` (tenant DB, new `CollectionConfig`)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| kind | text | `"header"` \| `"footer"` |
| name | text | author-facing label, e.g. "Landing Page Header" |
| layout | jsonb | same Section/Row/Column/Element tree `pages.layout` uses |
| settings | jsonb | same `{ gap? }` shape `pages.settings` uses |
| isDefault | boolean | exactly one `true` per `kind` per tenant |
| pageIds | text[] | specific pages this section overrides the default on |
| status | text | `"draft"` \| `"published"` — draft never renders publicly |
| createdAt/updatedAt | timestamptz | |

`siteSectionsBeforeChange` enforces the one-default-per-kind invariant: when a
request sets `isDefault: true`, any other row of the same `kind` for this
tenant is flipped to `false` in the same handler — same shape as the
existing "last enabled language" guard, just enforcing "exactly one" instead
of "at least one."

Resolution at render time, per page, per `kind`: the published row of that
`kind` whose `pageIds` includes the current page's id wins; else the
published `isDefault` row; else nothing renders (a fresh tenant with zero
configured sections gets no header/footer — not an error, just an empty
site until an author builds one).

Routes: same `registerProtectedCollectionRoutes`/public-GET split as `menus`,
gated on new `menus.write`/`siteSections.write` permissions respectively.
`POST /:id/publish` reuses the existing generic collection publish route
(status-column-aware already, no new code needed).

## Menu element (Designer + frontend)

New entry in Designer's `ELS` element registry: `type: "menu"`. Inspector
fields: `menuId` (select, populated from this tenant's `menus`), `layout`
(`"horizontal"` | `"vertical"`), `dropdownTrigger` (`"hover"` | `"click"` —
click matters for touch/tablet where hover doesn't exist), `megaMenuWidth`
(`"contained"` | `"full-width"`). Available in the palette everywhere —
Header, Footer, and any ordinary page Column — per the "place anywhere"
decision; there is no special-cased "header-only" element.

Frontend: `SectionBlock.astro`'s element switch gains a `"menu"` case →
new `MenuBlock.astro`. It fetches the referenced menu (`getMenu(tenantHost,
menuId)`), resolves every item's live label (translation-aware, same
`resolve*` pattern as posts/pages) and href, and renders:
- top-level `<ul>`/`<li>`, nested `<ul>` for `children` (dropdown shown via
  `:hover`/`:focus-within` CSS on desktop — no JS needed there, consistent
  with this codebase's "avoid client JS" default),
- a CSS-grid multi-column block for a `megaMenu` item's `columns`,
- a hamburger toggle + slide-down/accordion nav below the mobile breakpoint,
  which DOES need a small event-delegated `<script>` (bundled once per page
  regardless of how many Menu elements render — same convention the `tabs`
  element's own script already follows) since touch has no hover.

`validate-layout.ts` gets one new check: `menuId` must be a non-empty string
(existence of the referenced menu is a runtime 404 concern for `MenuBlock`,
not a save-time validation concern — same posture pages.categoryId's FK
already takes, deletion is handled by Postgres `onDelete` behavior instead of
pre-validating).

## Header/Footer builder UI

Reuses `PageDesignerRoute`/`Designer` directly — routed at
`site_sections/:id`, same component, zero new canvas code. A `kind` prop
(read from the fetched row, not a route param) swaps only the
top-of-canvas assignment sub-panel: a "Set as Default" toggle (disabled/
explained when another row of this `kind` already holds it — clicking it
still works, it just flips the old default off) and a page multi-select
(only meaningful when not Default).

A new "Header & Footer" admin section (mirrors `PagesPanel`'s quick-create-
then-navigate pattern): two lists (Headers, Footers), "+ New Header"/"+ New
Footer" quick-create (name only) immediately navigates into Designer, each
row shows a Default badge when applicable and an Edit/Delete action.
Mounted the same way `theme`/`languages` are: a superadmin sub-tab inside
`ContentManager` (site picker first) and a webmaster top-level `Tab`.

## Rendering plumbing

`BlockRenderer.astro` (new, shared): the section/hero/text/image/generic
switch currently duplicated between `[...slug].astro` and
`posts/[slug].astro` is extracted into one component both call — a real
existing duplication this work touches directly (both header/footer and
the new Menu element need the same block-rendering switch a third and
fourth time), worth fixing in the same pass rather than adding a third copy.

`BaseLayout.astro` gains optional `header`/`footer` props (each a resolved
layout tree + designerEdit passthrough for Live Edit), rendering them via
`BlockRenderer` wrapping `<slot/>`. `[...slug].astro`/`posts/[slug].astro`
resolve the applicable header/footer `site_sections` rows (per the fallback
rule above) before calling `BaseLayout`.

## Permissions

Two new permissions, `menus.write` and `siteSections.write`, added to
**both** the server `PERMISSIONS` set (`apps/api/src/index.ts`) **and**
the admin's own client-side `PERMISSIONS` const + Roles-editor checkbox list
(`apps/admin/src/App.tsx`) in the same change — this is the exact i18n
Phase 2 lesson already documented in CLAUDE.md: a permission that exists
only server-side can never actually be granted to a role from the UI, and
every webmaster save 403s with no way to fix it short of a direct DB edit.

## Out of scope (not built now)

- Drag-and-drop menu-item reordering across the WHOLE tree in one gesture
  (up/down/indent/outdent controls are enough for v1; a full drag-tree is a
  richer follow-up if requested).
- Per-item visibility rules beyond page assignment (role-based nav, schedule-
  based nav) — no such request was made.
- A dedicated "menu location" concept distinct from the Menu element itself —
  explicitly rejected by the "place anywhere" answer in favor of the element
  being just another Designer element.
