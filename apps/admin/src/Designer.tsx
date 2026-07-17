import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Clock,
  Code2,
  Copy,
  Download,
  ExternalLink,
  GripVertical,
  Heading1,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  List,
  Mail,
  MapPin,
  Minus,
  MousePointerClick,
  MoveVertical,
  Paintbrush,
  Phone,
  Plus,
  Redo2,
  Star,
  Trash2,
  Type,
  Undo2,
  Video,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";

// ---------- data model (stored in pages.layout JSONB) ----------
// A designer page is a list of blocks; the designer emits `section` blocks:
//   { type: "section", props: { bg?, bgImage?, textColor?, paddingY?, width?, rows: Row[] } }
// Legacy blocks (hero/text/image from the old BlockBuilder) are kept as-is and
// shown as locked cards — the frontend still renders them.

type ElType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "spacer"
  | "divider"
  | "embed"
  | "icon"
  | "list"
  | "html"
  | "gallery";

interface El {
  id: string;
  type: ElType;
  props: Record<string, string>;
}
interface Col {
  span: number;
  elements: El[];
  // Column-level style escape hatch — see COLUMN_FIELDS. Kept as a loose
  // string bag (not a typed interface) to match El.props/SectionProps'
  // convention of storing style values as plain strings.
  props?: Record<string, string>;
}
interface Row {
  columns: Col[];
}
interface SectionProps {
  bg?: string;
  bgImage?: string;
  textColor?: string;
  paddingY?: string;
  paddingX?: string;
  marginY?: string;
  width?: string;
  border?: string;
  shadow?: string;
  radius?: string;
  anchorId?: string;
  cssClass?: string;
  rows: Row[];
}
interface Block {
  type: string;
  props: Record<string, unknown>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type FieldKind = "text" | "textarea" | "select" | "color" | "image" | "gallery";
interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
}

// Curated icon set — SectionBlock.astro hardcodes the matching raw SVG path
// for each of these names (no lucide-react dependency on the frontend); add
// to both places together.
const ICONS: Record<string, typeof Check> = {
  check: Check,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  star: Star,
  phone: Phone,
  mail: Mail,
  "map-pin": MapPin,
  calendar: Calendar,
  clock: Clock,
  "external-link": ExternalLink,
  "chevron-right": ChevronRight,
  download: Download,
};

// Shared across heading/text/list — full typography control. fontFamily is
// any Google Font name; see the useEffect near the component body that
// keeps a matching <link> synced into document.head for canvas preview.
const TYPOGRAPHY_FIELDS: Field[] = [
  { key: "fontFamily", labelKey: "designer-f-fontfamily", kind: "text" },
  { key: "color", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "lineHeight", labelKey: "designer-f-lineheight", kind: "text" },
  { key: "letterSpacing", labelKey: "designer-f-letterspacing", kind: "text" },
  { key: "fontWeight", labelKey: "designer-f-fontweight", kind: "select", options: ["400", "500", "600", "700", "800"] },
];

