# Designer Layers Panel — Design

## Context

USIM CMS's page builder (`apps/admin/src/Designer.tsx`) is being brought closer to
professional page-builder UX (Webflow/Framer/Elementor Studio). A ranked list of gaps
was identified (see memory `project_designer_pro_ux_roadmap`); this spec covers the
first and lowest-risk item: a **Layers panel** — a sidebar tree view of the page's
block hierarchy that mirrors and drives canvas/Live-Edit selection. Breakpoint-based
responsive editing (the other top-ranked item, which needs schema/data-model changes)
is deliberately out of scope here and will get its own spec later.

No backend, schema, or `pages.layout` JSONB shape changes. Pure `apps/admin` UI work
on top of the existing `Block[]` state (`blocks`) and `Sel` path model already in
`Designer.tsx`.

## Existing data model (unchanged)

```
blocks: Block[]                          // top-level, Block = { type, props }
  block.type === "section" → props as SectionProps { rows: Row[], ...style fields }
    Row { columns: Col[] }               // no props of its own, not selectable
      Col { span, elements: El[], props? }
        El { id, type: ElType, props }
  block.type !== "section" → legacy block (hero/text/image), locked, rendered as-is
```

Selection (`sel: number[] | null`) is a path:
- `[b]` → section (or legacy block)
- `[b, r, c]` → column
- `[b, r, c, e]` → element

`sel[0]` always indexes into `blocks`, regardless of depth (already relied on by
`templateKind()` at [Designer.tsx:974](../../../apps/admin/src/Designer.tsx#L974)).

## A — Placement

The existing left palette `<aside className="w-44 ...">` (currently just the
"Elements" drag list, [Designer.tsx:2099](../../../apps/admin/src/Designer.tsx#L2099))
gains a 2-tab header: **Elements** | **Layers**. Same width, no new aside, no layout
reflow elsewhere. `activeLeftTab: "elements" | "layers"` local state controls which
body renders inside the same aside shell.

## B — Tree structure & labels

Built directly from the live `blocks` state — no derived/duplicated data structure,
no new fields persisted.

- **Section** (`blocks[b]`, `type === "section"`) — label: `props.anchorId` or
  `props.cssClass` if set, else `t("designer-layers-section", { n: b + 1 })`
  ("Section {n}"). Expandable.
- **Legacy block** (`blocks[b]`, `type !== "section"`) — single locked leaf, lock icon,
  `t("designer-layers-locked")` + block.type. Not expandable (matches existing
  locked-card treatment in canvas). Still participates in section-level reorder (see D).
- **Row** — only rendered as a thin non-selectable group label
  (`t("designer-layers-row", { n: r + 1 })`) when `section.rows.length > 1`. Single-row
  sections skip straight to columns — Row carries no props, so it's structural only.
- **Column** — `t("designer-layers-column", { n: c + 1, span: col.span })`
  ("Column {n} (span {span})"). Expandable.
- **Element** — `ELS[el.type].icon` + `t(ELS[el.type].labelKey)`, same icon/label
  source the Elements palette already uses. Leaf node.

Expand state: `expanded: Set<string>` (path joined with `.` as key), local component
state. On mount and whenever `sel` changes, all ancestors of `sel` are added to
`expanded` (auto-reveal current selection). Chevron per expandable node toggles
membership manually otherwise.

## C — Selection sync

Clicking a tree row calls `setSel(path)` — the same `sel` setter canvas/context-menu
paths already use. No new sync code needed for the Live Edit iframe: the effect at
[Designer.tsx:911](../../../apps/admin/src/Designer.tsx#L911) already posts
`{ type: "designer:selected", path }` to the iframe on every `sel` change regardless
of what changed it, so BaseLayout.astro's existing highlight/scroll-into-view handling
picks up tree-driven selection for free.

Reverse direction (iframe click → tree) also needs no new plumbing: iframe clicks
already flow through `designer:select` → `setSel` ([Designer.tsx:874](../../../apps/admin/src/Designer.tsx#L874));
the tree just needs to react to `sel` changes (auto-expand + highlight row), which is
new tree-side code but reads state that already updates correctly.

## D — Drag-reorder (all 3 levels)

Native HTML5 drag-and-drop (`draggable` + `onDragStart`/`onDragOver`/`onDrop`) — same
primitive the canvas already uses via the shared `drag.current` ref. No new dependency.

- **Element** — reuses `dropIntoColumn(colPath, index)` and `drag.current = { kind:
  "move", path }` exactly as canvas does today ([Designer.tsx:1198](../../../apps/admin/src/Designer.tsx#L1198)),
  just triggered from tree rows instead of canvas element rows. Cross-column
  reparenting works identically to canvas (drop target column doesn't have to match
  source).
- **Column** — new `moveColumn(sectionIdx, rowIdx, from, to)`: splices within
  `section.rows[rowIdx].columns` only. **Scoped to reorder within the same row** —
  cross-row column moves are out of scope (a row's `grid-template-columns` and each
  column's `span` are only meaningful within that row; moving a column to a different
  row's grid is not a well-defined operation without also renegotiating spans).
- **Section** — new `moveSection(from, to)`: splices top-level `blocks[]`. Applies to
  legacy blocks too (position-only; their internals stay locked/untouched). The
  existing up/down arrow buttons in canvas ([Designer.tsx:1880-1887](../../../apps/admin/src/Designer.tsx#L1880-L1887))
  are a separate, independent surface for the same underlying array-splice — both stay,
  neither replaces the other.

Drop position within a target row is determined by pointer position: top half of the
hovered row → insert before; bottom half → insert after. Standard tree-reorder
convention, no new UI chrome needed beyond a thin insertion-line indicator.

## E — i18n

New tree labels need entries in both language dictionaries used by the existing
`t()`/`Key` system (`designer-layers-section`, `designer-layers-row`,
`designer-layers-column`, `designer-layers-locked`, plus the Elements/Layers tab
labels) — same pattern the multi-level template feature already followed for its own
labels.

## F — Verification

No backend/schema touched, so no migration or API test needed. One assert-style smoke
check (plain `test_*` or inline `demo()`, no framework) covering the three new mutate
functions against a fixture `Block[]` (2 sections, 2 rows, 2 columns, 2 elements):

- `moveSection` reorders top-level array correctly (including a legacy-block entry).
- `moveColumn` reorders within a row only, leaves other rows untouched.
- Tree-triggered `dropIntoColumn` cross-column move matches the existing canvas
  behavior (regression guard, not new behavior).

This is the class of bug most likely to slip in (off-by-one in splice index math when
inserting after removing the source), and the cheapest to catch mechanically rather
than by manual re-testing every drag combination in the browser each time.

## Out of scope (explicitly)

- Breakpoint-based responsive edit mode (separate spec, needs schema work).
- Multi-select in the tree.
- Renaming/labeling sections or columns with custom names (labels are derived, not
  editable, in this iteration).
