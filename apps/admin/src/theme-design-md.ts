import { parseDocument, stringify } from "yaml";

// These are the values the CMS can persist today. The DESIGN.md specification
// also describes spacing, elevation and component recipes; those remain prose
// until the site renderer has matching controls.
export const THEME_FIELDS = [
  "primaryColor", "secondaryColor", "tertiaryColor", "backgroundColor", "textColor",
  "successColor", "warningColor", "errorColor", "infoColor",
  "fontFamily", "headingFont", "subHeadingFont", "postTitleFont", "captionFont",
  "headingFontSize", "headingLineHeight", "subHeadingFontSize", "subHeadingLineHeight",
  "postTitleFontSize", "postTitleLineHeight", "bodyFontSize", "bodyLineHeight",
  "captionFontSize", "captionLineHeight", "showPostTags", "showPostCategory",
  "showPostAuthor", "showPostDate", "logoUrl", "faviconUrl",
] as const;

export type ThemeField = (typeof THEME_FIELDS)[number];
export type ThemeSettings = Record<string, string>;

export interface ImportedDesignMd {
  name: string;
  settings: ThemeSettings;
  mappedFields: ThemeField[];
  ignoredSections: string[];
  source: "ucms" | "external";
}

const COLOR_ROLES: Array<[ThemeField, string[]]> = [
  ["primaryColor", ["primary", "brandprimary", "brand", "primaryteal", "main"]],
  ["secondaryColor", ["secondary", "accent", "accentgold", "brandsecondary"]],
  ["tertiaryColor", ["tertiary", "thirdaccent"]],
  ["backgroundColor", ["background", "pagebackground", "surfacebase", "canvas", "page", "neutral", "base"]],
  ["textColor", ["text", "bodytext", "foreground", "onbackground", "onsurface", "ink"]],
  ["successColor", ["success", "positive"]],
  ["warningColor", ["warning", "caution"]],
  ["errorColor", ["error", "danger", "negative"]],
  ["infoColor", ["info", "information", "skyblue"]],
];

const TYPE_ROLES: Array<{ names: string[]; font: ThemeField; size: ThemeField; line: ThemeField }> = [
  { names: ["bodymd", "body", "paragraph", "bodyregular"], font: "fontFamily", size: "bodyFontSize", line: "bodyLineHeight" },
  { names: ["h1", "heading", "headline", "headlinelg", "display"], font: "headingFont", size: "headingFontSize", line: "headingLineHeight" },
  { names: ["h2", "subheading", "headlinemd"], font: "subHeadingFont", size: "subHeadingFontSize", line: "subHeadingLineHeight" },
  { names: ["posttitle", "articletitle", "blogtitle"], font: "postTitleFont", size: "postTitleFontSize", line: "postTitleLineHeight" },
  { names: ["caption", "captionsm", "labelsm", "small"], font: "captionFont", size: "captionFontSize", line: "captionLineHeight" },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;
const COLOR_IN_TEXT_RE = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i;
const FONT_RE = /^[A-Za-z0-9 ]{1,80}$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (HEX_RE.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${[...raw.slice(1)].map((part) => part + part).join("")}`.toUpperCase();
  }
  return null;
}

function resolveColorValue(raw: unknown, root: Record<string, unknown>, depth = 0): string | null {
  if (depth > 8 || raw === undefined || raw === null) return null;
  const direct = hex(raw);
  if (direct) return direct;
  if (typeof raw === "string") {
    const reference = raw.match(/^\{colors\.([A-Za-z0-9._-]+)\}$/);
    if (!reference) return null;
    const target = reference[1].split(".").reduce<unknown>((node, part) => record(node)[part], root);
    return resolveColorValue(target, root, depth + 1);
  }
  const item = record(raw);
  if (!Object.keys(item).length) return null;
  return resolveColorValue(item.$value ?? item.value ?? item.hex, root, depth + 1);
}

function colorEntries(group: Record<string, unknown>, prefix = "", root = group): Array<{ name: string; value: string }> {
  const found: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(group)) {
    const label = prefix ? `${prefix} ${name}` : name;
    const entry = record(raw);
    const value = resolveColorValue(raw, root);
    if (value) found.push({ name: label, value });
    else if (Object.keys(entry).length > 0) found.push(...colorEntries(entry, label, root));
  }
  return found;
}

function markdownColors(body: string): Array<{ name: string; value: string }> {
  const lines = body.split(/\r?\n/);
  const found: Array<{ name: string; value: string }> = [];
  let previousLabel = "";
  for (const line of lines) {
    const match = line.match(COLOR_IN_TEXT_RE);
    if (match) {
      const value = hex(match[0]);
      if (value) {
        const before = line.slice(0, match.index).replace(/[|*`#:[\]()]/g, " ").trim();
        const label = before && !/^[-\s]+$/.test(before) ? before : previousLabel;
        if (label && label.length <= 80) found.push({ name: label, value });
      }
    } else {
      const cleaned = line.replace(/^[#*|\s-]+|[|*\s]+$/g, "").trim();
      if (cleaned && cleaned.length <= 60 && !cleaned.includes("|")) previousLabel = cleaned;
    }
  }
  return found;
}

