import type { CardItem, El, ElType, Row, SlideItem } from "./types";

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
export function addSlideElement(slide: SlideItem, type: ElType, defaults: Record<string, string>): SlideItem {
  const el = slideEl(type, { ...defaults });
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

// Removes one nested element at (r, c, e) — used by the slides editor's
// per-layer delete button.
export function deleteSlideElement(slide: SlideItem, r: number, c: number, e: number): SlideItem {
  const rows = slide.rows.map((row, ri) =>
    ri !== r ? row : { ...row, columns: row.columns.map((col, ci) => (ci !== c ? col : { ...col, elements: col.elements.filter((_, ei) => ei !== e) })) },
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
