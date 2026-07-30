// pages.layout stores the whole Designer.tsx block tree (section > row >
// column > element) as free-text prop bags — El.props/Col.props/
// SectionProps are all just Record<string, string> — that apps/frontend's
// SectionBlock.astro interpolates directly into raw CSS strings and HTML
// attributes, not through any safe DOM style API. An unconstrained string
// value is a stored CSS-injection vector (breaking out of one CSS
// declaration via `;`/`)`/`'` to add arbitrary rules to every visitor's
// page for this tenant) and, for URL-shaped fields, a stored-XSS-via-scheme
// vector (javascript:/data: hrefs). This validates every prop value by key
// before it's ever written, mirroring Designer.tsx's own key tables
// (FIELD_GROUP_BY_KEY, PADDING_SIDE_KEYS, MARGIN_SIDE_KEYS,
// RADIUS_CORNER_KEYS, ELS[type].fields, TYPOGRAPHY_FIELDS) so this stays in
// lockstep with whatever the admin UI can actually produce — update both
// together if a new field or element type is ever added there.
//
// `html` (the Custom HTML element) is deliberately NOT validated — a raw
// HTML/CSS/JS embed is an intentional, documented trust boundary (same as
// any page builder's "custom code" block), not a gap to close.

const LENGTH_RE = /^-?[0-9]+(\.[0-9]+)?(px|rem|em|%|vh|vw)?$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;
const CSS_CLASS_RE = /^[A-Za-z0-9_\- ]*$/;
const ID_RE = /^[A-Za-z0-9_-]*$/;
const NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;

// Same scheme allowlist as SectionBlock.astro's own safeUrl() (http(s)/root-
// relative/anchor/bare-relative all fine, only a non-http(s) URI scheme like
// javascript:/data: is rejected) — kept here too since API-side validation
// must not rely solely on the frontend's render-time guard.
function isSafeUrl(v: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^https?:/i.test(v);
  return true;
}