function chooseColor(entries: Array<{ name: string; value: string }>, aliases: string[]): string | null {
  let best: { value: string; score: number } | null = null;
  for (const entry of entries) {
    const key = normalized(entry.name);
    for (const alias of aliases) {
      const score = key === alias ? 100 : key.startsWith(alias) ? 55 : key.endsWith(alias) ? 45 : 0;
      if (score > (best?.score ?? 0)) best = { value: entry.value, score };
    }
  }
  return best?.value ?? null;
}

function font(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return FONT_RE.test(first) ? first : null;
}

function size(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const input = record(value);
  const raw = typeof value === "object" ? `${input.value ?? ""}${input.unit ?? ""}` : String(value);
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(px|rem)?$/i);
  if (!match) return null;
  const px = Number(match[1]) * (match[2]?.toLowerCase() === "rem" ? 16 : 1);
  return px >= 8 && px <= 120 ? String(Math.round(px * 10) / 10) : null;
}

function lineHeight(value: unknown, fontSize: string | null): string | null {
  if (value === undefined || value === null) return null;
  const input = record(value);
  const raw = typeof value === "object" ? `${input.value ?? ""}${input.unit ?? ""}` : String(value);
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
  if (!match) return null;
  const ratio = Number(match[1]) / (match[2] ? Number(fontSize) : 1);
  return Number.isFinite(ratio) && ratio >= 1 && ratio <= 2.5 ? String(Math.round(ratio * 100) / 100) : null;
}

function typeEntries(group: Record<string, unknown>): Array<{ name: string; value: Record<string, unknown> }> {
  return Object.entries(group).map(([name, value]) => ({ name: normalized(name), value: record(record(value).$value ?? value) }));
}

