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
// Lives in its own workspace package (@ucms/element-schema) rather than
// inside apps/api directly: this is the one piece of the element-registry
// puzzle (schema/ELS in apps/admin, this validator in apps/api, canvas
// render in ElPreview.tsx, site render in SectionBlock.astro — see
// designer/elements.ts's own note) that's pure logic with no framework
// dependency (no React, no Fastify), so it's the part that can actually be
// a single shared source of truth instead of a hand-duplicated table.
// apps/api/src/collections/validate-layout.ts re-exports this unchanged —
// a mechanical relocation, not a rewrite; every check below is unchanged
// from before the move.
//
// `html` (the Custom HTML element) is deliberately NOT validated — a raw
// HTML/CSS/JS embed is an intentional, documented trust boundary (same as
// any page builder's "custom code" block), not a gap to close.

// Plain CSS length, OR one of Designer.tsx's own legacy preset keywords
// (PAD/SPACE/RADIUS/ICON_SIZE tables use none/sm/md/lg/xl/full, not every
// table has every keyword — lengthValue() on the render side already falls
// through to using an unrecognized keyword as a literal, invalid-but-inert
// CSS value, so accepting the full shared set here rather than replicating
// each table exactly is safe, not just convenient).
const LENGTH_RE = /^-?[0-9]+(\.[0-9]+)?(px|rem|em|%|vh|vw)?$|^(none|sm|md|lg|xl|full)$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;
const CSS_CLASS_RE = /^[A-Za-z0-9_\- ]*$/;
const ID_RE = /^[A-Za-z0-9_-]*$/;
const NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;

// Same scheme allowlist as SectionBlock.astro's own safeUrl() (http(s)/root-
// relative/anchor/bare-relative all fine, only a non-http(s) URI scheme like
// javascript:/data: is rejected) — kept here too since API-side validation
// must not rely solely on the frontend's render-time guard.
export function isSafeUrl(v: string): boolean {
  // Browsers discard ASCII control/space chars (0x00-0x20) from anywhere in
  // a URL before parsing its scheme, so "java\tscript:alert(1)" defeats a
  // naive scheme regex here (the tab breaks the match, falling through to
  // the permissive `return true`) while still executing as javascript: once
  // rendered — strip them first so this check sees what a browser actually
  // parses.
  const stripped = v.replace(/[\x00-\x20]+/g, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) return /^https?:/i.test(stripped);
  return true;
}

