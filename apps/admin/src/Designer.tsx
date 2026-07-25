import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  Anchor,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Award,
  BarChart3,
  Baseline,
  Battery,
  Bell,
  Blend,
  Bold,
  Bookmark,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  Car,
  CaseSensitive,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Clock,
  Cloud,
  Code2,
  Coffee,
  Columns,
  Compass,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Dumbbell,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Film,
  Flag,
  Folder,
  Frame,
  Gift,
  Globe,
  GraduationCap,
  GripVertical,
  Handshake,
  Hash,
  Heading1,
  Headphones,
  Heart,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Images,
  Inbox,
  Info,
  Laptop,
  Layers,
  LayoutTemplate,
  Leaf,
  Link,
  Link2,
  List,
  Lock,
  Mail,
  Map,
  MapPin,
  Maximize2,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  Minus,
  Monitor,
  Moon,
  MousePointerClick,
  MoveHorizontal,
  MoveVertical,
  Music,
  Package,
  Paintbrush,
  PaintBucket,
  Palette,
  Pencil,
  Percent,
  Phone,
  PhoneCall,
  PieChart,
  Plane,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RectangleHorizontal,
  Recycle,
  Redo2,
  Rocket,
  Ruler,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquareDashedBottom,
  Star,
  Stethoscope,
  Store,
  Sun,
  Tablet,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  Train,
  Trash2,
  TrendingUp,
  Truck,
  Type,
  Umbrella,
  Undo2,
  Unlock,
  User,
  Users,
  Utensils,
  Video,
  Wallet,
  Wifi,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import * as api from "@/lib/api";
import { slugify, bestTextColor } from "@/lib/utils";
import type { Key } from "@/i18n";
import { moveSection, moveColumn } from "./designerTree";

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

export interface El {
  id: string;
  type: ElType;
  props: Record<string, string>;
  // Breakpoint style overrides, admin-preview only (see Designer's bp
  // toggle) — keyed "tablet:<fieldKey>" / "mobile:<fieldKey>", falling back
  // to props[fieldKey] when absent. Never read by apps/frontend.
  bp?: Record<string, string>;
}
export interface Col {
  span: number;
  elements: El[];
  // Column-level style escape hatch — see COLUMN_FIELDS. Kept as a loose
  // string bag (not a typed interface) to match El.props/SectionProps'
  // convention of storing style values as plain strings.
  props?: Record<string, string>;
  bp?: Record<string, string>;
}
export interface Row {
  columns: Col[];
}
export interface SectionProps {
  bg?: string;
  bgImage?: string;
  textColor?: string;
  paddingY?: string;
  paddingX?: string;
  // Per-side overrides — freedom to set Top/Right/Bottom/Left independently
  // instead of just the Y/X shorthand above. Empty/unset falls back to the
  // matching axis (paddingTop/Bottom -> paddingY, paddingRight/Left ->
  // paddingX), which itself falls back to the PAD table default — same
  // fallback-chain convention as bp overrides.
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  marginY?: string;
  // Per-side overrides for marginY — top/bottom only (no marginX: sections
  // are block-flow, horizontal margin isn't a real concept here). Same
  // fallback convention as padding's per-side keys.
  marginTop?: string;
  marginBottom?: string;
  width?: string;
  border?: string;
  shadow?: string;
  radius?: string;
  // Per-corner overrides, same fallback convention: unset falls back to the
  // single `radius` preset above.
  radiusTopLeft?: string;
  radiusTopRight?: string;
  radiusBottomRight?: string;
  radiusBottomLeft?: string;
  anchorId?: string;
  cssClass?: string;
  rows: Row[];
  bp?: Record<string, string>;
}
export interface Block {
  type: string;
  props: Record<string, unknown>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type FieldKind = "text" | "textarea" | "select" | "color" | "image" | "gallery" | "length" | "icon";
interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
}

