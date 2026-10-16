import type { Block, CardItem, El, ElType, Row, SlideItem } from "./types";

const uid = () => Math.random().toString(36).slice(2, 10);

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

export const SLIDE_DEFAULTS = {
  bgSize: "" as const,
  bgColor: "",
  textPosition: "center" as const,
  overlayColor: "#000000",
  // No overlay by default — only appears once the author sets an opacity
  // (see FieldInput's slide card slider), same "opt-in, not on-by-default"
  // rule as heading/subtitle/buttons and corner radius elsewhere in this file.
  overlayOpacity: "0",
};

const SLIDE_BG_SIZES = ["cover", "contain", "repeat", "no-repeat", "auto"] as const;

function slideEl(type: ElType, props: Record<string, string>): El {
  return { id: uid(), type, props };
}

// A legacy slide (saved before slides gained a real rows: Row[] tree) still
// carries its old heading/subtitle (string or {text,color,fontSize,align,...}
// object)/buttons ({label,href,variant,color,textColor,radius,size,fontSize,
// position,x,y}[]) shape. Converts that into the equivalent real elements —
// heading/subtitle become real "heading"/"text" elements (matching keys copy
// straight across: text/color/fontFamily/fontWeight/lineHeight/
// letterSpacing/textTransform/fontStyle/textDecoration/align), each button
// becomes a real "button" element (label/href/variant only — a legacy
// button's per-button color/textColor/radius/fontSize/custom-position have
// no equivalent on the standalone button element type and are dropped, same
// as this rework's other accepted scope reductions). Only fields that
// carried real content become elements — an empty legacy heading/subtitle
// (or a button with no label) contributes nothing, matching how a
// freshly-added slide today only ever holds what was explicitly added.
function legacySlideElements(s: Record<string, unknown>): El[] {
  const els: El[] = [];
  const asTextObj = (raw: unknown): Record<string, unknown> | null =>
    typeof raw === "string" ? { text: raw } : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const str = (o: Record<string, unknown>, key: string) => (typeof o[key] === "string" ? (o[key] as string) : "");
  const align = (o: Record<string, unknown>) => (o.align === "center" || o.align === "right" ? (o.align as string) : "left");

  const heading = asTextObj(s.heading);
  if (heading && str(heading, "text")) {
    els.push(
      slideEl("heading", {
        text: str(heading, "text"),
        level: "2",
        align: align(heading),
        fontFamily: str(heading, "fontFamily"),
        color: str(heading, "color"),
        lineHeight: str(heading, "lineHeight"),
        letterSpacing: str(heading, "letterSpacing"),
        fontWeight: str(heading, "fontWeight"),
        textTransform: str(heading, "textTransform"),
        fontStyle: str(heading, "fontStyle"),
        textDecoration: str(heading, "textDecoration"),
      }),
    );
  }

  const subtitle = asTextObj(s.subtitle);
  if (subtitle && str(subtitle, "text")) {
    const fontSize = str(subtitle, "fontSize");
    els.push(
      slideEl("text", {
        text: str(subtitle, "text"),
        size: fontSize ? `${fontSize}px` : "",
        align: align(subtitle),
        fontFamily: str(subtitle, "fontFamily"),
        color: str(subtitle, "color"),
        lineHeight: str(subtitle, "lineHeight"),
        letterSpacing: str(subtitle, "letterSpacing"),
        fontWeight: str(subtitle, "fontWeight"),
        textTransform: str(subtitle, "textTransform"),
        fontStyle: str(subtitle, "fontStyle"),
        textDecoration: str(subtitle, "textDecoration"),
      }),
    );
  }

  const buttons = Array.isArray(s.buttons) ? s.buttons : [];
  for (const b of buttons) {
    const btn = (b ?? {}) as Record<string, unknown>;
    const label = str(btn, "label");
    if (!label) continue;
    els.push(slideEl("button", { label, href: str(btn, "href"), variant: btn.variant === "outline" ? "outline" : "primary", align: "left" }));
  }
  return els;
}

function legacySlideRows(s: Record<string, unknown>): Row[] {
  const elements = legacySlideElements(s);
  return elements.length === 0 ? [] : [{ columns: [{ span: 12, elements }] }];
}

