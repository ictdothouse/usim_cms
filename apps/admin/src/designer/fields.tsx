// Field-schema lookup tables for the Inspector's data-driven field renderer
// (FieldInput/FieldGroups) — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
import {
  AlignLeft,
  AlignVerticalJustifyCenter,
  Anchor,
  Baseline,
  Blend,
  Bold,
  CaseSensitive,
  Check,
  Code2,
  Columns,
  Frame,
  Hash,
  Heading1,
  Image as ImageIcon,
  Images,
  Link,
  List,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  PaintBucket,
  Palette,
  Percent,
  RectangleHorizontal,
  Ruler,
  SlidersHorizontal,
  Square,
  SquareDashedBottom,
  Star,
  Type,
} from "lucide-react";
import type { Key } from "@/i18n";
import type { Field, FieldGroupKey } from "./types";

// Shared across heading/text/list — full typography control. fontFamily is
// any Google Font name; see the useEffect near Designer()'s own body that
// keeps a matching <link> synced into document.head for canvas preview.
export const TYPOGRAPHY_FIELDS: Field[] = [
  { key: "fontFamily", labelKey: "designer-f-fontfamily", kind: "font" },
  { key: "color", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "lineHeight", labelKey: "designer-f-lineheight", kind: "stepper", step: 0.1 },
  { key: "letterSpacing", labelKey: "designer-f-letterspacing", kind: "stepper", step: 0.5 },
  { key: "fontWeight", labelKey: "designer-f-fontweight", kind: "select", options: ["400", "500", "600", "700", "800"] },
  {
    key: "textTransform",
    labelKey: "designer-f-texttransform",
    kind: "select",
    options: ["none", "uppercase", "lowercase", "capitalize"],
  },
  { key: "fontStyle", labelKey: "designer-f-fontstyle", kind: "select", options: ["normal", "italic"] },
  {
    key: "textDecoration",
    labelKey: "designer-f-textdecoration",
    kind: "select",
    options: ["none", "underline", "line-through"],
  },
];

// Grouped Styles panel (Framer/Webflow-style): buckets the same flat Field
// lists (SECTION_FIELDS/COLUMN_FIELDS/ELS[type].fields, still in
// Designer.tsx) into collapsible sections by what the field actually
// controls, instead of one long form.
export const FIELD_GROUP_BY_KEY: Record<string, FieldGroupKey> = {
  text: "content", src: "content", alt: "content", href: "content", label: "content",
  url: "content", name: "content", items: "content", html: "content", images: "content",
  variant: "content", style: "content",
  // "menu" element only — menuId/dropdownTrigger/megaMenuWidth are new keys,
  // no collision with any other element's fields. `layout` is also new (no
  // other element uses that key name) but isn't listed here: the lookup
  // already falls back to "content" for any unmapped key (see the `?? "content"`
  // default in FieldGroups), so it lands in the same group either way.
  menuId: "content", dropdownTrigger: "content", megaMenuWidth: "content",
  fontFamily: "typography", color: "typography", lineHeight: "typography",
  letterSpacing: "typography", fontWeight: "typography", level: "typography", align: "typography",
  textTransform: "typography", fontStyle: "typography", textDecoration: "typography",
  bg: "background", bgImage: "background", textColor: "background",
  paddingY: "spacing", paddingX: "spacing", padding: "spacing", marginY: "spacing",
  width: "size", valign: "size", height: "size", ratio: "size", columns: "size", size: "size",
  // Figma-style split: Appearance (opacity/shadow/radius — visual effects)
  // vs Stroke (the actual border color/width/style), each its own card.
  opacity: "appearance", shadow: "appearance", radius: "appearance",
  border: "border", borderWidth: "border", borderColor: "border", borderStyle: "border",
  anchorId: "advanced", cssClass: "advanced",
};