const ELS: Record<ElType, { labelKey: Key; icon: typeof Type; defaults: Record<string, string>; fields: Field[] }> = {
  heading: {
    labelKey: "designer-el-heading",
    icon: Heading1,
    defaults: { text: "Heading", level: "2", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "level", labelKey: "designer-f-level", kind: "select", options: ["1", "2", "3", "4"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  text: {
    labelKey: "designer-el-text",
    icon: Type,
    defaults: { text: "", size: "md", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "size", labelKey: "designer-f-size", kind: "select", options: ["sm", "md", "lg"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  image: {
    labelKey: "designer-el-image",
    icon: ImageIcon,
    defaults: { src: "", alt: "", radius: "md" },
    fields: [
      { key: "src", labelKey: "designer-f-src", kind: "image" },
      { key: "alt", labelKey: "designer-f-alt", kind: "text" },
      { key: "radius", labelKey: "designer-f-radius", kind: "select", options: ["none", "md", "xl", "full"] },
      { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
    ],
  },
  button: {
    labelKey: "designer-el-button",
    icon: MousePointerClick,
    defaults: { label: "Button", href: "#", variant: "primary", align: "left" },
    fields: [
      { key: "label", labelKey: "designer-f-label", kind: "text" },
      { key: "href", labelKey: "designer-f-href", kind: "text" },
      { key: "variant", labelKey: "designer-f-variant", kind: "select", options: ["primary", "outline"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  spacer: {
    labelKey: "designer-el-spacer",
    icon: MoveVertical,
    defaults: { height: "md" },
    fields: [{ key: "height", labelKey: "designer-f-height", kind: "text" }],
  },
  divider: { labelKey: "designer-el-divider", icon: Minus, defaults: {}, fields: [] },
  embed: {
    labelKey: "designer-el-embed",
    icon: Video,
    defaults: { url: "", ratio: "16:9" },
    fields: [
      { key: "url", labelKey: "designer-f-url", kind: "text" },
      { key: "ratio", labelKey: "designer-f-ratio", kind: "select", options: ["16:9", "4:3", "1:1"] },
    ],
  },
  icon: {
    labelKey: "designer-el-icon",
    icon: Star,
    defaults: { name: "check", size: "md", color: "", align: "left" },
    fields: [
      { key: "name", labelKey: "designer-f-icon-name", kind: "select", options: Object.keys(ICONS) },
      { key: "size", labelKey: "designer-f-icon-size", kind: "select", options: ["sm", "md", "lg", "xl"] },
      { key: "color", labelKey: "designer-f-icon-color", kind: "color" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  list: {
    labelKey: "designer-el-list",
    icon: List,
    defaults: { items: "", style: "bullet" },
    fields: [
      { key: "items", labelKey: "designer-f-list-items", kind: "textarea" },
      { key: "style", labelKey: "designer-f-list-style", kind: "select", options: ["bullet", "numbered", "none"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  html: {
    labelKey: "designer-el-html",
    icon: Code2,
    // Pairs with cssClass on section/column/element (see COLUMN_FIELDS):
    // there's no separate site-wide custom-CSS field, so a <style> tag
    // dropped in here is how a cssClass actually gets styled.
    defaults: { html: "" },
    fields: [{ key: "html", labelKey: "designer-f-html", kind: "textarea" }],
  },
  gallery: {
    labelKey: "designer-el-gallery",
    icon: Images,
    defaults: { images: "", columns: "3", radius: "md" },
    fields: [
      { key: "images", labelKey: "designer-f-gallery-images", kind: "gallery" },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
      { key: "radius", labelKey: "designer-f-radius", kind: "select", options: ["none", "md", "xl", "full"] },
    ],
  },
};

// "Paste style" strips these before merging onto a target, so copying a
// heading's style and pasting it onto a button can't leak the heading's
// actual text — only the type's own content field(s) need stripping;
// section/column props are already style-only.
const CONTENT_KEYS: Record<ElType, string[]> = {
  heading: ["text"],
  text: ["text"],
  image: ["src", "alt"],
  button: ["label", "href"],
  icon: ["name"],
  list: ["items"],
  html: ["html"],
  gallery: ["images"],
  embed: ["url"],
  spacer: [],
  divider: [],
};
type ClipLevel = "section" | "column" | "element";
const CLIP_KEYS: Record<ClipLevel, string> = {
  section: "designer:clip:section",
  column: "designer:clip:column",
  element: "designer:clip:element",
};
const CLIPSTYLE_KEYS: Record<ClipLevel, string> = {
  section: "designer:clipstyle:section",
  column: "designer:clipstyle:column",
  element: "designer:clipstyle:element",
};

const SECTION_FIELDS: Field[] = [
  { key: "bg", labelKey: "designer-s-bg", kind: "color" },
  { key: "bgImage", labelKey: "designer-s-bgimage", kind: "image" },
  { key: "textColor", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "paddingY", labelKey: "designer-s-padding", kind: "text" },
  { key: "paddingX", labelKey: "designer-f-paddingx", kind: "text" },
  { key: "marginY", labelKey: "designer-f-marginy", kind: "text" },
  { key: "width", labelKey: "designer-s-width", kind: "select", options: ["contained", "full"] },
  { key: "border", labelKey: "designer-s-border", kind: "select", options: ["none", "thin", "thick"] },
  { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
  { key: "radius", labelKey: "designer-f-radius", kind: "select", options: ["none", "md", "xl", "full"] },
  { key: "anchorId", labelKey: "designer-f-anchorid", kind: "text" },
  { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" },
];

// Column-level style escape hatch (see Col.props) — a column becomes a
// themeable "card" once bg/padding/border/shadow/radius are set, covering
// what would otherwise need a dedicated Card/Testimonial element.
const COLUMN_FIELDS: Field[] = [
  { key: "bg", labelKey: "designer-s-bg", kind: "color" },
  { key: "padding", labelKey: "designer-f-padding", kind: "text" },
  { key: "marginY", labelKey: "designer-f-marginy", kind: "text" },
  { key: "valign", labelKey: "designer-f-valign", kind: "select", options: ["top", "center", "bottom"] },
  { key: "border", labelKey: "designer-s-border", kind: "select", options: ["none", "thin", "thick"] },
  { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
  { key: "radius", labelKey: "designer-f-radius", kind: "select", options: ["none", "md", "xl", "full"] },
  { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" },
];

const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
const SPACE: Record<string, string> = { sm: "1rem", md: "2rem", lg: "4rem", xl: "6rem" };
const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
const TEXT_SIZE: Record<string, string> = { sm: "0.875rem", md: "1rem", lg: "1.2rem" };
const H_SIZE: Record<string, string> = { "1": "2.6rem", "2": "2rem", "3": "1.5rem", "4": "1.2rem" };
const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };
const SHADOW: Record<string, string> = {
  none: "none",
  sm: "0 1px 3px rgba(0,0,0,.1)",
  md: "0 4px 12px rgba(0,0,0,.12)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};
const ICON_SIZE: Record<string, string> = { sm: "1rem", md: "1.5rem", lg: "2.25rem", xl: "3rem" };
// Resolves a spacing value that may be either a legacy preset keyword
// ("sm"/"md"/"lg"/"xl"/"none") or a real CSS length the author typed
// ("42px", "2.5rem") — existing pages keep their preset look, new edits get
// free-form units. Duplicated in SectionBlock.astro like every other table.
function lengthValue(v: string | undefined, table: Record<string, string>, fallback: string) {
  if (!v) return fallback;
  return table[v] ?? v;
}

// Row presets offered by "add row": each entry is the column span list.
const ROW_PRESETS: number[][] = [[1], [1, 1], [1, 1, 1], [1, 1, 1, 1], [1, 2], [2, 1]];

const newSection = (): Block => ({
  type: "section",
  props: { paddingY: "md", width: "contained", rows: [{ columns: [{ span: 1, elements: [] }] }] },
});
const newEl = (type: ElType): El => ({ id: uid(), type, props: { ...ELS[type].defaults } });

// selection path: [block] | [block,row] | [block,row,col] | [block,row,col,el]
type Sel = number[] | null;

// drag payload: a new palette element, or a move of an existing one
type Drag = { kind: "new"; type: ElType } | { kind: "move"; path: number[] };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]);
}
function safeHref(u: string) {
  const v = u.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^https?:/i.test(v) ? v : "#";
  return v;
}
// Small inline-markdown subset for heading/text: **bold**, *italic*, [label](url).
// Duplicated (not shared) in SectionBlock.astro's own renderInline — same
// convention as this file's PAD/RADIUS tables mirroring the frontend's.
// ponytail: link regex stops at the first ")" in the URL, so a raw
// unescaped "(" / ")" inside the URL itself truncates it — fine for normal
// links/anchors, encode the parens if it ever matters.
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeHref(url)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// Approximates a column's COLUMN_FIELDS in the canvas, mirroring the "card"
// styling SectionBlock.astro applies to .ds-col — same only-if-set guard as
// the section wrapper above so unstyled columns keep their plain layout.
// Only sets a style key when the field actually has a value, so an unset
// typography field falls back to the base style (e.g. heading's default
// bold weight) instead of being wiped to the browser default by `undefined`.
function typoStyle(p: Record<string, string>): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (p.fontFamily) s.fontFamily = p.fontFamily;
  if (p.color) s.color = p.color;
  if (p.lineHeight) s.lineHeight = p.lineHeight;
  if (p.letterSpacing) s.letterSpacing = p.letterSpacing;
  if (p.fontWeight) s.fontWeight = p.fontWeight;
  return s;
}

function colStyle(cp?: Record<string, string>): React.CSSProperties {
  if (!cp) return {};
  return {
    background: cp.bg || undefined,
    padding: cp.padding ? lengthValue(cp.padding, PAD, PAD.md) : undefined,
    margin: cp.marginY ? `${lengthValue(cp.marginY, PAD, "0")} 0` : undefined,
    alignSelf: cp.valign === "top" ? "start" : cp.valign === "bottom" ? "end" : cp.valign === "center" ? "center" : undefined,
    border: cp.border ? BORDER[cp.border] : undefined,
    boxShadow: cp.shadow ? SHADOW[cp.shadow] : undefined,
    borderRadius: cp.radius ? RADIUS[cp.radius] : undefined,
  };
}

export default function Designer({
  page,
  tenantHost,
  token,
  t,
  onClose,
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  onClose: (saved: boolean) => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => clone((page.layout as Block[] | undefined) ?? []));
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAny, setSavedAny] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [clipTick, setClipTick] = useState(0); // bumped on every clipboard write, to re-render Paste button enabled-state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<api.DesignTemplate[]>([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  const drag = useRef<Drag | null>(null);

  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    const next = clone(blocks);
    fn(next);
    setBlocks(next);
    setDirty(true);
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(clone(blocks));
    setBlocks(prev);
    setSel(null);
    setDirty(true);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(blocks));
    setBlocks(next);
    setSel(null);
    setDirty(true);
  }

  // localStorage-backed clipboard (survives reload/switching pages), namespaced
  // per level so copying a section doesn't clobber a copied element.
  function clipCopy(level: ClipLevel, data: unknown) {
    localStorage.setItem(CLIP_KEYS[level], JSON.stringify(data));
    setClipTick((x) => x + 1);
  }
  function clipRead<T = unknown>(level: ClipLevel): T | null {
    const raw = localStorage.getItem(CLIP_KEYS[level]);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  function clipHas(level: ClipLevel) {
    void clipTick;
    return localStorage.getItem(CLIP_KEYS[level]) !== null;
  }
  function styleCopy(level: ClipLevel, props: Record<string, string>, elType?: ElType) {
    const clean = { ...props };
    (elType ? CONTENT_KEYS[elType] : []).forEach((k) => delete clean[k]);
    localStorage.setItem(CLIPSTYLE_KEYS[level], JSON.stringify(clean));
    setClipTick((x) => x + 1);
  }
  function styleRead(level: ClipLevel): Record<string, string> | null {
    const raw = localStorage.getItem(CLIPSTYLE_KEYS[level]);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  }
  function styleHas(level: ClipLevel) {
    void clipTick;
    return localStorage.getItem(CLIPSTYLE_KEYS[level]) !== null;
  }

  useEffect(() => {
    const onStorage = () => setClipTick((x) => x + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function openTemplates() {
    setShowTemplates(true);
    setTemplatesBusy(true);
    try {
      setTemplates(await api.listTemplates(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  async function saveAsTemplate() {
    if (!sel || sel.length !== 1 || blocks[sel[0]].type !== "section") return;
    const name = prompt(t("designer-templates-save-prompt"));
    if (!name) return;
    setTemplatesBusy(true);
    try {
      await api.createTemplate(tenantHost, token, name, blocks[sel[0]] as unknown as Record<string, unknown>);
      setTemplates(await api.listTemplates(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  function insertTemplate(tpl: api.DesignTemplate) {
    mutate((bs) => bs.push(clone(tpl.data) as unknown as Block));
    setShowTemplates(false);
  }

  async function deleteTemplateHandler(id: string) {
    if (!confirm(t("designer-templates-delete-confirm"))) return;
    try {
      await api.deleteTemplate(tenantHost, token, id);
      setTemplates((ts) => ts.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keeps a Google Font <link> in document.head for every distinct
  // fontFamily in use, so the canvas preview approximates the real render
  // (SectionBlock.astro/[...slug].astro do the equivalent server-side).
  useEffect(() => {
    const fonts = new Set<string>();
    for (const block of blocks) {
      if (block.type !== "section") continue;
      for (const row of (block.props as unknown as SectionProps).rows ?? []) {
        for (const col of row.columns ?? []) {
          for (const el of col.elements ?? []) {
            if ((el.type === "heading" || el.type === "text" || el.type === "list") && el.props.fontFamily) {
              fonts.add(el.props.fontFamily);
            }
          }
        }
      }
    }
    fonts.forEach((f) => {
      const selector = `link[data-designer-font="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(f) : f}"]`;
      if (document.querySelector(selector)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.designerFont = f;
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}&display=swap`;
      document.head.appendChild(link);
    });
  }, [blocks]);

  const section = (bs: Block[], b: number) => bs[b].props as unknown as SectionProps;

  function removeAt(bs: Block[], path: number[]): El {
    const [b, r, c, e] = path;
    return section(bs, b).rows[r].columns[c].elements.splice(e, 1)[0];
  }

  function insertEl(bs: Block[], colPath: number[], el: El, index?: number) {
    const [b, r, c] = colPath;
    const list = section(bs, b).rows[r].columns[c].elements;
    list.splice(index ?? list.length, 0, el);
  }

  function dropIntoColumn(colPath: number[], index?: number) {
    const d = drag.current;
    drag.current = null;
    setDropHint(null);
    if (!d) return;
    mutate((bs) => {
      if (d.kind === "new") {
        insertEl(bs, colPath, newEl(d.type), index);
        return;
      }
      const [sb, sr, sc, se] = d.path;
      let idx = index;
      // same-column move: removing the source first shifts later indexes down
      if (idx !== undefined && sb === colPath[0] && sr === colPath[1] && sc === colPath[2] && se < idx) idx--;
      const el = removeAt(bs, d.path);
      insertEl(bs, colPath, el, idx);
    });
    setSel(null);
  }

  async function save(status?: "published") {
    setBusy(true);
    setError(null);
    try {
      await api.updatePage(tenantHost, token, page.id as string, {
        layout: blocks,
        ...(status ? { status, publishedAt: new Date().toISOString() } : {}),
      });
      if (status) page.status = status;
      setDirty(false);
      setSavedAny(true);
      setMsg(status ? t("designer-published") : t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Same sync-open pattern as PagesPanel.preview: window.open must happen in
  // direct response to the click or popup blockers eat it.
  async function preview() {
    const win = window.open("", "_blank", "noreferrer");
    try {
      if (dirty) await save();
      const previewToken =
        page.status === "published" ? undefined : await api.getPagePreviewToken(tenantHost, token, page.id as string);
      if (win) win.location.href = api.previewUrl(tenantHost, page.slug as string, previewToken);
    } catch (err) {
      win?.close();
      setError((err as Error).message);
    }
  }

  function close() {
    if (dirty && !confirm(t("designer-unsaved"))) return;
    onClose(savedAny);
  }

  // ---------- selection helpers ----------
  const selEq = (p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);
  const selCls = (p: number[]) =>
    selEq(p) ? "outline outline-2 outline-accent" : "outline outline-1 outline-transparent hover:outline-accent/30";

  function pick(e: React.MouseEvent, p: number[]) {
    e.stopPropagation();
    setSel(p);
  }

  // ---------- inspector ----------
  async function uploadImage(file: File, setValue: (v: string) => void) {
    setUploading(true);
    try {
      setValue(api.API_URL + (await api.uploadMedia(tenantHost, token, file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
    const base =
      "w-full rounded-lg border border-line/30 bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-line";
    if (field.kind === "textarea")
      return <textarea rows={4} className={base} value={value} onChange={(e) => onChange(e.target.value)} />;
    if (field.kind === "select")
      return (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    if (field.kind === "color")
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value || "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-line/30"
          />
          <input className={base} value={value} placeholder="#" onChange={(e) => onChange(e.target.value)} />
          {value && (
            <button onClick={() => onChange("")} className="text-[10px] font-semibold text-sub hover:text-red-500">
              ✕
            </button>
          )}
        </div>
      );
    if (field.kind === "image")
      return (
        <div className="space-y-1.5">
          <input className={base} value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
          <label className="inline-block cursor-pointer rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]">
            {uploading ? t("designer-uploading") : t("designer-upload")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f, onChange);
              }}
            />
          </label>
          {value && <img src={value} alt="" className="h-16 rounded-lg object-cover" />}
        </div>
      );
    if (field.kind === "gallery") {
      const urls = value ? value.split("\n").filter(Boolean) : [];
      const setUrls = (next: string[]) => onChange(next.join("\n"));
      return (
        <div className="space-y-2">
          {urls.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              {u && <img src={u} alt="" className="h-9 w-9 rounded object-cover" />}
              <input
                className={base}
                value={u}
                placeholder="https://"
                onChange={(e) => setUrls(urls.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <label className="cursor-pointer text-[10px] font-semibold text-accent">
                {uploading ? t("designer-uploading") : t("designer-upload")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f, (v) => setUrls(urls.map((x, j) => (j === i ? v : x))));
                  }}
                />
              </label>
              <button
                onClick={() => setUrls(urls.filter((_, j) => j !== i))}
                className="text-[10px] font-semibold text-red-500"
              >
                {t("designer-gallery-remove")}
              </button>
            </div>
          ))}
          <button onClick={() => setUrls([...urls, ""])} className="text-[11px] font-semibold text-accent">
            {t("designer-gallery-add-image")}
          </button>
        </div>
      );
    }
    return <input className={base} value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  function Inspector() {
    if (!sel || blocks[sel[0]]?.type !== "section") {
      return <p className="text-xs text-sub">{t("designer-none-selected")}</p>;
    }
    const [b, r, c, e] = sel;
    const sp = blocks[b].props as unknown as SectionProps;

    if (sel.length === 1) {
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-section")}</p>
          {SECTION_FIELDS.map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {t(f.labelKey)}
              <div className="mt-1">
                <FieldInput
                  field={f}
                  value={((sp as unknown as Record<string, string>)[f.key] as string) ?? ""}
                  onChange={(v) => mutate((bs) => ((bs[b].props as Record<string, unknown>)[f.key] = v))}
                />
              </div>
            </label>
          ))}
        </div>
      );
    }
    if (sel.length === 3) {
      const col = sp.rows[r]?.columns[c];
      if (!col) return null;
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-column")}</p>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-col-span")}: {col.span}
            <input
              type="range"
              min={1}
              max={6}
              value={col.span}
              className="mt-1 w-full accent-accent"
              onChange={(ev) => mutate((bs) => (section(bs, b).rows[r].columns[c].span = Number(ev.target.value)))}
            />
          </label>
          {COLUMN_FIELDS.map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {t(f.labelKey)}
              <div className="mt-1">
                <FieldInput
                  field={f}
                  value={col.props?.[f.key] ?? ""}
                  onChange={(v) =>
                    mutate((bs) => {
                      const target = section(bs, b).rows[r].columns[c];
                      target.props = { ...(target.props ?? {}), [f.key]: v };
                    })
                  }
                />
              </div>
            </label>
          ))}
          <div className="flex gap-3">
            <button
              onClick={() => clipCopy("column", col)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => {
                const data = clipRead<Col>("column");
                if (data) mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
              }}
              disabled={!clipHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button
              onClick={() => styleCopy("column", col.props ?? {})}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => {
                const style = styleRead("column");
                if (style)
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c];
                    target.props = { ...(target.props ?? {}), ...style };
                  });
              }}
              disabled={!styleHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <button
            onClick={() => {
              mutate((bs) => {
                const row = section(bs, b).rows[r];
                row.columns.splice(c, 1);
                if (row.columns.length === 0) section(bs, b).rows.splice(r, 1);
              });
              setSel(null);
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
        </div>
      );
    }
    if (sel.length === 4) {
      const el = sp.rows[r]?.columns[c]?.elements[e];
      if (!el) return null;
      const def = ELS[el.type];
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t(def.labelKey)}</p>
          {def.fields.map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {t(f.labelKey)}
              <div className="mt-1">
                <FieldInput
                  field={f}
                  value={el.props[f.key] ?? ""}
                  onChange={(v) => mutate((bs) => (section(bs, b).rows[r].columns[c].elements[e].props[f.key] = v))}
                />
              </div>
            </label>
          ))}
          <label className="block text-[11px] font-medium text-body">
            {t("designer-f-cssclass")}
            <div className="mt-1">
              <FieldInput
                field={{ key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" }}
                value={el.props.cssClass ?? ""}
                onChange={(v) => mutate((bs) => (section(bs, b).rows[r].columns[c].elements[e].props.cssClass = v))}
              />
            </div>
          </label>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-f-marginy")}
            <div className="mt-1">
              <FieldInput
                field={{ key: "marginY", labelKey: "designer-f-marginy", kind: "text" }}
                value={el.props.marginY ?? ""}
                onChange={(v) => mutate((bs) => (section(bs, b).rows[r].columns[c].elements[e].props.marginY = v))}
              />
            </div>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => clipCopy("element", el)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => {
                const data = clipRead<El>("element");
                if (data) mutate((bs) => insertEl(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
              }}
              disabled={!clipHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button
              onClick={() => styleCopy("element", el.props, el.type)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => {
                const style = styleRead("element");
                if (style)
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.props = { ...target.props, ...style };
                  });
              }}
              disabled={!styleHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() =>
                mutate((bs) => {
                  const src = section(bs, b).rows[r].columns[c].elements[e];
                  section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
                })
              }
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button
              onClick={() => {
                mutate((bs) => {
                  removeAt(bs, sel);
                });
                setSel(null);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  // ---------- canvas element preview (visual approximation of SectionBlock.astro) ----------
  function ElPreview({ el }: { el: El }) {
    const p = el.props;
    const align = { textAlign: (p.align as "left" | "center" | "right") ?? "left" };
    switch (el.type) {
      case "heading":
        return (
          <div
            style={{ ...align, fontSize: H_SIZE[p.level ?? "2"], fontWeight: 700, lineHeight: 1.2, ...typoStyle(p) }}
            className="font-display"
            dangerouslySetInnerHTML={{ __html: p.text ? renderInline(p.text) : "Heading" }}
          />
        );
      case "text":
        return p.text ? (
          <div
            style={{ ...align, fontSize: TEXT_SIZE[p.size ?? "md"], whiteSpace: "pre-wrap", lineHeight: 1.65, ...typoStyle(p) }}
            dangerouslySetInnerHTML={{ __html: renderInline(p.text) }}
          />
        ) : (
          <div style={{ ...align, fontSize: TEXT_SIZE[p.size ?? "md"] }} className="opacity-40">
            {t("designer-f-text")}…
          </div>
        );
      case "image":
        return p.src ? (
          <img
            src={p.src}
            alt={p.alt ?? ""}
            style={{ borderRadius: RADIUS[p.radius ?? "md"], boxShadow: SHADOW[p.shadow ?? "none"], maxWidth: "100%" }}
          />
        ) : (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line/50 bg-canvas/50 text-sub">
            <ImageIcon className="h-6 w-6" />
          </div>
        );
      case "button":
        return (
          <div style={align}>
            <span
              className="inline-block rounded-full px-5 py-2 text-sm font-semibold"
              style={
                p.variant === "outline"
                  ? { border: "2px solid currentColor" }
                  : { backgroundColor: "#0f62fe", color: "#fff" }
              }
            >
              {p.label || "Button"}
            </span>
          </div>
        );
      case "spacer":
        return (
          <div style={{ height: lengthValue(p.height, SPACE, SPACE.md) }} className="rounded border border-dashed border-line/30" />
        );
      case "divider":
        return <hr className="border-current opacity-20" />;
      case "embed":
        return (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-black/70 text-white">
            <Video className="mr-2 h-5 w-5" />
            <span className="max-w-[80%] truncate text-xs">{p.url || t("designer-f-url")}</span>
          </div>
        );
      case "icon": {
        const Icon = ICONS[p.name ?? "check"] ?? Check;
        const size = ICON_SIZE[p.size ?? "md"];
        return (
          <div style={align}>
            <Icon style={{ width: size, height: size, color: p.color || undefined }} />
          </div>
        );
      }
      case "list": {
        const items = (p.items ?? "").split("\n").filter(Boolean);
        if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-list-items")}…</span>;
        const cls =
          p.style === "none" ? "list-none" : p.style === "numbered" ? "list-decimal pl-5" : "list-disc pl-5";
        const Tag = p.style === "numbered" ? "ol" : "ul";
        return (
          <Tag className={`${cls} space-y-1 text-sm`} style={typoStyle(p)}>
            {items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </Tag>
        );
      }
      case "html":
        // Not rendered live here (admin's own session token lives in this
        // page — unlike the public frontend render, executing arbitrary
        // author HTML in this tab is a needless risk). Real render happens
        // in SectionBlock.astro.
        return (
          <div className="flex h-16 items-center gap-2 rounded-lg border border-dashed border-line/40 bg-canvas/50 px-3 text-[11px] text-sub">
            <Code2 className="h-4 w-4 shrink-0" />
            {p.html ? t("designer-el-html") : `${t("designer-el-html")}…`}
          </div>
        );
      case "gallery": {
        const images = (p.images ?? "").split("\n").filter(Boolean);
        if (images.length === 0)
          return (
            <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-line/50 bg-canvas/50 text-sub">
              <Images className="h-6 w-6" />
            </div>
          );
        return (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${p.columns ?? "3"}, 1fr)` }}>
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                className="aspect-square w-full object-cover"
                style={{ borderRadius: RADIUS[p.radius ?? "md"] }}
              />
            ))}
          </div>
        );
      }
    }
  }

  // section/legacy-block level controls: move up/down, duplicate, delete
  function BlockControls({ b }: { b: number }) {
    return (
      <span className="flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
        <button
          onClick={() => b > 0 && mutate((bs) => bs.splice(b - 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === 0}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
        >
          ↑
        </button>
        <button
          onClick={() => b < blocks.length - 1 && mutate((bs) => bs.splice(b + 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === blocks.length - 1}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
        >
          ↓
        </button>
        <button
          onClick={() => mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])))}
          className="px-0.5 text-accent"
          title={t("designer-duplicate")}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => clipCopy("section", blocks[b])} className="px-0.5 text-accent" title={t("designer-copy")}>
          <Clipboard className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            const data = clipRead<Block>("section");
            if (data) mutate((bs) => bs.splice(b + 1, 0, clone(data)));
          }}
          disabled={!clipHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste")}
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            // rows is the section's content (children), never its "style" —
            // stripped so pasting style elsewhere can't overwrite content.
            const { rows: _rows, ...styleProps } = blocks[b].props as unknown as SectionProps;
            styleCopy("section", styleProps as unknown as Record<string, string>);
          }}
          className="px-0.5 text-accent"
          title={t("designer-copy-style")}
        >
          <Paintbrush className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            const style = styleRead("section");
            if (style) mutate((bs) => Object.assign(bs[b].props, style));
          }}
          disabled={!styleHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button
          onClick={() => {
            mutate((bs) => {
              bs.splice(b, 1);
            });
            setSel(null);
          }}
          className="px-0.5 text-red-500"
          title={t("designer-delete")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    );
  }

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas font-sans text-ink antialiased">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-line/30 bg-white px-4 py-2.5">
        <span className="text-xs font-bold text-ink">
          {page.title as string} <span className="font-mono font-normal text-sub">/{page.slug as string}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            page.status === "published" && !dirty ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
          }`}
        >
          {dirty ? t("designer-dirty") : page.status === "published" ? t("pages-published") : t("pages-draft")}
        </span>
        {msg && <span className="text-[11px] font-semibold text-ok">{msg}</span>}
        {error && <span className="max-w-xs truncate text-[11px] text-red-600">{error}</span>}
        <span className="flex-1" />
        <button
          onClick={undo}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          title="Ctrl+Z"
        >
          <Undo2 className="h-3.5 w-3.5" /> {t("designer-undo")}
        </button>
        <button
          onClick={redo}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          title="Ctrl+Shift+Z"
        >
          <Redo2 className="h-3.5 w-3.5" /> {t("designer-redo")}
        </button>
        <button
          onClick={() => void openTemplates()}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
        >
          <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates")}
        </button>
        <button
          onClick={() => void preview()}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
        </button>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-50"
        >
          {busy ? t("designer-saving") : t("designer-save")}
        </button>
        <button
          onClick={() => void save("published")}
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("designer-publish")}
        </button>
        <button onClick={close} className="rounded-full p-2 text-body hover:bg-canvas" title={t("designer-close")}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* palette */}
        <aside className="w-44 shrink-0 space-y-1.5 overflow-y-auto border-r border-line/30 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-elements")}</p>
          {(Object.keys(ELS) as ElType[]).map((type) => {
            const Icon = ELS[type].icon;
            return (
              <div
                key={type}
                draggable
                onDragStart={(ev) => {
                  drag.current = { kind: "new", type };
                  ev.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => (drag.current = null)}
                className="flex cursor-grab items-center gap-2 rounded-lg border border-line/30 bg-canvas/60 px-2.5 py-2 text-xs font-medium text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
              >
                <Icon className="h-3.5 w-3.5 text-accent" /> {t(ELS[type].labelKey)}
              </div>
            );
          })}
          <p className="pt-2 text-[10px] leading-relaxed text-sub">{t("designer-drop-hint")}</p>
        </aside>

        {/* canvas */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6" onClick={() => setSel(null)}>
          <div className="mx-auto max-w-4xl space-y-4">
            {blocks.length === 0 && <p className="py-10 text-center text-xs text-sub">{t("designer-empty")}</p>}
            {blocks.map((block, b) => {
              if (block.type !== "section") {
                // legacy block from the old BlockBuilder — still rendered by the
                // frontend; movable/deletable here, edited via the old editor.
                return (
                  <div
                    key={b}
                    className={`flex items-center justify-between rounded-xl border border-line/40 bg-white px-4 py-3 text-xs ${selCls([b])}`}
                    onClick={(ev) => pick(ev, [b])}
                  >
                    <span className="font-semibold text-sub">
                      {t("designer-legacy")}: {block.type}
                    </span>
                    <BlockControls b={b} />
                  </div>
                );
              }
              const sp = block.props as unknown as SectionProps;
              const contained = (sp.width ?? "contained") === "contained";
              return (
                <div key={b} className={`group relative rounded-xl ${selCls([b])}`} onClick={(ev) => pick(ev, [b])}>
                  <div className="absolute -top-3 left-3 z-10 hidden items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-[10px] font-bold text-sub shadow-sm group-hover:flex">
                    {t("designer-section")} <BlockControls b={b} />
                  </div>
                  <div
                    className="overflow-hidden rounded-xl border border-line/20"
                    style={{
                      background: sp.bgImage ? `url(${sp.bgImage}) center/cover` : sp.bg || "#ffffff",
                      color: sp.textColor || "inherit",
                      padding: `${lengthValue(sp.paddingY, PAD, PAD.md)} ${lengthValue(sp.paddingX, PAD, "1.5rem")}`,
                      margin: `${lengthValue(sp.marginY, PAD, "0")} 0`,
                      // Only override when the author actually picked a value —
                      // otherwise every existing section would flatten to
                      // square/shadowless corners (RADIUS.none/SHADOW.none)
                      // instead of keeping this wrapper's own default look.
                      ...(sp.border ? { border: BORDER[sp.border] } : {}),
                      ...(sp.shadow ? { boxShadow: SHADOW[sp.shadow] } : {}),
                      ...(sp.radius ? { borderRadius: RADIUS[sp.radius] } : {}),
                    }}
                  >
                    <div className={contained ? "mx-auto max-w-3xl space-y-5" : "space-y-5"}>
                      {(sp.rows ?? []).map((row, r) => (
                        <div
                          key={r}
                          className="grid gap-4"
                          style={{ gridTemplateColumns: row.columns.map((cc) => `${cc.span}fr`).join(" ") }}
                        >
                          {row.columns.map((col, c) => (
                            <div
                              key={c}
                              className={`min-h-[3rem] space-y-3 rounded-lg p-1.5 transition-colors ${selCls([b, r, c])} ${
                                dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""
                              }`}
                              style={colStyle(col.props)}
                              onClick={(ev) => pick(ev, [b, r, c])}
                              onDragOver={(ev) => {
                                ev.preventDefault();
                                setDropHint(`${b}.${r}.${c}`);
                              }}
                              onDragLeave={() => setDropHint(null)}
                              onDrop={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                dropIntoColumn([b, r, c]);
                              }}
                            >
                              {col.elements.length === 0 && (
                                <div className="flex h-12 items-center justify-center rounded-lg border border-dashed border-line/40 text-[10px] font-medium text-sub">
                                  {t("designer-empty-col")}
                                </div>
                              )}
                              {col.elements.map((el, e) => (
                                <div
                                  key={el.id}
                                  draggable
                                  onDragStart={(ev) => {
                                    ev.stopPropagation();
                                    drag.current = { kind: "move", path: [b, r, c, e] };
                                    ev.dataTransfer.effectAllowed = "move";
                                  }}
                                  onDragEnd={() => (drag.current = null)}
                                  onDrop={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    dropIntoColumn([b, r, c], e);
                                  }}
                                  onDragOver={(ev) => ev.preventDefault()}
                                  onClick={(ev) => pick(ev, [b, r, c, e])}
                                  className={`relative cursor-grab rounded-lg p-1 ${selCls([b, r, c, e])}`}
                                  style={el.props.marginY ? { margin: `${lengthValue(el.props.marginY, SPACE, "0")} 0` } : undefined}
                                >
                                  {selEq([b, r, c, e]) && (
                                    <GripVertical className="absolute -left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                                  )}
                                  <ElPreview el={el} />
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))}
                      {/* add-row presets */}
                      <div className="hidden items-center gap-1.5 pt-1 group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
                        <span className="text-[10px] font-semibold text-sub">{t("designer-add-row")}:</span>
                        {ROW_PRESETS.map((preset, i) => (
                          <button
                            key={i}
                            onClick={() =>
                              mutate((bs) =>
                                section(bs, b).rows.push({ columns: preset.map((span) => ({ span, elements: [] })) }),
                              )
                            }
                            className="flex h-6 items-center gap-0.5 rounded border border-line/40 bg-white px-1.5 hover:border-accent"
                            title={preset.join(" : ")}
                          >
                            {preset.map((span, j) => (
                              <span key={j} className="h-3 rounded-sm bg-sub/40" style={{ width: `${span * 5}px` }} />
                            ))}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                mutate((bs) => bs.push(newSection()));
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/50 bg-white/60 py-4 text-xs font-semibold text-body hover:border-accent hover:text-accent"
            >
              <Plus className="h-4 w-4" /> {t("designer-add-section")}
            </button>
          </div>
        </main>

        {/* inspector */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-line/30 bg-white p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-inspector")}</p>
          <Inspector />
        </aside>
      </div>

      {showTemplates && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setShowTemplates(false)}
        >
          <div
            className="max-h-[70vh] w-96 overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{t("designer-templates")}</p>
              <button onClick={() => setShowTemplates(false)} className="text-body hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => void saveAsTemplate()}
              disabled={!sel || sel.length !== 1 || blocks[sel[0]]?.type !== "section" || templatesBusy}
              className="mb-3 flex w-full items-center justify-center gap-1 rounded-full bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-40"
            >
              <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates-save")}
            </button>
            {templates.length === 0 ? (
              <p className="text-xs text-sub">{t("designer-templates-empty")}</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="flex items-center justify-between rounded-lg border border-line/30 px-3 py-2">
                    <span className="truncate text-xs font-medium text-ink">{tpl.name}</span>
                    <span className="flex items-center gap-2">
                      <button onClick={() => insertTemplate(tpl)} className="text-[11px] font-semibold text-accent">
                        {t("designer-templates-insert")}
                      </button>
                      <button
                        onClick={() => void deleteTemplateHandler(tpl.id)}
                        className="text-[11px] font-semibold text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