// bgImage/imageUrl are concatenated into a raw `url('...')` CSS function
// (SectionBlock.astro/HeroBlock.astro), not bound through a safe attribute
// like href/src/url are — a bare scheme check isn't enough here, an
// embedded quote/semicolon/paren/brace can still break out of that one CSS
// declaration.
function isSafeCssUrl(v: string): boolean {
  return isSafeUrl(v) && !/['";(){}\s]/.test(v);
}

function isSafeShadow(v: string): boolean {
  if (v === "" || v === "none" || v === "sm" || v === "md" || v === "lg") return true;
  const parts = v.split("|");
  if (parts.length !== 6) return false;
  const [x, y, blur, spread, color, opacity] = parts;
  return NUM_RE.test(x) && NUM_RE.test(y) && NUM_RE.test(blur) && NUM_RE.test(spread) && HEX_COLOR_RE.test(color) && NUM_RE.test(opacity);
}

// Small fixed <select> option sets — mirrors Designer.tsx's `options: [...]`
// arrays exactly (SECTION_FIELDS, COLUMN_FIELDS, TYPOGRAPHY_FIELDS,
// ELS[type].fields). A closed enum gets an exact allowlist rather than a
// pattern — strictly tighter, and there's no room for injection at all.
const ENUM_VALUES: Record<string, string[]> = {
  level: ["1", "2", "3", "4"],
  align: ["left", "center", "right"],
  fontWeight: ["400", "500", "600", "700", "800"],
  textTransform: ["none", "uppercase", "lowercase", "capitalize"],
  fontStyle: ["normal", "italic"],
  textDecoration: ["none", "underline", "line-through"],
  width: ["contained", "full"],
  valign: ["top", "center", "bottom"],
  border: ["none", "thin", "thick"],
  borderStyle: ["solid", "dashed", "dotted"],
  variant: ["primary", "outline"],
  ratio: ["16:9", "4:3", "1:1"],
  style: ["bullet", "numbered", "none"],
  columns: ["2", "3", "4"],
};

// Free-typed CSS lengths (each ends up as `key:value` in a raw style
// string) — accepts a bare number or number+unit, same shape as index.ts's
// GAP_PATTERN. Covers every padding/margin/radius side + shorthand, plus
// borderWidth/opacity/lineHeight/letterSpacing/size/height/gap.
const LENGTH_KEYS = new Set([
  "paddingY", "paddingX", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginY", "marginX", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft",
  "borderWidth", "opacity", "lineHeight", "letterSpacing", "size", "height", "gap",
]);
const COLOR_KEYS = new Set(["bg", "borderColor", "textColor", "color"]);
// href/src/url are bound through a safe Astro attribute (href={}/src={}), so
// only the URI-scheme check applies — bgImage is handled separately above
// since it's concatenated into raw CSS instead.
const ATTR_URL_KEYS = new Set(["href", "url", "src"]);
// Rendered as escaped text content (or, for `images`, a safe src attribute
// per line) — never concatenated into CSS/HTML unescaped, so no pattern
// restriction beyond the per-line URL check `images` gets below.
const FREE_TEXT_KEYS = new Set(["text", "label", "alt", "items", "name"]);
const SKIP_KEYS = new Set(["html"]);

function validateValue(key: string, value: unknown): string | null {
  if (typeof value !== "string") return `${key} must be a string`;
  if (SKIP_KEYS.has(key) || value === "") return null;
  if (key === "images") {
    for (const line of value.split("\n")) {
      if (line.trim() && !isSafeCssUrl(line.trim())) return `${key} contains an unsafe image URL`;
    }
    return null;
  }
  if (FREE_TEXT_KEYS.has(key)) return null;
  if (key === "bgImage") return isSafeCssUrl(value) ? null : `${key} has an unsafe URL`;
  if (ATTR_URL_KEYS.has(key)) return isSafeUrl(value) ? null : `${key} has an unsafe URL scheme`;
  if (key === "cssClass") return CSS_CLASS_RE.test(value) ? null : `cssClass has invalid characters`;
  if (key === "anchorId") return ID_RE.test(value) ? null : `anchorId has invalid characters`;
  if (key === "fontFamily") return FONT_FAMILY_RE.test(value) ? null : `fontFamily has invalid characters`;
  if (key === "shadow") return isSafeShadow(value) ? null : `shadow has an invalid format`;
  if (COLOR_KEYS.has(key)) return HEX_COLOR_RE.test(value) ? null : `${key} must be a hex color`;
  if (LENGTH_KEYS.has(key)) return LENGTH_RE.test(value) ? null : `${key} must be a plain CSS length`;
  if (ENUM_VALUES[key]) return ENUM_VALUES[key].includes(value) ? null : `${key} has an unrecognized value`;
  return `unknown field "${key}"`;
}

function validatePropsBag(props: unknown, path: string): string | null {
  if (props === undefined) return null;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return `${path}.props must be an object`;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    const err = validateValue(key, value);
    if (err) return `${path}.props.${err}`;
  }
  return null;
}

// bp overrides are keyed "tablet:<fieldKey>"/"mobile:<fieldKey>" (see
// Designer.tsx's El.bp) — strip the breakpoint prefix to validate the same
// underlying field the un-prefixed key would.
function validateBp(bp: unknown, path: string): string | null {
  if (bp === undefined) return null;
  if (typeof bp !== "object" || bp === null || Array.isArray(bp)) return `${path}.bp must be an object`;
  for (const [rawKey, value] of Object.entries(bp as Record<string, unknown>)) {
    const key = rawKey.includes(":") ? rawKey.slice(rawKey.indexOf(":") + 1) : rawKey;
    const err = validateValue(key, value);
    if (err) return `${path}.bp.${err}`;
  }
  return null;
}