// bgImage/imageUrl are concatenated into a raw `url('...')` CSS function
// (SectionBlock.astro/HeroBlock.astro), not bound through a safe attribute
// like href/src/url are — a bare scheme check isn't enough here, an
// embedded quote/semicolon/paren/brace can still break out of that one CSS
// declaration.
export function isSafeCssUrl(v: string): boolean {
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
export const ENUM_VALUES: Record<string, string[]> = {
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
  // documentdownload is the one element offering a 1-column layout
  // (Designer.tsx's ELS.documentdownload) alongside 2/3/4 everyone else uses.
  columns: ["1", "2", "3", "4"],
  // Column.span per breakpoint (Inspector's Column panel range 1-6) — the
  // base (desktop) span is a plain top-level number, never validated here;
  // only col.bp's "tablet:span"/"mobile:span" strings route through this
  // generic bag validator, so this entry is what stops those from 400ing
  // as an "unknown field".
  span: ["1", "2", "3", "4", "5", "6"],
  // accordion/infobox/slider (see Designer.tsx's ELS registry additions).
  exclusive: ["false", "true"],
  iconPosition: ["top", "left"],
  autoplay: ["0", "3", "5", "8"],
  navStyle: ["arrows", "minimal", "none"],
  dotsStyle: ["dots", "lines", "numbers", "none"],
  transition: ["slide", "fade"],
  // menu element fields (Task 9: Designer.tsx menu integration)
  layout: ["horizontal", "vertical"],
  dropdownTrigger: ["hover", "click"],
  megaMenuWidth: ["contained", "full-width"],
  // Per-breakpoint visibility toggles — Section/Row/Column/Element all use
  // the same 3 keys (see Designer.tsx's VisibilityToggle); "" (not hidden)
  // is skipped by validateValue's own value === "" check above, so only
  // the "hide" state itself needs an allowlist.
  hideDesktop: ["true"],
  hideTablet: ["true"],
  hideMobile: ["true"],
  // Section lock (Page Blueprint deferred item) — superadmin-only toggle,
  // see apps/admin's designer/context.ts isSectionLocked and apps/api's
  // pagesBeforeChange (the real enforcement point).
  locked: ["true"],
  // Sprint 5 (docs/laporan-audit-ui-ux.md section 5.6) new elements —
  // cardgrid/ctabanner/announcementbar/postlist (Designer.tsx's ELS
  // registry). `columns`/`align` reuse the existing enums above.
  equalHeight: ["true", "false"],
  dismissible: ["true", "false"],
  postLayout: ["grid", "list"],
  eventLayout: ["grid", "list"],
  count: ["3", "4", "6", "9"],
  // Batch of simple no-backend elements (Designer.tsx's ELS registry) —
  // googlemap/announcementticker's own enum fields.
  requireConsent: ["true", "false"],
  speed: ["slow", "normal", "fast"],
};

// Free-typed CSS lengths (each ends up as `key:value` in a raw style
// string) — accepts a bare number or number+unit, same shape as index.ts's
// GAP_PATTERN. Covers every padding/margin/radius side + shorthand, plus
// borderWidth/opacity/lineHeight/letterSpacing/size/height/gap.
// Exported (not just module-local) so apps/admin can assert its own ELS
// field-kind tags ("length"/"color"/"select") actually land in the matching
// bucket here — a field added to the admin schema with the WRONG or no
// matching bucket entry silently fails every save (see the LENGTH_KEYS
// "padding" omission incident in CLAUDE.md's slider-work paragraph, which
// this cross-check exists to catch at test time instead of first-save time).
export const LENGTH_KEYS = new Set([
  // "padding" (bare, no Y/X) is Column/Element's own legacy fallback key —
  // see Designer.tsx's COLUMN_SPACING_KEYS and every sideValue(..., "padding")
  // call — distinct from Section's paddingY/paddingX split below.
  "padding", "paddingY", "paddingX", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginY", "marginX", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft",
  "borderWidth", "opacity", "lineHeight", "letterSpacing", "size", "height", "gap",
  // image element's own resizable width (Designer.tsx canvas drag handle +
  // Inspector length field) — "" means natural/auto size. Named "imgWidth",
  // not "width": ENUM_VALUES.width below is Section's own contained/full
  // picker, same flat props-bag key namespace across every node type —
  // LENGTH_KEYS.has(key) short-circuits validateValue before the enum
  // check ever runs, so reusing "width" here would reject every section's
  // width:"contained" as an invalid CSS length.
  "imgWidth",
]);
export const COLOR_KEYS = new Set(["bg", "borderColor", "textColor", "color", "bgColor"]);
// href/src/url are bound through a safe Astro attribute (href={}/src={}), so
// only the URI-scheme check applies — bgImage is handled separately above
// since it's concatenated into raw CSS instead. button1Href/button2Href/
// linkHref are ctabanner/announcementbar's own attribute-bound hrefs (see
// Designer.tsx's ELS.ctabanner/announcementbar) — distinct key names since
// props is a flat bag and an element can have more than one link.
// embedUrl is googlemap's own top-level flat prop (address/height/
// requireConsent below it); bound through an <iframe src> the same way
// embed's own `url` already is, so the same plain scheme check applies.
export const ATTR_URL_KEYS = new Set(["href", "url", "src", "button1Href", "button2Href", "linkHref", "embedUrl"]);
// Rendered as escaped text content (or, for `images`/`slides`, a safe URL
// per line/field) — never concatenated into CSS/HTML unescaped, so no
// pattern restriction beyond the per-line checks `images`/`slides` get below.
// description/button1Label/button2Label/linkLabel are ctabanner/
// announcementbar's own free-text fields (Designer.tsx's ELS registry).
export const FREE_TEXT_KEYS = new Set([
  "text", "label", "alt", "items", "name", "heading",
  "description", "button1Label", "button2Label", "linkLabel",
  // googlemap's own fallback location text (audit report 5.3: "jangan
  // jadikan peta satu-satunya maklumat lokasi").
  "address",
]);
const SKIP_KEYS = new Set(["html"]);

// slider's `slides` field: a JSON array (post-Embla-Carousel rewrite, see
// Designer.tsx's parseSlides/stringifySlides) — one object per slide, each
// with an image (raw url(...) CSS, like bgImage), free-text heading/subtitle,
// an enum textPosition, a hex overlayColor + numeric overlayOpacity, and a
// buttons array (each a safe-attribute href + free-text label + enum
// variant). Pages saved before that rewrite still have the OLD
// imageUrl|heading|subtitle|buttonLabel|buttonHref pipe-line format —
// JSON.parse throws on that, so it falls through to the legacy check below
// and keeps saving until the author re-opens/re-edits the slider (which
// rewrites it as JSON) — this must accept both shapes, never just the new one.
// Position/style overrides added for the drag-to-place button upgrade
// (Designer.tsx's dragPosition/POSITION_PRESETS): x/y are percent strings
// (0-100, clamped again at render time in both Designer.tsx's canvas and
// SectionBlock.astro), color/textColor are hex, radius is a bare px number,
// size is a closed enum — all optional, missing means "use theme default".
function isSafeSlideButton(b: unknown): boolean {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  if (typeof o.label !== "string") return false;
  if (typeof o.href !== "string" || !isSafeUrl(o.href)) return false;
  if (o.variant !== undefined && o.variant !== "primary" && o.variant !== "outline") return false;
  if (o.color !== undefined && o.color !== "" && (typeof o.color !== "string" || !HEX_COLOR_RE.test(o.color))) return false;
  if (o.textColor !== undefined && o.textColor !== "" && (typeof o.textColor !== "string" || !HEX_COLOR_RE.test(o.textColor))) return false;
  if (o.radius !== undefined && o.radius !== "" && (typeof o.radius !== "string" || !NUM_RE.test(o.radius))) return false;
  if (o.size !== undefined && !["sm", "md", "lg"].includes(o.size as string)) return false;
  if (o.fontSize !== undefined && o.fontSize !== "" && (typeof o.fontSize !== "string" || !NUM_RE.test(o.fontSize))) return false;
  if (o.position !== undefined && o.position !== "flow" && o.position !== "custom") return false;
  if (o.x !== undefined && (typeof o.x !== "string" || !NUM_RE.test(o.x))) return false;
  if (o.y !== undefined && (typeof o.y !== "string" || !NUM_RE.test(o.y))) return false;
  return true;
}
// heading/subtitle got the same position/color/fontSize treatment as
// buttons (Designer.tsx's SlideText/parseSlideText) — a plain string is
// still accepted as legacy content (pages saved before this upgrade), same
// dual-shape convention as `slides` itself.
function isSafeSlideText(v: unknown): boolean {
  if (typeof v === "string") return true;
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string") return false;
  if (o.color !== undefined && o.color !== "" && (typeof o.color !== "string" || !HEX_COLOR_RE.test(o.color))) return false;
  if (o.fontSize !== undefined && o.fontSize !== "" && (typeof o.fontSize !== "string" || !NUM_RE.test(o.fontSize))) return false;
  if (o.width !== undefined && o.width !== "" && (typeof o.width !== "string" || !NUM_RE.test(o.width))) return false;
  if (o.align !== undefined && !["left", "center", "right"].includes(o.align as string)) return false;
  // Same shapes/enums every other element's Typography fields already use
  // (FONT_FAMILY_RE, LENGTH_RE via LENGTH_KEYS' lineHeight/letterSpacing,
  // ENUM_VALUES.fontWeight/textTransform/fontStyle/textDecoration) — reused
  // here rather than re-declared, since SlideText isn't part of the generic
  // props-bag validatePropsBag() walks.
  if (o.fontFamily !== undefined && o.fontFamily !== "" && (typeof o.fontFamily !== "string" || !FONT_FAMILY_RE.test(o.fontFamily))) return false;
  if (o.fontWeight !== undefined && o.fontWeight !== "" && !ENUM_VALUES.fontWeight.includes(o.fontWeight as string)) return false;
  if (o.lineHeight !== undefined && o.lineHeight !== "" && (typeof o.lineHeight !== "string" || !LENGTH_RE.test(o.lineHeight))) return false;
  if (o.letterSpacing !== undefined && o.letterSpacing !== "" && (typeof o.letterSpacing !== "string" || !LENGTH_RE.test(o.letterSpacing))) return false;
  if (o.textTransform !== undefined && o.textTransform !== "" && !ENUM_VALUES.textTransform.includes(o.textTransform as string)) return false;
  if (o.fontStyle !== undefined && o.fontStyle !== "" && !ENUM_VALUES.fontStyle.includes(o.fontStyle as string)) return false;
  if (o.textDecoration !== undefined && o.textDecoration !== "" && !ENUM_VALUES.textDecoration.includes(o.textDecoration as string)) return false;
  if (o.position !== undefined && o.position !== "flow" && o.position !== "custom") return false;
  if (o.x !== undefined && (typeof o.x !== "string" || !NUM_RE.test(o.x))) return false;
  if (o.y !== undefined && (typeof o.y !== "string" || !NUM_RE.test(o.y))) return false;
  // Per-breakpoint override bag (Designer.tsx's VisibilityToggle-adjacent
  // BpToggle) — keyed "tablet:fontSize"/"mobile:align" etc, same prefix
  // convention as Section/Col/El's own `bp`. Only fontSize/align are ever
  // written here today, so only those two get validated; anything else is
  // rejected rather than silently accepted through an unvalidated bag.
  if (o.bp !== undefined) {
    if (typeof o.bp !== "object" || o.bp === null || Array.isArray(o.bp)) return false;
    for (const [rawKey, value] of Object.entries(o.bp as Record<string, unknown>)) {
      const key = rawKey.includes(":") ? rawKey.slice(rawKey.indexOf(":") + 1) : rawKey;
      if (typeof value !== "string") return false;
      if (key === "fontSize") {
        if (value !== "" && !NUM_RE.test(value)) return false;
      } else if (key === "align") {
        if (value !== "" && !["left", "center", "right"].includes(value)) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}
// bgSize (background-size/repeat for the slide's own image) — new field
// added alongside the rows: Row[] rework below.
const SLIDE_BG_SIZES = ["cover", "contain", "repeat", "no-repeat", "auto"];

// Post-rework, a slide's heading/subtitle/buttons are real elements inside
// its own `rows: Row[]` tree — the SAME row/column/element validation path
// (validateRow/validateColumn/validateElement below) that already validates
// a Section's own rows, reused here rather than duplicated. isSafeSlideText/
// isSafeSlideButton above are kept for the legacy shape branch only (a slide
// saved before this rework, still carrying heading/subtitle/buttons and no
// `rows` — see apps/admin/src/designer/parsers.ts's parseSlides for the
// matching read-side dual-shape handling).
function isSafeSlideRows(rows: unknown, path: string): string | null {
  if (!Array.isArray(rows)) return `${path} must be an array`;
  for (let i = 0; i < rows.length; i++) {
    const err = validateRow(rows[i], `${path}[${i}]`);
    if (err) return err;
  }
  return null;
}
function isSafeSlide(s: unknown, path: string): string | null {
  if (typeof s !== "object" || s === null) return `${path} must be an object`;
  const o = s as Record<string, unknown>;
  if (typeof o.imageUrl !== "string" || (o.imageUrl && !isSafeCssUrl(o.imageUrl))) return `${path}.imageUrl has an unsafe URL`;
  if (o.bgSize !== undefined && o.bgSize !== "" && !SLIDE_BG_SIZES.includes(o.bgSize as string)) return `${path}.bgSize has an unrecognized value`;
  if (o.bgColor !== undefined && o.bgColor !== "" && (typeof o.bgColor !== "string" || !HEX_COLOR_RE.test(o.bgColor)))
    return `${path}.bgColor must be a hex color`;
  if (o.textPosition !== undefined && !["left", "center", "right"].includes(o.textPosition as string))
    return `${path}.textPosition has an unrecognized value`;
  if (o.overlayColor !== undefined && (typeof o.overlayColor !== "string" || !HEX_COLOR_RE.test(o.overlayColor)))
    return `${path}.overlayColor must be a hex color`;
  if (o.overlayOpacity !== undefined && (typeof o.overlayOpacity !== "string" || !NUM_RE.test(o.overlayOpacity)))
    return `${path}.overlayOpacity must be numeric`;
  if (Array.isArray(o.rows)) return isSafeSlideRows(o.rows, `${path}.rows`);
  // Legacy shape (pre-rework, no `rows` yet).
  if (!isSafeSlideText(o.heading) || !isSafeSlideText(o.subtitle)) return `${path} has an unsafe legacy heading/subtitle`;
  if (o.buttons !== undefined) {
    if (!Array.isArray(o.buttons)) return `${path}.buttons must be an array`;
    if (!o.buttons.every(isSafeSlideButton)) return `${path}.buttons has an unsafe button`;
  }
  return null;
}
function isSafeSlides(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const err = isSafeSlide(parsed[i], `slides[${i}]`);
        if (err) return err;
      }
      return null;
    }
  } catch {
    // Not JSON — legacy pipe-line format, checked below.
  }
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const [image, , , , href] = line.split("|");
    if (image && !isSafeCssUrl(image)) return "slides has an unsafe image URL";
    if (href && !isSafeUrl(href)) return "slides has an unsafe button URL";
  }
  return null;
}

