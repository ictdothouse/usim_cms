import { bestTextColor } from "@/lib/utils";

// Style-computation pure helpers split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

export const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
export const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
export const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };
// Legacy preset keywords (existing pages' saved shadow="sm"/"md"/"lg" values)
// still resolve via this table. New edits store a pipe-delimited custom
// shadow instead — see shadowToCss() — no presets, a real X/Y/blur/spread/
// color/opacity panel (user: "saya taknak preset...letakkan option nombor").
export const LEGACY_SHADOW: Record<string, string | undefined> = {
  none: undefined,
  sm: "0 1px 3px rgba(0,0,0,.1)",
  md: "0 4px 12px rgba(0,0,0,.12)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};

// gapPx() round-trips a stored CSS length string to/from the <input
// type="number"> shown in the Inspector; assumes rem = 16px.
export function gapPx(v: string | undefined): number | "" {
  if (!v) return "";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return Math.round(v.endsWith("rem") ? n * 16 : n);
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number.isFinite(alpha) ? alpha : 1})`;
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

export function shadowToCss(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw in LEGACY_SHADOW) return LEGACY_SHADOW[raw];
  const [x, y, blur, spread, color, opacity] = raw.split("|");
  if (!x) return undefined;
  return `${x}px ${y}px ${blur ?? 0}px ${spread ?? 0}px ${hexToRgba(color, Number(opacity))}`;
}

// Resolves a spacing value that may be either a legacy preset keyword
// ("sm"/"md"/"lg"/"xl"/"none") or a real CSS length the author typed
// ("42px", "2.5rem") — existing pages keep their preset look, new edits get
// free-form units. Duplicated in SectionBlock.astro like every other table.
export function lengthValue(v: string | undefined, table: Record<string, string>, fallback: string) {
  if (!v) return fallback;
  return table[v] ?? v;
}

export function typoStyle(p: Record<string, string>): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (p.fontFamily) s.fontFamily = p.fontFamily;
  if (p.color) s.color = p.color;
  if (p.lineHeight) s.lineHeight = p.lineHeight;
  if (p.letterSpacing) s.letterSpacing = p.letterSpacing;
  if (p.fontWeight) s.fontWeight = p.fontWeight;
  if (p.textTransform) s.textTransform = p.textTransform as React.CSSProperties["textTransform"];
  if (p.fontStyle) s.fontStyle = p.fontStyle;
  if (p.textDecoration) s.textDecoration = p.textDecoration;
  return s;
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

// Element radius (image/embed/gallery): same per-corner freedom as Section/
// Column, but these elements default to a rounded "md" look out of the box,
// so the fallback is RADIUS.md, not RADIUS.none.
export function elRadius(p: Record<string, string>): string {
  const corner = (per: string) => lengthValue(p[per] || p.radius, RADIUS, RADIUS.md);
  return `${corner("radiusTopLeft")} ${corner("radiusTopRight")} ${corner("radiusBottomRight")} ${corner("radiusBottomLeft")}`;
}
