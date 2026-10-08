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
