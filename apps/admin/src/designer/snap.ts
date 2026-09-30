// Nearest-candidate alignment snapping for the slide free-position drag/
// resize system (ElPreview.tsx's startFreeElDrag/startFreeElResize). Pure
// numeric helpers — no DOM dependency — so the actual alignment math is
// unit-testable without a browser; the px<->percent conversion (which needs
// a live container rect) stays in ElPreview.tsx, the one caller that has one.

export interface FreeRectPx {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Picks whichever candidate is closest to `value`, but only within `range`
// px — returns `value` unchanged if nothing is close enough. Applied
// independently per axis (x, y).
export function snapValue(value: number, candidates: number[], range = 8): number {
  let best = value;
  let bestDist = range;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// Drag-time candidates: the dragged element's own CENTER snaps to the
// slide's true center or another free sibling's center — the two
// alignments an author reaches for by hand most often (centering on the
// slide, lining up with another element).
export function centerXCandidates(containerWidth: number, siblings: FreeRectPx[]): number[] {
  return [containerWidth / 2, ...siblings.map((s) => s.left + s.width / 2)];
}
export function centerYCandidates(containerHeight: number, siblings: FreeRectPx[]): number[] {
  return [containerHeight / 2, ...siblings.map((s) => s.top + s.height / 2)];
}

// Resize-time candidates: the resized edge (right/bottom, since left/top
// stay fixed) snaps to the safe-area margin (mirrors ElPreview's own 6%
// inset guide) or another free sibling's matching edge.
export function edgeXCandidates(containerWidth: number, siblings: FreeRectPx[]): number[] {
  const inset = containerWidth * 0.06;
  const out = [inset, containerWidth - inset];
  for (const s of siblings) out.push(s.left, s.left + s.width);
  return out;
}
export function edgeYCandidates(containerHeight: number, siblings: FreeRectPx[]): number[] {
  const inset = containerHeight * 0.06;
  const out = [inset, containerHeight - inset];
  for (const s of siblings) out.push(s.top, s.top + s.height);
  return out;
}
