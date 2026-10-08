# Live Edit drag-to-add design

Date: 2026-10-08

## Problem

Blocks mode (`DesignerCanvas.tsx`, the React-rendered approximation canvas)
already supports dragging a new element from the Elements palette and
dropping it into an existing column, or onto the empty-canvas "+ Add
Section" zone (which now auto-creates the section via `dropIntoNewSection`,
fixed same day as this spec). Live Edit — the iframe that renders the real
published/preview page via `apps/frontend` — is Designer's primary surface
(Blocks mode is deliberately a wireframe/structure-only view, see
apps/admin/CLAUDE.md's own "Live Edit is primary surface" note) but its
postMessage bridge (`useLiveEditBridge.ts` / `BaseLayout.astro`'s
`designerEdit` script) is selection-only today: clicking a rendered element
selects it for the Inspector, but there is no way to add a new
section/row/column/element without switching to Blocks mode.

Goal: let an author drag an element from the palette directly onto the real
rendered page in Live Edit, dropping either (a) between two sections — which
auto-wraps the element in a new section→row→column, same as
`dropIntoNewSection` — or (b) directly into an existing row's column,
alongside other content — same as `dropIntoColumn`. No new mutation logic:
both existing `useBlockOps.ts` functions are reused as-is: the block tree
(and its undo history) lives entirely in the admin parent, never in the
iframe.

## Why not native HTML5 drag-and-drop, and why not a same-origin canvas

Admin and the tenant's published site are genuinely cross-origin in general
(`BaseLayout.astro` already derives `targetOrigin` from `document.referrer`
for every postMessage, confirming this is not an in-practice-same-origin
simplification). Two alternatives were considered and rejected:

- **Native HTML5 Drag-and-Drop across the iframe boundary.** `dataTransfer`
  payload access during `dragover` is spec-restricted to `.types` only (not
  the actual data) in every browser, and cross-origin iframe drag carries
  known extra restrictions in some browsers. This would also be a SECOND,
  different drag mechanism in the codebase alongside the pointer-based one
  the slide free-position feature already uses — rejected for long-term
  maintainability.
- **Making the Live Edit preview same-origin** (the way Webflow/Wix avoid
  this problem — their edit-mode canvas loads from their own platform
  domain, not the end customer's live domain). This doesn't fit usim_cms's
  own deliberate architecture (CLAUDE.md: "Single instance, not one
  deployment per tenant — tenant identity always comes from the
  `x-tenant-host` header, never subdomain parsing"); each tenant can have
  its own real custom domain, and Live Edit intentionally previews the real
  thing. Re-architecting preview delivery through a same-origin proxy is a
  legitimate but much larger, separate change, out of scope here.

**Chosen approach**: extend the existing pointer-events + origin-checked
`postMessage` pattern the slide free-position/rotate/resize feature already
proved out in production (`designer:slideElDrag`/`designer:slideElAction`).
This is also the same category of solution current, actively-maintained
products with a genuinely cross-origin live preview use (Shopify Theme
Editor, Builder.io's visual editor) — not a legacy technique.

## Core mechanism: Pointer Capture across the iframe boundary

A `pointermove` listener registered on the admin parent's `window` stops
receiving events once the cursor visually moves over the iframe — the
iframe is a separate document, and the browser routes input to whichever
document the cursor is over, not to listeners on an unrelated document.

The fix is the standard one (not a hack): `element.setPointerCapture
(pointerId)`, called on `pointerdown` on the palette item. Once a pointer is
captured, every subsequent `pointermove`/`pointerup` for that pointer ID is
delivered to the capturing element in the PARENT document regardless of
what the cursor is visually over, including an iframe. This is exactly what
Pointer Capture is specified for, and is the mechanism real drag-and-drop
libraries use for this class of problem.

Consequence: the admin parent keeps full ownership of the gesture
(`clientX`/`clientY` in parent-viewport coordinates) for its entire
duration. It never needs the iframe to "hand back" control.

## Coordinate mapping

`DeviceViewport.tsx` renders the iframe at its true device width/height,
then applies `transform: scale(scale)` with `transformOrigin: "0 0"` to fit
the available space (used today for visual sizing, not yet for any
cross-frame coordinate math — this is new). To convert a parent-viewport
pointer position into the iframe's own content coordinate space:

```
iframeLocalX = (clientX - iframeRect.left) / scale
iframeLocalY = (clientY - iframeRect.top) / scale
```

where `iframeRect` is the iframe element's `getBoundingClientRect()` in the
parent document and `scale` is the same value `DeviceViewport.tsx` already
computes.

## Message protocol

New message types, following the existing `{type, ...}` shape and the
existing origin-check discipline (every send/receive validates
`targetOrigin`/`e.origin`, exactly as every other `designer:*` message
already does):

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| parent → iframe | `designer:paletteDragMove` | `{x, y}` (iframe-local px) | Pointer position during drag, throttled to one per `requestAnimationFrame`. |
| iframe → parent | `designer:dropTarget` | `{target: DropTarget \| null}` | Resolved drop target, sent only when it changes (not every move). |
| parent → iframe | `designer:paletteDragEnd` | `{}` | Tells the iframe to clear its drop-indicator overlay (belt-and-suspenders alongside the reload that normally follows a successful drop). |

```ts
type DropTarget =
  | { kind: "into-column"; colPath: number[]; index: number }
  | { kind: "new-section"; afterBlockIndex: number };
```

## Drop target resolution (inside the iframe)

On each `designer:paletteDragMove`, the `designerEdit` script:

1. `document.elementFromPoint(x, y)` → walk up to the nearest ancestor
   carrying `data-designer-path` (the same attribute `SectionBlock.astro`
   already stamps on every section/row/column/element, generic/depth-
   agnostic — this means a container's nested children resolve for free,
   no new stamping needed, matching the existing selection bridge's own
   "already depth-agnostic" behavior).
2. If the pointer is within the top or bottom ~1/3 of that ancestor
   section's own box: resolve to `{kind: "new-section", afterBlockIndex}`.
3. Otherwise, if resolved within a column: resolve to `{kind:
   "into-column", colPath, index}`, where `index` is computed by comparing
   the pointer's Y position against the vertical midpoint of each existing
   sibling element in that column (standard nearest-midpoint insertion-index
   math — the same approach sortable-list implementations and tools like
   Figma/Framer use for their own insertion-line indicators).
4. Render/update a single absolutely-positioned overlay `<div>` directly in
   the iframe's own DOM for the insertion line / column highlight — pure
   local DOM update, no round-trip needed for this part.
5. Post `designer:dropTarget` back to the parent only when the resolved
   target actually changes since the last message (not on every pointer
   move) — keeps postMessage volume low.

## Drop commit (in the admin parent)

On `pointerup` (delivered to the parent regardless of cursor position, per
Pointer Capture above):

- If the last-known `DropTarget` is `null` (pointer never resolved over a
  valid target, e.g. released outside the iframe or over chrome/toolbar) —
  no-op. This is not an error case; a cancelled/aborted drag is expected.
- If `{kind: "into-column"}` — call the existing `dropIntoColumn(colPath,
  index)` with `drag.current` set to `{kind: "new", type, propsOverride}`
  beforehand (same shape the Blocks-mode palette already produces).
- If `{kind: "new-section"}` — call the existing `dropIntoNewSection()`
  (today appends at the end; this spec's "between sections" case needs it
  extended to accept an explicit insertion index — see Open follow-up
  below).
- Either way: `mutate()` fires (the existing undo/dirty/autosave pipeline is
  completely unchanged), then post `designer:paletteDragEnd`, then the
  normal Live Edit reload-on-edit flow (already existing, unchanged) shows
  the result.

Locked sections: `isSectionLocked` is already checked inside
`dropIntoColumn`/the new-section path — reused as-is, no new lock logic.

## Performance / non-functional

- `postMessage` between two documents in the same browser tab is in-process
  IPC, not a network call — unaffected by the tenant's internet connection
  or by the live site's visitor traffic.
- Throttled to `requestAnimationFrame` cadence — bounded CPU cost regardless
  of how fast the pointer moves.
- The iframe reload (the one genuinely "expensive" operation in this whole
  flow) happens exactly once, on drop — never during the drag gesture
  itself.
- Saving to the database goes through the existing `usePersist` autosave
  queue (serialized, debounced) — this feature adds no new save-triggering
  path.
- This is an authenticated-admin-only code path, gated by the existing
  `designerEdit` flag already threaded through `BaseLayout.astro`. It ships
  in no bundle a real site visitor ever loads.

## Edge cases

- Drop released outside the iframe, or before any `designer:dropTarget` was
  ever received: last-known target is `null` → no-op, not an error.
- Iframe navigates/reloads mid-drag (e.g. an unrelated concurrent edit):
  `postMessage` to a torn-down `contentWindow` fails silently, matching the
  existing try/catch pattern already in `useLiveEditBridge.ts` for the same
  class of race.
- A locked section under the pointer: existing `isSectionLocked` check
  inside the commit path rejects with the existing toast — no new UI needed.
- Multiple pointers (multi-touch): `pointerId`-scoped capture means a second
  pointer is simply ignored while the first is captured, per standard
  Pointer Events semantics.
- `pointercancel` (e.g. browser-initiated gesture cancellation): treated
  identically to a target-less `pointerup` — clear the overlay, no mutation.

## Testing

- New pure-function unit tests (no DOM/browser needed, same style as
  `designerTree.selfcheck.ts`): the nearest-midpoint insertion-index
  calculation, and the `clientXY → iframeLocalXY` coordinate-mapping math.
- Extend the existing Playwright smoke test
  (`e2e/designer-smoke.spec.ts`): open Live Edit, drag a Heading from the
  palette onto the live-rendered page, assert the new element exists after
  the reload.
- The drop-indicator overlay's own visual appearance is not covered by
  automated tests — verified manually, matching the existing precedent
  (the slide free-position feature's smart-guides are also manual-only).

## Open follow-up (not blocking this spec)

`dropIntoNewSection()` today only appends a new section at the very end of
the page. This feature's "drop between two existing sections" case needs an
explicit insertion index. The implementation plan should extend
`dropIntoNewSection(afterBlockIndex?: number)` to accept an optional
position (preferred over a separate inline call at the Live Edit commit
site — keeps one function, one call site for every "wrap this drag in a new
section" case, including the existing Blocks-mode button/drop-zone, so both
surfaces stay behaviorally identical by construction).
