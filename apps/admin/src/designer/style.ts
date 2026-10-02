import { bestTextColor } from "@/lib/utils";
import { escapeHtml, sanitizeUrl } from "@ucms/element-style";
import {
  PAD,
  RADIUS,
  BORDER,
  SPACE,
  TEXT_SIZE,
  ICON_SIZE,
  SLIDER_HEIGHT,
  LEGACY_SHADOW,
  lengthValue,
  hexToRgba,
  shadowToCss,
  elRadius,
  elHoverClass,
  elMarginStyle as sharedElMarginStyle,
  elPaddingStyle as sharedElPaddingStyle,
  elBorderShadowStyle as sharedElBorderShadowStyle,
  typoStyle as sharedTypoStyle,
} from "@ucms/element-render";
export {
  escapeHtml,
  PAD,
  RADIUS,
  BORDER,
  SPACE,
  TEXT_SIZE,
  ICON_SIZE,
  SLIDER_HEIGHT,
  LEGACY_SHADOW,
  lengthValue,
  hexToRgba,
  shadowToCss,
  elRadius,
  elHoverClass,
};

// Style-computation pure helpers split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
// The size/side-key tables below were moved here from Designer.tsx as part
// of Layer 1b (Inspector/ElPreview extraction) — zero closure dependency on
// Designer() state, but ElPreview.tsx/Inspector.tsx (designer/ files) can
// never import back from Designer.tsx (see designer/types.ts's own note),
// so anything a designer/ file needs has to live in designer/ too.

export const H_SIZE: Record<string, string> = { "1": "2.6rem", "2": "2rem", "3": "1.5rem", "4": "1.2rem" };

// Scales a free-form "length" field's numeric part by `ratio`, keeping
// whatever unit (or lack of one) it already had. Anything that doesn't parse
// as a plain number+unit (e.g. a "%"-relative value, where "bigger" is
// meaningless) is left untouched rather than guessed at.
export function scaleLength(value: string, ratio: number): string | null {
  const m = /^(\d+(?:\.\d+)?)(px|rem|em)?$/.exec(value.trim());
  if (!m) return null;
  const num = Number(m[1]) * ratio;
  const unit = m[2] ?? "px";
  const rounded = unit === "px" ? Math.max(8, Math.round(num)) : Math.max(0.5, Math.round(num * 100) / 100);
  return `${rounded}${unit}`;
}

// Corner-resize "text grows with the box" for a free-positioned slide child —
// one rule for both the Blocks canvas (ElPreview.tsx) and Live Edit's iframe
// resize (useLiveEditBridge.ts). Heading/button have no continuous size
// field (heading's H_SIZE is a preset per level, button a fixed text-sm), so
// posFontSize is a free-position-only override for both; text scales its own
// "size". `get` resolves a prop at the current breakpoint.
export function scaledFreeFont(type: string, get: (k: string) => string, ratio: number): Record<string, string> {
  const size = get("size");
  const base =
    type === "heading"
      ? get("posFontSize") || H_SIZE[get("level") || "2"]
      : type === "button"
        ? get("posFontSize") || "0.875rem"
        : TEXT_SIZE[size] ?? (size || TEXT_SIZE.md);
  const scaled = scaleLength(base, ratio);
  return scaled ? { [type === "text" ? "size" : "posFontSize"]: scaled } : {};
}

// Four-side padding/radius/margin field-name maps — shared by Inspector's
// FourSideControl panels and the canvas's own bp*Style resolution. Plain
// literal maps, zero closure dependency.
export const PADDING_SIDE_KEYS = { top: "paddingTop", right: "paddingRight", bottom: "paddingBottom", left: "paddingLeft" } as const;
export const PADDING_SIDE_FALLBACK = { top: "paddingY", right: "paddingX", bottom: "paddingY", left: "paddingX" } as const;
export const MARGIN_SIDE_KEYS = { top: "marginTop", right: "marginRight", bottom: "marginBottom", left: "marginLeft" } as const;
export const MARGIN_SIDE_FALLBACK = { top: "marginY", right: "marginX", bottom: "marginY", left: "marginX" } as const;
export const RADIUS_CORNER_KEYS = {
  top: "radiusTopLeft",
  right: "radiusTopRight",
  bottom: "radiusBottomRight",
  left: "radiusBottomLeft",
} as const;
// gapPx() round-trips a stored CSS length string to/from the <input
// type="number"> shown in the Inspector; assumes rem = 16px.
export function gapPx(v: string | undefined): number | "" {
  if (!v) return "";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return Math.round(v.endsWith("rem") ? n * 16 : n);
}