// Slider slide repeater. Storage is a JSON array (one object per slide).
// parseSlides() accepts three shapes on read, oldest-first fallback: the
// original pipe-delimited line format, a legacy JSON object (heading/
// subtitle/buttons, no `rows`), and the current shape (`rows: Row[]`, see
// types.ts's SlideItem). A page saved under either older shape keeps
// opening/saving correctly forever — it silently upgrades to the current
// shape the next time its slider is edited in the Designer, never a hard
// migration. SectionBlock.astro's render-side parser mirrors this same
// fallback, and packages/element-schema's slide validator accepts all three
// shapes on write.
export function parseSlides(raw: string | undefined): SlideItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const s = (item ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(s.rows) ? (s.rows as Row[]) : legacySlideRows(s);
        return {
          imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
          bgSize: typeof s.bgSize === "string" && (SLIDE_BG_SIZES as readonly string[]).includes(s.bgSize) ? (s.bgSize as SlideItem["bgSize"]) : "",
          bgColor: typeof s.bgColor === "string" ? s.bgColor : SLIDE_DEFAULTS.bgColor,
          overlayColor: typeof s.overlayColor === "string" ? s.overlayColor : SLIDE_DEFAULTS.overlayColor,
          overlayOpacity: typeof s.overlayOpacity === "string" ? s.overlayOpacity : SLIDE_DEFAULTS.overlayOpacity,
          textPosition: s.textPosition === "left" || s.textPosition === "right" ? s.textPosition : "center",
          rows,
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
      const rows = legacySlideRows({ heading, subtitle, buttons: buttonLabel ? [{ label: buttonLabel, href: buttonHref }] : [] });
      return { imageUrl, ...SLIDE_DEFAULTS, rows };
    });
}

export function stringifySlides(items: SlideItem[]): string {
  return JSON.stringify(items);
}

// Fresh, empty slide — no content until the author explicitly adds
// Text/Button/Image/Row (FieldInput.tsx's slides editor).
export function newSlide(): SlideItem {
  return { imageUrl: "", ...SLIDE_DEFAULTS, rows: [] };
}

// Pushes a new element of `type` (with that element's own normal ELS
// defaults — passed in by the caller, since parsers.ts can't import
// elements.ts without risking a cycle) into a slide's tree: the LAST row's
// first column if one already exists, otherwise a freshly-created single
// row/column — appending to the end (not always row 0) so "Add Row" then
// "Add Text" reads naturally, the content lands in the row just created.
// Free-positioned from the start (2026-10-16): drag it straight away, lock it
// from its floating toolbar. Each add lands 12% below the last (wrapping
// after 5), so Header, Text, Button read as a stack instead of piling up.
const ADD_BOX: Partial<Record<ElType, Record<string, string>>> = {
  heading: { align: "center", x: "10", posWidth: "80%" },
  text: { align: "center", x: "15", posWidth: "70%" },
  button: { x: "44" },
  image: { x: "30", y: "25", posWidth: "40%", posHeight: "50%" },
};
export function addSlideElement(slide: SlideItem, type: ElType, defaults: Record<string, string>): SlideItem {
  const count = slide.rows.reduce((n, r) => n + r.columns.reduce((m, c) => m + c.elements.length, 0), 0);
  const el = slideEl(type, { ...defaults, position: "custom", y: String(20 + (count % 5) * 12), ...ADD_BOX[type] });
  const rows = slide.rows.length > 0 ? slide.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c })) })) : [{ columns: [{ span: 12, elements: [] }] }];
  const last = rows[rows.length - 1];
  last.columns[0].elements = [...last.columns[0].elements, el];
  return { ...slide, rows };
}

// Adds a new, empty nested row (the "layer" add option) — its own single
// full-width column, no elements yet.
export function addSlideRow(slide: SlideItem): SlideItem {
  return { ...slide, rows: [...slide.rows, { columns: [{ span: 12, elements: [] }] }] };
}

// Fresh section/row factories — moved here (from a local DesignerCanvas.tsx
// const and an inline object literal in its own "+add row" button) so the
// Layout category's palette presets (elements.ts's LAYOUT_PRESETS, dropped
// via useBlockOps.ts's dropIntoColumn) and the pre-existing click-to-add UI
// both build the exact same shape through one place.
export function newSection(): Block {
  return { type: "section", props: { paddingY: "md", width: "contained", rows: [{ columns: [{ span: 1, elements: [] }] }] } };
}
export function newRow(spans: number[]): Row {
  return { columns: spans.map((span) => ({ span, elements: [] })) };
}