// cardgrid's `cards` field (Sprint 5) — a JSON array of {image, title,
// description, href, buttonLabel}, a brand new element with no legacy
// format to accept (unlike slides). image/href are bound through safe Astro
// attributes on the render side (<img src>/<a href>, not a raw url(...) CSS
// function the way bgImage/slide imageUrl are), so a plain scheme check
// (isSafeUrl) is enough — no isSafeCssUrl needed here.
function isSafeCard(c: unknown): boolean {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  if (typeof o.title !== "string" || typeof o.description !== "string" || typeof o.buttonLabel !== "string") return false;
  if (typeof o.image !== "string" || (o.image && !isSafeUrl(o.image))) return false;
  if (typeof o.href !== "string" || (o.href && !isSafeUrl(o.href))) return false;
  return true;
}
function isSafeCards(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(isSafeCard);
  } catch {
    return false;
  }
}

// Batch of simple no-backend elements (Designer.tsx's ELS registry,
// designer/parsers.ts's parseRepeaterItems) — each a JSON array of small
// item objects, generic across all 8 repeater elements rather than one
// isSafeX per element (unlike isSafeCard above, which predates this and is
// left as-is). Keyed by the element's own prop key (testimonials/stats/
// people/socials/logos/timelineItems/documents/tickerItems) — deliberately
// NOT "items", which is already accordion/tabs' own free-text field; reusing
// that name would let a repeater's JSON array (containing image/url values
// that need real checks) through the FREE_TEXT_KEYS branch unvalidated.
// "icon" values are only ever used as a lookup key into a fixed client-side
// icon table (ICONS/ICON_PATHS, both defaulting safely on an unknown name),
// never interpolated into CSS/HTML — a plain slug pattern is enough,
// mirroring menuId/categoryId's own "lookup key, not rendered" treatment
// above, rather than duplicating that whole icon-name list here.
const ICON_SLUG_RE = /^[a-z0-9-]*$/;
export const REPEATER_SCHEMAS: Record<string, { key: string; type: "text" | "image" | "url" | "icon" }[]> = {
  testimonials: [
    { key: "avatar", type: "image" },
    { key: "quote", type: "text" },
    { key: "name", type: "text" },
    { key: "role", type: "text" },
    { key: "meta", type: "text" },
  ],
  stats: [
    { key: "number", type: "text" },
    { key: "label", type: "text" },
    { key: "icon", type: "icon" },
  ],
  people: [
    { key: "photo", type: "image" },
    { key: "name", type: "text" },
    { key: "role", type: "text" },
    { key: "department", type: "text" },
    { key: "email", type: "text" },
    { key: "phone", type: "text" },
    { key: "href", type: "url" },
  ],
  socials: [
    { key: "platform", type: "icon" },
    { key: "url", type: "url" },
  ],
  logos: [
    { key: "image", type: "image" },
    { key: "href", type: "url" },
    { key: "alt", type: "text" },
  ],
  timelineItems: [
    { key: "date", type: "text" },
    { key: "title", type: "text" },
    { key: "description", type: "text" },
  ],
  documents: [
    { key: "fileUrl", type: "url" },
    { key: "label", type: "text" },
    { key: "fileType", type: "text" },
    { key: "fileSize", type: "text" },
  ],
  tickerItems: [
    { key: "text", type: "text" },
    { key: "href", type: "url" },
  ],
};
function isSafeRepeaterItem(item: unknown, schema: { key: string; type: string }[]): boolean {
  if (typeof item !== "object" || item === null) return false;
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    const field = schema.find((f) => f.key === key);
    if (!field) return false;
    if (typeof value !== "string") return false;
    if (value === "") continue;
    if ((field.type === "image" || field.type === "url") && !isSafeUrl(value)) return false;
    if (field.type === "icon" && !ICON_SLUG_RE.test(value)) return false;
  }
  return true;
}
function isSafeRepeaterItems(value: string, schemaKey: string): boolean {
  const schema = REPEATER_SCHEMAS[schemaKey];
  if (!schema) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => isSafeRepeaterItem(item, schema));
  } catch {
    return false;
  }
}

