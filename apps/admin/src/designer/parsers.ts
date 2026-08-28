import type { CardItem, SlideButton, SlideItem, SlideText } from "./types";

// Slide/pairs parsing + serialization helpers split out of Designer.tsx
// (Layer 0 of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

// Shared "one item per line, first `|` splits it in two" parser for
// accordion (question|answer) and tabs (label|content) — same simple
// delimited-line convention `list`'s items already uses. Duplicated in
// SectionBlock.astro like every other table.
export function parsePairs(raw: string | undefined): { a: string; b: string }[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("|");
      return i === -1 ? { a: line, b: "" } : { a: line.slice(0, i), b: line.slice(i + 1) };
    });
}

export const TEXT_DEFAULTS: SlideText = {
  text: "",
  color: "",
  fontSize: "",
  width: "",
  align: "left",
  fontFamily: "",
  fontWeight: "",
  lineHeight: "",
  letterSpacing: "",
  textTransform: "",
  fontStyle: "",
  textDecoration: "",
  position: "flow",
  x: "50",
  y: "50",
  // Explicit (vs. simply omitted) so every parseSlideText branch returns the
  // same key set — the object branch below always sets `bp` (undefined when
  // absent), and a legacy string input spreads this default, so both need to
  // agree or a parse -> stringify -> parse round trip changes shape.
  bp: undefined,
};

// Heading/subtitle were plain strings before this upgrade — a string input
// here means legacy content, wrapped into TEXT_DEFAULTS with that string as
// `text` (same JSON-then-legacy-shape fallback convention as everywhere else
// in this file), so a page saved before this change keeps opening/saving
// and silently upgrades the next time its slider is edited.
export function parseSlideText(raw: unknown): SlideText {
  if (typeof raw === "string") return { ...TEXT_DEFAULTS, text: raw };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const str = (key: keyof SlideText): string => (typeof o[key] === "string" ? (o[key] as string) : (TEXT_DEFAULTS[key] as string));
    return {
      text: typeof o.text === "string" ? o.text : "",
      color: str("color"),
      fontSize: str("fontSize"),
      width: str("width"),
      align: o.align === "center" || o.align === "right" ? o.align : "left",
      fontFamily: str("fontFamily"),
      fontWeight: str("fontWeight"),
      lineHeight: str("lineHeight"),
      letterSpacing: str("letterSpacing"),
      textTransform: str("textTransform"),
      fontStyle: str("fontStyle"),
      textDecoration: str("textDecoration"),
      position: o.position === "custom" ? "custom" : "flow",
      x: typeof o.x === "string" ? o.x : TEXT_DEFAULTS.x,
      y: typeof o.y === "string" ? o.y : TEXT_DEFAULTS.y,
      bp: o.bp && typeof o.bp === "object" && !Array.isArray(o.bp) ? (o.bp as Record<string, string>) : undefined,
    };
  }
  return { ...TEXT_DEFAULTS };
}

export const SLIDE_DEFAULTS = { bgColor: "", textPosition: "center" as const, overlayColor: "#000000", overlayOpacity: "35" };
export const BUTTON_DEFAULTS: SlideButton = {
  label: "",
  href: "",
  variant: "primary",
  color: "",
  textColor: "",
  radius: "",
  size: "md",
  fontSize: "",
  position: "flow",
  x: "50",
  y: "50",
};

export function parseSlideButtons(raw: unknown): SlideButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const btn = (b ?? {}) as Record<string, unknown>;
    return {
      label: typeof btn.label === "string" ? btn.label : "",
      href: typeof btn.href === "string" ? btn.href : "",
      variant: btn.variant === "outline" ? "outline" : ("primary" as const),
      color: typeof btn.color === "string" ? btn.color : BUTTON_DEFAULTS.color,
      textColor: typeof btn.textColor === "string" ? btn.textColor : BUTTON_DEFAULTS.textColor,
      radius: typeof btn.radius === "string" ? btn.radius : BUTTON_DEFAULTS.radius,
      size: btn.size === "sm" || btn.size === "lg" ? btn.size : "md",
      fontSize: typeof btn.fontSize === "string" ? btn.fontSize : BUTTON_DEFAULTS.fontSize,
      position: btn.position === "custom" ? "custom" : "flow",
      x: typeof btn.x === "string" ? btn.x : BUTTON_DEFAULTS.x,
      y: typeof btn.y === "string" ? btn.y : BUTTON_DEFAULTS.y,
    };
  });
}

// Slider slide repeater. Storage is a JSON array (one object per slide) —
// the Embla Carousel rewrite's richer per-slide fields (multiple buttons,
// overlay color/opacity, text position) don't fit the old single
// imageUrl|heading|subtitle|buttonLabel|buttonHref line format. parseSlides()
// still accepts that legacy format too (JSON.parse throws on it, falls
// through) so a page saved before this change keeps opening/saving — it
// silently upgrades to the JSON format the next time it's edited in the
// Designer. SectionBlock.astro's render-side parser mirrors this same
// fallback, and validate-layout.ts's isSafeSlides() accepts both shapes on
// write.
export function parseSlides(raw: string | undefined): SlideItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const s = (item ?? {}) as Record<string, unknown>;
        return {
          imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
          bgColor: typeof s.bgColor === "string" ? s.bgColor : SLIDE_DEFAULTS.bgColor,
          heading: parseSlideText(s.heading),
          subtitle: parseSlideText(s.subtitle),
          textPosition: s.textPosition === "left" || s.textPosition === "right" ? s.textPosition : "center",
          overlayColor: typeof s.overlayColor === "string" ? s.overlayColor : SLIDE_DEFAULTS.overlayColor,
          overlayOpacity: typeof s.overlayOpacity === "string" ? s.overlayOpacity : SLIDE_DEFAULTS.overlayOpacity,
          buttons: parseSlideButtons(s.buttons),
        };
      });
    }
  } catch {
    // Not JSON — fall through to the legacy pipe-line format below.
  }
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [imageUrl = "", heading = "", subtitle = "", buttonLabel = "", buttonHref = ""] = line.split("|");
      return {
        imageUrl,
        heading: parseSlideText(heading),
        subtitle: parseSlideText(subtitle),
        ...SLIDE_DEFAULTS,
        buttons: buttonLabel ? [{ ...BUTTON_DEFAULTS, label: buttonLabel, href: buttonHref }] : [],
      };
    });
}

export function stringifySlides(items: SlideItem[]): string {
  return JSON.stringify(items);
}

// Card grid repeater (Sprint 5, docs/laporan-audit-ui-ux.md section 5.6) —
// a brand new element, unlike slider, so there's no legacy delimited-line
// format to fall back to; JSON array of CardItem is the only shape ever
// written.
export const CARD_DEFAULTS: CardItem = { image: "", title: "", description: "", href: "", buttonLabel: "" };

export function parseCards(raw: string | undefined): CardItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return {
        image: typeof c.image === "string" ? c.image : "",
        title: typeof c.title === "string" ? c.title : "",
        description: typeof c.description === "string" ? c.description : "",
        href: typeof c.href === "string" ? c.href : "",
        buttonLabel: typeof c.buttonLabel === "string" ? c.buttonLabel : "",
      };
    });
  } catch {
    return [];
  }
}

export function stringifyCards(items: CardItem[]): string {
  return JSON.stringify(items);
}
