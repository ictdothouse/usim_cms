// Shared render-value computation for apps/admin's designer canvas (ElPreview.tsx/style.ts,
// React) and apps/frontend's real published renderer (SliderBlock.astro, Astro SSR).
//
// Both apps used to hand-duplicate this logic — one returning React.CSSProperties objects, the
// other building CSS declaration strings — and every time a property was added (zIndex, far-edge
// overflow, border/shadow, typography) it had to be remembered and hand-ported to the second
// file, causing a recurring "Live Edit doesn't match Preview/Published" bug pattern (see
// docs/SliderProblem.pdf). Every function here returns a plain camelCase declaration map
// (Record<string,string>, shaped exactly like React.CSSProperties wants it) so it's
// serialization-agnostic; toCssText() below is the one place that turns that into a CSS string
// for Astro's SSR output.

export const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
export const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
export const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };
export const SPACE: Record<string, string> = { sm: "1rem", md: "2rem", lg: "4rem", xl: "6rem" };
export const TEXT_SIZE: Record<string, string> = { sm: "0.875rem", md: "1rem", lg: "1.2rem" };
export const ICON_SIZE: Record<string, string> = { sm: "1rem", md: "1.5rem", lg: "2.25rem", xl: "3rem" };
// Legacy pages saved before the height field became free-form ("length" kind)
// still store one of these keywords.
export const SLIDER_HEIGHT: Record<string, string> = { sm: "24rem", md: "32rem", lg: "42rem", full: "100vh" };
// Legacy preset keywords (existing content saved before the custom shadow panel) still resolve
// here. A new edit stores a pipe-delimited "x|y|blur|spread|color|opacity" string instead.
export const LEGACY_SHADOW: Record<string, string | undefined> = {
  none: undefined,
  sm: "0 1px 3px rgba(0,0,0,.1)",
  md: "0 4px 12px rgba(0,0,0,.12)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};

// Resolves a spacing value that may be either a legacy preset keyword ("sm"/"md"/"lg"/"xl"/"none")
// or a real CSS length the author typed ("42px", "2.5rem") — existing pages keep their preset
// look, new edits get free-form units.
export function lengthValue(v: string | undefined, table: Record<string, string>, fallback: string): string {
  if (!v) return fallback;
  if (v in table) return table[v];
  // A bare-number FourSideControl side input ("20") meant px — unitless non-zero
  // border-radius/padding/margin is invalid CSS and silently dropped by the browser.
  return /^-?\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number.isFinite(alpha) ? alpha : 1})`;
}

export function shadowToCss(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw in LEGACY_SHADOW) return LEGACY_SHADOW[raw];
  const [x, y, blur, spread, color, opacity] = raw.split("|");
  if (!x) return undefined;
  return `${x}px ${y}px ${blur ?? 0}px ${spread ?? 0}px ${hexToRgba(color, Number(opacity))}`;
}

// WCAG contrast helpers — previously hand-copied a third time inside SliderBlock.astro
// ("can't share code across the two apps ... deliberate byte-for-byte port").
export function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}
export function bestTextColor(hex: string): string {
  return contrastRatio("#ffffff", hex) >= contrastRatio("#000000", hex) ? "#ffffff" : "#000000";
}

// Plain (non-bp) margin/padding.
export function elMarginStyle(p: Record<string, string>): Record<string, string> | undefined {
  if (!p.marginY && !p.marginX && !p.marginTop && !p.marginRight && !p.marginBottom && !p.marginLeft) return undefined;
  const side = (per: string, axis: string) => lengthValue(p[per] || p[axis], SPACE, "0");
  return {
    margin: `${side("marginTop", "marginY")} ${side("marginRight", "marginX")} ${side("marginBottom", "marginY")} ${side("marginLeft", "marginX")}`,
  };
}
export function elPaddingStyle(p: Record<string, string>): Record<string, string> | undefined {
  if (!p.padding && !p.paddingTop && !p.paddingRight && !p.paddingBottom && !p.paddingLeft) return undefined;
  const side = (per: string) => lengthValue(p[per] || p.padding, PAD, "0");
  return { padding: `${side("paddingTop")} ${side("paddingRight")} ${side("paddingBottom")} ${side("paddingLeft")}` };
}

// Border/shadow escape hatch shared by heading/text/button/image — omits an unset key entirely
// (rather than setting it to undefined) so spreading this into a style object never clobbers a
// variant's own default border (e.g. button's outline variant) when the author hasn't overridden it.
export function elBorderShadowStyle(p: Record<string, string>): Record<string, string> {
  const border = p.borderWidth
    ? `${p.borderWidth}px ${p.borderStyle || "solid"} ${p.borderColor || "currentColor"}`
    : p.border
      ? BORDER[p.border]
      : undefined;
  const boxShadow = shadowToCss(p.shadow);
  return { ...(border ? { border } : {}), ...(boxShadow ? { boxShadow } : {}) };
}

// Full typography escape hatch for heading/text/list. fontFamily is left unquoted here —
// toCssText() quotes it only when serializing to a CSS string.
export function typoStyle(p: Record<string, string>): Record<string, string> {
  const s: Record<string, string> = {};
  if (p.fontFamily) s.fontFamily = p.fontFamily;
  if (p.color) s.color = p.color;
  if (p.fontSize) s.fontSize = `${p.fontSize}px`;
  if (p.lineHeight) s.lineHeight = p.lineHeight;
  // letterSpacing/wordSpacing need a real CSS length unit — a bare number string (what the
  // drag-number control stores) is invalid CSS on its own and browsers silently drop it.
  if (p.letterSpacing) s.letterSpacing = `${p.letterSpacing}px`;
  if (p.wordSpacing) s.wordSpacing = `${p.wordSpacing}px`;
  if (p.fontWeight) s.fontWeight = p.fontWeight;
  if (p.textTransform) s.textTransform = p.textTransform;
  if (p.fontStyle) s.fontStyle = p.fontStyle;
  if (p.textDecoration) s.textDecoration = p.textDecoration;
  return s;
}

// Element radius (image/embed/gallery/slider): per-corner freedom, RADIUS.none fallback — no
// element gets a rounded corner unless the author explicitly sets one.
export function elRadius(p: Record<string, string>): string {
  const corner = (per: string) => lengthValue(p[per] || p.radius, RADIUS, RADIUS.none);
  return `${corner("radiusTopLeft")} ${corner("radiusTopRight")} ${corner("radiusBottomRight")} ${corner("radiusBottomLeft")}`;
}

// Hover/entrance effect class names — :hover and scroll-linked animation can't be expressed as an
// inline style, so these just pick a fixed CSS class name; the actual rules live once in each
// app's own stylesheet (index.css for the canvas preview, global.css for the published site).
export function elHoverClass(p: Record<string, string>): string | undefined {
  return p.hoverEffect && p.hoverEffect !== "none" ? `ds-hover-${p.hoverEffect}` : undefined;
}
export function elEntranceClass(p: Record<string, string>): string | undefined {
  return p.entrance && p.entrance !== "none" ? `ds-entrance-${p.entrance}` : undefined;
}

export interface FreePositionInput {
  x?: string;
  y?: string;
  posWidth?: string;
  posHeight?: string;
  zIndex?: string;
}

// Slide-nested free-positioned element (props.position === "custom") — factors out the identical
// logic previously hand-duplicated in apps/admin's ElPreview.tsx (the childIsFree style branch)
// and apps/frontend's SliderBlock.astro (posStyle()). Takes already-resolved per-tier values —
// admin resolves its own tier via bpGetValue before calling this, frontend via its pre-merged
// prop bag — so this stays a pure value-to-style function with no bp-resolution logic inside it.
export function computeFreePositionStyle(input: FreePositionInput): Record<string, string> {
  const x = input.x || "50";
  const y = input.y || "50";
  const s: Record<string, string> = {
    position: "absolute",
    top: `${y}%`,
    left: `${x}%`,
  };
  // No clamp/squish here on purpose — an author may deliberately drag an
  // element partway past the slide's own edge (Canva-style), and squishing
  // it to fit via max-width/height distorted the box instead of just
  // cropping it. The real guard against it bleeding into the NEXT carousel
  // slide is `.ds-slide-box`/`.ds-slider-viewport`'s own `overflow:hidden`
  // (ElPreview.tsx / SliderBlock.astro) — a sibling slide is a separate box
  // the overflowing part is clipped against, never painted into, regardless
  // of how far past this slide's own edge the element is positioned.
  if (input.posWidth) s.width = input.posWidth;
  if (input.posHeight) s.height = input.posHeight;
  const z = Number(input.zIndex || "0");
  if (z) s.zIndex = String(z);
  return s;
}

// The one serialization helper: turns a camelCase declaration map (React.CSSProperties-shaped)
// into a CSS declaration-list string for Astro's SSR output. fontFamily is the one key that needs
// different handling per target — React assigns it to the DOM directly (no quoting needed), a raw
// CSS string needs it quoted so a multi-word font name parses as one value.
export function toCssText(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      if (key === "fontFamily" && !/^['"]/.test(value)) return `${cssKey}:'${value}'`;
      return `${cssKey}:${value}`;
    })
    .join(";");
}