function validateValue(key: string, value: unknown): string | null {
  if (typeof value !== "string") return `${key} must be a string`;
  if (SKIP_KEYS.has(key) || value === "") return null;
  if (key === "images") {
    for (const line of value.split("\n")) {
      if (line.trim() && !isSafeCssUrl(line.trim())) return `${key} contains an unsafe image URL`;
    }
    return null;
  }
  if (key === "slides") return isSafeSlides(value);
  if (key === "cards") return isSafeCards(value) ? null : `${key} contains an unsafe URL`;
  if (REPEATER_SCHEMAS[key]) return isSafeRepeaterItems(value, key) ? null : `${key} contains an unsafe value`;
  if (FREE_TEXT_KEYS.has(key)) return null;
  if (key === "bgImage") return isSafeCssUrl(value) ? null : `${key} has an unsafe URL`;
  if (ATTR_URL_KEYS.has(key)) return isSafeUrl(value) ? null : `${key} has an unsafe URL scheme`;
  if (key === "cssClass") return CSS_CLASS_RE.test(value) ? null : `cssClass has invalid characters`;
  if (key === "anchorId") return ID_RE.test(value) ? null : `anchorId has invalid characters`;
  if (key === "fontFamily") return FONT_FAMILY_RE.test(value) ? null : `fontFamily has invalid characters`;
  if (key === "shadow") return isSafeShadow(value) ? null : `shadow has an invalid format`;
  // menuId/categoryId are only ever used as parameterized DB lookup keys
  // (getMenu/postlist's category filter), never interpolated into CSS/HTML.
  if (key === "menuId" || key === "categoryId") return null;
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
const ROW_OWN_KEYS = [
  "gap",
  "marginTop",
  "marginBottom",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "hideDesktop",
  "hideTablet",
  "hideMobile",
];

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
