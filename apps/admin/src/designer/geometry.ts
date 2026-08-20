import type { Positionable, EdgeRect, GapMark } from "./types";

// Canvas drag/nudge/smart-guide geometry helpers split out of Designer.tsx
// (Layer 0 of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

// Baseline reference widths the Blocks canvas's "bp" preview simulates
// against — see fluidPreviewPx.
const BP_REFERENCE_PX: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 1000, tablet: 768, mobile: 384 };

// Mirrors SectionBlock.astro's fluidClamp/fluidFontSize math (real site:
// clamp(floor, vw, ceiling)) but evaluated in JS against a fixed reference
// width per breakpoint instead of an actual `vw` unit — the Blocks canvas's
// "bp" preview is just a max-width box inside the admin's own full browser
// window (Designer.tsx's `style={{ maxWidth: ... }}` on the canvas), so a
// real `vw`/`clamp()` here would measure the admin's actual (probably wide)
// window, not this simulated container, and never visibly shrink. This gives
// the canvas an accurate preview of how the real fluid font-size will look
// small instead of staying full (and overflowing) size regardless of bp.
export function fluidPreviewPx(px: number, bp: "desktop" | "tablet" | "mobile"): number {
  const floor = Math.max(14, Math.round(px * 0.55));
  const scaled = Math.round((px * BP_REFERENCE_PX[bp]) / 1000);
  return Math.min(px, Math.max(floor, scaled));
}

// Sizes the dashed resize box to the widest actually-rendered line of
// (possibly wrapped) text. No CSS value can do this: `width:fit-content`
// resolves to min(max-content, available), and the moment text wraps,
// max-content (its unwrapped width) exceeds available — so it collapses to
// the full container width and the box floats far past the glyphs.
// Range.getClientRects() returns one rect per rendered line box, so the
// widest of those is the true ink width. Called from an inline ref callback
// (a new function identity each render) rather than a layout effect, since
// the caller is a plain function, not a component that can hold hooks.
export function fitTextBox(node: HTMLElement | null): void {
  if (!node) return;
  node.style.width = "";
  const text = node.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) return;
  const widest = Math.max(...rects.map((r) => r.width));
  if (widest <= 0) return;
  // Tailwind sets box-sizing:border-box globally, so `width` has to include
  // the chip's own border/padding or the last glyph gets clipped.
  const cs = getComputedStyle(node);
  const extra =
    parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  node.style.width = `${Math.ceil(widest) + extra}px`;
}

// Click-or-drag inside a position minimap: computes percent from the
// pointerdown target's own bounding box (captured once, cheap — the minimap
// doesn't resize mid-drag) and tracks the pointer on window until release.
// Plain function, not a hook — safe to call from inside a .map().
export function dragPosition(e: React.PointerEvent<HTMLDivElement>, onMove: (x: string, y: string) => void) {
  const rect = e.currentTarget.getBoundingClientRect();
  const set = (clientX: number, clientY: number) => {
    const x = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)));
    onMove(String(x), String(y));
  };
  set(e.clientX, e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientX, ev.clientY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// percent per arrow-key press
const POSITION_NUDGE_STEP = 2;
// Arrow-key nudge for whichever canvas chip (button, heading, or subtitle)
// currently has keyboard focus — same x/y percent space as
// dragPosition/POSITION_PRESETS, just a smaller fixed step instead of a
// pointer position. Generic over `Positionable` since a still-"flow" item
// of any of the three kinds has no x/y yet — the first nudge starts it from
// the shared 50/50 center and switches it to "custom", same as dragging does.
export function nudgePosition<T extends Positionable>(item: T, key: string): Partial<T> | null {
  const dx = key === "ArrowLeft" ? -POSITION_NUDGE_STEP : key === "ArrowRight" ? POSITION_NUDGE_STEP : 0;
  const dy = key === "ArrowUp" ? -POSITION_NUDGE_STEP : key === "ArrowDown" ? POSITION_NUDGE_STEP : 0;
  if (dx === 0 && dy === 0) return null;
  const baseX = item.position === "custom" ? Number(item.x) : 50;
  const baseY = item.position === "custom" ? Number(item.y) : 50;
  return {
    position: "custom",
    x: String(Math.min(100, Math.max(0, baseX + dx))),
    y: String(Math.min(100, Math.max(0, baseY + dy))),
  } as Partial<T>;
}

// Figma-style "nearest neighbor" spacing tick: only returns a mark when the
// two rects don't overlap on that axis AND do overlap on the other (so the
// line has a sensible perpendicular anchor point) — a vertical gap needs
// x-overlap, a horizontal gap needs y-overlap. `axis` picks which one to
// compute; callers run this once per axis per candidate and keep only the
// smallest (nearest) result.
export function edgeGap(a: EdgeRect, b: EdgeRect, boxRect: EdgeRect, axis: "v" | "h"): GapMark | null {
  if (axis === "v") {
    const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (xOverlap <= 0) return null;
    const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    if (a.bottom <= b.top) return { top: a.bottom - boxRect.top, left: midX - boxRect.left, length: b.top - a.bottom };
    if (b.bottom <= a.top) return { top: b.bottom - boxRect.top, left: midX - boxRect.left, length: a.top - b.bottom };
    return null;
  }
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (yOverlap <= 0) return null;
  const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  if (a.right <= b.left) return { top: midY - boxRect.top, left: a.right - boxRect.left, length: b.left - a.right };
  if (b.right <= a.left) return { top: midY - boxRect.top, left: b.right - boxRect.left, length: a.left - b.right };
  return null;
}