// One glyph per field label, so the inspector reads at a glance instead of
// requiring every label to be sounded out — same "icon + short label" idea
// Puck uses throughout its own field list. Not exhaustive on purpose: a field
// with no obvious universal glyph (e.g. free-text href/url) just shows text.
const FIELD_ICONS: Partial<Record<Key, typeof Check>> = {
  "designer-s-bg": PaintBucket,
  "designer-s-bgimage": ImageIcon,
  "designer-s-textcolor": Palette,
  "designer-s-padding": Frame,
  "designer-f-padding": Frame,
  "designer-f-paddingx": Frame,
  "designer-f-marginy": MoveVertical,
  "designer-s-width": RectangleHorizontal,
  "designer-s-border": Square,
  "designer-s-shadow": Blend,
  "designer-f-radius": SquareDashedBottom,
  "designer-f-anchorid": Anchor,
  "designer-f-cssclass": Hash,
  "designer-f-valign": AlignVerticalJustifyCenter,
  "designer-col-span": Columns,
  "designer-f-text": Type,
  "designer-f-level": Heading1,
  "designer-f-align": AlignLeft,
  "designer-f-size": Ruler,
  "designer-f-src": ImageIcon,
  "designer-f-alt": CaseSensitive,
  "designer-f-label": Type,
  "designer-f-href": Link,
  "designer-f-variant": SlidersHorizontal,
  "designer-f-height": MoveVertical,
  "designer-f-url": Link,
  "designer-f-ratio": RectangleHorizontal,
  "designer-f-icon-name": Star,
  "designer-f-icon-size": Maximize2,
  "designer-f-icon-color": Palette,
  "designer-f-list-items": List,
  "designer-f-list-style": List,
  "designer-f-html": Code2,
  "designer-f-gallery-images": Images,
  "designer-f-gallery-columns": Columns,
  "designer-f-fontfamily": Baseline,
  "designer-f-lineheight": MoveVertical,
  "designer-f-letterspacing": MoveHorizontal,
  "designer-f-fontweight": Bold,
};
function FieldLabel(labelKey: Key, t: (k: Key) => string) {
  const Icon = FIELD_ICONS[labelKey];
  return (
    <>
      {Icon && <Icon className="mr-1 inline-block h-3 w-3 shrink-0 -translate-y-px align-middle text-sub" />}
      {t(labelKey)}
    </>
  );
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
  menu: Menu,
  home: Home,
  search: Search,
  user: User,
  users: Users,
  settings: Settings,
  bell: Bell,
  heart: Heart,
  share: Share2,
  bookmark: Bookmark,
  eye: Eye,
  "eye-off": EyeOff,
  lock: Lock,
  unlock: Unlock,
  shield: Shield,
  "shield-check": ShieldCheck,
  globe: Globe,
  link: Link2,
  "check-circle": CheckCircle,
  "x-circle": XCircle,
  "alert-triangle": AlertTriangle,
  "alert-circle": AlertCircle,
  info: Info,
  "help-circle": HelpCircle,
  "thumbs-up": ThumbsUp,
  "thumbs-down": ThumbsDown,
  gift: Gift,
  tag: Tag,
  flag: Flag,
  award: Award,
  "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  "credit-card": CreditCard,
  "dollar-sign": DollarSign,
  percent: Percent,
  wallet: Wallet,
  receipt: Receipt,
  store: Store,
  package: Package,
  truck: Truck,
  briefcase: Briefcase,
  building: Building2,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  send: Send,
  inbox: Inbox,
  archive: Archive,
  "at-sign": AtSign,
  "phone-call": PhoneCall,
  camera: Camera,
  video: Video,
  music: Music,
  mic: Mic,
  image: ImageIcon,
  "file-text": FileText,
  folder: Folder,
  printer: Printer,
  film: Film,
  smartphone: Smartphone,
  monitor: Monitor,
  laptop: Laptop,
  tablet: Tablet,
  headphones: Headphones,
  wifi: Wifi,
  battery: Battery,
  cloud: Cloud,
  "qr-code": QrCode,
  sun: Sun,
  moon: Moon,
  umbrella: Umbrella,
  compass: Compass,
  map: Map,
  car: Car,
  plane: Plane,
  train: Train,
  rocket: Rocket,
  coffee: Coffee,
  utensils: Utensils,
  dumbbell: Dumbbell,
  stethoscope: Stethoscope,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  "trending-up": TrendingUp,
  "bar-chart": BarChart3,
  "pie-chart": PieChart,
  activity: Activity,
  zap: Zap,
  handshake: Handshake,
  target: Target,
  recycle: Recycle,
  leaf: Leaf,
  sparkles: Sparkles,
  "chevron-left": ChevronLeft,
  "chevron-down": ChevronDown,
  "arrow-up-right": ArrowUpRight,
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
  {
    key: "textTransform",
    labelKey: "designer-f-texttransform",
    kind: "select",
    options: ["none", "uppercase", "lowercase", "capitalize"],
  },
  { key: "fontStyle", labelKey: "designer-f-fontstyle", kind: "select", options: ["normal", "italic"] },
  {
    key: "textDecoration",
    labelKey: "designer-f-textdecoration",
    kind: "select",
    options: ["none", "underline", "line-through"],
  },
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
    defaults: { text: "", size: "1rem", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "size", labelKey: "designer-f-size", kind: "length" },
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
      // radius edited via FourSideControl (element Inspector) — see Designer.tsx's ELS-radius branch.
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
    defaults: { url: "", ratio: "16:9", radius: "md" },
    fields: [
      { key: "url", labelKey: "designer-f-url", kind: "text" },
      { key: "ratio", labelKey: "designer-f-ratio", kind: "select", options: ["16:9", "4:3", "1:1"] },
      // radius edited via FourSideControl (element Inspector) — see Designer.tsx's ELS-radius branch.
      { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
    ],
  },
  icon: {
    labelKey: "designer-el-icon",
    icon: Star,
    defaults: { name: "check", size: "1.5rem", color: "", align: "left" },
    fields: [
      { key: "name", labelKey: "designer-f-icon-name", kind: "icon", options: Object.keys(ICONS) },
      { key: "size", labelKey: "designer-f-icon-size", kind: "length" },
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
      // radius edited via FourSideControl (element Inspector) — see Designer.tsx's ELS-radius branch.
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
  // paddingY/paddingX/radius/marginY are edited via the FourSideControl
  // composites (top-level "Padding"/"Border Radius"/"Margin" panels) instead
  // of a plain row here.
  { key: "width", labelKey: "designer-s-width", kind: "select", options: ["contained", "full"] },
  { key: "border", labelKey: "designer-s-border", kind: "select", options: ["none", "thin", "thick"] },
  { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
  { key: "anchorId", labelKey: "designer-f-anchorid", kind: "text" },
  { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" },
];

// Column-level style escape hatch (see Col.props) — a column becomes a
// themeable "card" once bg/padding/border/shadow/radius are set, covering
// what would otherwise need a dedicated Card/Testimonial element.
const COLUMN_FIELDS: Field[] = [
  { key: "bg", labelKey: "designer-s-bg", kind: "color" },
  // padding/radius/marginY are edited via the FourSideControl composites
  // (same as SECTION_FIELDS) instead of a plain row here.
  { key: "valign", labelKey: "designer-f-valign", kind: "select", options: ["top", "center", "bottom"] },
  { key: "border", labelKey: "designer-s-border", kind: "select", options: ["none", "thin", "thick"] },
  { key: "shadow", labelKey: "designer-s-shadow", kind: "select", options: ["none", "sm", "md", "lg"] },
  { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" },
];
// Bp-merge list for bpColStyle() — covers the base padding/radius fields plus
// their per-side/per-corner overrides, none of which are in COLUMN_FIELDS
// (they're edited via FourSideControl, not the flat Inspector list).
const COLUMN_SPACING_KEYS = [
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft",
  "marginY", "marginTop", "marginBottom",
];

// Standalone fields appended to every element's own type-specific fields
// (matches the two <label> blocks the flat Inspector used to hard-code after
// def.fields — hoisted so the grouped Inspector can bucket them like any
// other field instead of rendering them as a special tail case).
const CSS_CLASS_FIELD: Field = { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" };

// Grouped Styles panel (Framer/Webflow-style): buckets the same flat Field
// lists (SECTION_FIELDS/COLUMN_FIELDS/ELS[type].fields) into collapsible
// sections by what the field actually controls, instead of one long form.
// Keyed by field.key since that's stable across section/column/element,
// unlike labelKey which a few fields share for unrelated purposes.
type FieldGroupKey = "content" | "typography" | "background" | "spacing" | "size" | "border" | "advanced";

const FIELD_GROUP_BY_KEY: Record<string, FieldGroupKey> = {
  text: "content", src: "content", alt: "content", href: "content", label: "content",
  url: "content", name: "content", items: "content", html: "content", images: "content",
  variant: "content", style: "content",
  fontFamily: "typography", color: "typography", lineHeight: "typography",
  letterSpacing: "typography", fontWeight: "typography", level: "typography", align: "typography",
  textTransform: "typography", fontStyle: "typography", textDecoration: "typography",
  bg: "background", bgImage: "background", textColor: "background",
  paddingY: "spacing", paddingX: "spacing", padding: "spacing", marginY: "spacing",
  width: "size", valign: "size", height: "size", ratio: "size", columns: "size", size: "size",
  border: "border", shadow: "border", radius: "border",
  anchorId: "advanced", cssClass: "advanced",
};

const GROUP_META: { key: FieldGroupKey; labelKey: Key; icon: typeof Type }[] = [
  { key: "content", labelKey: "designer-group-content", icon: Type },
  { key: "typography", labelKey: "designer-group-typography", icon: Baseline },
  { key: "background", labelKey: "designer-group-background", icon: PaintBucket },
  { key: "spacing", labelKey: "designer-group-spacing", icon: Frame },
  { key: "size", labelKey: "designer-group-size", icon: RectangleHorizontal },
  { key: "border", labelKey: "designer-group-border", icon: Square },
  { key: "advanced", labelKey: "designer-group-advanced", icon: Hash },
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

// Figma-style spacing overlay: turns a resolved CSS length ("3rem", "24px",
// "0") into the rounded px number shown on the badge. rem assumed at the
// browser default 16px root — this editor doesn't let authors change that.
function pxLabel(len: string): string {
  if (len === "0" || len === "0px") return "0";
  const rem = /^(-?[\d.]+)rem$/.exec(len);
  if (rem) return `${Math.round(parseFloat(rem[1]) * 16)}`;
  const px = /^(-?[\d.]+)px$/.exec(len);
  if (px) return `${Math.round(parseFloat(px[1]))}`;
  return len;
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
type Drag =
  | { kind: "new"; type: ElType }
  | { kind: "move"; path: number[] }
  | { kind: "tree-reorder"; treeKind: "section" | "column"; path: number[] };

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
// Matches apps/frontend/global.css's h1 vs h2-h6 rule: h1 reads the theme's
// heading font, everything smaller reads subheading (falling back to heading,
// then the body font). Was previously a hardcoded "font-display" Tailwind
// class (always "Space Grotesk") — no per-tenant theme could ever override it.
function headingFontFamily(level: string | undefined): string {
  return level === "1"
    ? "var(--font-heading, var(--font-family, inherit))"
    : "var(--font-subheading, var(--font-heading, var(--font-family, inherit)))";
}

function typoStyle(p: Record<string, string>): React.CSSProperties {
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

function colStyle(cp?: Record<string, string>): React.CSSProperties {
  if (!cp) return {};
  const anyPadding = cp.padding || cp.paddingTop || cp.paddingRight || cp.paddingBottom || cp.paddingLeft;
  const padSide = (per: string) => lengthValue(cp[per] || cp.padding, PAD, "0");
  const anyRadius = cp.radius || cp.radiusTopLeft || cp.radiusTopRight || cp.radiusBottomRight || cp.radiusBottomLeft;
  const radCorner = (per: string) => lengthValue(cp[per] || cp.radius, RADIUS, RADIUS.none);
  const anyMargin = cp.marginY || cp.marginTop || cp.marginBottom;
  const marginSide = (per: string) => lengthValue(cp[per] || cp.marginY, PAD, "0");
  return {
    background: cp.bg || undefined,
    padding: anyPadding
      ? `${padSide("paddingTop")} ${padSide("paddingRight")} ${padSide("paddingBottom")} ${padSide("paddingLeft")}`
      : undefined,
    margin: anyMargin ? `${marginSide("marginTop")} 0 ${marginSide("marginBottom")} 0` : undefined,
    alignSelf: cp.valign === "top" ? "start" : cp.valign === "bottom" ? "end" : cp.valign === "center" ? "center" : undefined,
    border: cp.border ? BORDER[cp.border] : undefined,
    boxShadow: cp.shadow ? SHADOW[cp.shadow] : undefined,
    borderRadius: anyRadius
      ? `${radCorner("radiusTopLeft")} ${radCorner("radiusTopRight")} ${radCorner("radiusBottomRight")} ${radCorner("radiusBottomLeft")}`
      : undefined,
  };
}

// Element radius (image/embed/gallery): same per-corner freedom as Section/
// Column, but these elements default to a rounded "md" look out of the box
// (see their ELS defaults), so the fallback is RADIUS.md, not RADIUS.none.
function elRadius(p: Record<string, string>): string {
  const corner = (per: string) => lengthValue(p[per] || p.radius, RADIUS, RADIUS.md);
  return `${corner("radiusTopLeft")} ${corner("radiusTopRight")} ${corner("radiusBottomRight")} ${corner("radiusBottomLeft")}`;
}

// Hatched spacing-overlay band: shown while a padding/margin drag handle is
// selected so the actual area being resized is visible, not just its number.
// `outward` distinguishes margin (space outside the box) from padding (space
// inside it) — same idea as the browser devtools box model, which is also
// why the two get different stripe colors (blue padding, orange margin):
// same color on both made it hard to tell which one was being dragged.
const SPACING_STRIPE =
  "repeating-linear-gradient(45deg, rgba(0,113,227,0.35) 0px, rgba(0,113,227,0.35) 6px, rgba(0,113,227,0.12) 6px, rgba(0,113,227,0.12) 12px)";
const MARGIN_STRIPE =
  "repeating-linear-gradient(45deg, rgba(245,158,11,0.35) 0px, rgba(245,158,11,0.35) 6px, rgba(245,158,11,0.12) 6px, rgba(245,158,11,0.12) 12px)";
function spacingBand(edge: "top" | "bottom" | "left" | "right", px: number, outward = false) {
  if (!px) return null;
  const offset = outward ? -px : 0;
  const style: React.CSSProperties =
    edge === "top"
      ? { left: 0, right: 0, height: px, top: offset }
      : edge === "bottom"
        ? { left: 0, right: 0, height: px, bottom: offset }
        : edge === "left"
          ? { top: 0, bottom: 0, width: px, left: offset }
          : { top: 0, bottom: 0, width: px, right: offset };
  return (
    <div className="pointer-events-none absolute z-10" style={{ ...style, backgroundImage: outward ? MARGIN_STRIPE : SPACING_STRIPE }} />
  );
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
  // The Blocks/Live-Edit canvas used to be an iframe of the real frontend, so
  // it always showed the tenant's actual theme colors/fonts. Once that became
  // an in-app canvas (see mode === "live" below), it lost that for-free theme
  // parity — this fetches the same merged theme apps/frontend reads and
  // reapplies it as the same CSS custom properties BaseLayout.astro sets, so
  // the canvas approximates the real site again instead of always showing
  // Tailwind's default white/black.
  const [siteTheme, setSiteTheme] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    api.getTheme(tenantHost, token).then(setSiteTheme).catch(() => {});
  }, [tenantHost, token]);
  const [sel, setSel] = useState<Sel>(null);
  const [activeLeftTab, setActiveLeftTab] = useState<"elements" | "layers">("elements");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Grouped Styles panel: which Inspector field-groups are collapsed. Shared
  // across every selection (not reset per-select) — matches Framer/Webflow,
  // where collapsing "Typography" stays collapsed while you click around.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<FieldGroupKey>>(new Set(["advanced"]));
  // Four-side padding/radius controls (section Inspector): linked = one input
  // sets all 4 sides/corners equal; unlinked = Top/Right/Bottom/Left edited
  // independently. UI-only toggle, not persisted — doesn't change what's
  // already stored, only which input(s) are shown.
  const [linkedPadding, setLinkedPadding] = useState(true);
  const [linkedRadius, setLinkedRadius] = useState(true);
  const [linkedMargin, setLinkedMargin] = useState(true);
  function toggleGroup(g: FieldGroupKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  // Breakpoint edit mode — admin-preview only (Framer-style Desktop/Tablet/
  // Mobile toggle). Narrows the canvas width and routes Inspector field
  // edits into each node's `bp` override bag instead of its base props.
  // apps/frontend never reads `bp` — the real site is unaffected, this is
  // purely how the page looks/edits inside this Designer session.
  const [bp, setBp] = useState<"desktop" | "tablet" | "mobile">("desktop");
  function bpKey(key: string) {
    return `${bp}:${key}`;
  }
  function bpGetValue(base: string | undefined, overrides: Record<string, string> | undefined, key: string) {
    if (bp !== "desktop") {
      const ov = overrides?.[bpKey(key)];
      if (ov !== undefined) return ov;
    }
    return base ?? "";
  }
  // Canvas-preview equivalents of bpGetValue — resolve the active
  // breakpoint's overrides into the same style objects colStyle()/the
  // section wrapper/element margin already compute from desktop props.
  // Resolves one side/corner of a four-side control: its own override (bp-
  // aware) if set, else the shared axis/preset field's value (also bp-aware).
  // Generic version of fourSideValue()/setFourSideValue() below — same
  // fallback-chain resolution, but for any props/bp bag (Section, Column, or
  // Element), not just SectionProps.
  function sideValue(props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string): string {
    const raw = bpGetValue(props?.[perSideKey], bpBag, perSideKey);
    return raw || bpGetValue(props?.[fallbackKey], bpBag, fallbackKey);
  }
  function fourSideValue(sp: SectionProps, perSideKey: string, fallbackKey: string): string {
    return sideValue(sp as unknown as Record<string, string>, sp.bp, perSideKey, fallbackKey);
  }
  function setFourSideValue(b: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const block = bs[b];
      if (bp === "desktop") {
        (block.props as Record<string, unknown>)[perSideKey] = value;
      } else {
        const props = block.props as unknown as SectionProps;
        props.bp = { ...(props.bp ?? {}), [bpKey(perSideKey)]: value };
      }
    });
  }
  function setColSideValue(b: number, r: number, c: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c];
      if (bp === "desktop") target.props = { ...(target.props ?? {}), [perSideKey]: value };
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function setElSideValue(b: number, r: number, c: number, e: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c].elements[e];
      if (bp === "desktop") target.props[perSideKey] = value;
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  // Canvas drag-to-resize write for a four-side control: when `linked` is on
  // (the chain-icon toggle), one dragged handle must move all sides together
  // — same rule as the Inspector's linked input, which fans the same value
  // out to every side key. `target` is already the cloned-next-state node
  // (from startSpacingDrag's `apply` callback), mutated in place.
  function writeDragSideKeys(
    target: { props?: Record<string, string>; bp?: Record<string, string> },
    keys: readonly string[],
    activeKey: string,
    px: number,
    linked: boolean,
  ) {
    const touched = linked ? keys : [activeKey];
    if (bp === "desktop") {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[k] = `${px}px`;
      target.props = { ...(target.props ?? {}), ...patch };
    } else {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[bpKey(k)] = `${px}px`;
      target.bp = { ...(target.bp ?? {}), ...patch };
    }
  }
  const PADDING_SIDE_KEYS = { top: "paddingTop", right: "paddingRight", bottom: "paddingBottom", left: "paddingLeft" } as const;
  const PADDING_SIDE_FALLBACK = { top: "paddingY", right: "paddingX", bottom: "paddingY", left: "paddingX" } as const;
  // Margin has no X axis (block-flow spacing only, always 0 horizontally) —
  // just top/bottom, both falling back to the single shared marginY value.
  const MARGIN_SIDE_KEYS = { top: "marginTop", bottom: "marginBottom" } as const;
  const RADIUS_CORNER_KEYS = {
    top: "radiusTopLeft",
    right: "radiusTopRight",
    bottom: "radiusBottomRight",
    left: "radiusBottomLeft",
  } as const;
  function sectionBpStyle(sp: SectionProps): React.CSSProperties {
    const v = (key: string) => bpGetValue((sp as unknown as Record<string, string>)[key], sp.bp, key);
    const bgImage = v("bgImage");
    const border = v("border");
    const shadow = v("shadow");
    const side = (side: keyof typeof PADDING_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]), PAD, side === "top" || side === "bottom" ? PAD.md : "1.5rem");
    const corner = (side: keyof typeof RADIUS_CORNER_KEYS) => {
      const raw = fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius");
      return lengthValue(raw, RADIUS, RADIUS.none);
    };
    const marginSide = (side: keyof typeof MARGIN_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], "marginY"), PAD, "0");
    return {
      background: bgImage ? `url(${bgImage}) center/cover` : v("bg") || "var(--color-bg, #ffffff)",
      color: v("textColor") || "inherit",
      padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}`,
      margin: `${marginSide("top")} 0 ${marginSide("bottom")} 0`,
      ...(border ? { border: BORDER[border] } : {}),
      ...(shadow ? { boxShadow: SHADOW[shadow] } : {}),
      borderRadius: `${corner("top")} ${corner("right")} ${corner("bottom")} ${corner("left")}`,
    };
  }
  function bpColStyle(col: Col): React.CSSProperties {
    if (bp === "desktop" || !col.bp) return colStyle(col.props);
    const merged: Record<string, string> = { ...(col.props ?? {}) };
    for (const key of [...COLUMN_FIELDS.map((f) => f.key), ...COLUMN_SPACING_KEYS]) {
      const ov = col.bp[bpKey(key)];
      if (ov !== undefined) merged[key] = ov;
    }
    return colStyle(merged);
  }
  function bpMarginStyle(el: El): React.CSSProperties | undefined {
    const top = sideValue(el.props, el.bp, MARGIN_SIDE_KEYS.top, "marginY");
    const bottom = sideValue(el.props, el.bp, MARGIN_SIDE_KEYS.bottom, "marginY");
    if (!top && !bottom) return undefined;
    return { margin: `${lengthValue(top, SPACE, "0")} 0 ${lengthValue(bottom, SPACE, "0")} 0` };
  }
  // Universal per-element padding — every element type gets it (unlike
  // radius, which only makes visual sense on image/embed/gallery), same
  // per-side/fallback convention as Column's padding.
  function bpPaddingStyle(el: El): React.CSSProperties | undefined {
    const has = (k: string) => bpGetValue(el.props[k], el.bp, k);
    if (!has("padding") && !has("paddingTop") && !has("paddingRight") && !has("paddingBottom") && !has("paddingLeft")) {
      return undefined;
    }
    const side = (s: keyof typeof PADDING_SIDE_KEYS) => lengthValue(sideValue(el.props, el.bp, PADDING_SIDE_KEYS[s], "padding"), PAD, "0");
    return { padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}` };
  }
  const [treeDropHint, setTreeDropHint] = useState<{ key: string; pos: "before" | "after" } | null>(null);
  // Reported by BaseLayout.astro's designer:selectedRect message — the
  // selected node's on-screen box inside the iframe, used to position
  // LiveEditToolbar. Cleared below whenever `sel` itself changes so a stale
  // rect never positions the toolbar over the wrong element while the new
  // one's first report is in flight.
  const [selectedRect, setSelectedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  // Bumped by every structural (shape/order-changing) mutate() call reachable
  // from Live Edit — duplicate/paste/delete at any level, plus the iframe's
  // own drag-reorder. Live Edit's iframe is a real server-rendered page, not
  // a local render of `blocks`, so unlike a prop/style edit (already synced
  // live via the designer:style postMessage effect below) a shape change
  // needs an actual reload to become visible — debounced further down so a
  // burst of edits reloads once, not per action.
  const [structuralTick, setStructuralTick] = useState(0);
  function bumpStructural() {
    setStructuralTick((n) => n + 1);
  }
  const lastScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  const lastNonTextSig = useRef<string | null>(null);
  // True from the moment any iframe (re)load starts (initial open, mode
  // toggle back into Live, or a debounced structural/style reload) until
  // its onLoad fires — covers the skeleton overlay below so a reload never
  // shows the browser's own blank-frame flash, however brief.
  const [reloading, setReloading] = useState(true);
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
  const [ctxMenu, setCtxMenu] = useState<{ path: number[]; x: number; y: number } | null>(null);
  const [iconSearch, setIconSearch] = useState("");
  const [mode, setMode] = useState<"blocks" | "live">("blocks");
  // Double-buffered iframe pair: the inactive slot loads a reload's new
  // content off-screen (opacity 0, pointer-events none) and only swaps to
  // visible once its onLoad fires, so the visible iframe is never mid-
  // navigation — that's the actual source of any reload "blink", not skeleton
  // speed. swapPending names which slot a hot-swap (not a cold mount) is
  // waiting on; handleFrameLoad() below is the single place that resolves it.
  const [liveSrcA, setLiveSrcA] = useState<string | null>(null);
  const [liveSrcB, setLiveSrcB] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const swapPending = useRef<"a" | "b" | null>(null);
  const liveSrc = activeSlot === "a" ? liveSrcA : liveSrcB;
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(page.slug as string);
  const [slugError, setSlugError] = useState<string | null>(null);
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  const drag = useRef<Drag | null>(null);
  const editingText = useRef<Record<string, string>>({});
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const liveFrame = activeSlot === "a" ? frameARef : frameBRef;

  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    const next = clone(blocks);
    fn(next);
    setBlocks(next);
    setDirty(true);
  }

  // Figma-style drag-to-resize for the spacing-overlay badges: one history
  // entry for the whole drag (pushed once, up front) instead of one per
  // mousemove — every subsequent move re-derives the full next value from
  // the drag's start snapshot and overwrites, rather than accumulating.
  function startSpacingDrag(
    e: React.MouseEvent,
    startPx: number,
    axis: "x" | "y",
    sign: 1 | -1,
    apply: (next: Block[], px: number) => void,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const base = clone(blocks);
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    function onMove(ev: MouseEvent) {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      const px = Math.max(0, Math.round(startPx + sign * (pos - startPos)));
      const next = clone(base);
      apply(next, px);
      setBlocks(next);
      setDirty(true);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(clone(blocks));
    setBlocks(prev);
    setSel(null);
    setDirty(true);
    bumpStructural();
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(blocks));
    setBlocks(next);
    setSel(null);
    setDirty(true);
    bumpStructural();
  }

  useEffect(() => {
    setSelectedRect(null);
  }, [sel]);

  // Auto-expand the Layers tree around the current selection so switching to
  // the tab, or changing selection via the canvas/Live Edit, always reveals
  // the selected row without requiring a manual expand-click first.
  useEffect(() => {
    if (!sel) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= sel.length; i++) next.add(sel.slice(0, i).join("."));
      return next;
    });
  }, [sel]);

  // Forces a re-render on window resize so LiveEditToolbar's position (which
  // reads liveFrame.current.getBoundingClientRect() directly at render time,
  // not from state) picks up the iframe's new page position even when
  // selectedRect itself hasn't changed.
  const [, bumpLayoutTick] = useState(0);
  useEffect(() => {
    const onResize = () => bumpLayoutTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Debounced reload for structural Live Edit changes (see bumpStructural
  // above) — waits for a pause in activity so a fast burst (e.g. several
  // deletes in a row) reloads once. enterLive() already saves when dirty and
  // mints a fresh preview token, which is what actually forces the iframe to
  // reload; the scroll position is restored once the reloaded iframe reports
  // back in (see the iframe's onLoad handler further down).
  useEffect(() => {
    if (structuralTick === 0 || mode !== "live") return;
    const timer = setTimeout(() => {
      pendingScrollRestore.current = lastScrollY.current;
      void enterLive().catch((err) => setError((err as Error).message));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralTick]);

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

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Live-view bridge: the iframe's window posts these (see BaseLayout.astro's
  // inline script) — a click there selects exactly like a click in the block
  // canvas (same `sel`, same Inspector), and typing in an editable text node
  // there commits through the same mutate() path the Inspector textarea uses.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (e.data?.type === "designer:selectedRect") {
        setSelectedRect(e.data.rect ?? null);
        return;
      }
      if (e.data?.type === "designer:iframeClick") {
        setCtxMenu(null);
        return;
      }
      if (e.data?.type === "designer:scroll") {
        lastScrollY.current = Number(e.data.y ?? 0);
        return;
      }
      if (e.data?.type === "designer:undo") {
        undo();
        return;
      }
      if (e.data?.type === "designer:redo") {
        redo();
        return;
      }
      if (e.data?.type === "designer:contextmenu") {
        const p = String(e.data.path ?? "")
          .split(".")
          .map(Number);
        if (p.length !== 4 || !liveFrame.current) return;
        const rect = liveFrame.current.getBoundingClientRect();
        setSel(p);
        setCtxMenu({ path: p, x: rect.left + Number(e.data.x ?? 0), y: rect.top + Number(e.data.y ?? 0) });
        return;
      }
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
        const [b, r, c, el] = path;
        mutate((bs) => {
          section(bs, b).rows[r].columns[c].elements[el].props.text = e.data.value ?? "";
        });
      } else if (e.data?.type === "designer:reorder") {
        const from = String(e.data.from).split(".").map(Number);
        const to = String(e.data.to).split(".").map(Number);
        // Path depth is the drag's kind (1=section, 3=column, 4=element) — a
        // drag can only ever hover a same-depth target (BaseLayout.astro's
        // pointermove only sets hoverPath when the target's depth matches
        // dragState's), so a mismatch here means a stale/cross-kind message
        // and must be a no-op, never a guess at which branch to take.
        if (from.length !== to.length) return;
        if (from.length === 4) {
          mutate((bs) => {
            const [tb, tr, tc, te] = to;
            let idx = te + (e.data.position === "after" ? 1 : 0);
            // same-column move: removing the source first shifts later indexes
            // down — same adjustment dropIntoColumn already makes for the
            // block-canvas drag.
            if (from[0] === tb && from[1] === tr && from[2] === tc && from[3] < idx) idx--;
            const el = removeAt(bs, from);
            insertEl(bs, [tb, tr, tc], el, idx);
          });
        } else if (from.length === 3) {
          // Column reorder is scoped to within its own row — a row's
          // grid-template-columns and each column's span are only meaningful
          // there, same restriction the Layers tree's drag-reorder applies.
          if (from[0] !== to[0] || from[1] !== to[1]) return;
          let idx = to[2] + (e.data.position === "after" ? 1 : 0);
          if (from[2] < idx) idx--;
          mutate((bs) => moveColumn(bs, from[0], from[1], from[2], idx));
        } else if (from.length === 1) {
          let idx = to[0] + (e.data.position === "after" ? 1 : 0);
          if (from[0] < idx) idx--;
          mutate((bs) => moveSection(bs, from[0], idx));
        } else {
          return;
        }
        setSel(null);
        bumpStructural();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  // Keeps the live iframe's selection highlight/editability/inline style in
  // sync with the Inspector — reuses the exact same style helpers the block
  // canvas preview uses (typoStyle/colStyle/lengthValue), so style logic
  // isn't computed a third time.
  useEffect(() => {
    if (mode !== "live" || !liveSrc || !liveFrame.current?.contentWindow) return;
    const win = liveFrame.current.contentWindow;
    const targetOrigin = new URL(liveSrc, window.location.href).origin;
    // Right after a reload/slot-swap sets a new src, this iframe's
    // contentWindow briefly still belongs to the admin's own origin (the
    // navigation to targetOrigin hasn't completed yet) — postMessage throws
    // synchronously on that transient mismatch instead of silently no-op'ing.
    // Harmless to skip: the next render (once navigation completes, or once
    // sel/blocks changes again) re-sends the same sync.
    const post = (msg: unknown) => {
      try {
        win.postMessage(msg, targetOrigin);
      } catch {
        /* transient cross-origin mismatch during reload — see comment above */
      }
    };
    post({ type: "designer:selected", path: sel?.join(".") ?? null });
    if (!sel) return;
    const path = sel.join(".");
    if (sel.length === 4) {
      const [b, r, c, e] = sel;
      const el = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c]?.elements?.[e];
      if (!el) return;
      const textLike = el.type === "heading" || el.type === "text" || el.type === "list";
      if (!textLike) {
        // Non-text element types (button/image/icon/spacer/...) each render
        // bespoke CSS in ElPreview/SectionBlock.astro — there's no single
        // props-to-CSS mapping to reuse here, so a style change (paste
        // style, or an Inspector field edit) falls back to the same
        // debounced reload structural edits use instead of silently posting
        // no visible change. Guarded by a signature so the reload this
        // itself triggers (liveSrc changing re-runs this effect against the
        // same still-selected element) doesn't bump again and loop forever.
        const sig = `${path}:${JSON.stringify(el.props)}`;
        if (lastNonTextSig.current !== sig) {
          lastNonTextSig.current = sig;
          bumpStructural();
        }
        return;
      }
      const style = typoStyle(el.props);
      post({ type: "designer:style", path, style });
      post({ type: "designer:text", path, editable: el.type === "heading" || el.type === "text" });
    } else if (sel.length === 3) {
      const [b, r, c] = sel;
      const col = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c];
      if (!col) return;
      post({ type: "designer:style", path, style: colStyle(col.props) });
    } else if (sel.length === 1) {
      const sp = blocks[sel[0]]?.props as unknown as SectionProps;
      if (!sp) return;
      const style: React.CSSProperties = {
        background: sp.bgImage ? undefined : sp.bg || undefined,
        color: sp.textColor || undefined,
        padding: `${lengthValue(sp.paddingY, PAD, PAD.md)} ${lengthValue(sp.paddingX, PAD, "1.5rem")}`,
        margin: `${lengthValue(sp.marginY, PAD, "0")} 0`,
        ...(sp.border ? { border: BORDER[sp.border] } : {}),
        ...(sp.shadow ? { boxShadow: SHADOW[sp.shadow] } : {}),
        ...(sp.radius ? { borderRadius: RADIUS[sp.radius] } : {}),
      };
      post({ type: "designer:style", path, style });
    }
  }, [mode, sel, blocks, liveSrc]);

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

  // Saveable at any selection depth — sel[0] is always the containing
  // section's index regardless of depth, so this derives which level
  // (section/column/element) the current selection actually points at.
  function templateKind(): "section" | "column" | "element" | null {
    if (!sel || blocks[sel[0]]?.type !== "section") return null;
    return sel.length === 1 ? "section" : sel.length === 3 ? "column" : sel.length === 4 ? "element" : null;
  }

  async function saveAsTemplate() {
    const kind = templateKind();
    if (!kind || !sel) return;
    const value: unknown =
      kind === "section"
        ? blocks[sel[0]]
        : kind === "column"
          ? section(blocks, sel[0]).rows[sel[1]].columns[sel[2]]
          : section(blocks, sel[0]).rows[sel[1]].columns[sel[2]].elements[sel[3]];
    const name = prompt(t("designer-templates-save-prompt"));
    if (!name) return;
    setTemplatesBusy(true);
    try {
      await api.createTemplate(tenantHost, token, name, { kind, value } as unknown as Record<string, unknown>);
      setTemplates(await api.listTemplates(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  // Pre-migration rows have no `kind`/`value` wrapper — `data` itself was
  // the raw section block, so a missing `kind` falls back to that shape.
  function insertTemplate(tpl: api.DesignTemplate) {
    const kind = tpl.data?.kind as "section" | "column" | "element" | undefined;
    const value = kind ? tpl.data.value : tpl.data;
    if (kind === "column" || kind === "element") {
      if (!sel || sel.length < 3) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const [b, r, c, e] = sel;
      if (kind === "column") {
        mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(value) as Col));
      } else {
        const index = sel.length === 4 ? e + 1 : section(blocks, b).rows[r].columns[c].elements.length;
        mutate((bs) => insertEl(bs, [b, r, c], { ...(clone(value) as El), id: uid() }, index));
      }
    } else {
      mutate((bs) => bs.push(clone(value) as unknown as Block));
    }
    bumpStructural();
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

  // Extracted from BlockControls/Inspector's inline closures so both those
  // and LiveEditToolbar (Live Edit mode) call one shared implementation per
  // action+level instead of re-deriving the same splice/clip logic.
  function duplicateSection(b: number) {
    mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])));
    bumpStructural();
  }
  function copySection(b: number) {
    clipCopy("section", blocks[b]);
  }
  function pasteSection(b: number) {
    const data = clipRead<Block>("section");
    if (data) {
      mutate((bs) => bs.splice(b + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleSection(b: number) {
    // rows is the section's content (children), never its "style" —
    // stripped so pasting style elsewhere can't overwrite content.
    const { rows: _rows, ...styleProps } = blocks[b].props as unknown as SectionProps;
    styleCopy("section", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleSection(b: number) {
    const style = styleRead("section");
    if (style) mutate((bs) => Object.assign(bs[b].props, style));
  }
  function deleteSection(b: number) {
    mutate((bs) => {
      bs.splice(b, 1);
    });
    setSel(null);
    bumpStructural();
  }

  function copyColumn(b: number, r: number, c: number) {
    clipCopy("column", section(blocks, b).rows[r].columns[c]);
  }
  function pasteColumn(b: number, r: number, c: number) {
    const data = clipRead<Col>("column");
    if (data) {
      mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleColumn(b: number, r: number, c: number) {
    styleCopy("column", section(blocks, b).rows[r].columns[c].props ?? {});
  }
  function pasteStyleColumn(b: number, r: number, c: number) {
    const style = styleRead("column");
    if (style)
      mutate((bs) => {
        const target = section(bs, b).rows[r].columns[c];
        target.props = { ...(target.props ?? {}), ...style };
      });
  }
  function deleteColumn(b: number, r: number, c: number) {
    mutate((bs) => {
      const row = section(bs, b).rows[r];
      row.columns.splice(c, 1);
      if (row.columns.length === 0) section(bs, b).rows.splice(r, 1);
    });
    setSel(null);
    bumpStructural();
  }
  // A freshly added-row preset has columns but no elements in them yet — the
  // only way to remove it was previously to delete each of its columns one
  // at a time (deleteColumn only cascades to the row once its last column is
  // gone). This is the direct one-click equivalent.
  function deleteRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r, 1));
    setSel(null);
    bumpStructural();
  }

  function duplicateElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => {
      const src = section(bs, b).rows[r].columns[c].elements[e];
      section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
    });
    bumpStructural();
  }
  function copyElement(b: number, r: number, c: number, e: number) {
    clipCopy("element", section(blocks, b).rows[r].columns[c].elements[e]);
  }
  function pasteElement(b: number, r: number, c: number, e: number) {
    const data = clipRead<El>("element");
    if (data) {
      mutate((bs) => insertEl(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
      bumpStructural();
    }
  }
  function copyStyleElement(b: number, r: number, c: number, e: number) {
    const el = section(blocks, b).rows[r].columns[c].elements[e];
    styleCopy("element", el.props, el.type);
  }
  function pasteStyleElement(b: number, r: number, c: number, e: number) {
    const style = styleRead("element");
    if (style)
      mutate((bs) => {
        const target = section(bs, b).rows[r].columns[c].elements[e];
        target.props = { ...target.props, ...style };
      });
  }
  function deleteElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => {
      removeAt(bs, [b, r, c, e]);
    });
    setSel(null);
    bumpStructural();
  }

  function dropIntoColumn(colPath: number[], index?: number) {
    const d = drag.current;
    drag.current = null;
    setDropHint(null);
    // Layers-tree section/column reorders are handled entirely by rowDragProps'
    // own onDrop — a stray drop onto a canvas column must not fall through to
    // the "move" (element) branch below, which would destructure this payload's
    // section/column path as if it were an element's [b, r, c, e] path.
    if (!d || d.kind === "tree-reorder") return;
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

  // Quick-create (App.tsx's PagesPanel) only auto-derives the slug up
  // front — this is the "then boleh edit" half, exposed as a click-to-edit
  // field in the header instead of a whole page-settings screen.
  async function renameSlug() {
    const next = slugify(slugDraft);
    if (!next) {
      setSlugError(t("designer-slug-empty"));
      return;
    }
    if (next === page.slug) {
      setEditingSlug(false);
      return;
    }
    try {
      await api.updatePage(tenantHost, token, page.id as string, { slug: next });
      page.slug = next;
      setSlugDraft(next);
      setEditingSlug(false);
      setSlugError(null);
    } catch (err) {
      setSlugError((err as Error).message);
    }
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

  // Only reached when there's unsaved content or the page is a draft — a
  // saved+published page renders a plain <a href target="_blank"> instead
  // (see the Preview button below), since a real anchor click is a genuine
  // browser navigation and can't hit the "window.open then redirect"
  // pattern's failure mode: some browsers let the blank tab open but then
  // silently block the follow-up script navigation, leaving a permanently
  // blank tab. This path unavoidably needs that pattern anyway — the save
  // and/or the preview-token mint have to finish before the URL is known.
  async function preview() {
    const win = window.open("", "_blank", "noreferrer");
    if (!win) {
      // window.open silently returns null when the browser's popup blocker
      // eats it — without this check, clicking Preview looks like nothing
      // happened at all, with no error and no new tab.
      setError(t("designer-preview-blocked"));
      return;
    }
    try {
      if (dirty) await save();
      const previewToken = await api.getPagePreviewToken(tenantHost, token, page.id as string);
      win.location.href = api.previewUrl(tenantHost, page.slug as string, previewToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  // "Live Edit": same real-render iframe the Preview button opens in a new
  // tab, but embedded and augmented with a designerEdit=1 flag so
  // BaseLayout.astro's bridge script + SectionBlock.astro's
  // data-designer-path attributes activate (see apps/frontend) — clicking an
  // element there sets `sel` exactly like clicking in the block canvas, so
  // the existing Inspector sidebar keeps working unmodified.
  //
  // Always mints a preview token, even for an already-published page: a
  // published page's public GET already includes the content, but
  // [...slug].astro only turns designerEdit on when a token is present (see
  // its comment) — skipping the mint for "published" used to leave the
  // bridge script/data-designer-path attributes never activated, so clicks
  // in Live Edit silently did nothing.
  // cold=true means the live iframes were just unmounted (switching in from
  // Blocks mode) or this is the very first load — nothing is on screen to
  // keep showing, so skeleton + a fresh mount into slot "a" is correct.
  // cold=false (the debounced structural/style reload path, mode already
  // "live") loads into the *inactive* slot and hands off the actual swap to
  // handleFrameLoad, so the visible iframe never sees its own navigation.
  async function enterLive(cold = false) {
    if (dirty) await save();
    const previewToken = await api.getPagePreviewToken(tenantHost, token, page.id as string);
    const base = api.previewUrl(tenantHost, page.slug as string, previewToken);
    const src = `${base}${base.includes("?") ? "&" : "?"}designerEdit=1`;
    if (cold || (liveSrcA === null && liveSrcB === null)) {
      setReloading(true);
      swapPending.current = null;
      setActiveSlot("a");
      setLiveSrcA(src);
      setLiveSrcB(null);
      setMode("live");
      return;
    }
    const targetSlot = activeSlot === "a" ? "b" : "a";
    swapPending.current = targetSlot;
    if (targetSlot === "a") setLiveSrcA(src);
    else setLiveSrcB(src);
    setMode("live");
  }

  // Resolves both reload paths' onLoad: a pending hot-swap for this exact
  // slot flips it to active (the actual, blink-free "reveal"); a cold mount
  // just clears the skeleton once its own slot (already active) has painted.
  function handleFrameLoad(slot: "a" | "b") {
    if (swapPending.current === slot) {
      swapPending.current = null;
      setActiveSlot(slot);
      setReloading(false);
      const frame = (slot === "a" ? frameARef : frameBRef).current;
      const src = slot === "a" ? liveSrcA : liveSrcB;
      if (pendingScrollRestore.current != null && frame?.contentWindow && src) {
        const targetOrigin = new URL(src, window.location.href).origin;
        frame.contentWindow.postMessage(
          { type: "designer:restoreScroll", y: pendingScrollRestore.current },
          targetOrigin,
        );
        pendingScrollRestore.current = null;
      }
      return;
    }
    if (slot === activeSlot) setReloading(false);
  }

  function toggleLive() {
    setMode(mode === "live" ? "blocks" : "live");
  }

  // Opens straight into the Blocks canvas by default — same-document
  // React state + native drag/drop, no iframe/postMessage bridge to break.
  // The old iframe-based "Live Edit" (enterLive/toggleLive, the double-
  // buffered iframe JSX, BaseLayout.astro's designerEdit bridge) is kept
  // intact and still reachable via the mode toggle button below, not
  // deleted — just no longer the default on open.

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

  // ---------- layers tree ----------
  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function rowDragProps(kind: "section" | "column" | "element", path: number[], key: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        if (kind === "element") drag.current = { kind: "move", path };
        else drag.current = { kind: "tree-reorder", treeKind: kind, path };
      },
      onDragEnd: () => (drag.current = null),
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        setTreeDropHint({ key, pos });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const d = drag.current;
        drag.current = null;
        const hint = treeDropHint;
        setTreeDropHint(null);
        if (!d || !hint) return;
        if (kind === "element" && d.kind === "move") {
          dropIntoColumn([path[0], path[1], path[2]], hint.pos === "before" ? path[3] : path[3] + 1);
          return;
        }
        if (d.kind !== "tree-reorder" || d.treeKind !== kind) return;
        // Column reorder is scoped to within the same row — a row's grid-template
        // and each column's span are only meaningful there. Cross-row drags no-op.
        if (kind === "column" && (d.path[0] !== path[0] || d.path[1] !== path[1])) return;
        const to = hint.pos === "before" ? path[path.length - 1] : path[path.length - 1] + 1;
        const from = d.path[d.path.length - 1];
        const adjustedTo = from < to ? to - 1 : to;
        if (kind === "section") mutate((bs) => moveSection(bs, from, adjustedTo));
        else mutate((bs) => moveColumn(bs, path[0], path[1], from, adjustedTo));
      },
    };
  }

  function LayersTree() {
    return (
      <div className="space-y-0.5 text-xs">
        {blocks.map((block, b) => {
          if (block.type !== "section") {
            const key = `${b}`;
            return (
              <div
                key={b}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-sub ${treeDropHint?.key === key && treeDropHint.pos === "before" ? "border-t-2 border-accent rounded-t-none" : ""} ${treeDropHint?.key === key && treeDropHint.pos === "after" ? "border-b-2 border-accent rounded-b-none" : ""}`}
                {...rowDragProps("section", [b], key)}
              >
                <Lock className="h-3 w-3" /> {t("designer-layers-locked")} ({block.type})
              </div>
            );
          }
          const sp = block.props as unknown as SectionProps;
          const key = `${b}`;
          const isOpen = expanded.has(key);
          const label = sp.anchorId || sp.cssClass || `${t("designer-layers-section")} ${b + 1}`;
          return (
            <div key={b}>
              <div
                className={`flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer ${selEq([b]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"} ${treeDropHint?.key === key && treeDropHint.pos === "before" ? "border-t-2 border-accent rounded-t-none" : ""} ${treeDropHint?.key === key && treeDropHint.pos === "after" ? "border-b-2 border-accent rounded-b-none" : ""}`}
                onClick={(e) => pick(e, [b])}
                {...rowDragProps("section", [b], key)}
              >
                <button onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}>
                  {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                <span className="truncate">{label}</span>
              </div>
              {isOpen &&
                sp.rows.map((row, r) => (
                  <div key={r} className="ml-3">
                    {sp.rows.length > 1 && (
                      <p className="px-1.5 py-0.5 text-[10px] font-semibold text-sub">
                        {t("designer-layers-row")} {r + 1}
                      </p>
                    )}
                    {row.columns.map((col, c) => {
                      const colKey = `${b}.${r}.${c}`;
                      const colOpen = expanded.has(colKey);
                      return (
                        <div key={c} className="ml-1.5">
                          <div
                            className={`flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer ${selEq([b, r, c]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"} ${treeDropHint?.key === colKey && treeDropHint.pos === "before" ? "border-t-2 border-accent rounded-t-none" : ""} ${treeDropHint?.key === colKey && treeDropHint.pos === "after" ? "border-b-2 border-accent rounded-b-none" : ""}`}
                            onClick={(e) => pick(e, [b, r, c])}
                            {...rowDragProps("column", [b, r, c], colKey)}
                          >
                            <button onClick={(e) => { e.stopPropagation(); toggleExpand(colKey); }}>
                              {colOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                            <span className="truncate">
                              {t("designer-layers-column")} {c + 1} ({col.span})
                            </span>
                          </div>
                          {colOpen &&
                            col.elements.map((el, e) => {
                              const Icon = ELS[el.type].icon;
                              const elKey = `${b}.${r}.${c}.${e}`;
                              return (
                                <div
                                  key={el.id}
                                  className={`ml-4 flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer ${selEq([b, r, c, e]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"} ${treeDropHint?.key === elKey && treeDropHint.pos === "before" ? "border-t-2 border-accent rounded-t-none" : ""} ${treeDropHint?.key === elKey && treeDropHint.pos === "after" ? "border-b-2 border-accent rounded-b-none" : ""}`}
                                  onClick={(ev) => pick(ev, [b, r, c, e])}
                                  {...rowDragProps("element", [b, r, c, e], elKey)}
                                >
                                  <Icon className="h-3 w-3" /> {t(ELS[el.type].labelKey)}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    );
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
    if (field.kind === "select" && field.key === "align") {
      const ALIGN_ICON: Record<string, typeof AlignLeft> = {
        left: AlignLeft,
        center: AlignCenter,
        right: AlignRight,
        justify: AlignJustify,
      };
      return (
        <div className="flex gap-1">
          {(field.options ?? []).map((o) => {
            const Icon = ALIGN_ICON[o] ?? AlignLeft;
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(o)}
                title={o}
                className={`flex-1 rounded-lg border p-1.5 ${
                  value === o ? "border-accent bg-accent/10 text-accent" : "border-line/30 text-sub hover:border-accent/40"
                }`}
              >
                <Icon className="mx-auto h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      );
    }
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
    if (field.kind === "length") {
      const m = value.match(/^(-?\d*\.?\d+)(px|%|em|rem)$/);
      const num = m ? m[1] : "";
      const unit = m ? m[2] : "px";
      return (
        <div className="flex gap-2">
          <input
            type="number"
            step={unit === "em" || unit === "rem" ? 0.05 : 1}
            className={base}
            value={num}
            onChange={(e) => onChange(e.target.value === "" ? "" : `${e.target.value}${unit}`)}
          />
          <select
            className={`${base} w-20 shrink-0`}
            value={unit}
            onChange={(e) => onChange(`${num || "0"}${e.target.value}`)}
          >
            {["px", "%", "em", "rem"].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (field.kind === "icon") {
      const q = iconSearch.trim().toLowerCase();
      const options = (field.options ?? []).filter((name) => !q || name.includes(q));
      return (
        <div className="space-y-1.5">
          <input
            className={base}
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
            placeholder={t("designer-icon-search")}
          />
          <div className="grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-line/30 bg-canvas p-1.5">
            {options.length === 0 && (
              <p className="col-span-4 py-2 text-center text-[10px] text-sub">{t("designer-icon-none")}</p>
            )}
            {options.map((name) => {
              const Icon = ICONS[name] ?? Check;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange(name)}
                  title={name}
                  className={`flex flex-col items-center gap-1 rounded-md p-1.5 text-[9px] ${
                    value === name ? "bg-accent/15 font-semibold text-accent" : "text-body hover:bg-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="w-full truncate text-center">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }
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

  // Figma/Elementor-style four-side control: linked shows one input that
  // sets all 4 sides/corners equal; unlinked shows independent Top/Right/
  // Bottom/Left inputs. Values are whatever fourSideValue() resolves —
  // either a per-side override or the shared axis/preset fallback.
  function FourSideControl({
    labelKey,
    icon: Icon,
    linked,
    onToggleLink,
    getSide,
    setSide,
    sides = ["top", "right", "bottom", "left"],
  }: {
    labelKey: Key;
    icon: typeof Frame;
    linked: boolean;
    onToggleLink: () => void;
    getSide: (side: "top" | "right" | "bottom" | "left") => string;
    setSide: (side: "top" | "right" | "bottom" | "left", value: string) => void;
    // Defaults to all 4 (padding/radius); margin has no left/right concept
    // (block-flow spacing only), so it passes just ["top", "bottom"].
    sides?: readonly ("top" | "right" | "bottom" | "left")[];
  }) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-body">
          <span className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
          </span>
          <button
            type="button"
            onClick={onToggleLink}
            title={t("designer-f-link-sides")}
            className={`rounded p-1 ${linked ? "text-accent" : "text-sub hover:text-body"}`}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {linked ? (
          <input
            className="w-full rounded-lg border border-line/30 bg-white px-2 py-1.5 text-[11px]"
            value={getSide(sides[0])}
            onChange={(e) => sides.forEach((s) => setSide(s, e.target.value))}
          />
        ) : (
          <div className={`grid gap-1 ${sides.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
            {sides.map((s) => (
              <input
                key={s}
                className="w-full rounded-lg border border-line/30 bg-white px-1 py-1.5 text-center text-[11px]"
                value={getSide(s)}
                placeholder={s[0].toUpperCase()}
                title={s}
                onChange={(e) => setSide(s, e.target.value)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Grouped Styles panel body: buckets `fields` by FIELD_GROUP_BY_KEY and
  // renders each non-empty bucket as a collapsible section (Advanced starts
  // collapsed, everything else starts open — see collapsedGroups above).
  function FieldGroups({
    fields,
    getValue,
    setValue,
  }: {
    fields: Field[];
    getValue: (f: Field) => string;
    setValue: (f: Field, v: string) => void;
  }) {
    const buckets: Partial<Record<FieldGroupKey, Field[]>> = {};
    for (const f of fields) {
      const g = FIELD_GROUP_BY_KEY[f.key] ?? "content";
      (buckets[g] ??= []).push(f);
    }
    return (
      <>
        {GROUP_META.filter((g) => buckets[g.key]).map((g) => {
          const groupFields = buckets[g.key]!;
          const isOpen = !collapsedGroups.has(g.key);
          const Icon = g.icon;
          return (
            <div key={g.key} className="border-b border-line/20 pb-2 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                className="flex w-full items-center justify-between py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-sub"
              >
                <span className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" /> {t(g.labelKey)}
                </span>
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {isOpen && (
                <div className="space-y-3 pb-1">
                  {groupFields.map((f) => (
                    <label key={f.key} className="block text-[11px] font-medium text-body">
                      {FieldLabel(f.labelKey, t)}
                      <div className="mt-1">{FieldInput({ field: f, value: getValue(f), onChange: (v) => setValue(f, v) })}</div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
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
          <FourSideControl
            labelKey="designer-s-padding"
            icon={Frame}
            linked={linkedPadding}
            onToggleLink={() => setLinkedPadding((v) => !v)}
            getSide={(side) => fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side])}
            setSide={(side, v) => setFourSideValue(b, PADDING_SIDE_KEYS[side], v)}
          />
          <FourSideControl
            labelKey="designer-f-radius"
            icon={SquareDashedBottom}
            linked={linkedRadius}
            onToggleLink={() => setLinkedRadius((v) => !v)}
            getSide={(side) => fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius")}
            setSide={(side, v) => setFourSideValue(b, RADIUS_CORNER_KEYS[side], v)}
          />
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            sides={["top", "bottom"]}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => fourSideValue(sp, MARGIN_SIDE_KEYS[side as "top" | "bottom"], "marginY")}
            setSide={(side, v) => setFourSideValue(b, MARGIN_SIDE_KEYS[side as "top" | "bottom"], v)}
          />
          <FieldGroups
            fields={SECTION_FIELDS}
            getValue={(f) => bpGetValue((sp as unknown as Record<string, string>)[f.key], sp.bp, f.key)}
            setValue={(f, v) =>
              mutate((bs) => {
                if (bp === "desktop") {
                  (bs[b].props as Record<string, unknown>)[f.key] = v;
                } else {
                  const props = bs[b].props as unknown as SectionProps;
                  props.bp = { ...(props.bp ?? {}), [bpKey(f.key)]: v };
                }
              })
            }
          />
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
            {FieldLabel("designer-col-span", t)}: {col.span}
            <input
              type="range"
              min={1}
              max={6}
              value={col.span}
              className="mt-1 w-full accent-accent"
              onChange={(ev) => mutate((bs) => (section(bs, b).rows[r].columns[c].span = Number(ev.target.value)))}
            />
          </label>
          <FourSideControl
            labelKey="designer-s-padding"
            icon={Frame}
            linked={linkedPadding}
            onToggleLink={() => setLinkedPadding((v) => !v)}
            getSide={(side) => sideValue(col.props, col.bp, PADDING_SIDE_KEYS[side], "padding")}
            setSide={(side, v) => setColSideValue(b, r, c, PADDING_SIDE_KEYS[side], v)}
          />
          <FourSideControl
            labelKey="designer-f-radius"
            icon={SquareDashedBottom}
            linked={linkedRadius}
            onToggleLink={() => setLinkedRadius((v) => !v)}
            getSide={(side) => sideValue(col.props, col.bp, RADIUS_CORNER_KEYS[side], "radius")}
            setSide={(side, v) => setColSideValue(b, r, c, RADIUS_CORNER_KEYS[side], v)}
          />
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            sides={["top", "bottom"]}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side as "top" | "bottom"], "marginY")}
            setSide={(side, v) => setColSideValue(b, r, c, MARGIN_SIDE_KEYS[side as "top" | "bottom"], v)}
          />
          <FieldGroups
            fields={COLUMN_FIELDS}
            getValue={(f) => bpGetValue(col.props?.[f.key], col.bp, f.key)}
            setValue={(f, v) =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                if (bp === "desktop") {
                  target.props = { ...(target.props ?? {}), [f.key]: v };
                } else {
                  target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
                }
              })
            }
          />
          <div className="flex gap-3">
            <button onClick={() => copyColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => pasteColumn(b, r, c)}
              disabled={!clipHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button onClick={() => copyStyleColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => pasteStyleColumn(b, r, c)}
              disabled={!styleHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <button onClick={() => deleteColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
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
          <FourSideControl
            labelKey="designer-s-padding"
            icon={Frame}
            linked={linkedPadding}
            onToggleLink={() => setLinkedPadding((v) => !v)}
            getSide={(side) => sideValue(el.props, el.bp, PADDING_SIDE_KEYS[side], "padding")}
            setSide={(side, v) => setElSideValue(b, r, c, e, PADDING_SIDE_KEYS[side], v)}
          />
          {(el.type === "image" || el.type === "embed" || el.type === "gallery") && (
            <FourSideControl
              labelKey="designer-f-radius"
              icon={SquareDashedBottom}
              linked={linkedRadius}
              onToggleLink={() => setLinkedRadius((v) => !v)}
              getSide={(side) => sideValue(el.props, el.bp, RADIUS_CORNER_KEYS[side], "radius")}
              setSide={(side, v) => setElSideValue(b, r, c, e, RADIUS_CORNER_KEYS[side], v)}
            />
          )}
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            sides={["top", "bottom"]}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[side as "top" | "bottom"], "marginY")}
            setSide={(side, v) => setElSideValue(b, r, c, e, MARGIN_SIDE_KEYS[side as "top" | "bottom"], v)}
          />
          <FieldGroups
            fields={[...def.fields, CSS_CLASS_FIELD]}
            getValue={(f) => bpGetValue(el.props[f.key], el.bp, f.key)}
            setValue={(f, v) =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c].elements[e];
                if (bp === "desktop") {
                  target.props[f.key] = v;
                } else {
                  target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
                }
              })
            }
          />
          <div className="flex flex-wrap gap-3">
            <button onClick={() => copyElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => pasteElement(b, r, c, e)}
              disabled={!clipHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button onClick={() => copyStyleElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => pasteStyleElement(b, r, c, e)}
              disabled={!styleHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={() => duplicateElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button onClick={() => deleteElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
              <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  // ---------- canvas element preview (visual approximation of SectionBlock.astro) ----------
  function ElPreview({ el, path }: { el: El; path?: number[] }) {
    const p = el.props;
    const align = { textAlign: (p.align as "left" | "center" | "right") ?? "left" };
    // Canvas-direct text editing (in addition to the Inspector sidebar): while
    // this exact element is selected, heading/text swap their formatted
    // preview for a plain contentEditable showing the raw text (same value
    // the Inspector textarea edits). editingText holds the value captured at
    // focus time so re-renders from typing don't feed new children back into
    // the DOM node (which would reset the caret) — only onBlur clears it.
    const editable = path && selEq(path);
    if (editable && (el.type === "heading" || el.type === "text")) {
      if (editingText.current[el.id] === undefined) editingText.current[el.id] = p.text ?? "";
      const commit = (v: string) =>
        mutate((bs) => {
          const [b, r, c, e] = path;
          section(bs, b).rows[r].columns[c].elements[e].props.text = v;
        });
      const sharedStyle =
        el.type === "heading"
          ? {
              ...align,
              fontSize: H_SIZE[p.level ?? "2"],
              fontWeight: 700,
              lineHeight: 1.2,
              fontFamily: headingFontFamily(p.level),
              ...typoStyle(p),
            }
          : { ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md), whiteSpace: "pre-wrap" as const, lineHeight: 1.65, ...typoStyle(p) };
      return (
        <div
          contentEditable
          suppressContentEditableWarning
          ref={(node) => {
            if (node && document.activeElement !== node) node.focus();
          }}
          style={sharedStyle}
          className="outline-none"
          onInput={(e) => commit(e.currentTarget.textContent ?? "")}
          onBlur={() => delete editingText.current[el.id]}
        >
          {editingText.current[el.id]}
        </div>
      );
    }
    switch (el.type) {
      case "heading":
        return (
          <div
            style={{
              ...align,
              fontSize: H_SIZE[p.level ?? "2"],
              fontWeight: 700,
              lineHeight: 1.2,
              fontFamily: headingFontFamily(p.level),
              ...typoStyle(p),
            }}
            dangerouslySetInnerHTML={{ __html: p.text ? renderInline(p.text) : "Heading" }}
          />
        );
      case "text":
        return p.text ? (
          <div
            style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md), whiteSpace: "pre-wrap", lineHeight: 1.65, ...typoStyle(p) }}
            dangerouslySetInnerHTML={{ __html: renderInline(p.text) }}
          />
        ) : (
          <div style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md) }} className="opacity-40">
            {t("designer-f-text")}…
          </div>
        );
      case "image":
        return p.src ? (
          <img
            src={p.src}
            alt={p.alt ?? ""}
            style={{ borderRadius: elRadius(p), boxShadow: SHADOW[p.shadow ?? "none"], maxWidth: "100%" }}
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
                  : { backgroundColor: "var(--color-primary, #0f62fe)", color: "var(--color-primary-content, #fff)" }
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
          <div
            className="flex aspect-video items-center justify-center bg-black/70 text-white"
            style={{ borderRadius: elRadius(p), boxShadow: SHADOW[p.shadow ?? "none"] }}
          >
            <Video className="mr-2 h-5 w-5" />
            <span className="max-w-[80%] truncate text-xs">{p.url || t("designer-f-url")}</span>
          </div>
        );
      case "icon": {
        const Icon = ICONS[p.name ?? "check"] ?? Check;
        const size = lengthValue(p.size, ICON_SIZE, ICON_SIZE.md);
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
                style={{ borderRadius: elRadius(p) }}
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
        <button onClick={() => duplicateSection(b)} className="px-0.5 text-accent" title={t("designer-duplicate")}>
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => copySection(b)} className="px-0.5 text-accent" title={t("designer-copy")}>
          <Clipboard className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteSection(b)}
          disabled={!clipHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste")}
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <button onClick={() => copyStyleSection(b)} className="px-0.5 text-accent" title={t("designer-copy-style")}>
          <Paintbrush className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteStyleSection(b)}
          disabled={!styleHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button onClick={() => deleteSection(b)} className="px-0.5 text-red-500" title={t("designer-delete")}>
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    );
  }

  // Grip-handle indicator for Live Edit mode — visual parity with Blocks
  // mode's GripVertical (shown there only on a selected element), extended
  // here to all 3 draggable depths (section/column/element) since Live
  // Edit's own drag-reorder now covers all three too. Visual only: the
  // actual grab still works from anywhere on the selected row, same as
  // BaseLayout.astro's pointerdown already allows — this just makes the
  // affordance discoverable. Reuses the same selectedRect + iframe-position
  // math as LiveEditToolbar below.
  function LiveEditGripHandle() {
    if (!sel || !selectedRect || !liveFrame.current) return null;
    const iframeRect = liveFrame.current.getBoundingClientRect();
    const style: React.CSSProperties = {
      position: "fixed",
      left: iframeRect.left + selectedRect.left - 16,
      top: iframeRect.top + selectedRect.top + selectedRect.height / 2 - 7,
      zIndex: 50,
    };
    return (
      <div style={style} className="pointer-events-none text-accent">
        <GripVertical className="h-3.5 w-3.5" />
      </div>
    );
  }

  // Floating action toolbar for Live Edit mode — same actions Blocks mode
  // already has at the matching selection level (see the extracted
  // duplicate/copy/paste/etc. functions above), positioned over the
  // selected block using selectedRect (reported by BaseLayout.astro) plus
  // the iframe's own page position.
  function LiveEditToolbar() {
    if (!sel || !selectedRect || !liveFrame.current) return null;
    const iframeRect = liveFrame.current.getBoundingClientRect();
    const top = iframeRect.top + selectedRect.top;
    const left = iframeRect.left + selectedRect.left;
    const toolbarHeight = 32;
    const showBelow = top < toolbarHeight + 8;
    const style: React.CSSProperties = {
      position: "fixed",
      left,
      top: showBelow ? top + selectedRect.height + 4 : top - toolbarHeight - 4,
      zIndex: 50,
    };
    const iconBtn = "flex items-center justify-center rounded p-1 text-accent hover:bg-canvas disabled:opacity-30";
    if (sel.length === 1) {
      const [b] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => duplicateSection(b)} className={iconBtn} title={t("designer-duplicate")}><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={() => copySection(b)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteSection(b)} disabled={!clipHas("section")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleSection(b)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleSection(b)} disabled={!styleHas("section")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteSection(b)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    if (sel.length === 3) {
      const [b, r, c] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => copyColumn(b, r, c)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteColumn(b, r, c)} disabled={!clipHas("column")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleColumn(b, r, c)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleColumn(b, r, c)} disabled={!styleHas("column")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteColumn(b, r, c)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    if (sel.length === 4) {
      const [b, r, c, e] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => duplicateElement(b, r, c, e)} className={iconBtn} title={t("designer-duplicate")}><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyElement(b, r, c, e)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteElement(b, r, c, e)} disabled={!clipHas("element")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleElement(b, r, c, e)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleElement(b, r, c, e)} disabled={!styleHas("element")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteElement(b, r, c, e)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    return null;
  }

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas font-sans text-ink antialiased">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-line/30 bg-white px-4 py-2.5">
        <span className="text-xs font-bold text-ink">{page.title as string}</span>
        {editingSlug ? (
          <span className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-sub">/</span>
            <input
              autoFocus
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void renameSlug();
                if (e.key === "Escape") {
                  setSlugDraft(page.slug as string);
                  setEditingSlug(false);
                  setSlugError(null);
                }
              }}
              onBlur={() => void renameSlug()}
              className="rounded border border-line/40 px-1.5 py-0.5 font-mono text-[11px] text-ink"
            />
          </span>
        ) : (
          <button
            onClick={() => {
              setSlugDraft(page.slug as string);
              setEditingSlug(true);
            }}
            className="font-mono text-[11px] text-sub hover:text-accent hover:underline"
            title={t("designer-slug-edit")}
          >
            /{page.slug as string}
          </button>
        )}
        {slugError && <span className="text-[11px] font-semibold text-red-600">{slugError}</span>}
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
          onClick={() => void toggleLive()}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-canvas ${
            mode === "live" ? "bg-accent/15 text-accent" : "text-body"
          }`}
        >
          <MousePointerClick className="h-3.5 w-3.5" /> {mode === "live" ? t("designer-block-view") : t("designer-live-view")}
        </button>
        <div className="flex items-center gap-0.5 rounded-full bg-canvas p-0.5">
          {(
            [
              { key: "desktop", icon: Monitor, labelKey: "designer-bp-desktop" },
              { key: "tablet", icon: Tablet, labelKey: "designer-bp-tablet" },
              { key: "mobile", icon: Smartphone, labelKey: "designer-bp-mobile" },
            ] as const
          ).map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => setBp(key)}
              title={t(labelKey)}
              className={`rounded-full p-1.5 ${bp === key ? "bg-white text-accent shadow-sm" : "text-sub hover:text-body"}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        {page.status === "published" && !dirty ? (
          <a
            href={api.previewUrl(tenantHost, page.slug as string)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
          </a>
        ) : (
          <button
            onClick={() => void preview()}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
          </button>
        )}
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
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-line/30 bg-white p-3">
          <div className="mb-2 flex gap-1 rounded-lg bg-canvas p-0.5 text-[10px] font-semibold">
            <button
              onClick={() => setActiveLeftTab("elements")}
              className={`flex-1 rounded-md py-1 ${activeLeftTab === "elements" ? "bg-white shadow-sm" : "text-sub"}`}
            >
              {t("designer-tab-elements")}
            </button>
            <button
              onClick={() => setActiveLeftTab("layers")}
              className={`flex-1 rounded-md py-1 inline-flex items-center justify-center gap-1 ${activeLeftTab === "layers" ? "bg-white shadow-sm" : "text-sub"}`}
            >
              <Layers className="h-3 w-3" /> {t("designer-tab-layers")}
            </button>
          </div>
          {activeLeftTab === "elements" ? (
            <div className="space-y-1.5">
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
            </div>
          ) : (
            <LayersTree />
          )}
        </aside>

        {/* canvas */}
        <main
          className="min-w-0 flex-1 overflow-y-auto p-6"
          onClick={() => setSel(null)}
          style={
            {
              "--color-primary": siteTheme?.primaryColor,
              "--color-primary-content": siteTheme?.primaryColor ? bestTextColor(siteTheme.primaryColor) : undefined,
              "--color-secondary": siteTheme?.secondaryColor,
              "--color-bg": siteTheme?.backgroundColor,
              "--color-text": siteTheme?.textColor,
              "--font-family": siteTheme?.fontFamily,
              "--font-heading": siteTheme?.headingFont,
              "--font-subheading": siteTheme?.subHeadingFont,
              background: "var(--color-bg, #ffffff)",
              color: "var(--color-text, inherit)",
              fontFamily: "var(--font-family, inherit)",
            } as React.CSSProperties
          }
        >
          <div
            className={`mx-auto ${mode === "live" ? "" : "space-y-4"}`}
            style={{ maxWidth: bp === "tablet" ? "48rem" : bp === "mobile" ? "24rem" : mode === "live" ? undefined : "56rem" }}
          >
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
                    {BlockControls({ b })}
                  </div>
                );
              }
              const sp = block.props as unknown as SectionProps;
              const contained = (sp.width ?? "contained") === "contained";
              return (
                <div
                  key={b}
                  className={`group relative ${mode === "live" ? "" : "rounded-xl"} ${selCls([b])}`}
                  onClick={(ev) => pick(ev, [b])}
                >
                  <div className="absolute -top-3 left-3 z-10 hidden items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-[10px] font-bold text-sub shadow-sm group-hover:flex">
                    {t("designer-section")} {BlockControls({ b })}
                  </div>
                  {selEq([b]) &&
                    (() => {
                      // Reads/writes go through the same per-side keys (PADDING_SIDE_KEYS,
                      // fallback PADDING_SIDE_FALLBACK) as this section's own FourSideControl
                      // in the Inspector — dragging here now agrees with what's actually
                      // rendered instead of a separate paddingY/paddingX axis value that the
                      // per-side override (once set) would silently ignore.
                      const sidePx = (side: keyof typeof PADDING_SIDE_KEYS) =>
                        Number(
                          pxLabel(
                            lengthValue(
                              fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]),
                              PAD,
                              side === "top" || side === "bottom" ? PAD.md : "1.5rem",
                            ),
                          ),
                        ) || 0;
                      const topPx = sidePx("top");
                      const rightPx = sidePx("right");
                      const bottomPx = sidePx("bottom");
                      const leftPx = sidePx("left");
                      // Block's `bp` bag lives inside `props` (SectionProps.bp), not as a
                      // sibling of it like Col/El — writeDragSideKeys' shape doesn't fit, so
                      // this section writes directly instead.
                      const applyDrag = (key: string, px: number) => (next: Block[]) => {
                        const props = next[b].props as unknown as SectionProps;
                        const keys = linkedPadding ? Object.values(PADDING_SIDE_KEYS) : [key];
                        if (bp === "desktop") {
                          for (const k of keys) (props as unknown as Record<string, string>)[k] = `${px}px`;
                        } else {
                          const patch: Record<string, string> = {};
                          for (const k of keys) patch[bpKey(k)] = `${px}px`;
                          props.bp = { ...(props.bp ?? {}), ...patch };
                        }
                      };
                      return (
                        <>
                          {(["top", "bottom"] as const).map((edge) => (
                            <span
                              key={edge}
                              onMouseDown={(ev) => {
                                const startPx = edge === "top" ? topPx : bottomPx;
                                const key = PADDING_SIDE_KEYS[edge];
                                startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => applyDrag(key, px)(next));
                              }}
                              className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"
                              }`}
                            >
                              {edge === "top" ? topPx : bottomPx}px
                            </span>
                          ))}
                          {(["left", "right"] as const).map((edge) => (
                            <span
                              key={edge}
                              onMouseDown={(ev) => {
                                const startPx = edge === "left" ? leftPx : rightPx;
                                const key = PADDING_SIDE_KEYS[edge];
                                startSpacingDrag(ev, startPx, "x", edge === "left" ? 1 : -1, (next, px) => applyDrag(key, px)(next));
                              }}
                              className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
                              }`}
                            >
                              {edge === "left" ? leftPx : rightPx}px
                            </span>
                          ))}
                        </>
                      );
                    })()}
                  {selEq([b]) &&
                    (() => {
                      // Margin lives outside the box (outward bands), unlike padding — no
                      // canvas drag handle existed for section margin before this at all
                      // (Inspector-text-only). Right-aligned so it doesn't collide with the
                      // centered padding badges or the -top-3 "Section" hover tag.
                      const sidePx = (side: "top" | "bottom") =>
                        Number(pxLabel(lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], "marginY"), PAD, "0"))) || 0;
                      const topPx = sidePx("top");
                      const bottomPx = sidePx("bottom");
                      const applyDrag = (key: string, px: number) => (next: Block[]) => {
                        const props = next[b].props as unknown as SectionProps;
                        const keys = linkedMargin ? Object.values(MARGIN_SIDE_KEYS) : [key];
                        if (bp === "desktop") {
                          for (const k of keys) (props as unknown as Record<string, string>)[k] = `${px}px`;
                        } else {
                          const patch: Record<string, string> = {};
                          for (const k of keys) patch[bpKey(k)] = `${px}px`;
                          props.bp = { ...(props.bp ?? {}), ...patch };
                        }
                      };
                      return (
                        <>
                          {spacingBand("top", topPx, true)}
                          {spacingBand("bottom", bottomPx, true)}
                          {(["top", "bottom"] as const).map((edge) => (
                            <span
                              key={edge}
                              onMouseDown={(ev) => {
                                const startPx = edge === "top" ? topPx : bottomPx;
                                const key = MARGIN_SIDE_KEYS[edge];
                                startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => applyDrag(key, px)(next));
                              }}
                              className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "top" ? "-top-2" : "-bottom-2"
                              }`}
                            >
                              {edge === "top" ? topPx : bottomPx}px
                            </span>
                          ))}
                        </>
                      );
                    })()}
                  <div
                    className={`relative ${mode === "live" ? "overflow-hidden" : "overflow-hidden rounded-xl border border-line/20"}`}
                    style={sectionBpStyle(sp)}
                  >
                    {selEq([b]) && (
                      <>
                        {spacingBand(
                          "top",
                          Number(
                            pxLabel(lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.top, PADDING_SIDE_FALLBACK.top), PAD, PAD.md)),
                          ) || 0,
                        )}
                        {spacingBand(
                          "bottom",
                          Number(
                            pxLabel(
                              lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.bottom, PADDING_SIDE_FALLBACK.bottom), PAD, PAD.md),
                            ),
                          ) || 0,
                        )}
                        {spacingBand(
                          "left",
                          Number(
                            pxLabel(
                              lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.left, PADDING_SIDE_FALLBACK.left), PAD, "1.5rem"),
                            ),
                          ) || 0,
                        )}
                        {spacingBand(
                          "right",
                          Number(
                            pxLabel(
                              lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.right, PADDING_SIDE_FALLBACK.right), PAD, "1.5rem"),
                            ),
                          ) || 0,
                        )}
                      </>
                    )}
                    <div
                      className={
                        mode === "live"
                          ? contained
                            ? "mx-auto max-w-[68rem] space-y-10"
                            : "space-y-10"
                          : contained
                            ? "mx-auto max-w-3xl space-y-5"
                            : "space-y-5"
                      }
                    >
                      {(sp.rows ?? []).map((row, r) => (
                        <div key={r} className="group/row relative">
                          {mode !== "live" && (
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                deleteRow(b, r);
                              }}
                              title={t("designer-delete-row")}
                              className="absolute -right-2 -top-2 z-20 hidden rounded-full bg-white p-1 text-red-500 opacity-0 shadow-sm ring-1 ring-line/30 transition-opacity group-hover/row:flex group-hover/row:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                          <div
                            className={mode === "live" ? "grid gap-8" : "grid gap-4"}
                            style={{ gridTemplateColumns: row.columns.map((cc) => `${cc.span}fr`).join(" ") }}
                          >
                            {row.columns.map((col, c) => (
                            <div
                              key={c}
                              className={`relative min-h-[3rem] transition-colors ${
                                mode === "live" ? "space-y-5" : "space-y-3 rounded-lg p-1.5"
                              } ${selCls([b, r, c])} ${dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""}`}
                              style={bpColStyle(col)}
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
                              {selEq([b, r, c]) && mode !== "live" && (
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    deleteColumn(b, r, c);
                                  }}
                                  title={t("designer-delete")}
                                  className="absolute -right-2 -top-2 z-30 rounded-full bg-white p-1 text-red-500 shadow-sm ring-1 ring-line/30"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                              {selEq([b, r, c]) &&
                                (() => {
                                  // Per-side padding (top/right/bottom/left), each falling back to the
                                  // shared `padding` value when its own override isn't set — same
                                  // fallback chain as the FourSideControl in the Inspector, so unlinked
                                  // per-side edits there are draggable here too, not just the uniform case.
                                  const sidePx = (key: string) =>
                                    Number(pxLabel(lengthValue(sideValue(col.props, col.bp, key, "padding"), PAD, "0"))) || 0;
                                  const topPx = sidePx(PADDING_SIDE_KEYS.top);
                                  const rightPx = sidePx(PADDING_SIDE_KEYS.right);
                                  const bottomPx = sidePx(PADDING_SIDE_KEYS.bottom);
                                  const leftPx = sidePx(PADDING_SIDE_KEYS.left);
                                  return (
                                    <>
                                      {spacingBand("top", topPx)}
                                      {spacingBand("bottom", bottomPx)}
                                      {spacingBand("left", leftPx)}
                                      {spacingBand("right", rightPx)}
                                      {(["top", "bottom"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={(ev) => {
                                            const startPx = edge === "top" ? topPx : bottomPx;
                                            const key = PADDING_SIDE_KEYS[edge];
                                            startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => {
                                              const target = section(next, b).rows[r].columns[c];
                                              writeDragSideKeys(
                                                target,
                                                Object.values(PADDING_SIDE_KEYS),
                                                key,
                                                px,
                                                linkedPadding,
                                              );
                                            });
                                          }}
                                          className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"
                                          }`}
                                        >
                                          {edge === "top" ? topPx : bottomPx}px
                                        </span>
                                      ))}
                                      {(["left", "right"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={(ev) => {
                                            const startPx = edge === "left" ? leftPx : rightPx;
                                            const key = PADDING_SIDE_KEYS[edge];
                                            startSpacingDrag(ev, startPx, "x", edge === "left" ? 1 : -1, (next, px) => {
                                              const target = section(next, b).rows[r].columns[c];
                                              writeDragSideKeys(
                                                target,
                                                Object.values(PADDING_SIDE_KEYS),
                                                key,
                                                px,
                                                linkedPadding,
                                              );
                                            });
                                          }}
                                          className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
                                          }`}
                                        >
                                          {edge === "left" ? leftPx : rightPx}px
                                        </span>
                                      ))}
                                    </>
                                  );
                                })()}
                              {selEq([b, r, c]) &&
                                (() => {
                                  // Column margin — same outward-band pattern as Section's, no
                                  // canvas drag existed for it before (Inspector-text-only).
                                  const sidePx = (side: "top" | "bottom") =>
                                    Number(pxLabel(lengthValue(sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side], "marginY"), PAD, "0"))) ||
                                    0;
                                  const topPx = sidePx("top");
                                  const bottomPx = sidePx("bottom");
                                  return (
                                    <>
                                      {spacingBand("top", topPx, true)}
                                      {spacingBand("bottom", bottomPx, true)}
                                      {(["top", "bottom"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={(ev) => {
                                            const startPx = edge === "top" ? topPx : bottomPx;
                                            const key = MARGIN_SIDE_KEYS[edge];
                                            startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => {
                                              const target = section(next, b).rows[r].columns[c];
                                              writeDragSideKeys(target, Object.values(MARGIN_SIDE_KEYS), key, px, linkedMargin);
                                            });
                                          }}
                                          className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "top" ? "-top-2" : "-bottom-2"
                                          }`}
                                        >
                                          {edge === "top" ? topPx : bottomPx}px
                                        </span>
                                      ))}
                                    </>
                                  );
                                })()}
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
                                  onContextMenu={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    setSel([b, r, c, e]);
                                    setCtxMenu({ path: [b, r, c, e], x: ev.clientX, y: ev.clientY });
                                  }}
                                  className={`relative cursor-grab rounded-lg p-1 ${selCls([b, r, c, e])}`}
                                  style={{ ...bpMarginStyle(el), ...bpPaddingStyle(el) }}
                                >
                                  {selEq([b, r, c, e]) && (
                                    <div className="absolute -left-2 -top-2 z-30 rounded-full bg-white p-1 text-accent shadow-sm ring-1 ring-line/30">
                                      <GripVertical className="h-3 w-3" />
                                    </div>
                                  )}
                                  {selEq([b, r, c, e]) && mode !== "live" && (
                                    <button
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        deleteElement(b, r, c, e);
                                      }}
                                      title={t("designer-delete")}
                                      className="absolute -right-2 -top-2 z-30 rounded-full bg-white p-1 text-red-500 shadow-sm ring-1 ring-line/30"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                  {selEq([b, r, c, e]) &&
                                    (() => {
                                      const sidePx = (key: string) =>
                                        Number(pxLabel(lengthValue(sideValue(el.props, el.bp, key, "marginY"), SPACE, "0"))) || 0;
                                      const topPx = sidePx(MARGIN_SIDE_KEYS.top);
                                      const bottomPx = sidePx(MARGIN_SIDE_KEYS.bottom);
                                      return (
                                        <>
                                          {spacingBand("top", topPx, true)}
                                          {spacingBand("bottom", bottomPx, true)}
                                          {(["top", "bottom"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={(ev) => {
                                                const startPx = edge === "top" ? topPx : bottomPx;
                                                const key = MARGIN_SIDE_KEYS[edge];
                                                startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => {
                                                  const target = section(next, b).rows[r].columns[c].elements[e];
                                                  writeDragSideKeys(target, Object.values(MARGIN_SIDE_KEYS), key, px, linkedMargin);
                                                });
                                              }}
                                              className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "top" ? "-top-2" : "-bottom-2"
                                              }`}
                                            >
                                              {edge === "top" ? topPx : bottomPx}px
                                            </span>
                                          ))}
                                        </>
                                      );
                                    })()}
                                  {selEq([b, r, c, e]) &&
                                    (() => {
                                      // Universal element padding — inward bands/handles, same edge
                                      // positions as Column's (top/bottom centered, left/right
                                      // vertically centered), so it never collides with the grip,
                                      // delete, or margin badges, which all live at the corners/edges
                                      // outside the box.
                                      const sidePx = (side: keyof typeof PADDING_SIDE_KEYS) =>
                                        Number(pxLabel(lengthValue(sideValue(el.props, el.bp, PADDING_SIDE_KEYS[side], "padding"), PAD, "0"))) ||
                                        0;
                                      const topPx = sidePx("top");
                                      const rightPx = sidePx("right");
                                      const bottomPx = sidePx("bottom");
                                      const leftPx = sidePx("left");
                                      return (
                                        <>
                                          {spacingBand("top", topPx)}
                                          {spacingBand("bottom", bottomPx)}
                                          {spacingBand("left", leftPx)}
                                          {spacingBand("right", rightPx)}
                                          {(["top", "bottom"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={(ev) => {
                                                const startPx = edge === "top" ? topPx : bottomPx;
                                                const key = PADDING_SIDE_KEYS[edge];
                                                startSpacingDrag(ev, startPx, "y", edge === "top" ? 1 : -1, (next, px) => {
                                                  const target = section(next, b).rows[r].columns[c].elements[e];
                                                  writeDragSideKeys(target, Object.values(PADDING_SIDE_KEYS), key, px, linkedPadding);
                                                });
                                              }}
                                              className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"
                                              }`}
                                            >
                                              {edge === "top" ? topPx : bottomPx}px
                                            </span>
                                          ))}
                                          {(["left", "right"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={(ev) => {
                                                const startPx = edge === "left" ? leftPx : rightPx;
                                                const key = PADDING_SIDE_KEYS[edge];
                                                startSpacingDrag(ev, startPx, "x", edge === "left" ? 1 : -1, (next, px) => {
                                                  const target = section(next, b).rows[r].columns[c].elements[e];
                                                  writeDragSideKeys(target, Object.values(PADDING_SIDE_KEYS), key, px, linkedPadding);
                                                });
                                              }}
                                              className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
                                              }`}
                                            >
                                              {edge === "left" ? leftPx : rightPx}px
                                            </span>
                                          ))}
                                        </>
                                      );
                                    })()}
                                  {ElPreview({ el, path: [b, r, c, e] })}
                                </div>
                              ))}
                            </div>
                          ))}
                          </div>
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
          {Inspector()}
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
              disabled={!templateKind() || templatesBusy}
              className="mb-3 flex w-full items-center justify-center gap-1 rounded-full bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-40"
            >
              <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates-save")}
            </button>
            {templates.length === 0 ? (
              <p className="text-xs text-sub">{t("designer-templates-empty")}</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((tpl) => {
                  const kind = (tpl.data?.kind as string | undefined) ?? "section";
                  const kindLabel =
                    kind === "column" ? t("designer-column") : kind === "element" ? t("designer-elements") : t("designer-section");
                  return (
                  <li key={tpl.id} className="flex items-center justify-between rounded-lg border border-line/30 px-3 py-2">
                    <span className="min-w-0 truncate text-xs font-medium text-ink">
                      {tpl.name} <span className="text-[10px] font-normal text-sub">({kindLabel})</span>
                    </span>
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
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {ctxMenu &&
        (() => {
          const [b, r, c, e] = ctxMenu.path;
          const el = section(blocks, b).rows[r]?.columns[c]?.elements[e];
          if (!el) return null;
          const item = (icon: React.ReactNode, label: string, onClick: () => void, disabled?: boolean) => (
            <button
              onClick={() => {
                onClick();
                setCtxMenu(null);
              }}
              disabled={disabled}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-ink hover:bg-canvas disabled:opacity-30"
            >
              {icon}
              {label}
            </button>
          );
          return (
            <div
              className="fixed z-[70] w-44 overflow-hidden rounded-lg border border-line/30 bg-white py-1 shadow-xl"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(ev) => ev.stopPropagation()}
            >
              {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r, c, e]))}
              {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => {
                mutate((bs) => insertEl(bs, [b, r, c], { ...clone(el), id: uid() }, e + 1));
                bumpStructural();
              })}
              {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => clipCopy("element", el))}
              {item(
                <ClipboardPaste className="h-3.5 w-3.5" />,
                t("designer-paste"),
                () => {
                  const data = clipRead<El>("element");
                  if (data) {
                    mutate((bs) => insertEl(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
                    bumpStructural();
                  }
                },
                !clipHas("element"),
              )}
              {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () =>
                styleCopy("element", el.props, el.type),
              )}
              {item(
                <Paintbrush className="h-3.5 w-3.5 opacity-50" />,
                t("designer-paste-style"),
                () => {
                  const style = styleRead("element");
                  if (style)
                    mutate((bs) => {
                      const target = section(bs, b).rows[r].columns[c].elements[e];
                      target.props = { ...target.props, ...style };
                    });
                },
                !styleHas("element"),
              )}
              <div className="my-1 border-t border-line/20" />
              {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => void saveAsTemplate())}
              <div className="my-1 border-t border-line/20" />
              <button
                onClick={() => {
                  deleteElement(b, r, c, e);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-red-500 hover:bg-canvas"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("designer-delete")}
              </button>
            </div>
          );
        })()}
    </div>
  );
}