// Slide layout presets (2026-10-16) — a whole slide in one click, picked from
// the slides editor's picture grid (FieldInput.tsx draws each thumbnail from
// buildSlidePreset's own output). Every element is free-positioned, not
// stacked in flow: drag it straight away, lock it from its floating toolbar.
// x/width are % of the slide, so a preset fits any slider width; y is stacked
// from the slider's real height (rough px line heights + fixed gaps, stackY),
// so a 24rem banner and a 100vh hero both get one tight block instead of the
// same % spread. Mobile gets its own x/y/width (`mobile:*` bp keys); tablet
// inherits desktop.
export type SlidePresetId = "center" | "left" | "right" | "split" | "split-reverse" | "bottom";
type PresetRole = "title" | "sub" | "body" | "button";
// w = posWidth %; none = the button's own width (left-anchored layouts). A
// role with a width on desktop needs one on mobile too — an empty bp
// override can't unset a base width (the @media rule just omits it).
type PresetPlace = { x: number; w?: number };
interface PresetDevice {
  // Top to bottom; roles sharing a row share a line (centered on it).
  rows: Partial<Record<PresetRole, PresetPlace>>[];
  band?: [number, number]; // % of slide height the stack sits in — default the whole slide
  anchor?: "middle" | "end";
  image?: { x: number; y: number; w: number; h: number }; // % box, outside the stack
}
interface SlidePreset {
  id: SlidePresetId;
  align: "left" | "center" | "right";
  desktop: PresetDevice;
  mobile: PresetDevice;
}
const PRESET_SAMPLE: Record<PresetRole, [ElType, Record<string, string>]> = {
  title: ["heading", { text: "Heading", level: "2" }],
  sub: ["heading", { text: "Sub header", level: "4" }],
  body: ["text", { text: "Supporting text goes here.", size: "1rem" }],
  button: ["button", { label: "Button", href: "#", variant: "primary" }],
};
// One line of each sample in px, [desktop, mobile] — .ds-h2/.ds-h4 are fluid
// (global.css), body is 1rem text, a .ds-btn pill is ~2.75rem tall.
const PRESET_LINE_PX: Record<PresetRole, [number, number]> = { title: [44, 32], sub: [24, 22], body: [28, 25], button: [44, 42] };
const stackAt = (x: number, w: number, button: PresetPlace = { x }): PresetDevice["rows"] => [
  { title: { x, w } },
  { sub: { x, w } },
  { body: { x, w } },
  { button },
];
// Image on top, text below — both split layouts on a phone.
const SPLIT_MOBILE: PresetDevice = { rows: stackAt(8, 84), band: [40, 98], image: { x: 8, y: 6, w: 84, h: 30 } };
export const SLIDE_PRESETS: SlidePreset[] = [
  {
    id: "center",
    align: "center",
    desktop: { rows: [{ title: { x: 10, w: 80 } }, { sub: { x: 10, w: 80 } }, { body: { x: 15, w: 70 } }, { button: { x: 42, w: 16 } }] },
    mobile: { rows: [{ title: { x: 6, w: 88 } }, { sub: { x: 6, w: 88 } }, { body: { x: 8, w: 84 } }, { button: { x: 28, w: 44 } }] },
  },
  {
    id: "left",
    align: "left",
    desktop: { rows: [{ title: { x: 8, w: 46 } }, { sub: { x: 8, w: 46 } }, { body: { x: 8, w: 42 } }, { button: { x: 8 } }] },
    mobile: { rows: stackAt(8, 84) },
  },
  {
    id: "right",
    align: "right",
    desktop: { rows: [{ title: { x: 46, w: 46 } }, { sub: { x: 46, w: 46 } }, { body: { x: 50, w: 42 } }, { button: { x: 78, w: 14 } }] },
    mobile: { rows: stackAt(8, 84, { x: 52, w: 40 }) },
  },
  {
    id: "split",
    align: "left",
    desktop: { rows: stackAt(7, 40), image: { x: 53, y: 14, w: 40, h: 72 } },
    mobile: SPLIT_MOBILE,
  },
  {
    id: "split-reverse",
    align: "left",
    desktop: { rows: stackAt(53, 40), image: { x: 7, y: 14, w: 40, h: 72 } },
    mobile: SPLIT_MOBILE,
  },
  {
    id: "bottom",
    align: "left",
    desktop: {
      rows: [{ sub: { x: 6, w: 56 } }, { title: { x: 6, w: 56 } }, { body: { x: 6, w: 52 }, button: { x: 80, w: 14 } }],
      band: [0, 86],
      anchor: "end",
    },
    mobile: {
      rows: [{ sub: { x: 6, w: 88 } }, { title: { x: 6, w: 88 } }, { body: { x: 6, w: 88 } }, { button: { x: 6, w: 44 } }],
      band: [0, 88],
      anchor: "end",
    },
  },
];

