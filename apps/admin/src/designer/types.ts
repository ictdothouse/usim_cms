// Shared type/interface declarations for the Designer's slider element and
// canvas smart-guide geometry — split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md), since
// grown with several Layer 1a additions (each marked with its own inline
// provenance comment below).
// Pure type declarations only, no runtime code.

import type { Key } from "@/i18n";

// A slide is its own small section body — the same rows: Row[] tree a
// Section itself has (see SectionProps below), reusing every existing
// element type (heading/text/button/image/etc.) and Inspector field editor
// instead of a bespoke heading/subtitle/button schema. A freshly-added slide
// has `rows: []` — nothing renders but a placeholder until the author
// explicitly adds Text/Button/Image/Row (see FieldInput.tsx's slides editor
// and ElPreview.tsx's slide-content renderer). Legacy slides saved before
// this shape existed (still carrying the old heading/subtitle/buttons keys)
// are silently upgraded to an equivalent rows: Row[] tree by
// parsers.ts's parseSlides — never a hard migration.
export interface SlideItem {
  imageUrl: string;
  // How the background image fills the slide box — CSS background-size/
  // repeat, "" falls back to "cover" (this element's original, only, look).
  bgSize: "cover" | "contain" | "repeat" | "no-repeat" | "auto" | "";
  bgColor: string; // hex fallback fill behind the image (or the whole slide when there's no image) — "" = transparent
  overlayColor: string;
  overlayOpacity: string; // "0".."100"
  textPosition: "left" | "center" | "right";
  rows: Row[];
}

// Field-schema types for the Inspector's data-driven field renderer
// (FieldInput/FieldGroups) — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) so
// FieldInput.tsx/FieldGroups.tsx/fields.tsx can share them without importing
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
  | "cards"
  | "font"
  | "stepper"
  | "menu-select"
  | "category-select"
  | "repeater";

// One sub-field of a "repeater" kind item — deliberately a small fixed set
// (not every FieldKind): a generic add/remove-cards editor only needs a
// plain text row, a multi-line text row, an image picker, or an icon
// picker per item, covering every repeater element added so far
// (testimonial/statscounter/peoplegrid/socialicons/logocloud/timeline/
// documentdownload) without a bespoke hand-written UI per element the way
// "cards" (cardgrid's own repeater) is. `type` also tells
// packages/element-schema which check to run on that key at write time
// (see REPEATER_SCHEMAS there) — keep both in sync when adding a field.
export interface RepeaterItemField {
  key: string;
  labelKey: Key;
  type: "text" | "textarea" | "image" | "icon";
}

export interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
  // "pairs" kind only: i18n keys for the two sub-field placeholders (e.g. Question/Answer vs Label/Content).
  subLabels?: [Key, Key];
  // "stepper" kind only: +/- nudge amount (default 1 if omitted).
  step?: number;
  // "repeater" kind only: the per-item sub-field schema.
  itemFields?: RepeaterItemField[];
}

// Grouped Styles panel (Framer/Webflow-style) bucket key — keyed by
// field.key since that's stable across section/column/element, unlike
// labelKey which a few fields share for unrelated purposes.
export type FieldGroupKey = "content" | "typography" | "background" | "spacing" | "size" | "appearance" | "border" | "advanced";

// Designer()'s canvas breakpoint-preview state — named here so files split
// out of Designer.tsx can type a `bp` prop without duplicating the literal
// union `Designer()` itself still declares inline via `useState<Bp>(...)`.
export type Bp = "desktop" | "tablet" | "mobile";

// ---------- data model (stored in pages.layout JSONB) ----------
// A designer page is a list of blocks; the designer emits `section` blocks:
//   { type: "section", props: { bg?, bgImage?, textColor?, paddingY?, width?, rows: Row[] } }
// Legacy blocks (hero/text/image from the old BlockBuilder) are kept as-is and
// shown as locked cards — the frontend still renders them.
// Moved here from Designer.tsx (byte-identical relocation, `ElType` gained
// `export` since it didn't need it while every user lived in the same file)
// so `designer/FieldInput.tsx` can type its `blocks`/`SectionProps` cast
// without importing back from Designer.tsx — files under `designer/` must
// never import from Designer.tsx, even type-only (see the Layer 1a review
// that caught the original `import type ... from "../Designer"` as a
// violation of this one-directional rule).

export type ElType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "spacer"
  | "divider"
  | "embed"
  | "icon"
  | "list"
  | "html"
  | "gallery"
  | "accordion"
  | "infobox"
  | "tabs"
  | "slider"
  | "menu"
  | "cardgrid"
  | "ctabanner"
  | "announcementbar"
  | "postlist"
  // Batch of simple, no-backend Designer elements (audit report sections
  // 5.2/5.7) — each a repeater of small items (see FieldKind "repeater"
  // below) except googlemap/announcementticker, which are flat props.
  | "testimonial"
  | "statscounter"
  | "peoplegrid"
  | "socialicons"
  | "logocloud"
  | "timeline"
  | "documentdownload"
  | "googlemap"
  | "announcementticker"
  | "eventlist";

