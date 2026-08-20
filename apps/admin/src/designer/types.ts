// Shared type/interface declarations for the Designer's slider element and
// canvas smart-guide geometry — split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
// Pure type declarations only, no runtime code.

export interface SlideButton {
  label: string;
  href: string;
  variant: "primary" | "outline";
  color: string; // hex bg override, "" = theme default
  textColor: string; // hex text/border override, "" = theme default
  radius: string; // px number, "" = default pill radius
  size: "sm" | "md" | "lg";
  fontSize: string; // px number, "" = derive from size — set by the canvas resize handle
  // "flow" = original behavior, laid out inside the slide's text block
  // alongside heading/subtitle; "custom" = absolutely positioned anywhere
  // in the slide via x/y percent (drag-placed or preset-snapped).
  position: "flow" | "custom";
  x: string; // "0".."100", only meaningful when position === "custom"
  y: string;
}

export interface SlideItem {
  imageUrl: string;
  bgColor: string; // hex fallback fill behind the image (or the whole slide when there's no image) — "" = transparent
  heading: SlideText;
  subtitle: SlideText;
  textPosition: "left" | "center" | "right";
  overlayColor: string;
  overlayOpacity: string; // "0".."100"
  buttons: SlideButton[];
}

// Shared shape for heading/subtitle/button drag-position — dragPosition/
// nudgePosition/POSITION_PRESETS all operate on this generically so every
// item kind drives the same drag/nudge/preset code.
export interface Positionable {
  position: "flow" | "custom";
  x: string;
  y: string;
}

export interface SlideText extends Positionable {
  text: string;
  color: string; // hex text-color override, "" = inherit the slide's default
  fontSize: string; // px, "" = derive from TEXT_BASE_PX — set by canvas resize handle
  width: string; // px, "" = auto (shrink-to-fit the widest rendered line, see fitTextBox)
  align: "left" | "center" | "right";
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  fontStyle: string;
  textDecoration: string;
  // Same "tablet:<key>"/"mobile:<key>" bag shape as Section/Col/El's own
  // `bp` — but unlike those (admin-preview only), this one IS real on the
  // published site (SectionBlock.astro's slideTextStyleBp).
  bp?: Record<string, string>;
}

// Minimal DOMRect-shaped bag for the canvas smart-guide math — lets the
// dragged item's "virtual" rect (built from clientX/Y mid-drag, not a real
// live DOM node) be the same type as every real rect it's compared against.
export interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type GapMark = { top: number; left: number; length: number };