// Canvas overlay chrome (dashed guides, drop hints) is drawn straight on top
// of whatever bg color the section/column actually has, which the tenant
// can set to anything — flips the guide-line/hint-text color dark-on-light
// vs light-on-dark based on which reads better against that bg.
export function overlayColors(bg: string): { line: string; text: string } {
  const dark = bestTextColor(bg) === "#000000";
  return dark
    ? { line: hexToRgba("#000000", 0.35), text: hexToRgba("#000000", 0.55) }
    : { line: hexToRgba("#ffffff", 0.45), text: hexToRgba("#ffffff", 0.75) };
}

// Plain (non-bp) margin/padding/border/shadow, and typography — now single-
// sourced in @ucms/element-render (see that package's own header comment for
// why: these were the CSS style-computation helpers apps/frontend's
// element-render.ts hand-duplicated, the exact drift risk that package's
// design closes). These wrappers just cast the shared Record<string,string>
// declaration map to React.CSSProperties for this app's own call sites.
export function elMarginStyle(p: Record<string, string>): React.CSSProperties | undefined {
  return sharedElMarginStyle(p) as React.CSSProperties | undefined;
}
export function elPaddingStyle(p: Record<string, string>): React.CSSProperties | undefined {
  return sharedElPaddingStyle(p) as React.CSSProperties | undefined;
}
export function elBorderShadowStyle(p: Record<string, string>): React.CSSProperties {
  return sharedElBorderShadowStyle(p) as React.CSSProperties;
}

// elHoverClass is re-exported from @ucms/element-render above (:hover can't
// be expressed as inline React.CSSProperties, so it just picks a fixed class
// name — see that package's own comment).
export function typoStyle(p: Record<string, string>): React.CSSProperties {
  return sharedTypoStyle(p) as React.CSSProperties;
}

export function colStyle(cp?: Record<string, string>): React.CSSProperties {
  if (!cp) return {};
  const anyPadding = cp.padding || cp.paddingTop || cp.paddingRight || cp.paddingBottom || cp.paddingLeft;
  const padSide = (per: string) => lengthValue(cp[per] || cp.padding, PAD, "0");
  const anyRadius = cp.radius || cp.radiusTopLeft || cp.radiusTopRight || cp.radiusBottomRight || cp.radiusBottomLeft;
  const radCorner = (per: string) => lengthValue(cp[per] || cp.radius, RADIUS, RADIUS.none);
  const anyMargin = cp.marginY || cp.marginX || cp.marginTop || cp.marginRight || cp.marginBottom || cp.marginLeft;
  const marginSide = (per: string, axis: string) => lengthValue(cp[per] || cp[axis], PAD, "0");
  return {
    background: cp.bg || undefined,
    padding: anyPadding
      ? `${padSide("paddingTop")} ${padSide("paddingRight")} ${padSide("paddingBottom")} ${padSide("paddingLeft")}`
      : undefined,
    margin: anyMargin
      ? `${marginSide("marginTop", "marginY")} ${marginSide("marginRight", "marginX")} ${marginSide("marginBottom", "marginY")} ${marginSide("marginLeft", "marginX")}`
      : undefined,
    alignSelf: cp.valign === "top" ? "start" : cp.valign === "bottom" ? "end" : cp.valign === "center" ? "center" : undefined,
    border: cp.border ? BORDER[cp.border] : undefined,
    boxShadow: shadowToCss(cp.shadow),
    borderRadius: anyRadius
      ? `${radCorner("radiusTopLeft")} ${radCorner("radiusTopRight")} ${radCorner("radiusBottomRight")} ${radCorner("radiusBottomLeft")}`
      : undefined,
  };
}

// elRadius is re-exported from @ucms/element-render above.

// Anchor-specific fallback convention (falls back to "#", never undefined) —
// the actual scheme/control-char validation now lives once in
// @ucms/element-style's sanitizeUrl, shared with apps/frontend's own
// safeUrl (which instead returns undefined so an <img>/bgImage can skip
// rendering rather than pointing at a broken URL).
export function safeHref(u: string) {
  return sanitizeUrl(u) ?? "#";
}
// Small inline-markdown subset for heading/text: **bold**, *italic*, [label](url).
// renderInline itself is still hand-mirrored in SectionBlock.astro (same
// convention as this file's PAD/RADIUS tables) — only its underlying
// escapeHtml/sanitizeUrl now come from @ucms/element-style, not the whole
// function.
// ponytail: link regex stops at the first ")" in the URL, so a raw
// unescaped "(" / ")" inside the URL itself truncates it — fine for normal
// links/anchors, encode the parens if it ever matters.
export function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeHref(url)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// Matches apps/frontend/global.css's h1 vs h2-h6 rule: h1 reads the theme's
// heading font, everything smaller reads subheading (falling back to heading,
// then the body font).
export function headingFontFamily(level: string | undefined): string {
  return level === "1"
    ? "var(--font-heading, var(--font-family, inherit))"
    : "var(--font-subheading, var(--font-heading, var(--font-family, inherit)))";
}