function markdownTypography(body: string): Array<{ name: string; value: Record<string, unknown> }> {
  const section = body.split(/^##\s+Typography[^\n]*\r?\n/im)[1]?.split(/^##\s+/m)[0] ?? "";
  const found: Array<{ name: string; value: Record<string, unknown> }> = [];
  for (const line of section.split(/\r?\n/)) {
    const cells = line.startsWith("|") ? line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/[`*]/g, "")) : null;
    const prose = line.replace(/^\s*[-*]\s*/, "").replace(/\*\*/g, "").trim();
    const match = prose.match(/^(heading|headline|display|h1|h2|subheading|post[ -]?title|article[ -]?title|body|paragraph|caption|label)(?:\s+(?:font|typeface|family))?\s*[:—–-]\s*([^·|;]+?)(?:\s*·\s*(\d+(?:\.\d+)?(?:px|rem)))?(?:\s*·|$)/i);
    const role = cells?.[0] || match?.[1];
    if (!role) continue;
    const family = cells?.[1] || match?.[2];
    const fontSize = cells?.[2] || match?.[3];
    const lh = cells?.[3];
    found.push({ name: normalized(role), value: { fontFamily: family, fontSize, lineHeight: lh } });
  }
  return found;
}

export function parseDesignMd(contents: string): ImportedDesignMd | null {
  if (contents.length > 256 * 1024) throw new Error("design.md is larger than 256 KB");
  const text = contents.replace(/^\uFEFF/, "");
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  let front: Record<string, unknown> = {};
  if (match) {
    const doc = parseDocument(match[1], { uniqueKeys: true });
    if (doc.errors.length > 0) throw new Error("Invalid YAML frontmatter in design.md");
    front = record(doc.toJS({ maxAliasCount: 0 }));
  }
  const body = match ? text.slice(match[0].length) : text;
  const settings: ThemeSettings = {};
  const set = (key: ThemeField, value: string | null) => { if (value !== null && value !== "") settings[key] = value; };

  const entries = [...colorEntries(record(front.colors)), ...markdownColors(body)];
  for (const [key, aliases] of COLOR_ROLES) set(key, chooseColor(entries, aliases));

  const typography = [...typeEntries(record(front.typography)), ...markdownTypography(body)];
  for (const role of TYPE_ROLES) {
    const selected = role.names.map((name) => typography.find((item) => item.name === name)).find(Boolean);
    if (!selected) continue;
    const value = selected.value;
    const fontSize = size(value.fontSize);
    set(role.font, font(value.fontFamily));
    set(role.size, fontSize);
    set(role.line, lineHeight(value.lineHeight, fontSize));
  }

  // Our v2 exports used flat keys; v3 keeps an explicit extension for exact
  // round trips while also exporting interoperable colors/typography tokens.
  const own = record(record(front.ucms).settings);
  for (const key of THEME_FIELDS) {
    const raw = own[key] ?? front[key];
    if (typeof raw !== "string" || raw === "") continue;
    if (key.endsWith("Color")) set(key, hex(raw));
    else if (["fontFamily", "headingFont", "subHeadingFont", "postTitleFont", "captionFont"].includes(key)) set(key, font(raw));
    else if (key.startsWith("showPost")) {
      if (raw === "true" || raw === "false") set(key, raw);
    } else if (key.endsWith("FontSize")) set(key, size(raw));
    else if (key.endsWith("LineHeight")) set(key, lineHeight(raw, null));
    else if (key.endsWith("Url")) {
      if (/^https?:\/\//i.test(raw) || raw.startsWith("/uploads/")) set(key, raw);
    }
  }

  const mappedFields = THEME_FIELDS.filter((key) => settings[key] !== undefined);
  if (mappedFields.length === 0) return null;
  const ignoredSections = ["spacing", "rounded", "elevation", "shadows", "components"]
    .filter((section) => front[section] !== undefined);
  const name = typeof front.name === "string" && front.name.trim()
    ? front.name.trim().slice(0, 100)
    : (body.match(/^#\s+(.+)$/m)?.[1].trim().slice(0, 100) || "Imported design");
  return { name, settings, mappedFields, ignoredSections, source: Object.keys(own).length > 0 ? "ucms" : "external" };
}

export function serializeDesignMd(name: string, settings: ThemeSettings): string {
  const colors: Record<string, string> = {};
  for (const [key, token] of [
    ["primaryColor", "primary"], ["secondaryColor", "secondary"], ["tertiaryColor", "tertiary"],
    ["backgroundColor", "background"], ["textColor", "on-background"], ["successColor", "success"],
    ["warningColor", "warning"], ["errorColor", "error"], ["infoColor", "info"],
  ] as const) {
    if (settings[key]) colors[token] = settings[key];
  }
  const typography: Record<string, Record<string, string>> = {};
  for (const [token, fontKey, sizeKey, lineKey] of [
    ["h1", "headingFont", "headingFontSize", "headingLineHeight"],
    ["h2", "subHeadingFont", "subHeadingFontSize", "subHeadingLineHeight"],
    ["post-title", "postTitleFont", "postTitleFontSize", "postTitleLineHeight"],
    ["body-md", "fontFamily", "bodyFontSize", "bodyLineHeight"],
    ["caption", "captionFont", "captionFontSize", "captionLineHeight"],
  ] as const) {
    const item: Record<string, string> = {};
    if (settings[fontKey]) item.fontFamily = settings[fontKey];
    if (settings[sizeKey]) item.fontSize = `${settings[sizeKey]}px`;
    if (settings[lineKey]) item.lineHeight = settings[lineKey];
    if (Object.keys(item).length) typography[token] = item;
  }
  const exact = Object.fromEntries(THEME_FIELDS.filter((key) => settings[key]).map((key) => [key, settings[key]]));
  const front: Record<string, unknown> = { name: name.trim() || "USIM CMS theme" };
  if (Object.keys(colors).length) front.colors = colors;
  if (Object.keys(typography).length) front.typography = typography;
  front.ucms = { version: 3, settings: exact };
  const rows = Object.entries(colors).map(([role, value]) => `| ${role} | ${value} |`);
  const typeRows = Object.entries(typography).map(([role, item]) =>
    `| ${role} | ${item.fontFamily || "inherited"} | ${item.fontSize || "inherited"} | ${item.lineHeight || "inherited"} |`);
  return [
    "---", stringify(front).trimEnd(), "---", "", `# ${front.name}`, "",
    "## Overview", "", "Theme settings exported from USIM CMS. The `ucms` extension preserves every supported CMS control for a complete round trip. Other tools can read the standard colors and typography tokens.", "",
    "## Colors", "", "| Role | Hex |", "| --- | --- |", ...rows, "",
    "## Typography", "", "| Role | Font | Size | Line height |", "| --- | --- | --- | --- |", ...typeRows, "",
    "## Components", "",
    `- Primary buttons use ${settings.primaryColor || "the inherited primary color"} with an automatically selected readable label.`,
    `- Body text uses ${settings.textColor || "the inherited text color"} on ${settings.backgroundColor || "the inherited background"}.`,
    `- Post metadata: tags ${settings.showPostTags === "false" ? "hidden" : "shown"}; category ${settings.showPostCategory === "false" ? "hidden" : "shown"}; author ${settings.showPostAuthor === "false" ? "hidden" : "shown"}; date ${settings.showPostDate === "false" ? "hidden" : "shown"}.`,
    "", "## Do's and Don'ts", "", "- Check body text contrast against the background before publishing.",
    "- Preview this theme across a real site before applying it.", "",
  ].join("\n");
}
