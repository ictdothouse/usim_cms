# Slider/Banner rework + corner-radius default fix

Status: approved, ready for implementation planning
Date: 2026-09-05

## Problem

The Designer's Slider/Banner element (`apps/admin/src/designer/elements.ts` `ELS.slider`) has
three real problems, confirmed by code research (not guessed):

1. **No opt-in components.** Every slide unconditionally carries a `heading` and `subtitle`
   object (`SlideItem.heading`/`.subtitle`, `apps/admin/src/designer/types.ts:28-37`) — there is
   no way to have a slide with no heading/subtitle at all, only an empty-text one. `buttons` is
   the one part of the schema that already is opt-in (`buttons: []`, added via an explicit "Add
   button" click). There is also no way to nest a row/column of arbitrary elements inside a
   slide — `SlideItem` is a flat, fixed-shape object, structurally unrelated to the real
   `Section > Row > Col > El` tree every other part of a page uses.
2. **Slider height has no per-breakpoint override.** `p.height` resolves to one literal value
   (`apps/frontend/src/components/SectionBlock.astro:1201`, mirrored in
   `apps/admin/src/designer/ElPreview.tsx:923`) applied identically at every screen size — a
   height picked for desktop (e.g. `42rem`/`100vh`) renders the same on mobile, with no author
   control. Every Section/Column style field already has a real bp-override path
   (`bpStyleRules`/`bpMerge`); Element-level fields (slider included) were explicitly deferred —
   see `apps/admin/CLAUDE.md`'s note that Element's per-type inline style building would need
   real extraction work to support this "for real," not just canvas-preview simulation.
3. **Corner-radius default bug.** `elRadius()` (`apps/admin/src/designer/style.ts:136-142`,
   mirrored in `apps/frontend/src/components/SectionBlock.astro:835-841`) falls back to
   `RADIUS.md` (0.75rem) instead of `RADIUS.none` when no radius is set, and `image`/`embed`/
   `gallery` additionally bake `radius: "md"` into their own element defaults
   (`apps/admin/src/designer/elements.ts:79,115,156`). Every `image`, `embed`, and `gallery`
   element gets a hardcoded rounded corner unless the author explicitly overrides it — Section
   and Column already do this correctly (`RADIUS.none` fallback), this is the one inconsistent
   spot. Confirmed: no other element type has a hidden non-zero-radius default.

Two known slide canvas bugs, confirmed via existing code comments/observations, get fixed as
part of the rewrite rather than patched separately: `ElPreview.tsx`'s drag/resize handlers
(`textPatch`/`updateItem`) assume `heading`/`subtitle` always exist — once they become optional
El nodes inside a real tree, these special-cased handlers are replaced by the same generic
element-drag code Section/Column/Element already use, which has no such assumption.

## Goals

- A freshly-added slide shows only a placeholder (image icon, "click + to add content") — no
  default heading/subtitle text, no default component of any kind.
- An author explicitly adds Text, Button, Image, or a nested Row ("layer") into a slide via
  dedicated add buttons, each becoming a real element in that slide's own tree.
- A slide's content area behaves like a real mini-canvas: the same selection, guides, drag,
  resize, and Inspector editing every Section/Row/Column/Element already has — not a second,
  bespoke implementation.
- Slide background gains a `bgSize` control (cover/contain/repeat/no-repeat/auto) alongside the
  existing `bgColor`/`overlayColor`/`overlayOpacity`.
- Slider `height` becomes truly responsive: tablet/mobile can each set their own literal height,
  falling back to the desktop value when unset, rendered for real on the published site (not
  just simulated in the admin canvas).
- `image`/`embed`/`gallery` elements have no default corner radius unless the author sets one.
- Existing pages with the old `heading`/`subtitle`/`buttons` slide shape keep rendering/saving
  correctly — auto-upgraded to the new tree shape the first time that slide is opened for edit,
  never a hard migration.

## Non-goals

- Admin Designer's own UI-panel responsiveness (sidebar/Inspector/canvas not adapting to a
  narrow browser window) — explicitly scoped out, tracked as a separate follow-up.
- Unifying `ELS`'s 4-touchpoint registry gap (schema/canvas-render/site-render/validator each
  hand-duplicated) into one real `ElementDefinition` — pre-existing, larger, not attempted here;
  this rework follows the existing 4-touchpoint convention for the slider element specifically.
- Real per-breakpoint style overrides for every other Element field — only `height` on slider
  gets this; extending it further is out of scope.
- A visual collision-avoidance layout system for custom-positioned content — unchanged from
  today ("let the editor tell the truth, not prevent the collision").

## Data model

`apps/admin/src/designer/types.ts` — `SlideItem` changes from:

