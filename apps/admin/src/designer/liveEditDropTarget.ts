// Pure math for Live Edit's drag-to-add feature (see
// docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md).
// apps/frontend/src/layouts/BaseLayout.astro's `designerEdit` script hand-
// ports resolveInsertionIndex's same logic (it's <script is:inline>, plain
// unbundled JS, so it can't import this module) — that file's own comment
// points back here. Keep both in sync by hand.

export interface IframeRectLike {
  left: number;
  top: number;
  width: number;
}

export type DropTarget = { kind: "into-column"; colPath: number[]; index?: number } | { kind: "new-section"; afterBlockIndex: number };

// DeviceViewport renders the Live Edit iframe at its true device width then
// CSS `transform: scale()`s it to fit the available space — rect.width
// (post-scale, parent-viewport px) divided by offsetWidth (pre-scale, the
// iframe's own true width) recovers that scale factor. Same derivation
// useLiveEditBridge.ts's existing `designer:contextmenu` handler already
// uses for the opposite direction (iframe-local -> parent).
export function clientToIframeLocal(
  clientX: number,
  clientY: number,
  iframeRect: IframeRectLike,
  iframeOffsetWidth: number,
): { x: number; y: number } {
  const scale = iframeOffsetWidth ? iframeRect.width / iframeOffsetWidth : 1;
  return {
    x: (clientX - iframeRect.left) / scale,
    y: (clientY - iframeRect.top) / scale,
  };
}

// Given the pointer's Y (iframe-local px), the hovered element's own
// bounding box, and that element's own index within its parent column,
// returns the index a dragged element should be inserted at: before the
// hovered element if the pointer is in its top half, after it otherwise.
export function resolveInsertionIndex(pointerY: number, hoveredRect: { top: number; height: number }, hoveredIndex: number): number {
  const midpoint = hoveredRect.top + hoveredRect.height / 2;
  return pointerY < midpoint ? hoveredIndex : hoveredIndex + 1;
}

// The canonical drop-target decision logic, hand-ported as plain JS into
// apps/frontend/src/layouts/BaseLayout.astro's `designerEdit` script (that
// script is <script is:inline>, deliberately unbundled, can't import this
// module). `path` is the dotted data-designer-path of whatever DOM node is
// under the pointer, already split into numbers (null when nothing with
// that attribute is under the pointer at all); `rect` is that node's own
// bounding box; `sectionCount` is how many top-level sections the page
// currently has (needed for the "no node" fallback below).
export function resolveDropTargetFromPath(
  path: number[] | null,
  pointerY: number,
  rect: { top: number; bottom: number; height: number },
  sectionCount: number,
): DropTarget {
  // Nothing with data-designer-path under the pointer at all: either the
  // page has no sections yet (a brand-new page) or the pointer is below
  // the last one. Either way, append a new section at the very end —
  // without this, Live Edit has no way to place a page's very first
  // section (found by the final branch review).
  if (!path) return { kind: "new-section", afterBlockIndex: sectionCount - 1 };
  // Section-level node (path length 1): top/bottom ~1/3 of its own box
  // means "drop between sections", not "into this section's first column".
  if (path.length === 1) {
    const third = rect.height / 3;
    if (pointerY <= rect.top + third) return { kind: "new-section", afterBlockIndex: path[0] - 1 };
    if (pointerY >= rect.bottom - third) return { kind: "new-section", afterBlockIndex: path[0] };
    return { kind: "into-column", colPath: [path[0], 0, 0] };
  }
  // Column-level node (path length 3: the pointer resolved directly to an
  // empty column, or to padding/a gap not covered by any element's own
  // box) — the path itself IS the column to append into. This must not
  // fall into the element branch below: treating it as [b,r] (the
  // column's PARENT row) would splice an element object into Row.columns
  // instead of Column.elements — the tree-corruption bug the final branch
  // review found (a phantom extra column, white-screening Blocks mode and
  // the Layers tree once the corrupted page reloads).
  if (path.length === 3) return { kind: "into-column", colPath: path };
  // Element-level node (length 4, or 5+ for a container's own nested
  // children): resolve to its PARENT's children array (colPath = its own
  // path minus the last index) and an insertion index relative to its own
  // position there — generic over depth, matching insertAt/childrenOf's
  // own depth-agnostic behavior (see designerTree.ts).
  const colPath = path.slice(0, -1);
  const hoveredIndex = path[path.length - 1];
  const index = resolveInsertionIndex(pointerY, rect, hoveredIndex);
  return { kind: "into-column", colPath, index };
}

// The single decision point between "what the iframe resolved" and "which
// existing useBlockOps function actually runs" — pulled out as its own pure
// function so a target-less drag (released outside the iframe, or dropped
// before any hover ever resolved) is a tested no-op rather than logic
// buried inside a pointerup event handler with no unit-test harness.
export function commitDropTarget(
  target: DropTarget | null,
  dropIntoColumn: (colPath: number[], index?: number) => void,
  dropIntoNewSection: (afterBlockIndex?: number) => void,
): void {
  if (!target) return;
  if (target.kind === "into-column") dropIntoColumn(target.colPath, target.index);
  else dropIntoNewSection(target.afterBlockIndex);
}