export const GROUP_META: { key: FieldGroupKey; labelKey: Key; icon: typeof Type }[] = [
  { key: "content", labelKey: "designer-group-content", icon: Type },
  { key: "typography", labelKey: "designer-group-typography", icon: Baseline },
  { key: "background", labelKey: "designer-group-background", icon: PaintBucket },
  { key: "spacing", labelKey: "designer-group-spacing", icon: Frame },
  { key: "size", labelKey: "designer-group-size", icon: RectangleHorizontal },
  { key: "appearance", labelKey: "designer-group-appearance", icon: Blend },
  { key: "border", labelKey: "designer-group-border", icon: Square },
  { key: "advanced", labelKey: "designer-group-advanced", icon: Hash },
];

// Seed values a freshly-added shadow starts from — visually close to the old
// "md" preset, so switching a legacy preset into the new panel doesn't jump.
export const SHADOW_DEFAULT_PARTS = ["0", "4", "12", "0", "#000000", "0.12"] as const;

// Baseline px used as the canvas resize handle's starting point when
// heading/subtitle (slider element) have no explicit fontSize yet.
export const TEXT_BASE_PX = { heading: 20, subtitle: 13 };

// 3x3 anchor grid offered as one-click shortcuts for a slide button/heading/
// subtitle's custom x/y — clicking a dot just sets x/y to a canonical spot
// and switches position to "custom"; there's no separate named-preset enum
// to keep in sync between admin/frontend/validator, presets are purely a UI
// convenience over the same x/y percent every custom-dragged item already uses.
export const POSITION_PRESETS: { x: string; y: string }[] = [
  { x: "10", y: "15" }, { x: "50", y: "15" }, { x: "90", y: "15" },
  { x: "10", y: "50" }, { x: "50", y: "50" }, { x: "90", y: "50" },
  { x: "10", y: "85" }, { x: "50", y: "85" }, { x: "90", y: "85" },
];

// One glyph per field label, so the inspector reads at a glance instead of
// requiring every label to be sounded out — same "icon + short label" idea
// Puck uses throughout its own field list. Not exhaustive on purpose: a field
// with no obvious universal glyph (e.g. free-text href/url) just shows text.
const FIELD_ICONS: Partial<Record<Key, typeof Check>> = {
  "designer-s-bg": PaintBucket,
  "designer-s-bgimage": ImageIcon,
  "designer-s-textcolor": Palette,
  "designer-s-padding": Frame,
  "designer-f-padding": Frame,
  "designer-f-paddingx": Frame,
  "designer-f-marginy": MoveVertical,
  "designer-s-width": RectangleHorizontal,
  "designer-s-border": Square,
  "designer-s-borderwidth": Square,
  "designer-s-bordercolor": Palette,
  "designer-s-borderstyle": Square,
  "designer-s-opacity": Percent,
  "designer-s-shadow": Blend,
  "designer-f-radius": SquareDashedBottom,
  "designer-f-anchorid": Anchor,
  "designer-f-cssclass": Hash,
  "designer-f-valign": AlignVerticalJustifyCenter,
  "designer-col-span": Columns,
  "designer-f-text": Type,
  "designer-f-level": Heading1,
  "designer-f-align": AlignLeft,
  "designer-f-size": Ruler,
  "designer-f-src": ImageIcon,
  "designer-f-alt": CaseSensitive,
  "designer-f-label": Type,
  "designer-f-href": Link,
  "designer-f-variant": SlidersHorizontal,
  "designer-f-height": MoveVertical,
  "designer-f-url": Link,
  "designer-f-ratio": RectangleHorizontal,
  "designer-f-icon-name": Star,
  "designer-f-icon-size": Maximize2,
  "designer-f-icon-color": Palette,
  "designer-f-list-items": List,
  "designer-f-list-style": List,
  "designer-f-html": Code2,
  "designer-f-gallery-images": Images,
  "designer-f-gallery-columns": Columns,
  "designer-f-fontfamily": Baseline,
  "designer-f-lineheight": MoveVertical,
  "designer-f-letterspacing": MoveHorizontal,
  "designer-f-fontweight": Bold,
};
export function FieldLabel(labelKey: Key, t: (k: Key) => string) {
  const Icon = FIELD_ICONS[labelKey];
  return (
    <>
      {Icon && <Icon className="mr-1 inline-block h-3 w-3 shrink-0 -translate-y-px align-middle text-sub" />}
      {t(labelKey)}
    </>
  );
}
