# Live Edit floating block-action toolbar

**Date:** 2026-07-23
**Status:** Approved (design), ready for implementation plan

## Motivation

`apps/admin/src/Designer.tsx`'s "Blocks" mode already has duplicate, copy,
paste, copy style, paste style, and delete for the currently selected
section/column/element (via `BlockControls` and the `Inspector` sidebar's
per-level button rows) and drag-and-drop reordering (native HTML5 DnD on the
canvas). "Live Edit" mode (the real frontend page rendered in an iframe,
click-to-select + inline text edit via a postMessage bridge to
`apps/frontend/src/layouts/BaseLayout.astro`) already has click-to-select,
inline text editing, and drag-and-drop reordering (a separate custom
pointer-based implementation, since native HTML5 DnD doesn't hand off across
an iframe origin boundary) — but has no UI for duplicate/copy/paste/copy
style/paste style/delete at all. This adds that, as a floating toolbar that
tracks the selected block's on-screen position inside the iframe.

## Out of scope

- Live drag-resize handles for size/margin/padding — a separate, much larger
  feature (no existing UI or bridge machinery for it at all), tracked as its
  own future spec, not part of this one.
- Any change to Blocks mode itself, or to the existing drag-and-drop reorder
  behavior in either mode.
- Row-level actions — Blocks mode has no duplicate/copy/paste for rows
  today, and this spec doesn't add any either (same constraint as the
  section/column/element parity rule below).

## Design

### A. New bridge message: `designer:selectedRect`

`BaseLayout.astro`'s inline script already toggles a selection outline on
whichever node matches the `sel` path sent from `Designer.tsx` (existing
`designer:selected` handling, via `findByPath()`). Alongside that existing
logic, attach a `ResizeObserver` to the newly-selected node and a `scroll`
listener, and post:

```js
window.parent.postMessage({ type: "designer:selectedRect", rect: { top, left, width, height } }, targetOrigin);
```

using `node.getBoundingClientRect()` — viewport-relative, inside the
iframe's own coordinate space. Disconnect the observer and remove the
scroll listener whenever the selection changes or clears (same lifecycle as
the existing outline-toggle code). The `ResizeObserver` alone covers every
case that changes the node's box (a live style edit from the Inspector
sidebar, or the iframe's own container being resized causing responsive
reflow) without needing to hook into the existing `designer:style` handler
directly; the `scroll` listener covers pure position changes where the box
size didn't change.

### B. Admin positions the toolbar

`Designer.tsx` adds a `selectedRect` state, set from the new message in the
existing `postMessage` listener (`Designer.tsx:769-800`'s effect). On
`mode === "live" && sel && selectedRect`, compute the toolbar's page
position as `iframeRect.top + selectedRect.top` /
`iframeRect.left + selectedRect.left` (`iframeRect` from
`liveFrame.current!.getBoundingClientRect()`, recomputed on a `window`
`resize` listener so the admin's own layout changes — e.g. a sidebar
toggling — keep the toolbar aligned). Render a small `position:fixed`
toolbar pinned just above the selected box's top edge (below it if there's
no room above, i.e. `selectedRect`'s page-top is within the toolbar's own
height of the viewport top). Render nothing when `mode !== "live"`,
`sel` is `null`, or `selectedRect` hasn't arrived yet (e.g. right after a
mode switch, before the iframe's script has posted the first rect).

### C. Toolbar actions, by selection level

The toolbar's button set depends on `sel.length` (the same convention
`Inspector()` already switches on):

| `sel.length` | Level | Buttons |
|---|---|---|
| 1 | Section | Duplicate, Copy, Paste, Copy style, Paste style, Delete |
| 3 | Column | Copy, Paste, Copy style, Paste style, Delete |
| 4 | Element | Duplicate, Copy, Paste, Copy style, Paste style, Delete |

No level gets a button Blocks mode doesn't already have for it today (no
column Duplicate, matching `Inspector()`'s existing column branch which has
none either) — this toolbar exposes exactly Blocks mode's existing
capability set in Live Edit, it doesn't add new capabilities to either mode.
Paste and Paste style are disabled (not hidden) when the matching clipboard
slot is empty, same as the existing Inspector/`BlockControls` buttons
(`clipHas`/`styleHas`).

Each button calls the same logic Blocks mode already uses for that
action+level — currently written as inline closures inside `BlockControls`
(section level, `Designer.tsx:1658-1713`) and `Inspector()` (column level,
`Designer.tsx:1323-1372`; element level, `Designer.tsx:1416-1475`). Extract
each into a named function taking the relevant path indices (e.g.
`duplicateSection(b)`, `copyColumn(col)`, `deleteElement(bs, [b,r,c], e)` —
exact names/signatures are an implementation-plan decision, not fixed here),
so `BlockControls`, `Inspector()`, and the new floating toolbar all call the
same three implementations per action instead of three call sites each
re-deriving their own splice/clip logic. This is a small, targeted
extraction — no behavior change to Blocks mode, just removing duplication
that this new toolbar would otherwise have to re-create a third time.

### The Inspector sidebar stays live at the same time

The floating toolbar is additive, not a replacement: the Inspector sidebar
already renders in Live Edit mode today (it reads the same shared `sel`
state Live Edit's selection sync effect uses) and continues to show/edit
every field for the current selection exactly as it does now. A user can
use the floating toolbar's action buttons and the sidebar's field inputs on
the same selection at the same time — nothing in this spec disables or
hides the sidebar.

## Testing

- `apps/admin`: `tsc -b --noEmit` covers type-correctness of the new state,
  message handling, and toolbar component; no existing component test
  harness in this repo to extend for interaction behavior (consistent with
  how the rest of `Designer.tsx` is verified today).
- Manual smoke check (this repo has no live browser test harness wired into
  CI): select a section/column/element in Live Edit, confirm the toolbar
  appears positioned over it, confirm each button produces the same result
  clicking the equivalent Blocks-mode/Inspector control would; confirm
  scrolling and resizing the iframe keeps the toolbar aligned; confirm the
  Inspector sidebar remains usable throughout.