// Each role's top edge as % of `heightPx`: 24px above a buttons-only row,
// 12px between the rest; a stack taller than its band pins to the band's top.
function stackY(device: PresetDevice, d: 0 | 1, heightPx: number): Partial<Record<PresetRole, number>> {
  const roles = (row: PresetDevice["rows"][number]) => Object.keys(row) as PresetRole[];
  const rowH = device.rows.map((row) => Math.max(...roles(row).map((k) => PRESET_LINE_PX[k][d])));
  const gap = device.rows.map((row, i) => (i === 0 ? 0 : roles(row).every((k) => k === "button") ? 24 : 12));
  const total = [...rowH, ...gap].reduce((a, b) => a + b, 0);
  const [lo, hi] = (device.band ?? [0, 100]).map((p) => (p / 100) * heightPx);
  let top = Math.max(lo, device.anchor === "end" ? hi - total : lo + (hi - lo - total) / 2);
  const y: Partial<Record<PresetRole, number>> = {};
  device.rows.forEach((row, i) => {
    top += gap[i];
    for (const k of roles(row)) y[k] = Math.round(((top + (rowH[i] - PRESET_LINE_PX[k][d]) / 2) / heightPx) * 1000) / 10;
    top += rowH[i];
  });
  return y;
}

export function buildSlidePreset(id: SlidePresetId, heightPx = 512, mobileHeightPx = heightPx): El[] {
  const preset = SLIDE_PRESETS.find((p) => p.id === id) ?? SLIDE_PRESETS[0];
  const yD = stackY(preset.desktop, 0, heightPx);
  const yM = stackY(preset.mobile, 1, mobileHeightPx);
  const placeOf = (dev: PresetDevice, role: PresetRole) => dev.rows.find((row) => row[role])?.[role] ?? { x: 0 };
  // Only what actually differs on a phone becomes a `mobile:*` override.
  const withMobile = (el: El, mobile: Record<string, string>): El => {
    const bp = Object.fromEntries(Object.entries(mobile).filter(([k, v]) => el.props[k] !== v).map(([k, v]) => [`mobile:${k}`, v]));
    return Object.keys(bp).length > 0 ? { ...el, bp } : el;
  };
  const els = preset.desktop.rows
    .flatMap((row) => Object.keys(row) as PresetRole[])
    .map((role) => {
      const d = placeOf(preset.desktop, role);
      const m = placeOf(preset.mobile, role);
      const [type, sample] = PRESET_SAMPLE[role];
      const el = slideEl(type, {
        ...sample,
        // A fixed-width pill centers its label; text follows the layout.
        align: role === "button" ? "center" : preset.align,
        position: "custom",
        x: String(d.x),
        y: String(yD[role]),
        posWidth: d.w ? `${d.w}%` : "",
      });
      return withMobile(el, { x: String(m.x), y: String(yM[role]), posWidth: m.w ? `${m.w}%` : "" });
    });
  const di = preset.desktop.image;
  const mi = preset.mobile.image;
  if (di && mi) {
    const box = (b: typeof di) => ({ x: String(b.x), y: String(b.y), posWidth: `${b.w}%`, posHeight: `${b.h}%` });
    els.push(withMobile(slideEl("image", { src: "", alt: "", radius: "", imgWidth: "", align: "left", position: "custom", ...box(di) }), box(mi)));
  }
  return els;
}

// Replaces the slide's whole rows tree — FieldInput.tsx confirms first when
// the slide already has content.
export function applySlidePreset(slide: SlideItem, id: SlidePresetId, heightPx?: number, mobileHeightPx?: number): SlideItem {
  return { ...slide, rows: [{ columns: [{ span: 12, elements: buildSlidePreset(id, heightPx, mobileHeightPx) }] }] };
}