function validateElement(el: unknown, path: string): string | null {
  if (typeof el !== "object" || el === null) return `${path} must be an object`;
  const e = el as Record<string, unknown>;
  return validatePropsBag(e.props, path) ?? validateBp(e.bp, path);
}

function validateColumn(col: unknown, path: string): string | null {
  if (typeof col !== "object" || col === null) return `${path} must be an object`;
  const c = col as Record<string, unknown>;
  const err = validatePropsBag(c.props, path) ?? validateBp(c.bp, path);
  if (err) return err;
  if (!Array.isArray(c.elements)) return null;
  for (let i = 0; i < c.elements.length; i++) {
    const elErr = validateElement(c.elements[i], `${path}.elements[${i}]`);
    if (elErr) return elErr;
  }
  return null;
}

// Row's own fields (gap/margin*/padding*) live directly on the row object,
// not inside a nested `props` bag — Row has no style "escape hatch" the way
// Section/Column/Element do (see Row interface in Designer.tsx).
const ROW_OWN_KEYS = ["gap", "marginTop", "marginBottom", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];

function validateRow(row: unknown, path: string): string | null {
  if (typeof row !== "object" || row === null) return `${path} must be an object`;
  const r = row as Record<string, unknown>;
  for (const key of ROW_OWN_KEYS) {
    if (r[key] !== undefined) {
      const err = validateValue(key, r[key]);
      if (err) return `${path}.${err}`;
    }
  }
  if (!Array.isArray(r.columns)) return null;
  for (let i = 0; i < r.columns.length; i++) {
    const err = validateColumn(r.columns[i], `${path}.columns[${i}]`);
    if (err) return err;
  }
  return null;
}

// Section's own style fields live directly on `props` (SectionProps) — same
// bag shape as El.props — but `rows`/`bp` are nested inside that same props
// object rather than as siblings on the block, unlike Col/El which nest
// their children as an array on the block itself.
function validateSectionBlock(block: Record<string, unknown>, path: string): string | null {
  const props = block.props as Record<string, unknown> | undefined;
  if (props === undefined) return null;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return `${path}.props must be an object`;
  const { rows, bp, ...styleProps } = props;
  for (const [key, value] of Object.entries(styleProps)) {
    const err = validateValue(key, value);
    if (err) return `${path}.props.${err}`;
  }
  const bpErr = validateBp(bp, path);
  if (bpErr) return bpErr;
  if (!Array.isArray(rows)) return null;
  for (let i = 0; i < rows.length; i++) {
    const err = validateRow(rows[i], `${path}.rows[${i}]`);
    if (err) return err;
  }
  return null;
}

// Legacy BlockBuilder block types (hero/text/image/generic — predate the
// Designer.tsx section system, still rendered by apps/frontend, see
// [...slug].astro's block-type switch). Only hero's imageUrl needs a check:
// it's concatenated into a raw `url(...)` background-image the same way
// section bgImage is; title/subtitle (text content) and image/generic's
// props (safe attribute bindings or JSON.stringify'd text) carry no
// CSS-injection risk.
function validateLegacyBlock(block: Record<string, unknown>, path: string): string | null {
  if (block.type !== "hero") return null;
  const props = block.props as Record<string, unknown> | undefined;
  if (!props || typeof props.imageUrl !== "string" || props.imageUrl === "") return null;
  return isSafeCssUrl(props.imageUrl) ? null : `${path}.props.imageUrl has an unsafe URL`;
}

export function validateLayout(layout: unknown): string | null {
  if (!Array.isArray(layout)) return "layout must be an array";
  for (let i = 0; i < layout.length; i++) {
    const block = layout[i];
    if (typeof block !== "object" || block === null) return `layout[${i}] must be an object`;
    const b = block as Record<string, unknown>;
    if (typeof b.type !== "string") return `layout[${i}].type must be a string`;
    const path = `layout[${i}]`;
    const err = b.type === "section" ? validateSectionBlock(b, path) : validateLegacyBlock(b, path);
    if (err) return err;
  }
  return null;
}
