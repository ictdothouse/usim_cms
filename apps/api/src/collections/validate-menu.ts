import { isSafeUrl, isSafeCssUrl } from "./validate-layout.js";

// Same style-value/URL safety posture as validate-layout.ts: icon is a
// lucide-react icon name looked up client-side, never interpolated into
// CSS/HTML server-side — a plain identifier pattern is enough to stop
// injection without having to mirror Designer's exact icon enum here (that
// enum is UI-only; an unrecognized name just renders nothing on the
// frontend, same "invalid-but-inert" posture LENGTH_RE's fallback already
// takes for an unrecognized keyword).
const ICON_NAME_RE = /^[a-z0-9-]*$/i;
const MAX_DEPTH = 3;
const MAX_COLUMNS = 8;
const MAX_COLUMN_ITEMS = 20;

type LinkType = "page" | "post" | "category" | "custom";
const LINK_TYPES: LinkType[] = ["page", "post", "category", "custom"];

function validateLinkFields(o: Record<string, unknown>, path: string): string | null {
  if (typeof o.linkType !== "string" || !LINK_TYPES.includes(o.linkType as LinkType)) {
    return `${path}.linkType must be one of ${LINK_TYPES.join("/")}`;
  }
  if (o.linkType === "custom") {
    if (typeof o.url !== "string" || !isSafeUrl(o.url)) return `${path}.url has an unsafe or missing URL`;
  } else {
    if (typeof o.refId !== "string" || !o.refId) return `${path}.refId is required for linkType "${o.linkType}"`;
  }
  if (o.target !== undefined && o.target !== "_self" && o.target !== "_blank") {
    return `${path}.target must be "_self" or "_blank"`;
  }
  return null;
}

function validateTranslations(o: Record<string, unknown>, path: string): string | null {
  if (o.translations === undefined) return null;
  if (typeof o.translations !== "object" || o.translations === null || Array.isArray(o.translations)) {
    return `${path}.translations must be an object`;
  }
  for (const [code, entry] of Object.entries(o.translations as Record<string, unknown>)) {
    const label = (entry as Record<string, unknown> | null)?.label;
    if (typeof label !== "string") return `${path}.translations.${code}.label must be a string`;
  }
  return null;
}

function validateCommonItemFields(o: Record<string, unknown>, path: string): string | null {
  if (typeof o.label !== "string" || !o.label) return `${path}.label is required`;
  const linkErr = validateLinkFields(o, path);
  if (linkErr) return linkErr;
  const trErr = validateTranslations(o, path);
  if (trErr) return trErr;
  return null;
}

function validateMegaMenuItem(item: unknown, path: string): string | null {
  if (typeof item !== "object" || item === null) return `${path} must be an object`;
  const o = item as Record<string, unknown>;
  const commonErr = validateCommonItemFields(o, path);
  if (commonErr) return commonErr;
  if (o.children !== undefined || o.megaMenu !== undefined) {
    return `${path} cannot have children or megaMenu`;
  }
  if (o.icon !== undefined && (typeof o.icon !== "string" || !ICON_NAME_RE.test(o.icon))) {
    return `${path}.icon has invalid characters`;
  }
  if (o.image !== undefined && o.image !== "" && (typeof o.image !== "string" || !isSafeCssUrl(o.image))) {
    return `${path}.image has an unsafe URL`;
  }
  return null;
}

function validateMegaMenu(mega: unknown, path: string): string | null {
  if (typeof mega !== "object" || mega === null) return `${path}.megaMenu must be an object`;
  const columns = (mega as Record<string, unknown>).columns;
  if (!Array.isArray(columns)) return `${path}.megaMenu.columns must be an array`;
  if (columns.length > MAX_COLUMNS) return `${path}.megaMenu has too many columns (max ${MAX_COLUMNS})`;
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci];
    if (typeof col !== "object" || col === null) return `${path}.megaMenu.columns[${ci}] must be an object`;
    const c = col as Record<string, unknown>;
    if (c.heading !== undefined && typeof c.heading !== "string") return `${path}.megaMenu.columns[${ci}].heading must be a string`;
    const trErr = validateTranslations({ translations: c.translations }, `${path}.megaMenu.columns[${ci}]`);
    if (trErr) return trErr;
    if (!Array.isArray(c.items)) return `${path}.megaMenu.columns[${ci}].items must be an array`;
    if (c.items.length > MAX_COLUMN_ITEMS) return `${path}.megaMenu.columns[${ci}] has too many items (max ${MAX_COLUMN_ITEMS})`;
    for (let ii = 0; ii < c.items.length; ii++) {
      const err = validateMegaMenuItem(c.items[ii], `${path}.megaMenu.columns[${ci}].items[${ii}]`);
      if (err) return err;
    }
  }
  return null;
}

function validateItem(item: unknown, path: string, depth: number): string | null {
  if (typeof item !== "object" || item === null) return `${path} must be an object`;
  const o = item as Record<string, unknown>;
  const commonErr = validateCommonItemFields(o, path);
  if (commonErr) return commonErr;
  if (o.children !== undefined && o.megaMenu !== undefined) {
    return `${path} cannot have both children and megaMenu`;
  }
  if (o.megaMenu !== undefined) return validateMegaMenu(o.megaMenu, path);
  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) return `${path}.children must be an array`;
    if (depth + 1 > MAX_DEPTH) return `${path}.children exceeds max nesting depth (${MAX_DEPTH})`;
    for (let i = 0; i < o.children.length; i++) {
      const err = validateItem(o.children[i], `${path}.children[${i}]`, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

export function validateMenuItems(items: unknown): string | null {
  if (!Array.isArray(items)) return "items must be an array";
  for (let i = 0; i < items.length; i++) {
    const err = validateItem(items[i], `items[${i}]`, 1);
    if (err) return err;
  }
  return null;
}
