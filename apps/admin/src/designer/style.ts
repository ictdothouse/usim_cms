import { bestTextColor } from "@/lib/utils";

// Style-computation pure helpers split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
// The size/side-key tables below were moved here from Designer.tsx as part
// of Layer 1b (Inspector/ElPreview extraction) — zero closure dependency on
// Designer() state, but ElPreview.tsx/Inspector.tsx (designer/ files) can
// never import back from Designer.tsx (see designer/types.ts's own note),
// so anything a designer/ file needs has to live in designer/ too.

export const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
export const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
export const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };

export const SPACE: Record<string, string> = { sm: "1rem", md: "2rem", lg: "4rem", xl: "6rem" };
export const TEXT_SIZE: Record<string, string> = { sm: "0.875rem", md: "1rem", lg: "1.2rem" };
export const H_SIZE: Record<string, string> = { "1": "2.6rem", "2": "2rem", "3": "1.5rem", "4": "1.2rem" };
export const ICON_SIZE: Record<string, string> = { sm: "1rem", md: "1.5rem", lg: "2.25rem", xl: "3rem" };
// Mirrors SectionBlock.astro's own SLIDER_HEIGHT table — legacy pages saved
// before the height field became free-form ("length" kind) still store one of
// these keywords; resolving it here lets the canvas preview show the real
// height for those too, not just newly-typed literal values.
export const SLIDER_HEIGHT: Record<string, string> = { sm: "24rem", md: "32rem", lg: "42rem", full: "100vh" };

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
// Column, and the same RADIUS.none fallback — no element gets a rounded
// corner unless the author explicitly sets one.
export function elRadius(p: Record<string, string>): string {
  const corner = (per: string) => lengthValue(p[per] || p.radius, RADIUS, RADIUS.none);
  return `${corner("radiusTopLeft")} ${corner("radiusTopRight")} ${corner("radiusBottomRight")} ${corner("radiusBottomLeft")}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]);
}
export function safeHref(u: string) {
  // Browsers discard ASCII control/space chars (0x00-0x20) from anywhere in
  // a URL before parsing its scheme, not just the ends — a bare .trim()
  // left "java\tscript:alert(1)" able to slip past the scheme regex below
  // while still executing as javascript: once rendered. Stripping them from
  // the whole string (not just trimming) closes that, and also means the
  // href we actually emit can't still be smuggling one.
  const v = u.replace(/[\x00-\x20]+/g, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^https?:/i.test(v) ? v : "#";
  return v;
}
// Small inline-markdown subset for heading/text: **bold**, *italic*, [label](url).
// Duplicated (not shared) in SectionBlock.astro's own renderInline — same
// convention as this file's PAD/RADIUS tables mirroring the frontend's.
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
