// Shared type/interface declarations for the Designer's slider element and
// canvas smart-guide geometry — split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
// Pure type declarations only, no runtime code.

import type { Key } from "@/i18n";

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

// Same "flow vs custom x/y" idea buttons already have, applied to the
// heading/subtitle too — the shared shape both extend is `Positionable`,
// used by dragPosition/nudgePosition/PositionEditor so all three item kinds
// (heading, subtitle, button) drive the exact same drag/nudge/preset code.
// Deliberately NOT `Positionable` — heading/subtitle tried free x/y placement
// (like buttons) and it felt wrong in practice ("tiba2 jd tak best la heading
// dan subtitle sama macam button"): dropped in favor of a plain `align`
// select, the same left/center/right control the standalone heading/text
// element types already use (`designer-f-align`), and `fontSize` moved from
// a canvas resize-handle to a typed number input next to it — a "Typography"
// mini-section, not a drag interaction.
// `Positionable` again (canvas hand-drag/resize for heading/subtitle stays —
// only the Inspector's minimap went away, replaced by a simple align
// icon-row, same ALIGN_ICON control the standard heading/text element types
// already use). `align` only matters while `position === "flow"` (it's the
// text-align inside the shared content block); it's ignored once dragged to
// a custom x/y, same as a standalone positioned box has no "alignment".
export interface Positionable {
  position: "flow" | "custom";
  x: string;
  y: string;
}

// Typography fields mirror TYPOGRAPHY_FIELDS' own keys/options exactly
// (defined in designer/fields.ts) so the Inspector can render them by literally
// reusing that same field list + FieldInput, rather than a second
// hand-written set of fontWeight/textTransform/etc. controls — kept in
// lockstep by construction.
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

// Field-schema types for the Inspector's data-driven field renderer
// (FieldInput/FieldGroups) — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) so
// FieldInput.tsx/FieldGroups.tsx/fields.ts can share them without importing
// back from Designer.tsx.
export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "color"
  | "image"
  | "gallery"
  | "length"
  | "icon"
  | "shadow"
  | "pairs"
  | "slides"
  | "font"
  | "stepper"
  | "menu-select";

export interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
  // "pairs" kind only: i18n keys for the two sub-field placeholders (e.g. Question/Answer vs Label/Content).
  subLabels?: [Key, Key];
  // "stepper" kind only: +/- nudge amount (default 1 if omitted).
  step?: number;
}

// Grouped Styles panel (Framer/Webflow-style) bucket key — keyed by
// field.key since that's stable across section/column/element, unlike
// labelKey which a few fields share for unrelated purposes.
export type FieldGroupKey = "content" | "typography" | "background" | "spacing" | "size" | "appearance" | "border" | "advanced";