// A resolved slider height ("32rem", "480px", "100vh") in px, for
// buildSlidePreset — vh assumes an ~800px-tall window, anything else 512.
export function lengthPx(v: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)(px|rem|em|vh)?$/.exec(v ?? "");
  if (!m) return 512;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : m[2] === "vh" ? n * 8 : n;
}

// Removes one nested element at (r, c, e) — used by the slides editor's
// per-layer delete button.
export function deleteSlideElement(slide: SlideItem, r: number, c: number, e: number): SlideItem {
  const rows = slide.rows.map((row, ri) =>
    ri !== r ? row : { ...row, columns: row.columns.map((col, ci) => (ci !== c ? col : { ...col, elements: col.elements.filter((_, ei) => ei !== e) })) },
  );
  return { ...slide, rows };
}

// Copies one nested element (fresh id) right after itself — the slide
// canvas's floating-toolbar Duplicate. A free-positioned copy is nudged 3%
// down-right so it doesn't land exactly on top of the original.
export function duplicateSlideElement(slide: SlideItem, r: number, c: number, e: number): SlideItem {
  const src = slide.rows[r]?.columns[c]?.elements[e];
  if (!src) return slide;
  const copy: El = { ...(JSON.parse(JSON.stringify(src)) as El), id: uid() };
  if (copy.props.position === "custom") {
    copy.props.x = String(Math.round((Number(copy.props.x || "50") + 3) * 10) / 10);
    copy.props.y = String(Math.round((Number(copy.props.y || "50") + 3) * 10) / 10);
  }
  const rows = slide.rows.map((row, ri) =>
    ri !== r
      ? row
      : { ...row, columns: row.columns.map((col, ci) => (ci !== c ? col : { ...col, elements: [...col.elements.slice(0, e + 1), copy, ...col.elements.slice(e + 1)] })) },
  );
  return { ...slide, rows };
}

// Removes an entire nested row (and everything in it).
export function deleteSlideRow(slide: SlideItem, r: number): SlideItem {
  return { ...slide, rows: slide.rows.filter((_, ri) => ri !== r) };
}

// Merges `patch` into one nested element's own props — the write side of
// the nested element's Inspector field editor (Content fields only; nested
// elements have no per-breakpoint override, an accepted scope reduction —
// see the design doc's Mini-canvas section).
export function updateSlideElementProps(slide: SlideItem, r: number, c: number, e: number, patch: Record<string, string>): SlideItem {
  const rows = slide.rows.map((row, ri) =>
    ri !== r
      ? row
      : {
          ...row,
          columns: row.columns.map((col, ci) =>
            ci !== c
              ? col
              : { ...col, elements: col.elements.map((el, ei) => (ei !== e ? el : { ...el, props: { ...el.props, ...patch } })) },
          ),
        },
  );
  return { ...slide, rows };
}

// Replaces (not merges) a slide-nested element's `bp` bag — mirrors
// Designer.tsx's `target.bp = ...` assignment for top-level elements, since
// callers (Inspector's per-field write, and its toggleBpKeys-driven override
// toggle) already compute the full next bp object themselves.
export function updateSlideElementBp(slide: SlideItem, r: number, c: number, e: number, bp: Record<string, string> | undefined): SlideItem {
  const rows = slide.rows.map((row, ri) =>
    ri !== r
      ? row
      : {
          ...row,
          columns: row.columns.map((col, ci) =>
            ci !== c ? col : { ...col, elements: col.elements.map((el, ei) => (ei !== e ? el : { ...el, bp })) },
          ),
        },
  );
  return { ...slide, rows };
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

// Generic repeater (testimonial/statscounter/peoplegrid/socialicons/
// logocloud/timeline/documentdownload — see types.ts's FieldKind
// "repeater") — unlike cardgrid's own fixed CardItem shape, each of these
// elements has its own field list (RepeaterItemField[] on the Field), so
// the stored shape is just a plain string bag per item rather than a typed
// interface. Every value is coerced to a string (or "" when absent/non-
// string) the same way parseCards does per field.
export function parseRepeaterItems(raw: string | undefined): Record<string, string>[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const k of Object.keys(o)) {
        if (typeof o[k] === "string") out[k] = o[k] as string;
      }
      return out;
    });
  } catch {
    return [];
  }
}

export function stringifyRepeaterItems(items: Record<string, string>[]): string {
  return JSON.stringify(items);
}