```ts
interface SlideItem {
  imageUrl: string; bgColor: string;
  heading: SlideText; subtitle: SlideText;
  textPosition: "left"|"center"|"right";
  overlayColor: string; overlayOpacity: string;
  buttons: SlideButton[];
}
```

to:

```ts
interface SlideItem {
  imageUrl: string;
  bgSize: "cover" | "contain" | "repeat" | "no-repeat" | "auto";
  bgColor: string;
  overlayColor: string; overlayOpacity: string;
  textPosition: "left" | "center" | "right"; // still governs the row block's own alignment
  rows: Row[]; // the slide's own mini section body — same shape Section.props.rows already is
}
```

`SlideText`/`SlideButton` types are removed once no longer referenced (heading/subtitle/button
content becomes real `El` nodes of type `heading`/`text`/`button` inside `rows[].columns[].elements`,
using every field those element types already have — Typography section, font picker, align,
custom fontSize — for free, no duplicate schema).

A freshly-added slide (`FieldInput.tsx`'s "Add slide" button) creates `{ imageUrl: "", bgSize:
"cover", bgColor: "", overlayColor: "#000000", overlayOpacity: "35", textPosition: "center", rows: [] }`
— empty `rows` is what renders the placeholder-only canvas.

**Legacy upgrade.** `parseSlides()`/`stringifySlides()` (`apps/admin/src/designer/parsers.ts`)
gain a one-time conversion: a parsed slide with the old `heading`/`subtitle`/`buttons` keys (and
no `rows`) gets converted into a single `Row` with one `Col` containing, in order: a `heading` El
(from `.heading`, skipped if `text` was empty), a `text` El (from `.subtitle`, skipped if empty),
and one `button` El per entry in `.buttons` — preserving each field's existing value
(color/fontSize/position/x/y/align/etc., mapped onto the equivalent El prop names). This mirrors
the exact "parse either shape, silently upgrade on next save" convention this file already uses
for the pipe-line → JSON slide format migration. `SectionBlock.astro`'s own slide parser needs the
same fallback so an unedited legacy page still renders correctly forever, not just until next edit.

## Add-component UI

The slides field editor (`FieldInput.tsx`, `field.kind === "slides"` branch) gains 4 dedicated
buttons per slide (matching the existing "Add button" pattern, not a generic element picker menu):
**Add Text**, **Add Button**, **Add Image**, **Add Row** ("layer"). Each pushes a new `El` (or,
for Add Row, a new `Row` with one empty `Col`) into the slide's tree at the currently-selected
insertion point (end of the first/only row's first/only column by default, same "just works"
default Column already has for a freshly-added Row). No default styling beyond each element
type's own normal `ELS` defaults — a newly-added Text starts exactly like a Text element dropped
onto a normal page, not with slide-specific defaults.

## Mini-canvas + selection (revised after implementation-time verification)

**Verified before writing this section** (per the Risk this spec originally flagged): Section's
Row→Column→Element canvas is *not* a callable function — it's ~1000+ lines inlined directly in
`Designer.tsx`'s JSX (`Designer.tsx:2977-3390`), hardcoded to absolute path indices (`[b,r,c,e]`)
with mutation callbacks written as literal `section(next, b).rows[r].columns[c]` traversals, plus
per-side padding/margin drag-handle chrome keyed off those same indices. Making a slide *literally*
share this exact code would mean rewriting Designer's whole path/mutation addressing scheme to be
relative/composable — a much larger, riskier refactor than this spec originally assumed, touching
the core canvas in daily production use. Decided against doing that refactor now.

**What's reused instead — confirmed safe:** `ElPreview({ ctx, el, path })`
(`apps/admin/src/designer/ElPreview.tsx:74`) already takes `path` as *optional*, and its per-type
render `switch` (`heading`/`text`/`image`/`button` cases, lines 226-280) never depends on `path`
for anything except the inline-contentEditable-edit toggle (`editable = path && selEq(sel, path)`,
line 191) and that toggle's own `mutate()` commit callback (which does assume a literal 4-length
`[b,r,c,e]`, only reached when `editable` is true). This means `ElPreview({ ctx, el })` — path
omitted — can be called directly on any `El` node anywhere, including one nested inside a slide,
and gets fully real heading/text/image/button rendering (typography, colors, sizing) for free,
with zero changes to Designer's core selection/mutation system. The one accepted gap: a slide's
nested heading/text element doesn't get the canvas double-click-to-edit-inline shortcut (no `path`
to compare against `sel`) — editing goes through the Inspector's normal field editor instead, same
as editing a button's label always has.

**Slide's own render + selection is new, small, and separate from Designer's global `Sel`.** A
slide's `rows: Row[]` renders via a new, slide-scoped function (in `ElPreview.tsx`, next to the
slider case) that walks `rows → columns → elements` with a simple stacked-flex layout (no
per-column span/gap grid system, no padding/margin drag-handle chrome — the scoped-down decision)
and calls `ElPreview({ ctx, el })` per element for the actual content. Selecting one of these nested
elements does **not** touch the global `Sel`/`pick()`/`selCls()` — it's tracked in new
`DesignerCtx` state, `sliderInnerSel: Record<string, { r: number; c: number; e: number } | null>`
keyed by the slider element's own id (mirrors the existing `sliderSlideIdx` per-element-id keying
convention). A click sets `sliderInnerSel[sliderElId]`; the Inspector, when the currently-selected
top-level element (`sel = [b,r,c,e]`) is a slider **and** that slider has a `sliderInnerSel` entry,
renders that inner element's own Content/Style tabs (reusing `FieldGroups`/`FieldInput` generically,
same call convention as a normal depth-4 element) instead of the slider's own fields, with a "back
to slide settings" affordance to clear the inner selection.

**Mutation.** A new helper mutates a slide's nested element by: reading the slider `El` at
`section(bs,b).rows[r].columns[c].elements[e]`, parsing its `props.slides` via `parseSlides`,
mutating `slides[slideIdx].rows[r2].columns[c2].elements[e2]` per a callback, then writing back
through `stringifySlides` into `props.slides` — the same parse/mutate/stringify round trip the
slides field editor already uses today, just reaching one level deeper.

Clicking inside a slide's placeholder area with nothing added yet shows the 4 add-buttons directly
on canvas (mirrors Column's own empty-state "add element" hint), in addition to the Inspector's
dedicated Add Text/Button/Image/Row buttons.

**Accepted scope reduction vs. the original "true" mini-canvas idea:** no drag/resize, no smart
guides, no padding/margin drag handles, no nested-row grid-column-span control for content inside
a slide. What's real: real element rendering (typography/colors/sizing exactly as elsewhere), real
click-to-select-and-edit via the Inspector, real add/remove/reorder of Text/Button/Image/Row.

## Background controls

`bgSize` renders as a new `"select"` field (cover/contain/repeat/no-repeat/auto) next to the
existing `bgColor`/`overlayColor`/`overlayOpacity` slide-level fields. `ElPreview.tsx`'s slide box
style and `SectionBlock.astro`'s `.ds-slide` inline style both read it (replacing the hardcoded
`backgroundSize: "cover"` at `ElPreview.tsx` and `.ds-slide`'s CSS `background-size: cover`),
falling back to `"cover"` when unset (legacy slides with no `bgSize` keep today's look exactly).

## Slider height, real per-breakpoint

`elements.ts`'s slider `height` field keeps its existing `"length"` kind but gains a `BpToggle`
in the Inspector, same Monitor/Tablet/Smartphone icon row every bp-aware Section/Column field
already has. `El.bp` (already exists on every element, currently canvas-preview-only for slider)
becomes real for this one key: `SectionBlock.astro`'s slider render calls a new
`elBpStyleRules(el, "height", buildHeightStyle)`-shaped helper — following the exact same
`bpMerge`/`bpStyleRules`/`!important`-scoped-selector mechanism Section/Column already use for
real overrides, scoped to a `data-vis` id on the `.ds-slider` root (reusing `respId()`). This is
the first Element-level field made real rather than preview-only; the design deliberately keeps
it to just this one key rather than generalizing Element's whole `bp` bag, matching the same
narrow-escape-hatch precedent `SlideText.bp` already set for heading/subtitle font-size/align
before this rework.

Implementation-time check (not a settled assumption): once heading/subtitle become real
`heading`/`text` elements, verify whether standalone heading/text elements have a real (not
preview-only) bp path for their own font-size/align today. If not, extend the same real-height
mechanism to those two fields so this rework doesn't regress slide text from "real per-bp" (its
pre-rework state) to "preview-only."

`ElPreview.tsx`'s canvas preview of height-per-bp reuses the existing `bpGetValue` when resolving
`resolvedHeight` for display while a non-desktop bp is being previewed (already close today, just
needs to read the real bp-aware value instead of always the desktop one).

## Corner radius fix

- `apps/admin/src/designer/style.ts:140` — `elRadius()`'s per-corner fallback changes from
  `RADIUS.md` to `RADIUS.none`.
- `apps/frontend/src/components/SectionBlock.astro:840` — same change, mirrored.
- `apps/admin/src/designer/elements.ts:79,115,156` — remove `radius: "md"` from `image`/`embed`/
  `gallery`'s `defaults` (or set to `""`, resolving through the now-`RADIUS.none` fallback).
- `apps/admin/src/designer/style.test.ts:39-41` — update the assertion from `RADIUS.md`'s
  resolved value to `RADIUS.none`'s (`"0 0 0 0"`), since it currently pins the bug as correct
  behavior and would fail once the fallback changes.

No other element type or file needs touching for this fix — Section/Column already default
correctly, and no other element type exposes a `radius` field.

## Validator (`packages/element-schema`)

`isSafeSlide`/`isSafeSlideButton`/`isSafeSlideText`/`isSafeSlides`
(`packages/element-schema/src/index.ts:207,227,272,287,420`) are replaced by validating each
slide's `rows: Row[]` through the package's **existing** row/column/element validation path (the
same one that already validates a Section's own `rows`), plus a slide-level check for
`imageUrl`/`bgSize`/`bgColor`/`overlayColor`/`overlayOpacity`. A legacy-shaped slide (still
carrying `heading`/`subtitle`/`buttons`, not yet upgraded) must keep validating via the exact
existing checks until it's opened for edit — the validator needs a shape-detection branch mirroring
the parser's own "has `rows`? then new-shape; else legacy" dispatch, not a hard cutover.

## Touchpoints (files this rework changes)

- `apps/admin/src/designer/types.ts` — `SlideItem` shape, `Sel` depth.
- `apps/admin/src/designer/parsers.ts` — `parseSlides`/`stringifySlides` + legacy-upgrade logic.
- `apps/admin/src/designer/elements.ts` — slider field list (`bgSize`, `height` BpToggle-eligible),
  remove `radius: "md"` defaults.
- `apps/admin/src/designer/style.ts` — `elRadius()` fallback; possibly a new `elBpStyleRules`-style
  helper location if shared with Designer.tsx's canvas preview.
- `apps/admin/src/designer/ElPreview.tsx` — slider case rewritten to call the shared row/col/el
  render function; height-per-bp canvas preview.
- `apps/admin/src/Designer.tsx` — extend `pick()`/`selCls()`/whatever else keys off `sel.length`
  to the nested slide-content selection form; extract Section's row/col/el render into a callable
  function if not already separable.
- `apps/admin/src/designer/Inspector.tsx` — slide add-buttons wiring, BpToggle for slider height,
  level-dispatch for the new nested selection depths.
- `apps/admin/src/designer/FieldInput.tsx` — slides field editor: remove heading/subtitle-specific
  UI, add the 4 add-buttons, `bgSize` select.
- `apps/admin/src/designer/style.test.ts` — updated radius assertion.
- `apps/frontend/src/components/SectionBlock.astro` — slider render (rows/col/el instead of
  heading/subtitle/button chips), `bgSize`, real height-per-bp, `elRadius()` fallback.
- `packages/element-schema/src/index.ts` (+ its `.test.ts`) — validator rework described above.
- `apps/admin/CLAUDE.md` — update the slider/banner narrative section to describe the new shape
  (per this repo's standing convention of keeping CLAUDE.md in sync with code changes).

## Testing

- `apps/admin`'s existing `designer/*.test.ts` unit tests (parsers, style, elements) gain cases
  for: legacy-slide-upgrade round-trip, `bgSize` default/round-trip, `elRadius({})` now resolving
  to none.
- `packages/element-schema`'s `.test.ts` gains cases: a valid new-shape slide with nested rows
  passes, a legacy-shape slide still passes, an old `isSafeSlide`-style attack case (e.g.
  `javascript:` URL smuggled into a slide image or a nested element's href) still rejects.
- Manual verification in the running admin: add a slider, confirm placeholder-only default, add
  Text/Button/Image/Row, confirm drag/resize/guides work identically to a normal Section, set a
  mobile-only height override and confirm it renders for real (not just admin-preview) via the
  Live Edit mobile breakpoint, confirm image/embed/gallery show 0 corner radius by default.

## Risks / open questions for implementation

- ~~The Section-body row/col/el render function may not currently be cleanly extractable~~ —
  **resolved**: confirmed not extractable without a much larger core refactor; scope revised to
  the "reuse `ElPreview` per-element rendering only" approach in the Mini-canvas section above.
- ~~The heading/subtitle-as-real-elements bp-realness question~~ — **moot**: implementation settled on
  "no bp support for nested slide elements at all" (an explicit accepted scope reduction, not a silent
  regression from the old slide-text bp escape hatch) — see the Mini-canvas section above.
- Legacy-slide auto-upgrade verified via unit tests covering both the legacy JSON-object shape and the
  original pipe-line format (`apps/admin/src/designer/parsers.test.ts`,
  `apps/api/src/collections/validate-layout.test.ts`) — not yet verified against a real saved production
  page with the old shape; do that before considering this rework fully complete in production.