// Sprint 5 (docs/laporan-audit-ui-ux.md section 5.6) "card grid" element —
// items is a JSON array of these, stored as a string in El.props.cards (see
// Designer.tsx's ELS.cardgrid). No legacy pipe-line format to fall back to
// (brand new element, unlike slider), so parseCards/stringifyCards
// (designer/parsers.ts) only ever need to handle this one shape.
export interface CardItem {
  image: string;
  title: string;
  description: string;
  href: string;
  buttonLabel: string;
}

export interface El {
  id: string;
  type: ElType;
  props: Record<string, string>;
  // Breakpoint style overrides, admin-preview only (see Designer's bp
  // toggle) — keyed "tablet:<fieldKey>" / "mobile:<fieldKey>", falling back
  // to props[fieldKey] when absent. Never read by apps/frontend.
  bp?: Record<string, string>;
}
export interface Col {
  span: number;
  elements: El[];
  // Column-level style escape hatch — see COLUMN_FIELDS. Kept as a loose
  // string bag (not a typed interface) to match El.props/SectionProps'
  // convention of storing style values as plain strings.
  props?: Record<string, string>;
  bp?: Record<string, string>;
}
export interface Row {
  columns: Col[];
  // Gap between this row's columns. Unset falls back to the same default
  // the real frontend's .ds-row CSS uses (SectionBlock.astro) — "2rem".
  gap?: string;
  // Space above/below this row (the gap *between rows* stacked in the same
  // section). Unset marginTop falls back to the old fixed space-y value
  // (see the rows container below) — except row 0, which never got a
  // leading gap under the old space-y-based layout either.
  marginTop?: string;
  marginBottom?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  // Per-breakpoint visibility — "true" hides this row on that screen size,
  // unset/"" always shows. Real @media rules on the published site, not an
  // admin-preview-only simulation like the `bp` style-override bag (that one
  // never reaches apps/frontend) — see SectionBlock.astro's hideCss().
  hideDesktop?: string;
  hideTablet?: string;
  hideMobile?: string;
}
export interface SectionProps {
  bg?: string;
  bgImage?: string;
  textColor?: string;
  paddingY?: string;
  paddingX?: string;
  // Per-side overrides — freedom to set Top/Right/Bottom/Left independently
  // instead of just the Y/X shorthand above. Empty/unset falls back to the
  // matching axis (paddingTop/Bottom -> paddingY, paddingRight/Left ->
  // paddingX), which itself falls back to the PAD table default — same
  // fallback-chain convention as bp overrides.
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  marginY?: string;
  marginX?: string;
  // Per-side overrides — same fallback convention as padding's per-side keys
  // (marginTop/Bottom -> marginY, marginLeft/Right -> marginX).
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  width?: string;
  border?: string;
  // Real stroke (replaces the border preset above for anything edited after
  // this was added): borderWidth set means "use these", otherwise render
  // falls back to the legacy none/thin/thick preset so old pages don't move.
  borderWidth?: string;
  borderColor?: string;
  borderStyle?: string;
  // 0-100 percent string, CSS opacity applied to the whole section (backdrop
  // + content) — unset means fully opaque, same convention as every other
  // optional style prop here.
  opacity?: string;
  shadow?: string;
  radius?: string;
  // Per-corner overrides, same fallback convention: unset falls back to the
  // single `radius` preset above.
  radiusTopLeft?: string;
  radiusTopRight?: string;
  radiusBottomRight?: string;
  radiusBottomLeft?: string;
  anchorId?: string;
  cssClass?: string;
  rows: Row[];
  bp?: Record<string, string>;
  hideDesktop?: string;
  hideTablet?: string;
  hideMobile?: string;
  // Section lock (Page Blueprint deferred item) — superadmin-only toggle,
  // see designer/context.ts's isSectionLocked. Enforced server-side too
  // (apps/api's pagesBeforeChange rejects any save that changes or removes
  // a locked section, regardless of this client-side check).
  locked?: string;
}
export interface Block {
  type: string;
  props: Record<string, unknown>;
}

// selection path: [block] | [block,row] | [block,row,col] | [block,row,col,el]
// Moved here from Designer.tsx (Layer 1b, Inspector/ElPreview extraction) —
// designer/Inspector.tsx and designer/ElPreview.tsx both need this type and
// can never import it back from Designer.tsx.
export type Sel = number[] | null;

// Page-wide Designer defaults (pages.settings JSONB), read by Inspector's
// "nothing selected" panel. Moved here alongside Sel for the same reason.
export interface PageSettings {
  gap?: string;
  contentWidth?: "contained" | "full";
  paddingX?: string;
  theme?: Record<string, string>;
  themePresetName?: string;
}
