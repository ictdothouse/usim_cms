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
  ChevronsUpDown,
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
  GalleryHorizontal,
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
  LayoutPanelTop,
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
import { slugify, bestTextColor, GOOGLE_FONTS } from "@/lib/utils";
import type { Key } from "@/i18n";
import { moveSection, moveColumn } from "./designerTree";

// i18n Phase 5 — sentinel key for the page's own base-language layout
// inside PageDesignerRoute's `content` map, mirroring PostEditorPage's own
// BASE_LANG. Never a real language code, so it can't collide with one.
const BASE_LANG = "__base__";

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
  | "gallery"
  | "accordion"
  | "infobox"
  | "tabs"
  | "slider";

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
  // Gap between this row's columns. Unset falls back to the same default
  // the real frontend's .ds-row CSS uses (SectionBlock.astro) — "2rem".
  gap?: string;
  // Space above/below this row (the gap *between rows* stacked in the same
  // section). Unset marginTop falls back to the old fixed space-y value
  // (see the rows container below) — except row 0, which never got a
  // leading gap under the old space-y-based layout either.
  marginTop?: string;
  marginBottom?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  // Per-breakpoint visibility — "true" hides this row on that screen size,
  // unset/"" always shows. Real @media rules on the published site, not an
  // admin-preview-only simulation like the `bp` style-override bag (that one
  // never reaches apps/frontend) — see SectionBlock.astro's hideCss().
  hideDesktop?: string;
  hideTablet?: string;
  hideMobile?: string;
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
  marginX?: string;
  // Per-side overrides — same fallback convention as padding's per-side keys
  // (marginTop/Bottom -> marginY, marginLeft/Right -> marginX).
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  width?: string;
  border?: string;
  // Real stroke (replaces the border preset above for anything edited after
  // this was added): borderWidth set means "use these", otherwise render
  // falls back to the legacy none/thin/thick preset so old pages don't move.
  borderWidth?: string;
  borderColor?: string;
  borderStyle?: string;
  // 0-100 percent string, CSS opacity applied to the whole section (backdrop
  // + content) — unset means fully opaque, same convention as every other
  // optional style prop here.
  opacity?: string;
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
  hideDesktop?: string;
  hideTablet?: string;
  hideMobile?: string;
}
export interface Block {
  type: string;
  props: Record<string, unknown>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "color"
  | "image"
  | "gallery"
  | "length"
  | "icon"
  | "shadow"
  | "pairs"
  | "slides"
  | "font"
  | "stepper";
interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
  // "pairs" kind only: i18n keys for the two sub-field placeholders (e.g. Question/Answer vs Label/Content).
  subLabels?: [Key, Key];
  // "stepper" kind only: +/- nudge amount (default 1 if omitted).
  step?: number;
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
  "designer-s-borderwidth": Square,
  "designer-s-bordercolor": Palette,
  "designer-s-borderstyle": Square,
  "designer-s-opacity": Percent,
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
  { key: "fontFamily", labelKey: "designer-f-fontfamily", kind: "font" },
  { key: "color", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "lineHeight", labelKey: "designer-f-lineheight", kind: "stepper", step: 0.1 },
  { key: "letterSpacing", labelKey: "designer-f-letterspacing", kind: "stepper", step: 0.5 },
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
      { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
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
      { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
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
  // Question|Answer pairs, one per line — same simple delimited-line
  // convention as `list`'s items, chosen over building a whole new
  // structured-repeater Field kind just for this. Rendered as native
  // <details>/<summary> (SectionBlock.astro) — zero client JS, free
  // accessibility, matches this app's "no client-side JS" frontend
  // convention exactly instead of fighting it.
  accordion: {
    labelKey: "designer-el-accordion",
    icon: ChevronsUpDown,
    defaults: { items: "Question one|Answer to question one\nQuestion two|Answer to question two", exclusive: "false" },
    fields: [
      {
        key: "items",
        labelKey: "designer-f-accordion-items",
        kind: "pairs",
        subLabels: ["designer-f-accordion-question", "designer-f-accordion-answer"],
      },
      { key: "exclusive", labelKey: "designer-f-accordion-exclusive", kind: "select", options: ["false", "true"] },
    ],
  },
  // Icon + heading + short text — the common "feature card" building block
  // (Elementor's Icon Box). Drop 3 of these into a 3-column Row for a
  // features section; background/border/shadow "card" look comes from the
  // Column it sits in (see COLUMN_FIELDS), not from this element itself.
  infobox: {
    labelKey: "designer-el-infobox",
    icon: Info,
    defaults: { name: "star", heading: "Feature title", text: "Feature description", align: "left", iconPosition: "top" },
    fields: [
      { key: "name", labelKey: "designer-f-icon-name", kind: "icon", options: Object.keys(ICONS) },
      { key: "color", labelKey: "designer-f-icon-color", kind: "color" },
      { key: "heading", labelKey: "designer-f-infobox-heading", kind: "text" },
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center"] },
      { key: "iconPosition", labelKey: "designer-f-infobox-iconposition", kind: "select", options: ["top", "left"] },
    ],
  },
  // Label|Content pairs, one per line — same delimited-line convention as
  // accordion. Switching panels needs a click handler (unlike accordion's
  // native <details>), so this is the one static element that ships a small
  // vanilla-JS listener (SectionBlock.astro's own <script>, event-delegated
  // so it initializes every .ds-tabs instance on the page with one listener,
  // not a heavier tabs library).
  tabs: {
    labelKey: "designer-el-tabs",
    icon: LayoutPanelTop,
    defaults: { items: "Tab one|Content for tab one\nTab two|Content for tab two" },
    fields: [
      {
        key: "items",
        labelKey: "designer-f-tabs-items",
        kind: "pairs",
        subLabels: ["designer-f-tabs-label", "designer-f-tabs-content"],
      },
    ],
  },
  // A JSON array of slide objects (image, heading, subtitle, text position,
  // overlay color/opacity, multiple buttons) — see parseSlides/stringifySlides
  // above. Rendered by SectionBlock.astro via Embla Carousel (headless,
  // vanilla JS — drag/swipe/momentum/looping) instead of hand-rolled scroll
  // math, with an optional autoplay plugin.
  slider: {
    labelKey: "designer-el-slider",
    icon: GalleryHorizontal,
    defaults: {
      slides: JSON.stringify([
        { imageUrl: "", heading: "Slide one heading", subtitle: "Slide one subtitle", textPosition: "center", overlayColor: "#000000", overlayOpacity: "35", buttons: [] },
        { imageUrl: "", heading: "Slide two heading", subtitle: "Slide two subtitle", textPosition: "center", overlayColor: "#000000", overlayOpacity: "35", buttons: [] },
      ]),
      autoplay: "0",
      // A literal length now that the field itself accepts one directly
      // (kind "length", below) — "32rem" is exactly what the old "md" preset
      // keyword already resolved to (SLIDER_HEIGHT in SectionBlock.astro),
      // so a freshly-added slider looks identical to before. Pages saved
      // before this change keep the "sm"/"md"/"lg"/"full" keyword itself,
      // which SectionBlock.astro's `lengthValue()` still resolves the exact
      // same way — never a hard migration, upgrades silently on next edit,
      // same convention as every other schema evolution in this element.
      height: "32rem",
      navStyle: "arrows",
      dotsStyle: "dots",
      transition: "slide",
    },
    fields: [
      { key: "slides", labelKey: "designer-f-slider-slides", kind: "slides" },
      { key: "autoplay", labelKey: "designer-f-slider-autoplay", kind: "select", options: ["0", "3", "5", "8"] },
      // px/%/em/rem/vh/vw via the shared "length" kind — was a closed
      // sm/md/lg/full select, which could never express a custom px or vh
      // value at all. 100vh now covers the old "full" preset directly.
      { key: "height", labelKey: "designer-f-slider-height", kind: "length" },
      { key: "navStyle", labelKey: "designer-f-slider-nav", kind: "select", options: ["arrows", "minimal", "none"] },
      { key: "dotsStyle", labelKey: "designer-f-slider-pagination", kind: "select", options: ["dots", "lines", "numbers", "none"] },
      { key: "transition", labelKey: "designer-f-slider-transition", kind: "select", options: ["slide", "fade"] },
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
  accordion: ["items"],
  infobox: ["name", "heading", "text"],
  tabs: ["items"],
  slider: ["slides"],
};
type ClipLevel = "section" | "row" | "column" | "element";
const CLIP_KEYS: Record<ClipLevel, string> = {
  section: "designer:clip:section",
  row: "designer:clip:row",
  column: "designer:clip:column",
  element: "designer:clip:element",
};
const CLIPSTYLE_KEYS: Record<ClipLevel, string> = {
  section: "designer:clipstyle:section",
  row: "designer:clipstyle:row",
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
  { key: "opacity", labelKey: "designer-s-opacity", kind: "text" },
  { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
  { key: "borderWidth", labelKey: "designer-s-borderwidth", kind: "text" },
  { key: "borderColor", labelKey: "designer-s-bordercolor", kind: "color" },
  { key: "borderStyle", labelKey: "designer-s-borderstyle", kind: "select", options: ["solid", "dashed", "dotted"] },
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
  { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
  { key: "cssClass", labelKey: "designer-f-cssclass", kind: "text" },
];
// Bp-merge list for bpColStyle() — covers the base padding/radius fields plus
// their per-side/per-corner overrides, none of which are in COLUMN_FIELDS
// (they're edited via FourSideControl, not the flat Inspector list).
const COLUMN_SPACING_KEYS = [
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomRight", "radiusBottomLeft",
  "marginY", "marginX", "marginTop", "marginRight", "marginBottom", "marginLeft",
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
type FieldGroupKey = "content" | "typography" | "background" | "spacing" | "size" | "appearance" | "border" | "advanced";

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
  // Figma-style split: Appearance (opacity/shadow/radius — visual effects)
  // vs Stroke (the actual border color/width/style), each its own card.
  opacity: "appearance", shadow: "appearance", radius: "appearance",
  border: "border", borderWidth: "border", borderColor: "border", borderStyle: "border",
  anchorId: "advanced", cssClass: "advanced",
};

const GROUP_META: { key: FieldGroupKey; labelKey: Key; icon: typeof Type }[] = [
  { key: "content", labelKey: "designer-group-content", icon: Type },
  { key: "typography", labelKey: "designer-group-typography", icon: Baseline },
  { key: "background", labelKey: "designer-group-background", icon: PaintBucket },
  { key: "spacing", labelKey: "designer-group-spacing", icon: Frame },
  { key: "size", labelKey: "designer-group-size", icon: RectangleHorizontal },
  { key: "appearance", labelKey: "designer-group-appearance", icon: Blend },
  { key: "border", labelKey: "designer-group-border", icon: Square },
  { key: "advanced", labelKey: "designer-group-advanced", icon: Hash },
];

const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
// Row/page gap is stored as a plain CSS length ("24px", "0") rather than a
// preset table — authors type an exact px value, no rem/preset guessing.
// gapPx() round-trips that string to/from the <input type="number"> shown
// in the Inspector; assumes rem = 16px like pxLabel() does everywhere else.
function gapPx(v: string | undefined): number | "" {
  if (!v) return "";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return Math.round(v.endsWith("rem") ? n * 16 : n);
}
const SPACE: Record<string, string> = { sm: "1rem", md: "2rem", lg: "4rem", xl: "6rem" };
const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
const TEXT_SIZE: Record<string, string> = { sm: "0.875rem", md: "1rem", lg: "1.2rem" };
const H_SIZE: Record<string, string> = { "1": "2.6rem", "2": "2rem", "3": "1.5rem", "4": "1.2rem" };
const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };
// Legacy preset keywords (existing pages' saved shadow="sm"/"md"/"lg" values)
// still resolve via this table. New edits store a pipe-delimited custom
// shadow instead — see shadowToCss()/SHADOW_DEFAULT_PARTS — no presets, a
// real X/Y/blur/spread/color/opacity panel (user: "saya taknak preset...
// letakkan option nombor").
const LEGACY_SHADOW: Record<string, string | undefined> = {
  none: undefined,
  sm: "0 1px 3px rgba(0,0,0,.1)",
  md: "0 4px 12px rgba(0,0,0,.12)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};
// Seed values a freshly-added shadow starts from — visually close to the old
// "md" preset, so switching a legacy preset into the new panel doesn't jump.
const SHADOW_DEFAULT_PARTS = ["0", "4", "12", "0", "#000000", "0.12"] as const;
function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number.isFinite(alpha) ? alpha : 1})`;
}
// Canvas overlay chrome (dashed guides, drop hints) is drawn straight on top
// of whatever bg color the section/column actually has, which the tenant
// can set to anything — the old fixed light-gray `border-line` line vanished
// on a bright/white background. bestTextColor already answers "black or
// white reads better on this bg" for button labels; reuse it here to flip
// the guide-line/hint-text color dark-on-light vs light-on-dark instead.
function overlayColors(bg: string): { line: string; text: string } {
  const dark = bestTextColor(bg) === "#000000";
  return dark
    ? { line: hexToRgba("#000000", 0.35), text: hexToRgba("#000000", 0.55) }
    : { line: hexToRgba("#ffffff", 0.45), text: hexToRgba("#ffffff", 0.75) };
}
function shadowToCss(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw in LEGACY_SHADOW) return LEGACY_SHADOW[raw];
  const [x, y, blur, spread, color, opacity] = raw.split("|");
  if (!x) return undefined;
  return `${x}px ${y}px ${blur ?? 0}px ${spread ?? 0}px ${hexToRgba(color, Number(opacity))}`;
}
const ICON_SIZE: Record<string, string> = { sm: "1rem", md: "1.5rem", lg: "2.25rem", xl: "3rem" };
// Resolves a spacing value that may be either a legacy preset keyword
// ("sm"/"md"/"lg"/"xl"/"none") or a real CSS length the author typed
// ("42px", "2.5rem") — existing pages keep their preset look, new edits get
// free-form units. Duplicated in SectionBlock.astro like every other table.
function lengthValue(v: string | undefined, table: Record<string, string>, fallback: string) {
  if (!v) return fallback;
  return table[v] ?? v;
}

// Shared "one item per line, first `|` splits it in two" parser for
// accordion (question|answer) and tabs (label|content) — same simple
// delimited-line convention `list`'s items already uses, just two fields
// instead of one. Duplicated in SectionBlock.astro like every other table.
function parsePairs(raw: string | undefined): { a: string; b: string }[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("|");
      return i === -1 ? { a: line, b: "" } : { a: line.slice(0, i), b: line.slice(i + 1) };
    });
}

// Slider slide repeater. Storage is a JSON array (one object per slide) —
// the Embla Carousel rewrite's richer per-slide fields (multiple buttons,
// overlay color/opacity, text position) don't fit the old single
// imageUrl|heading|subtitle|buttonLabel|buttonHref line format. parseSlides()
// still accepts that legacy format too (JSON.parse throws on it, falls
// through) so a page saved before this change keeps opening/saving — it
// silently upgrades to the JSON format the next time it's edited here.
// SectionBlock.astro's render-side parser mirrors this same fallback, and
// validate-layout.ts's isSafeSlides() accepts both shapes on write.
interface SlideButton {
  label: string;
  href: string;
  variant: "primary" | "outline";
  color: string; // hex bg override, "" = theme default
  textColor: string; // hex text/border override, "" = theme default
  radius: string; // px number, "" = default pill radius
  size: "sm" | "md" | "lg";
  fontSize: string; // px number, "" = derive from size — set by the canvas resize handle
  // "flow" = original behavior, laid out inside the slide's text block
  // alongside heading/subtitle; "custom" = absolutely positioned anywhere
  // in the slide via x/y percent (drag-placed or preset-snapped below).
  position: "flow" | "custom";
  x: string; // "0".."100", only meaningful when position === "custom"
  y: string;
}
// Baseline px used as the resize-handle drag's starting point when a button
// has no explicit fontSize yet — purely a UI convenience, not stored.
const SIZE_PX: Record<SlideButton["size"], number> = { sm: 13, md: 16, lg: 20 };
interface SlideItem {
  imageUrl: string;
  bgColor: string; // hex fallback fill behind the image (or the whole slide when there's no image) — "" = transparent
  heading: SlideText;
  subtitle: SlideText;
  textPosition: "left" | "center" | "right";
  overlayColor: string;
  overlayOpacity: string; // "0".."100"
  buttons: SlideButton[];
}
// Same "flow vs custom x/y" idea buttons already have, applied to the
// heading/subtitle too — the shared shape both extend is `Positionable`,
// used by dragPosition/nudgePosition/PositionEditor so all three item kinds
// (heading, subtitle, button) drive the exact same drag/nudge/preset code.
interface Positionable {
  position: "flow" | "custom";
  x: string;
  y: string;
}
// Deliberately NOT `Positionable` — heading/subtitle tried free x/y placement
// (like buttons) and it felt wrong in practice ("tiba2 jd tak best la heading
// dan subtitle sama macam button"): dropped in favor of a plain `align`
// select, the same left/center/right control the standalone heading/text
// element types already use (`designer-f-align`), and `fontSize` moved from
// a canvas resize-handle to a typed number input next to it — a "Typography"
// mini-section, not a drag interaction.
// `Positionable` again (canvas hand-drag/resize for heading/subtitle stays —
// only the Inspector's minimap went away, replaced by a simple align
// icon-row, same ALIGN_ICON control the standard heading/text element types
// already use). `align` only matters while `position === "flow"` (it's the
// text-align inside the shared content block); it's ignored once dragged to
// a custom x/y, same as a standalone positioned box has no "alignment".
// Typography fields mirror TYPOGRAPHY_FIELDS' own keys/options exactly (see
// below) so the Inspector can render them by literally reusing that same
// field list + FieldInput, rather than a second hand-written set of
// fontWeight/textTransform/etc. controls — kept in lockstep by construction.
interface SlideText extends Positionable {
  text: string;
  color: string; // hex text-color override, "" = inherit the slide's default
  fontSize: string; // px, "" = derive from TEXT_BASE_PX below — set by canvas resize handle
  width: string; // px, "" = auto (shrink-to-fit the widest rendered line, see fitTextBox) — set by the mid-edge drag handle so a line can be dragged wider before it wraps
  align: "left" | "center" | "right";
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  fontStyle: string;
  textDecoration: string;
  // Same "tablet:<key>"/"mobile:<key>" bag shape as Section/Col/El's own
  // `bp` — but unlike those (admin-preview only), this one IS real on the
  // published site (SectionBlock.astro's slideTextStyleBp), same convention
  // as the Visibility toggle above it. Only fontSize/align expose a BpToggle
  // right now; the bag itself isn't restricted to just those two keys.
  bp?: Record<string, string>;
}
const TEXT_DEFAULTS: SlideText = {
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
};
// Baseline px used as the canvas resize handle's starting point when
// heading/subtitle have no explicit fontSize yet (mirrors SIZE_PX for
// buttons, just no discrete sm/md/lg enum of their own to derive from).
const TEXT_BASE_PX = { heading: 20, subtitle: 13 };
// Mirrors SectionBlock.astro's fluidClamp/fluidFontSize math (real site:
// clamp(floor, vw, ceiling)) but evaluated in JS against a fixed reference
// width per breakpoint instead of an actual `vw` unit — the Blocks canvas's
// "bp" preview is just a max-width box inside the admin's own full browser
// window (Designer.tsx's `style={{ maxWidth: ... }}` on the canvas), so a
// real `vw`/`clamp()` here would measure the admin's actual (probably wide)
// window, not this simulated container, and never visibly shrink. This gives
// the canvas an accurate preview of how the real fluid font-size will look
// small instead of staying full (and overflowing) size regardless of bp.
const BP_REFERENCE_PX: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 1000, tablet: 768, mobile: 384 };
function fluidPreviewPx(px: number, bp: "desktop" | "tablet" | "mobile"): number {
  const floor = Math.max(14, Math.round(px * 0.55));
  const scaled = Math.round((px * BP_REFERENCE_PX[bp]) / 1000);
  return Math.min(px, Math.max(floor, scaled));
}
// Mirrors SectionBlock.astro's own SLIDER_HEIGHT table — legacy pages saved
// before the height field became free-form ("length" kind, below) still
// store one of these keywords; resolving it here lets the canvas preview
// show the real height for those too, not just newly-typed literal values.
const SLIDER_HEIGHT: Record<string, string> = { sm: "24rem", md: "32rem", lg: "42rem", full: "100vh" };
// Sizes the dashed resize box to the widest actually-rendered line of
// (possibly wrapped) text. No CSS value can do this: `width:fit-content`
// resolves to min(max-content, available), and the moment text wraps,
// max-content (its unwrapped width) exceeds available — so it collapses to
// the full container width and the box floats far past the glyphs. That was
// the real cause behind three failed attempts at this (nowrap, lineHeight,
// w-fit). Range.getClientRects() returns one rect per rendered line box, so
// the widest of those is the true ink width. Called from an inline ref
// callback (a new function identity each render, so React re-runs it every
// render) rather than a layout effect, since ElPreview is a plain function,
// not a component that can hold hooks.
function fitTextBox(node: HTMLElement | null): void {
  if (!node) return;
  node.style.width = "";
  const text = node.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) return;
  const widest = Math.max(...rects.map((r) => r.width));
  if (widest <= 0) return;
  // Tailwind sets box-sizing:border-box globally, so `width` has to include
  // the chip's own border/padding or the last glyph gets clipped.
  const cs = getComputedStyle(node);
  const extra =
    parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  node.style.width = `${Math.ceil(widest) + extra}px`;
}
// Heading/subtitle were plain strings before this upgrade — a string input
// here means legacy content, wrapped into TEXT_DEFAULTS with that string as
// `text` (same JSON-then-legacy-shape fallback convention as everywhere else
// in this file), so a page saved before this change keeps opening/saving
// and silently upgrades the next time its slider is edited.
function parseSlideText(raw: unknown): SlideText {
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
const SLIDE_DEFAULTS = { bgColor: "", textPosition: "center" as const, overlayColor: "#000000", overlayOpacity: "35" };
const BUTTON_DEFAULTS: SlideButton = {
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
// 3x3 anchor grid offered as one-click shortcuts — clicking a dot just sets
// x/y to a canonical spot and switches position to "custom"; there's no
// separate named-preset enum to keep in sync between admin/frontend/
// validator, presets are purely a UI convenience over the same x/y percent
// every custom-dragged button already uses.
const POSITION_PRESETS: { x: string; y: string }[] = [
  { x: "10", y: "15" }, { x: "50", y: "15" }, { x: "90", y: "15" },
  { x: "10", y: "50" }, { x: "50", y: "50" }, { x: "90", y: "50" },
  { x: "10", y: "85" }, { x: "50", y: "85" }, { x: "90", y: "85" },
];
// Click-or-drag inside a position minimap: computes percent from the
// pointerdown target's own bounding box (captured once, cheap — the
// minimap doesn't resize mid-drag) and tracks the pointer on window until
// release. Plain function, not a hook — safe to call from inside a .map().
function dragPosition(e: React.PointerEvent<HTMLDivElement>, onMove: (x: string, y: string) => void) {
  const rect = e.currentTarget.getBoundingClientRect();
  const set = (clientX: number, clientY: number) => {
    const x = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)));
    onMove(String(x), String(y));
  };
  set(e.clientX, e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientX, ev.clientY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
const POSITION_NUDGE_STEP = 2; // percent per arrow-key press
// Arrow-key nudge for whichever canvas chip (button, heading, or subtitle)
// currently has keyboard focus — same x/y percent space as
// dragPosition/POSITION_PRESETS above, just a smaller fixed step instead of
// a pointer position. Generic over `Positionable` since a still-"flow" item
// of any of the three kinds has no x/y yet — the first nudge starts it from
// the shared 50/50 center and switches it to "custom", same as dragging does.
function nudgePosition<T extends Positionable>(item: T, key: string): Partial<T> | null {
  const dx = key === "ArrowLeft" ? -POSITION_NUDGE_STEP : key === "ArrowRight" ? POSITION_NUDGE_STEP : 0;
  const dy = key === "ArrowUp" ? -POSITION_NUDGE_STEP : key === "ArrowDown" ? POSITION_NUDGE_STEP : 0;
  if (dx === 0 && dy === 0) return null;
  const baseX = item.position === "custom" ? Number(item.x) : 50;
  const baseY = item.position === "custom" ? Number(item.y) : 50;
  return {
    position: "custom",
    x: String(Math.min(100, Math.max(0, baseX + dx))),
    y: String(Math.min(100, Math.max(0, baseY + dy))),
  } as Partial<T>;
}
// Minimal DOMRect-shaped bag — the canvas smart-guide math only ever needs
// these four numbers, and building a plain object (vs. a real DOMRect) keeps
// the dragged button's "virtual" rect (built from clientX/Y, not an actual
// live DOM node — it's mid-drag) the same type as every real rect it's
// compared against.
interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
type GapMark = { top: number; left: number; length: number };
// Figma-style "nearest neighbor" spacing tick: only returns a mark when the
// two rects don't overlap on that axis AND do overlap on the other (so the
// line has a sensible perpendicular anchor point) — a vertical gap needs
// x-overlap, a horizontal gap needs y-overlap. `axis` picks which one to
// compute; startMove below calls this once per axis per candidate and keeps
// only the smallest (nearest) result.
function edgeGap(a: EdgeRect, b: EdgeRect, boxRect: EdgeRect, axis: "v" | "h"): GapMark | null {
  if (axis === "v") {
    const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (xOverlap <= 0) return null;
    const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    if (a.bottom <= b.top) return { top: a.bottom - boxRect.top, left: midX - boxRect.left, length: b.top - a.bottom };
    if (b.bottom <= a.top) return { top: b.bottom - boxRect.top, left: midX - boxRect.left, length: a.top - b.bottom };
    return null;
  }
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (yOverlap <= 0) return null;
  const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  if (a.right <= b.left) return { top: midY - boxRect.top, left: a.right - boxRect.left, length: b.left - a.right };
  if (b.right <= a.left) return { top: midY - boxRect.top, left: b.right - boxRect.left, length: a.left - b.right };
  return null;
}
function parseSlideButtons(raw: unknown): SlideButton[] {
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
function parseSlides(raw: string | undefined): SlideItem[] {
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
function stringifySlides(items: SlideItem[]): string {
  return JSON.stringify(items);
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
  const anyMargin = cp.marginY || cp.marginX || cp.marginTop || cp.marginRight || cp.marginBottom || cp.marginLeft;
  const marginSide = (per: string, axis: string) => lengthValue(cp[per] || cp[axis], PAD, "0");
  return {
    background: cp.bg || undefined,
    padding: anyPadding
      ? `${padSide("paddingTop")} ${padSide("paddingRight")} ${padSide("paddingBottom")} ${padSide("paddingLeft")}`
      : undefined,
    margin: anyMargin
      ? `${marginSide("marginTop", "marginY")} ${marginSide("marginRight", "marginX")} ${marginSide("marginBottom", "marginY")} ${marginSide("marginLeft", "marginX")}`
      : undefined,
    alignSelf: cp.valign === "top" ? "start" : cp.valign === "bottom" ? "end" : cp.valign === "center" ? "center" : undefined,
    border: cp.border ? BORDER[cp.border] : undefined,
    boxShadow: shadowToCss(cp.shadow),
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
  // Element Inspector only — Content (raw data: text/src/href/items/etc) vs
  // Style (spacing + every other GROUP_META bucket) tabs, so a long element
  // like Heading doesn't force scrolling past Padding/Margin/Typography just
  // to reach the Text field, or vice versa.
  const [inspectorTab, setInspectorTab] = useState<"content" | "style">("content");
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
  // Whether ANY of `keys` has an override at the CURRENT bp — a FourSideControl
  // covers several side keys (paddingTop/Right/Bottom/Left) at once, so its own
  // toggle icon represents the group, not one key.
  function bpKeysOverridden(bag: Record<string, string> | undefined, keys: string[]): boolean {
    return !!bag && keys.some((k) => bag[bpKey(k)] !== undefined);
  }
  // Enabling an override seeds it at "" (falls through lengthValue's own
  // default-preset resolution until the author actually types a value) rather
  // than copying the resolved desktop value — simpler, and "no override yet
  // but the icon is now active" is itself a real, distinct state worth
  // showing. Disabling removes every one of `keys`' override entries.
  function toggleBpKeys(bag: Record<string, string> | undefined, keys: string[]): Record<string, string> {
    const has = bpKeysOverridden(bag, keys);
    const next = { ...(bag ?? {}) };
    for (const k of keys) {
      if (has) delete next[bpKey(k)];
      else next[bpKey(k)] = "";
    }
    return next;
  }
  // Whether a node's own Visibility toggle hides it on the CURRENT bp preview
  // — this is real (SectionBlock.astro renders the matching @media rule on
  // the published site), so the Blocks canvas ghosting it here isn't just
  // cosmetic, it's telling the truth about what a visitor at this breakpoint
  // would see. Never actually removed from the canvas though (best practice,
  // matches Elementor/Webflow): still fully visible-enough-to-click/edit,
  // just faded + labeled, since hiding it outright would make an author
  // unable to ever reach an element hidden on the bp they're currently
  // previewing.
  function hiddenAtBp(props: { hideDesktop?: string; hideTablet?: string; hideMobile?: string } | undefined): boolean {
    if (!props) return false;
    const key = bp === "desktop" ? "hideDesktop" : bp === "tablet" ? "hideTablet" : "hideMobile";
    return props[key] === "true";
  }
  function HiddenAtBpBadge({ hidden }: { hidden: boolean }) {
    if (!hidden) return null;
    const Icon = bp === "tablet" ? Tablet : Smartphone;
    return (
      <span className="absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-500 shadow-sm">
        <Icon className="h-2.5 w-2.5" /> {t("designer-hidden-at-bp")}
      </span>
    );
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
  const MARGIN_SIDE_KEYS = { top: "marginTop", right: "marginRight", bottom: "marginBottom", left: "marginLeft" } as const;
  // top/bottom fall back to the shared marginY value, left/right to marginX —
  // same fallback-chain convention as PADDING_SIDE_FALLBACK. Row keeps its
  // own margin top/bottom-only (a row already spans the full section width;
  // its Inspector control still passes sides={["top","bottom"]}).
  const MARGIN_SIDE_FALLBACK = { top: "marginY", right: "marginX", bottom: "marginY", left: "marginX" } as const;
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
    const borderWidth = v("borderWidth");
    const borderColor = v("borderColor");
    const borderStyle = v("borderStyle");
    const shadow = v("shadow");
    const opacity = v("opacity");
    const side = (side: keyof typeof PADDING_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]), PAD, side === "top" || side === "bottom" ? PAD.md : "1.5rem");
    const corner = (side: keyof typeof RADIUS_CORNER_KEYS) => {
      const raw = fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius");
      return lengthValue(raw, RADIUS, RADIUS.none);
    };
    const marginSide = (side: keyof typeof MARGIN_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), PAD, "0");
    return {
      background: bgImage ? `url(${bgImage}) center/cover` : v("bg") || "var(--color-bg, #ffffff)",
      color: v("textColor") || "inherit",
      padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}`,
      margin: `${marginSide("top")} ${marginSide("right")} ${marginSide("bottom")} ${marginSide("left")}`,
      // borderWidth set = the new real stroke fields win; otherwise fall
      // back to the legacy none/thin/thick preset so old pages don't move.
      ...(borderWidth
        ? { border: `${borderWidth}px ${borderStyle || "solid"} ${borderColor || "currentColor"}` }
        : border
          ? { border: BORDER[border] }
          : {}),
      boxShadow: shadowToCss(shadow),
      borderRadius: `${corner("top")} ${corner("right")} ${corner("bottom")} ${corner("left")}`,
      opacity: opacity ? Math.max(0, Math.min(100, Number(opacity))) / 100 : undefined,
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
    const side = (s: keyof typeof MARGIN_SIDE_KEYS) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[s], MARGIN_SIDE_FALLBACK[s]);
    const top = side("top");
    const right = side("right");
    const bottom = side("bottom");
    const left = side("left");
    if (!top && !right && !bottom && !left) return undefined;
    return {
      margin: `${lengthValue(top, SPACE, "0")} ${lengthValue(right, SPACE, "0")} ${lengthValue(bottom, SPACE, "0")} ${lengthValue(left, SPACE, "0")}`,
    };
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
  // Row's own margin/padding — no `bp` breakpoint bag on Row (desktop-only
  // for now, unlike Section/Column/Element), so this skips bpGetValue's
  // fallback chain and reads row.marginTop/paddingTop etc directly.
  // marginTop's default replaces the old fixed space-y-* gap between rows
  // (see the rows container below) — row 0 never got a leading gap under
  // that either, so it defaults to "0" instead.
  function rowMarginStyle(row: Row, isFirst: boolean): React.CSSProperties {
    return {
      marginTop: lengthValue(row.marginTop, SPACE, isFirst ? "0" : mode === "live" ? "2.5rem" : "1.25rem"),
      marginBottom: lengthValue(row.marginBottom, SPACE, "0"),
    };
  }
  function rowPaddingStyle(row: Row): React.CSSProperties | undefined {
    if (!row.paddingTop && !row.paddingRight && !row.paddingBottom && !row.paddingLeft) return undefined;
    const v = (x?: string) => lengthValue(x, PAD, "0");
    return { padding: `${v(row.paddingTop)} ${v(row.paddingRight)} ${v(row.paddingBottom)} ${v(row.paddingLeft)}` };
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
  // Naming step for "Save as template" — an in-app field, not window.prompt():
  // Chrome/Firefox silently suppress repeated JS dialogs in one tab ("prevent
  // this page from creating additional dialogs"), after which prompt() just
  // returns null instantly with no visible sign anything happened, which
  // made a real save look like a dead button.
  const [pendingTemplate, setPendingTemplate] = useState<{ kind: string; value: unknown } | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "section" | "row" | "column" | "element">("all");
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
  // Page-wide Designer defaults (currently just the default column gap) —
  // separate from `blocks`/history since it's not part of the undo stack,
  // same convention as slugDraft above. Persisted via save()'s `settings`.
  const [pageSettings, setPageSettings] = useState<{ gap?: string }>(() => (page.settings as { gap?: string }) ?? {});
  // i18n Phase 4 — same page-level, not-part-of-the-undo-stack treatment as
  // pageSettings above; persisted via save()'s `language` field.
  const [pageLanguage, setPageLanguage] = useState<string>((page.language as string | null) ?? "");
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  // i18n Phase 5 — site-wide master switch, plus this page's own opt-in;
  // the Translations block below is only offered when both are true.
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);
  const [pageMultilangEnabled, setPageMultilangEnabled] = useState<boolean>(Boolean(page.multilangEnabled));
  // i18n Phase 5 — every language's layout lives on this one page row (see
  // PostEditorPage's matching `content` map for the same idea applied to
  // posts' title/excerpt/body). `content[BASE_LANG]` mirrors the top-level
  // `layout` column (== `blocks`, the canvas's own driving state);
  // `content[code]` mirrors `page.translations[code].layout`. Pages have no
  // per-language title (Designer has no title editor at all), so only
  // `layout` varies.
  const [content, setContent] = useState<Record<string, Block[]>>(() => ({
    [BASE_LANG]: clone((page.layout as Block[] | undefined) ?? []),
    ...Object.fromEntries(
      Object.entries((page.translations as Record<string, { layout: Block[] }> | null) ?? {}).map(([code, v]) => [code, v.layout]),
    ),
  }));
  const [activeLang, setActiveLang] = useState(BASE_LANG);
  useEffect(() => {
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
      // Only for a page that has never had its own language explicitly
      // chosen — same "never override an explicit pick" rule as posts'.
      if (!(page.language as string | null) && d.defaultLanguage) {
        setPageLanguage(d.defaultLanguage);
      }
    });
  }, [tenantHost, token, page.id]);
  // Same "Language field doubles as the translation switcher, always the
  // SAME row" behavior as PostEditorPage's switchLanguage/clickLanguagePill
  // — see those for the full rule. Undo history is reset on switch: it's
  // scoped to whichever language's layout is currently open, not shared
  // across languages (undoing across two different languages' content
  // wouldn't mean anything).
  function switchPageLanguage(target: string) {
    if (target === activeLang) return;
    const leaving = clone(blocks);
    const targetLayout = content[target] ?? leaving;
    setContent((prev) => ({ ...prev, [activeLang]: leaving, [target]: targetLayout }));
    setBlocks(clone(targetLayout));
    setSel(null);
    history.current = [];
    future.current = [];
    setActiveLang(target);
  }
  function clickPageLanguagePill(code: string) {
    if (!pageLanguage) {
      setPageLanguage(code);
      setDirty(true);
      return;
    }
    switchPageLanguage(code === pageLanguage ? BASE_LANG : code);
  }
  // Figma-style spacing overlay: the hatched fill band only shows while the
  // matching handle is hovered or actively dragged, not for the whole
  // selected box's perimeter at once — a persistent 4-sided hatch on every
  // selection was too visually noisy (user feedback). The small "Npx" badge
  // itself still always shows once selected; only the colored band is gated.
  const [hoverBand, setHoverBand] = useState<string | null>(null);
  // A drag in progress must keep its band shown even once the mouse leaves
  // the small handle it started on — dragging moves the cursor away from
  // that ~20px hit target almost immediately, which used to fire
  // onMouseLeave and clear hoverBand right as the drag began (the band
  // would then only reappear if the cursor happened to re-enter a handle).
  // startSpacingDrag sets this before the first onMouseLeave can fire.
  const draggingBand = useRef(false);
  // When the four/two sides are linked (dragging one moves them all), a
  // single shared key for the whole group means hovering/dragging any one
  // handle shows every linked side's band together, not just the one edge
  // under the cursor — since they're all the same value anyway. Unlinked
  // sides keep their own distinct key, so only that one edge's band shows.
  const bandKey = (prefix: string, edge: string, linked: boolean) => (linked ? `${prefix}.*` : `${prefix}.${edge}`);
  const bandHoverProps = (key: string) => ({
    onMouseEnter: () => setHoverBand(key),
    onMouseLeave: () => {
      if (!draggingBand.current) setHoverBand((k) => (k === key ? null : k));
    },
  });
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  const drag = useRef<Drag | null>(null);
  const editingText = useRef<Record<string, string>>({});
  // Same stable-snapshot-while-typing pattern as editingText above, but for
  // slider heading/subtitle canvas-direct editing: keyed by `${el.id}:${itemKey}`
  // since a slider has two independently-editable text items, not one.
  const editingSliderText = useRef<Record<string, string>>({});
  // Which slider item (per element id) is currently in canvas-direct edit
  // mode — entered via double-click (single click/drag is already bound to
  // move), exited on blur.
  const [sliderEditingItem, setSliderEditingItem] = useState<Record<string, string | null>>({});
  // Slider button canvas drag: DOM refs for each slider element's own preview
  // box + text block (keyed by el.id, same convention as editingText above —
  // a flat single ref would get overwritten by whichever slider block
  // rendered last if a page has more than one), and the transient "smart
  // guide" state a drag shows (center-alignment lines + a text-block spacing
  // indicator) — tagged with elId so only the slider block actually being
  // dragged renders its own guide, not every slider on the page.
  // `items` is keyed "heading" | "subtitle" | "btn-<index>" — one flat map
  // for every draggable/resizable thing a slide can have, so the smart-guide
  // candidate search (below) doesn't need to special-case text vs buttons.
  const sliderPreviewRefs = useRef<Record<string, { box: HTMLElement | null; items: Record<string, HTMLElement | null> }>>(
    {},
  );
  // Which slide each slider element is previewing on the Blocks canvas, keyed
  // by element id (same per-element keying as sliderPreviewRefs — a page can
  // hold several sliders). The canvas used to hard-code slides[0], so adding a
  // button or editing text on slide 2+ appeared to do nothing at all: the
  // Inspector edits every slide, the canvas only ever drew the first one. The
  // dots along the bottom of the preview drive this now instead of being
  // decorative.
  const [sliderSlideIdx, setSliderSlideIdx] = useState<Record<string, number>>({});
  const [sliderGuide, setSliderGuide] = useState<{
    elId: string;
    vCenter: boolean;
    hCenter: boolean;
    // vGap = a vertical (top/bottom) spacing tick, hGap = a horizontal
    // (left/right) one — against whichever candidate (text block or another
    // button) is nearest on that axis, not every candidate at once.
    vGap: { top: number; left: number; length: number } | null;
    hGap: { top: number; left: number; length: number } | null;
    // vGapMatches/hGapMatches = every OTHER pair of items (not involving the
    // dragged one) whose own gap on that axis happens to equal vGap/hGap's
    // length — e.g. the two untouched buttons either side of the one being
    // dragged already sit 33px apart, same as the gap just formed by the
    // drag, so both get a tick, not just the dragged item's own nearest one.
    vGapMatches: { top: number; left: number; length: number }[];
    hGapMatches: { top: number; left: number; length: number }[];
    // alignX/alignY = a full-height/full-width pink guide line (box-relative
    // px) when the dragged item's own center lands on another item's center
    // on that axis — sibling-to-sibling alignment, distinct from vCenter/
    // hCenter above (which only snap to the slide box's own 50% center).
    alignX: number | null;
    alignY: number | null;
  } | null>(null);
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const liveFrame = activeSlot === "a" ? frameARef : frameBRef;

  // Uses the functional setState form so multiple mutate() calls fired
  // synchronously in the same tick each build on the PREVIOUS call's result
  // instead of all cloning the same pre-edit `blocks` closure value and
  // racing to overwrite each other. This came up for real: a "linked"
  // FourSideControl commit calls setSide once per side (sides.forEach) — 4
  // separate mutate() calls back to back — and with a plain `const next =
  // clone(blocks)` here, all 4 cloned the same stale snapshot and only the
  // LAST call's single-side change actually stuck (every other side's
  // change was silently discarded), even though the linked value looked
  // right in the input itself.
  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setBlocks((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
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
    bandKey?: string,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const base = clone(blocks);
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    draggingBand.current = true;
    if (bandKey) setHoverBand(bandKey);
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
      draggingBand.current = false;
      if (bandKey) setHoverBand((k) => (k === bandKey ? null : k));
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
        // Row has no data-designer-path of its own in SectionBlock.astro (only
        // section/column/element do), so a live-mode right-click can only ever
        // resolve to one of those 3 depths — 2 (row) is unreachable here, Row
        // right-click only works in Blocks mode.
        if (![1, 3, 4].includes(p.length) || !liveFrame.current) return;
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
        boxShadow: shadowToCss(sp.shadow),
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

  // Saveable at any selection depth — path[0] is always the containing
  // section's index regardless of depth, so this derives which level
  // (section/row/column/element) a given path actually points at. Defaults
  // to the left-click `sel` state, but the right-click context menu passes
  // its own `ctxMenu.path` explicitly — right-clicking an element never
  // updates `sel`, so relying on `sel` there silently no-ops on whatever was
  // previously (or never) left-click selected. Row is included because
  // clicking a section's background/grid area selects its Row, not the
  // section itself (see the Row Inspector note above) — without this, a
  // user trying to save "the whole section" via a background click always
  // hit a silently-disabled Save button.
  function templateKind(path: Sel = sel): "section" | "row" | "column" | "element" | null {
    if (!path || blocks[path[0]]?.type !== "section") return null;
    return path.length === 1
      ? "section"
      : path.length === 2
        ? "row"
        : path.length === 3
          ? "column"
          : path.length === 4
            ? "element"
            : null;
  }

  // Stages the save (opens the modal's inline name field) — the actual API
  // call happens in confirmSaveTemplate() once a name is entered.
  function saveAsTemplate(path: Sel = sel) {
    const kind = templateKind(path);
    if (!kind || !path) return;
    const value: unknown =
      kind === "section"
        ? blocks[path[0]]
        : kind === "row"
          ? section(blocks, path[0]).rows[path[1]]
          : kind === "column"
            ? section(blocks, path[0]).rows[path[1]].columns[path[2]]
            : section(blocks, path[0]).rows[path[1]].columns[path[2]].elements[path[3]];
    setShowTemplates(true);
    setTemplateName("");
    setPendingTemplate({ kind, value });
  }

  async function confirmSaveTemplate() {
    if (!pendingTemplate) return;
    const name = templateName.trim();
    if (!name) return;
    setTemplatesBusy(true);
    try {
      await api.createTemplate(tenantHost, token, name, pendingTemplate as unknown as Record<string, unknown>);
      setTemplates(await api.listTemplates(tenantHost, token));
      setPendingTemplate(null);
      setTemplateName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  // Pre-migration rows have no `kind`/`value` wrapper — `data` itself was
  // the raw section block, so a missing `kind` falls back to that shape.
  function insertTemplate(tpl: api.DesignTemplate) {
    const kind = tpl.data?.kind as "section" | "row" | "column" | "element" | undefined;
    const value = kind ? tpl.data.value : tpl.data;
    if (kind === "row") {
      if (!sel || sel.length < 1) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const b = sel[0];
      const index = sel.length >= 2 ? sel[1] + 1 : section(blocks, b).rows.length;
      mutate((bs) => section(bs, b).rows.splice(index, 0, clone(value) as Row));
    } else if (kind === "column" || kind === "element") {
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

  // Preloads the whole curated GOOGLE_FONTS list as one stylesheet so the
  // Typography font picker's dropdown can render every option in its own
  // face (not just whichever font is already applied somewhere) — same
  // batched-<link> approach ThemeForm uses for its own font pickers
  // (App.tsx, id="admin-font-picker-preview"), guarded by the same id since
  // this admin build never mounts both pages at once but the guard is free.
  useEffect(() => {
    if (document.getElementById("admin-font-picker-preview")) return;
    const link = document.createElement("link");
    link.id = "admin-font-picker-preview";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map((f) => `family=${encodeURIComponent(f)}`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, []);

  // Keeps a Google Font <link> in document.head for every distinct
  // fontFamily in use, so the canvas preview approximates the real render
  // (SectionBlock.astro/[...slug].astro do the equivalent server-side) —
  // covers fonts picked outside the curated GOOGLE_FONTS list above (hand-typed
  // names), which the batched preload doesn't include.
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

  function duplicateColumn(b: number, r: number, c: number) {
    mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(section(bs, b).rows[r].columns[c])));
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
  function duplicateRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(section(bs, b).rows[r])));
    bumpStructural();
  }
  function copyRow(b: number, r: number) {
    clipCopy("row", section(blocks, b).rows[r]);
  }
  function pasteRow(b: number, r: number) {
    const data = clipRead<Row>("row");
    if (data) {
      mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleRow(b: number, r: number) {
    const { columns: _columns, ...styleProps } = section(blocks, b).rows[r];
    styleCopy("row", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleRow(b: number, r: number) {
    const style = styleRead("row");
    if (style) mutate((bs) => Object.assign(section(bs, b).rows[r], style));
  }
  function setRowGap(b: number, r: number, gap: string | undefined) {
    mutate((bs) => {
      section(bs, b).rows[r].gap = gap;
    });
  }
  function setPageGap(gap: string | undefined) {
    setPageSettings((s) => ({ ...s, gap }));
    setDirty(true);
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
      // Commit whatever language is currently on the canvas before splitting
      // into the base `layout` column + `translations` (everything else) —
      // same pattern as PostEditorPage's save().
      const merged: Record<string, Block[]> = { ...content, [activeLang]: clone(blocks) };
      setContent(merged);
      const translations: Record<string, { layout: Block[] }> = {};
      for (const [code, layout] of Object.entries(merged)) {
        if (code !== BASE_LANG) translations[code] = { layout };
      }
      await api.updatePage(tenantHost, token, page.id as string, {
        layout: merged[BASE_LANG],
        translations,
        settings: pageSettings,
        language: pageLanguage || null,
        multilangEnabled: pageMultilangEnabled,
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
                      <div
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${selEq([b, r]) ? "bg-accent/10 text-accent" : "text-sub hover:bg-canvas"}`}
                        onClick={(e) => pick(e, [b, r])}
                      >
                        {t("designer-layers-row")} {r + 1}
                      </div>
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
    if (field.kind === "textarea") return <BufferedTextarea rows={4} className={base} value={value} onCommit={onChange} />;
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
          <BufferedInput className={base} value={value} placeholder="#" onCommit={onChange} />
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
          <BufferedInput className={base} value={value} placeholder="https://" onCommit={onChange} />
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
      // vh/vw added alongside the original px/%/em/rem so a field like the
      // slider's height can express "50% of the viewport height" or "the
      // full viewport" (100vh) directly, not just a fixed/relative-to-parent
      // length — every other "length" kind field (padding, radius, etc)
      // simply never uses those two units, no behavior change for them.
      const m = value.match(/^(-?\d*\.?\d+)(px|%|em|rem|vh|vw)$/);
      const num = m ? m[1] : "";
      const unit = m ? m[2] : "px";
      return (
        <div className="flex gap-2">
          {/* `base` includes `w-full`, which as a flex item's basis (100%)
              plus the select's own 20-width sibling overflows any narrow
              sidebar (Inspector panels run ~240-280px) — the number input
              would refuse to shrink small enough to fit, squeezing/hiding it
              next to the unit dropdown. `min-w-0 flex-1` instead lets it
              actually share the row properly. */}
          <BufferedInput
            type="number"
            step={unit === "em" || unit === "rem" ? 0.05 : 1}
            className={base.replace("w-full", "min-w-0 flex-1")}
            value={num}
            onCommit={(v) => onChange(v === "" ? "" : `${v}${unit}`)}
          />
          <select
            className={`${base.replace("w-full", "w-16")} shrink-0 px-1`}
            value={unit}
            onChange={(e) => onChange(`${num || "0"}${e.target.value}`)}
          >
            {["px", "%", "em", "rem", "vh", "vw"].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (field.kind === "font") return <FontPickerInput value={value} onChange={onChange} className={base} />;
    if (field.kind === "stepper") {
      const step = field.step ?? 1;
      const n = Number(value) || 0;
      const round = (x: number) => Math.round(x * 100) / 100;
      return (
        <div className="flex items-center rounded-lg border border-line/30 bg-canvas">
          <button type="button" onClick={() => onChange(String(round(n - step)))} className="px-2 py-1.5 text-sub hover:text-ink">
            <Minus className="h-3 w-3" />
          </button>
          <BufferedInput
            type="number"
            step={step}
            value={value}
            onCommit={onChange}
            className="w-full border-0 bg-transparent px-1 py-1.5 text-center text-xs outline-none"
          />
          <button type="button" onClick={() => onChange(String(round(n + step)))} className="px-2 py-1.5 text-sub hover:text-ink">
            <Plus className="h-3 w-3" />
          </button>
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
              <BufferedInput
                className={base}
                value={u}
                placeholder="https://"
                onCommit={(v) => setUrls(urls.map((x, j) => (j === i ? v : x)))}
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
    if (field.kind === "pairs") {
      const items = parsePairs(value);
      const setItems = (next: { a: string; b: string }[]) => onChange(next.map((it) => `${it.a}|${it.b}`).join("\n"));
      const [labelAKey, labelBKey] = field.subLabels ?? ["designer-f-accordion-question", "designer-f-accordion-answer"];
      return (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-line/30 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-sub">#{i + 1}</span>
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="text-[10px] font-semibold text-red-500"
                >
                  {t("designer-gallery-remove")}
                </button>
              </div>
              <BufferedInput
                className={base}
                value={it.a}
                placeholder={t(labelAKey)}
                onCommit={(v) => setItems(items.map((x, j) => (j === i ? { ...x, a: v } : x)))}
              />
              <BufferedTextarea
                rows={2}
                className={base}
                value={it.b}
                placeholder={t(labelBKey)}
                onCommit={(v) => setItems(items.map((x, j) => (j === i ? { ...x, b: v } : x)))}
              />
            </div>
          ))}
          <button
            onClick={() => setItems([...items, { a: "", b: "" }])}
            className="text-[11px] font-semibold text-accent"
          >
            {t("designer-pairs-add")}
          </button>
        </div>
      );
    }
    if (field.kind === "slides") {
      const items = parseSlides(value);
      // What an unset button colour actually resolves to, so the swatches can
      // preview the real default. Mirrors `.ds-btn-primary`'s
      // `var(--color-primary, #0f62fe)` fallback chain on the real site.
      const themePrimary = siteTheme?.primaryColor || "#0f62fe";
      // A slide's own card here is edited regardless of which slide the
      // Blocks canvas is currently previewing (sliderSlideIdx) — size/align/
      // color changes on an off-screen slide's card are real (same `update`
      // below every other field here uses) but invisible until you switch
      // the canvas to that slide, which reads as "setting has no effect".
      // Focusing any field inside a slide's card auto-switches the canvas
      // preview to that same slide, so what you're editing is always what
      // you're looking at.
      const activeSliderElId =
        sel && sel.length === 4
          ? (blocks[sel[0]]?.props as unknown as SectionProps)?.rows?.[sel[1]]?.columns?.[sel[2]]?.elements?.[sel[3]]?.id
          : undefined;
      const setItems = (next: SlideItem[]) => onChange(stringifySlides(next));
      const update = (i: number, patch: Partial<SlideItem>) =>
        setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      const updateButtons = (i: number, buttons: SlideButton[]) => update(i, { buttons });
      // Shared by the button card AND the heading/subtitle editors below —
      // same preset grid + drag-or-click minimap + keyboard nudge for
      // whichever `Positionable` is passed in, so all three item kinds edit
      // their x/y through identical UI.
      const renderPositionEditor = (
        pos: Positionable,
        onChange: (patch: Partial<Positionable>) => void,
        previewImage?: string,
      ) => (
        <div className="space-y-1 rounded border border-line/20 p-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-sub">{t("designer-f-slider-position")}</span>
            <button
              onClick={() => onChange({ position: "flow" })}
              className={`text-[10px] font-semibold ${pos.position === "flow" ? "text-accent" : "text-sub"}`}
            >
              {t("designer-f-slider-positionflow")}
            </button>
          </div>
          <div className="flex gap-2">
            <div className="grid w-16 shrink-0 grid-cols-3 gap-0.5">
              {POSITION_PRESETS.map((pp, pi) => (
                <button
                  key={pi}
                  onClick={() => onChange({ position: "custom", x: pp.x, y: pp.y })}
                  className="h-4 w-4 rounded-sm border border-line/40 bg-canvas hover:bg-accent/20"
                />
              ))}
            </div>
            <div
              tabIndex={0}
              className="relative h-16 flex-1 overflow-hidden rounded border border-line/30 bg-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
              style={previewImage ? { backgroundImage: `url(${previewImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              onPointerDown={(ev) => dragPosition(ev, (x, y) => onChange({ position: "custom", x, y }))}
              onKeyDown={(ev) => {
                const patch = nudgePosition(pos, ev.key);
                if (patch) {
                  ev.preventDefault();
                  onChange(patch);
                }
              }}
            >
              {pos.position === "custom" && (
                <div
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-accent shadow"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                />
              )}
            </div>
          </div>
        </div>
      );
      // Heading/subtitle's align control — the same icon-button row
      // (left/center/right) FieldInput already renders for the standalone
      // heading/text element types' own "align" field (see the
      // `field.kind === "select" && field.key === "align"` branch above).
      // No minimap here and no manual fontSize input: position/resize for
      // heading/subtitle are canvas-drag-only, exactly like buttons.
      const ALIGN_ICONS: Record<SlideText["align"], typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight };
      // bp-aware like every other field in this file now: on desktop, writes
      // `align` directly; on tablet/mobile, writes into `txt.bp` instead
      // (same "tablet:<key>"/"mobile:<key>" bag Section/Col/El use) — real on
      // the published site via SectionBlock.astro's slideTextStyleBp, not
      // just an admin-preview simulation.
      const renderTextAlign = (txt: SlideText, onChange: (patch: Partial<SlideText>) => void) => {
        const resolvedAlign = (bpGetValue(txt.align, txt.bp, "align") || "left") as SlideText["align"];
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-sub">{t("designer-f-align")}</span>
              <BpToggle
                active={bpKeysOverridden(txt.bp, ["align"])}
                onToggle={() => onChange({ bp: toggleBpKeys(txt.bp, ["align"]) })}
              />
            </div>
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((o) => {
                const Icon = ALIGN_ICONS[o];
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() =>
                      onChange(bp === "desktop" ? { align: o } : { bp: { ...(txt.bp ?? {}), [bpKey("align")]: o } })
                    }
                    title={o}
                    className={`flex-1 rounded-lg border p-1.5 ${
                      resolvedAlign === o ? "border-accent bg-accent/10 text-accent" : "border-line/30 text-sub hover:border-accent/40"
                    }`}
                  >
                    <Icon className="mx-auto h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      };
      // Heading/subtitle's font-family/weight/line-height/letter-spacing/
      // text-transform/italic/decoration controls — literally reuses
      // TYPOGRAPHY_FIELDS + FieldInput (the same field list/renderer the
      // standalone heading/text element types use for their own Style tab),
      // minus "color" since that already has its own dedicated swatch above.
      // FieldInput is a plain function (no hooks of its own), safe to call
      // directly in a .map() the same way ElPreview is called elsewhere here.
      // Canvas drag-to-resize is fast but imprecise — this gives an exact
      // numeric alternative for whoever wants a specific size instead of
      // eyeballing it. Reuses the standalone text element's own "Size" label
      // (same field name, no new i18n key) and the stepper kind already
      // built for lineHeight/letterSpacing above. Neither this nor the
      // canvas drag (startResize) clamps an upper bound — only a 1px floor.
      const SLIDE_TEXT_SIZE_FIELD: Field = { key: "fontSize", labelKey: "designer-f-size", kind: "stepper", step: 1 };
      const renderTypographyFields = (txt: SlideText, onChange: (patch: Partial<SlideText>) => void) => (
        <div className="space-y-1.5 rounded border border-line/20 p-2">
          <span className="text-[10px] font-semibold text-sub">{t("designer-group-typography")}</span>
          {TYPOGRAPHY_FIELDS.filter((f) => f.key !== "color").map((f) => (
            <div key={f.key} className="space-y-0.5">
              <span className="text-[9px] text-sub">{t(f.labelKey)}</span>
              {FieldInput({
                field: f,
                value: (txt as unknown as Record<string, string>)[f.key] ?? "",
                onChange: (v) => onChange({ [f.key]: v } as Partial<SlideText>),
              })}
            </div>
          ))}
        </div>
      );
      return (
        <div className="space-y-2">
          {items.map((s, i) => (
            <div
              key={i}
              className={`space-y-1.5 rounded-lg border p-2 ${
                activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) === i ? "border-accent" : "border-line/30"
              }`}
              onFocus={() => {
                // Skip the state write entirely when this card is already
                // the previewed slide (the common case — most field edits
                // happen on the slide already showing) so focusing/clicking
                // a control here never fires a react-state update+re-render
                // interleaved with that same click's own onChange, which is
                // exactly the kind of thing that can make a click silently
                // never land (focus fires before click in the browser's own
                // event order).
                if (activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) !== i) {
                  setSliderSlideIdx((m) => ({ ...m, [activeSliderElId]: i }));
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-sub">#{i + 1} {activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) === i ? `· ${t("designer-slide-previewing")}` : ""}</span>
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="text-[10px] font-semibold text-red-500"
                >
                  {t("designer-gallery-remove")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {s.imageUrl && <img src={s.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                <BufferedInput
                  className={base}
                  value={s.imageUrl}
                  placeholder={t("designer-f-slider-image")}
                  onCommit={(v) => update(i, { imageUrl: v })}
                />
                <label className="shrink-0 cursor-pointer text-[10px] font-semibold text-accent">
                  {uploading ? t("designer-uploading") : t("designer-upload")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f, (v) => update(i, { imageUrl: v }));
                    }}
                  />
                </label>
              </div>
              <label className="flex w-fit items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-bgcolor")}>
                <input
                  type="color"
                  value={s.bgColor || "#000000"}
                  onChange={(e) => update(i, { bgColor: e.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-line/30"
                />
                {t("designer-f-slider-bgcolor")}
                {s.bgColor && (
                  <button type="button" className="text-sub/70 hover:text-sub" onClick={() => update(i, { bgColor: "" })}>
                    ×
                  </button>
                )}
              </label>
              <div className="space-y-1.5 rounded border border-line/20 p-2">
                <span className="text-[10px] font-semibold text-sub">{t("designer-f-slider-heading")}</span>
                {/* Textarea, not a single-line input: heading/subtitle never
                    auto-wrap on the canvas or the real site anymore (see
                    textChip/slideTextStyle's white-space:pre) — the ONLY way
                    to get a second line is a literal newline, so Enter has to
                    actually insert one instead of just committing/blurring. */}
                <BufferedTextarea
                  rows={2}
                  className={base}
                  value={s.heading.text}
                  placeholder={t("designer-f-slider-heading")}
                  onCommit={(v) => update(i, { heading: { ...s.heading, text: v } })}
                />
                <label className="flex w-fit items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-textcolor")}>
                  <input
                    type="color"
                    value={s.heading.color || "#ffffff"}
                    onChange={(e) => update(i, { heading: { ...s.heading, color: e.target.value } })}
                    className="h-6 w-8 cursor-pointer rounded border border-line/30"
                  />
                  {s.heading.color && (
                    <button
                      onClick={() => update(i, { heading: { ...s.heading, color: "" } })}
                      className="font-semibold text-red-500"
                    >
                      ×
                    </button>
                  )}
                </label>
                <div className="space-y-0.5">
                  <span className="inline-flex items-center gap-1 text-[9px] text-sub">
                    {t(SLIDE_TEXT_SIZE_FIELD.labelKey)}
                    <BpToggle
                      active={bpKeysOverridden(s.heading.bp, ["fontSize"])}
                      onToggle={() => update(i, { heading: { ...s.heading, bp: toggleBpKeys(s.heading.bp, ["fontSize"]) } })}
                    />
                  </span>
                  {FieldInput({
                    field: SLIDE_TEXT_SIZE_FIELD,
                    value: bpGetValue(s.heading.fontSize, s.heading.bp, "fontSize") || String(TEXT_BASE_PX.heading),
                    onChange: (v) =>
                      update(i, {
                        heading:
                          bp === "desktop"
                            ? { ...s.heading, fontSize: v }
                            : { ...s.heading, bp: { ...(s.heading.bp ?? {}), [bpKey("fontSize")]: v } },
                      }),
                  })}
                </div>
                {renderTextAlign(s.heading, (patch) => update(i, { heading: { ...s.heading, ...patch } }))}
                {renderTypographyFields(s.heading, (patch) => update(i, { heading: { ...s.heading, ...patch } }))}
              </div>
              <div className="space-y-1.5 rounded border border-line/20 p-2">
                <span className="text-[10px] font-semibold text-sub">{t("designer-f-slider-subtitle")}</span>
                <BufferedTextarea
                  rows={2}
                  className={base}
                  value={s.subtitle.text}
                  placeholder={t("designer-f-slider-subtitle")}
                  onCommit={(v) => update(i, { subtitle: { ...s.subtitle, text: v } })}
                />
                <label className="flex w-fit items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-textcolor")}>
                  <input
                    type="color"
                    value={s.subtitle.color || "#ffffff"}
                    onChange={(e) => update(i, { subtitle: { ...s.subtitle, color: e.target.value } })}
                    className="h-6 w-8 cursor-pointer rounded border border-line/30"
                  />
                  {s.subtitle.color && (
                    <button
                      onClick={() => update(i, { subtitle: { ...s.subtitle, color: "" } })}
                      className="font-semibold text-red-500"
                    >
                      ×
                    </button>
                  )}
                </label>
                <div className="space-y-0.5">
                  <span className="inline-flex items-center gap-1 text-[9px] text-sub">
                    {t(SLIDE_TEXT_SIZE_FIELD.labelKey)}
                    <BpToggle
                      active={bpKeysOverridden(s.subtitle.bp, ["fontSize"])}
                      onToggle={() => update(i, { subtitle: { ...s.subtitle, bp: toggleBpKeys(s.subtitle.bp, ["fontSize"]) } })}
                    />
                  </span>
                  {FieldInput({
                    field: SLIDE_TEXT_SIZE_FIELD,
                    value: bpGetValue(s.subtitle.fontSize, s.subtitle.bp, "fontSize") || String(TEXT_BASE_PX.subtitle),
                    onChange: (v) =>
                      update(i, {
                        subtitle:
                          bp === "desktop"
                            ? { ...s.subtitle, fontSize: v }
                            : { ...s.subtitle, bp: { ...(s.subtitle.bp ?? {}), [bpKey("fontSize")]: v } },
                      }),
                  })}
                </div>
                {renderTextAlign(s.subtitle, (patch) => update(i, { subtitle: { ...s.subtitle, ...patch } }))}
                {renderTypographyFields(s.subtitle, (patch) => update(i, { subtitle: { ...s.subtitle, ...patch } }))}
              </div>
              <div className="flex gap-2">
                <select
                  className={`${base} w-1/2`}
                  value={s.textPosition}
                  onChange={(e) => update(i, { textPosition: e.target.value as SlideItem["textPosition"] })}
                  title={t("designer-f-slider-textposition")}
                >
                  {(["left", "center", "right"] as const).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={s.overlayColor || "#000000"}
                  onChange={(e) => update(i, { overlayColor: e.target.value })}
                  title={t("designer-f-slider-overlaycolor")}
                  className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line/30"
                />
                <BufferedInput
                  type="number"
                  className={`${base} w-1/2`}
                  value={s.overlayOpacity}
                  placeholder={t("designer-f-slider-overlayopacity")}
                  onCommit={(v) => update(i, { overlayOpacity: v })}
                />
              </div>
              <div className="space-y-1.5 rounded-lg border border-line/20 p-1.5">
                {s.buttons.map((btn, bi) => {
                  const updateBtn = (patch: Partial<SlideButton>) =>
                    updateButtons(i, s.buttons.map((x, j) => (j === bi ? { ...x, ...patch } : x)));
                  return (
                    <div key={bi} className="space-y-1.5 rounded border border-line/20 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-sub">
                          {t("designer-f-slider-button")} #{bi + 1}
                        </span>
                        <button
                          onClick={() => updateButtons(i, s.buttons.filter((_, j) => j !== bi))}
                          className="text-[10px] font-semibold text-red-500"
                        >
                          {t("designer-gallery-remove")}
                        </button>
                      </div>
                      <BufferedInput
                        className={base}
                        value={btn.label}
                        placeholder={t("designer-f-slider-buttonlabel")}
                        onCommit={(v) => updateBtn({ label: v })}
                      />
                      <BufferedInput
                        className={base}
                        value={btn.href}
                        placeholder={t("designer-f-slider-buttonhref")}
                        onCommit={(v) => updateBtn({ href: v })}
                      />
                      <div className="flex items-center gap-1.5">
                        <select
                          className={`${base} flex-1`}
                          value={btn.variant}
                          onChange={(e) => updateBtn({ variant: e.target.value as SlideButton["variant"] })}
                        >
                          <option value="primary">primary</option>
                          <option value="outline">outline</option>
                        </select>
                        <select
                          className={`${base} flex-1`}
                          value={btn.size}
                          onChange={(e) => updateBtn({ size: e.target.value as SlideButton["size"] })}
                          title={t("designer-f-slider-buttonsize")}
                        >
                          <option value="sm">sm</option>
                          <option value="md">md</option>
                          <option value="lg">lg</option>
                        </select>
                        <BufferedInput
                          type="number"
                          className={`${base} w-16 shrink-0`}
                          value={btn.radius}
                          placeholder={t("designer-f-slider-buttonradius")}
                          onCommit={(v) => updateBtn({ radius: v })}
                        />
                      </div>
                      {/* Both swatches preview the value that's ACTUALLY in
                          effect when nothing is overridden — the site theme's
                          primary and its computed label colour — rather than an
                          arbitrary blue/white. Previously the swatch showed
                          #2563eb for an unset colour, which read as "this
                          button is blue" when the real default is the theme's
                          own colour. The reset button (shown only when there IS
                          something to reset) puts it back to that default. */}
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-buttoncolor")}>
                          <input
                            type="color"
                            value={btn.color || themePrimary}
                            onChange={(e) => updateBtn({ color: e.target.value })}
                            className="h-6 w-8 cursor-pointer rounded border border-line/30"
                          />
                          {btn.color && (
                            <button
                              onClick={() => updateBtn({ color: "" })}
                              title={t("designer-reset-default")}
                              className="font-semibold text-red-500"
                            >
                              ×
                            </button>
                          )}
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-buttontextcolor")}>
                          <input
                            type="color"
                            value={btn.textColor || bestTextColor(btn.color || themePrimary)}
                            onChange={(e) => updateBtn({ textColor: e.target.value })}
                            className="h-6 w-8 cursor-pointer rounded border border-line/30"
                          />
                          {btn.textColor && (
                            <button
                              onClick={() => updateBtn({ textColor: "" })}
                              title={t("designer-reset-default")}
                              className="font-semibold text-red-500"
                            >
                              ×
                            </button>
                          )}
                        </label>
                      </div>
                      {renderPositionEditor(btn, (patch) => updateBtn(patch), s.imageUrl)}
                    </div>
                  );
                })}
                <button
                  onClick={() => updateButtons(i, [...s.buttons, { ...BUTTON_DEFAULTS }])}
                  className="text-[11px] font-semibold text-accent"
                >
                  {t("designer-slides-add-button")}
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() =>
              setItems([
                ...items,
                { imageUrl: "", heading: { ...TEXT_DEFAULTS }, subtitle: { ...TEXT_DEFAULTS }, ...SLIDE_DEFAULTS, buttons: [] },
              ])
            }
            className="text-[11px] font-semibold text-accent"
          >
            {t("designer-slides-add")}
          </button>
        </div>
      );
    }
    if (field.kind === "shadow") {
      const legacyDefault = value && value in LEGACY_SHADOW && value !== "none";
      const parts = value.includes("|") ? value.split("|") : legacyDefault ? SHADOW_DEFAULT_PARTS : null;
      if (!parts) {
        return (
          <button
            type="button"
            onClick={() => onChange(SHADOW_DEFAULT_PARTS.join("|"))}
            className="w-full rounded-lg border border-dashed border-line/40 py-1.5 text-[11px] font-semibold text-accent"
          >
            {t("designer-shadow-add")}
          </button>
        );
      }
      const [x, y, blur, spread, color, opacity] = parts;
      const commit = (i: number, v: string) => {
        const next = [x, y, blur, spread, color, opacity];
        next[i] = v;
        onChange(next.join("|"));
      };
      return (
        <div className="space-y-2 rounded-lg border border-line/30 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberStepper label="X" value={x} onCommit={(v) => commit(0, v)} />
            <NumberStepper label="Y" value={y} onCommit={(v) => commit(1, v)} />
            <NumberStepper label={t("designer-shadow-blur")} value={blur} min={0} onCommit={(v) => commit(2, v)} />
            <NumberStepper label={t("designer-shadow-spread")} value={spread} onCommit={(v) => commit(3, v)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color || "#000000"}
              onChange={(e) => commit(4, e.target.value)}
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line/30"
            />
            <div className="flex-1">
              <NumberStepper
                label={t("designer-shadow-opacity")}
                value={opacity}
                step={0.05}
                min={0}
                onCommit={(v) => commit(5, String(Math.min(1, Number(v))))}
              />
            </div>
          </div>
          <button type="button" onClick={() => onChange("")} className="text-[10px] font-semibold text-sub hover:text-red-500">
            {t("designer-shadow-remove")}
          </button>
        </div>
      );
    }
    return <BufferedInput className={base} value={value} onCommit={onChange} />;
  }

  // Local-buffered text input: typing updates only this component's own
  // state (cheap) instead of committing on every keystroke — commit
  // (calling onCommit, which runs the real mutate()/history-clone) happens
  // on blur or Enter instead. Every Inspector field used to call onCommit
  // straight from onChange, so on a page with many sections/rows, typing a
  // padding/margin number (or any text field) re-cloned the whole block
  // tree per character — laggy, and occasionally dropped/misplaced
  // keystrokes since a slow re-render can land after focus has already
  // moved. useEffect only re-syncs from the external value while NOT
  // focused, so an in-progress edit is never clobbered by, e.g., a canvas
  // drag changing the same value elsewhere.
  function BufferedInput({
    value,
    onCommit,
    className,
    type,
    placeholder,
    title,
    step,
  }: {
    value: string;
    onCommit: (v: string) => void;
    className?: string;
    type?: string;
    placeholder?: string;
    title?: string;
    step?: number;
  }) {
    const [draft, setDraft] = useState(value);
    const focused = useRef(false);
    useEffect(() => {
      if (!focused.current) setDraft(value);
    }, [value]);
    return (
      <input
        type={type}
        step={step}
        className={className}
        placeholder={placeholder}
        title={title}
        value={draft}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    );
  }
  function BufferedTextarea({
    value,
    onCommit,
    className,
    rows,
    placeholder,
  }: {
    value: string;
    onCommit: (v: string) => void;
    className?: string;
    rows?: number;
    placeholder?: string;
  }) {
    const [draft, setDraft] = useState(value);
    const focused = useRef(false);
    useEffect(() => {
      if (!focused.current) setDraft(value);
    }, [value]);
    return (
      <textarea
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={draft}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          if (draft !== value) onCommit(draft);
        }}
      />
    );
  }

  // Typeable/scrollable Google Font picker — mirrors App.tsx's ThemeForm
  // FontField exactly (typing filters a dropdown of matches, each option
  // rendered in its own font-family so it previews rather than just naming
  // itself), but with no <label> of its own since FieldInput's other kinds
  // are bare controls — FieldGroups/renderTypographyFields already render
  // the field's label above it.
  function FontPickerInput({
    value,
    onChange,
    className,
  }: {
    value: string;
    onChange: (v: string) => void;
    className?: string;
  }) {
    const [open, setOpen] = useState(false);
    const matches = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(value.toLowerCase()));
    return (
      <div className="relative">
        <input
          className={className}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Poppins"
        />
        {open && matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line/30 bg-white shadow-lg">
            {matches.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onMouseDown={() => {
                    onChange(f);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                  style={{ fontFamily: f }}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // "Volume up/down" style numeric stepper — a BufferedInput flanked by
  // −/+ buttons, used by the shadow panel's X/Y/blur/spread fields (no
  // preset dropdown; user explicitly asked for real numbers here).
  function NumberStepper({
    label,
    value,
    step = 1,
    min,
    onCommit,
  }: {
    label: string;
    value: string;
    step?: number;
    min?: number;
    onCommit: (v: string) => void;
  }) {
    const n = Number(value) || 0;
    const round = (x: number) => Math.round(x * 100) / 100;
    return (
      <label className="block text-[10px] font-medium text-sub">
        {label}
        <div className="mt-0.5 flex items-center rounded-lg border border-line/30 bg-canvas">
          <button
            type="button"
            onClick={() => onCommit(String(round(Math.max(min ?? -Infinity, n - step))))}
            className="px-2 py-1 text-sub hover:text-ink"
          >
            −
          </button>
          <BufferedInput
            type="number"
            step={step}
            value={value}
            onCommit={onCommit}
            className="w-full border-0 bg-transparent px-1 py-1 text-center text-[11px] outline-none"
          />
          <button type="button" onClick={() => onCommit(String(round(n + step)))} className="px-2 py-1 text-sub hover:text-ink">
            +
          </button>
        </div>
      </label>
    );
  }

  // Figma/Elementor-style four-side control: linked shows one input that
  // sets all 4 sides/corners equal; unlinked shows independent Top/Right/
  // Bottom/Left inputs. Values are whatever fourSideValue() resolves —
  // either a per-side override or the shared axis/preset fallback.
  // Small Tablet/Smartphone tag next to a setting's own label — reminds you
  // which screen the value you're looking at/editing actually belongs to,
  // since every bp-aware field already silently shows/writes a per-
  // breakpoint override the moment the global bp toggle (bar Monitor/Tablet/
  // Smartphone icons, see `bp` state) leaves "desktop", with no other visual
  // cue on the field itself. Renders nothing on desktop — that's the
  // implicit default, no tag needed for it.
  // Elementor/Webflow-style per-field responsive toggle: a small Tablet/
  // Smartphone icon next to a setting's own label, filled/accent when THIS
  // field (or, for FourSideControl, any of its side keys) actually has an
  // override at the current bp, muted/outline when it's just inheriting the
  // desktop value. Clicking toggles between the two — enabling seeds the
  // override at "" (falls through to the normal default-preset resolution
  // until typed over), disabling removes it. Renders nothing on desktop —
  // there's nothing to override against on the base breakpoint itself.
  function BpToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
    if (bp === "desktop") return null;
    const Icon = bp === "tablet" ? Tablet : Smartphone;
    return (
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onToggle();
        }}
        title={t(active ? "designer-bp-override-clear" : "designer-bp-override-set")}
        className={`inline-flex rounded p-0.5 ${active ? "text-accent" : "text-sub/40 hover:text-sub"}`}
      >
        <Icon className="h-3 w-3" />
      </button>
    );
  }

  function FourSideControl({
    labelKey,
    icon: Icon,
    linked,
    onToggleLink,
    getSide,
    setSide,
    sides = ["top", "right", "bottom", "left"],
    hasOverride,
    onToggleOverride,
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
    // Omitted entirely for a node with no `bp` bag at all (Row) — the toggle
    // then simply never renders, same as being on desktop.
    hasOverride?: boolean;
    onToggleOverride?: () => void;
  }) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-body">
          <span className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
            {hasOverride !== undefined && onToggleOverride && <BpToggle active={hasOverride} onToggle={onToggleOverride} />}
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
          <BufferedInput
            className="w-full rounded-lg border border-line/30 bg-white px-2 py-1.5 text-[11px]"
            value={getSide(sides[0])}
            onCommit={(v) => sides.forEach((s) => setSide(s, v))}
          />
        ) : (
          <div className={`grid gap-1 ${sides.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
            {sides.map((s) => (
              <BufferedInput
                key={s}
                className="w-full rounded-lg border border-line/30 bg-white px-1 py-1.5 text-center text-[11px]"
                value={getSide(s)}
                placeholder={s[0].toUpperCase()}
                title={s}
                onCommit={(v) => setSide(s, v)}
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
    only,
    hasOverride,
    onToggleOverride,
  }: {
    fields: Field[];
    getValue: (f: Field) => string;
    setValue: (f: Field, v: string) => void;
    // Element Inspector's Content/Style tabs (see hasContentFields below)
    // reuse this same bucketing instead of a separate content-vs-style
    // split — "content" is its own tab, every other bucket is "style".
    only?: "content" | "style";
    // Per-field bp-override toggle (BpToggle) — omitted for a node with no
    // `bp` bag (none currently omit it; Row doesn't use FieldGroups at all).
    hasOverride?: (f: Field) => boolean;
    onToggleOverride?: (f: Field) => void;
  }) {
    const buckets: Partial<Record<FieldGroupKey, Field[]>> = {};
    for (const f of fields) {
      const g = FIELD_GROUP_BY_KEY[f.key] ?? "content";
      (buckets[g] ??= []).push(f);
    }
    return (
      <>
        {GROUP_META.filter((g) => buckets[g.key] && (!only || (g.key === "content") === (only === "content"))).map((g) => {
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
                      <span className="inline-flex items-center gap-1">
                        {FieldLabel(f.labelKey, t)}
                        {hasOverride && onToggleOverride && f.kind !== "slides" && (
                          <BpToggle active={hasOverride(f)} onToggle={() => onToggleOverride(f)} />
                        )}
                      </span>
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

  type VisKey = "hideDesktop" | "hideTablet" | "hideMobile";
  const VIS_ITEMS: { key: VisKey; icon: typeof Monitor }[] = [
    { key: "hideDesktop", icon: Monitor },
    { key: "hideTablet", icon: Tablet },
    { key: "hideMobile", icon: Smartphone },
  ];
  // Shared Section/Row/Column/Element visibility control — a real per-
  // breakpoint hide, unlike the `bp` style-override bag above (admin-preview
  // only): SectionBlock.astro renders these as actual @media display:none
  // rules on the published site (see hideCss() there). "Active" (highlighted)
  // means hidden on that screen, not shown — same on/off semantics as any
  // other toggle button in this file, just inverted from "visible".
  function VisibilityToggle({ get, set }: { get: (k: VisKey) => boolean; set: (k: VisKey, v: boolean) => void }) {
    return (
      <label className="block text-[11px] font-medium text-body">
        {t("designer-visibility")}
        <div className="mt-1 flex gap-1">
          {VIS_ITEMS.map(({ key, icon: Icon }) => {
            const hidden = get(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => set(key, !hidden)}
                title={t(hidden ? "designer-vis-hidden" : "designer-vis-visible")}
                className={`flex-1 rounded-lg border p-1.5 ${
                  hidden ? "border-red-300 bg-red-50 text-red-500" : "border-line/30 text-sub hover:border-accent/40"
                }`}
              >
                <Icon className="mx-auto h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </label>
    );
  }

  function templateKindLabel(kind: string): string {
    return kind === "row"
      ? t("designer-row")
      : kind === "column"
        ? t("designer-column")
        : kind === "element"
          ? t("designer-elements")
          : t("designer-section");
  }

  // Rough layout impression only ("shape2 susunan" — not a pixel-accurate
  // render, no real colors/fonts/media) so a list of 100+ templates stays
  // scannable without the cost/dependency of a real screenshot thumbnail
  // (would need a headless-browser render pipeline just for this). Every
  // kind normalizes to a rows[] shape so one render path covers all 4 —
  // row/column/element templates are just a 1-row (and 1-column) section.
  function TemplatePreview({ tpl }: { tpl: api.DesignTemplate }) {
    const kind = (tpl.data?.kind as string | undefined) ?? "section";
    const value = tpl.data?.kind ? tpl.data.value : tpl.data;
    const rows: Row[] =
      kind === "section"
        ? ((value as SectionProps).rows ?? [])
        : kind === "row"
          ? [value as Row]
          : kind === "column"
            ? [{ columns: [value as Col] } as Row]
            : [{ columns: [{ elements: [value as El] }] } as Row];
    return (
      <div className="flex h-14 flex-col gap-0.5 overflow-hidden rounded-md border border-line/30 bg-canvas/40 p-1">
        {rows.slice(0, 4).map((row, i) => (
          <div key={i} className="flex flex-1 gap-0.5">
            {(row.columns ?? []).slice(0, 5).map((col, j) => (
              <div key={j} className="flex flex-1 flex-col justify-center gap-[1px] rounded-sm bg-white/70 p-[1px]">
                {(col.elements ?? []).slice(0, 3).map((_, k) => (
                  <div key={k} className="h-[3px] w-full rounded-full bg-accent/40" />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function Inspector() {
    if (!sel) {
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-page-settings")}</p>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-page-gap")}
            <BufferedInput
              type="number"
              placeholder="32"
              value={String(gapPx(pageSettings.gap))}
              onCommit={(v) => setPageGap(v === "" ? undefined : `${v}px`)}
              className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
            />
          </label>
          {siteMultilangEnabled && (
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-body">{t("designer-page-language")}</label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-body">
              <input
                type="checkbox"
                checked={pageMultilangEnabled}
                onChange={(e) => {
                  setPageMultilangEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              {t("designer-page-multilang-enable")}
            </label>
            {pageMultilangEnabled ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {siteLanguages.map((l) => {
                  const slotKey = l.code === pageLanguage ? BASE_LANG : l.code;
                  const isCurrent = activeLang === slotKey;
                  const hasContent = Boolean(content[slotKey]);
                  const isBase = l.code === pageLanguage;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => clickPageLanguagePill(l.code)}
                      title={isBase ? t("posts-language-default-badge") : !pageLanguage || hasContent ? undefined : t("posts-translate-btn")}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        isBase ? "ring-2 ring-amber-400 ring-offset-1" : ""
                      } ${
                        isCurrent
                          ? "bg-accent text-white"
                          : hasContent
                            ? "bg-canvas text-ink hover:bg-[#e8e8ed]"
                            : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
                      }`}
                    >
                      {isBase && "★ "}{l.label}{!isCurrent && !hasContent && " +"}
                    </button>
                  );
                })}
              </div>
            ) : (
              <select
                value={pageLanguage || "__none"}
                onChange={(e) => {
                  setPageLanguage(e.target.value === "__none" ? "" : e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="__none">{t("designer-page-language-none")}</option>
                {siteLanguages.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            )}
          </div>
          )}
          <p className="text-[10px] text-sub">{t("designer-none-selected")}</p>
        </div>
      );
    }
    if (blocks[sel[0]]?.type !== "section") {
      return <p className="text-xs text-sub">{t("designer-none-selected")}</p>;
    }
    const [b, r, c, e] = sel;
    const sp = blocks[b].props as unknown as SectionProps;

    if (sel.length === 1) {
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-section")}</p>
          <VisibilityToggle
            get={(k) => (sp as unknown as Record<string, string>)[k] === "true"}
            set={(k, v) =>
              mutate((bs) => {
                (bs[b].props as Record<string, string>)[k] = v ? "true" : "";
              })
            }
          />
          <FourSideControl
            labelKey="designer-s-padding"
            icon={Frame}
            linked={linkedPadding}
            onToggleLink={() => setLinkedPadding((v) => !v)}
            getSide={(side) => fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side])}
            setSide={(side, v) => setFourSideValue(b, PADDING_SIDE_KEYS[side], v)}
            hasOverride={bpKeysOverridden(sp.bp, Object.values(PADDING_SIDE_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(PADDING_SIDE_KEYS));
              })
            }
          />
          <FourSideControl
            labelKey="designer-f-radius"
            icon={SquareDashedBottom}
            linked={linkedRadius}
            onToggleLink={() => setLinkedRadius((v) => !v)}
            getSide={(side) => fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius")}
            setSide={(side, v) => setFourSideValue(b, RADIUS_CORNER_KEYS[side], v)}
            hasOverride={bpKeysOverridden(sp.bp, Object.values(RADIUS_CORNER_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(RADIUS_CORNER_KEYS));
              })
            }
          />
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
            setSide={(side, v) => setFourSideValue(b, MARGIN_SIDE_KEYS[side], v)}
            hasOverride={bpKeysOverridden(sp.bp, Object.values(MARGIN_SIDE_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(MARGIN_SIDE_KEYS));
              })
            }
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
            hasOverride={(f) => bpKeysOverridden(sp.bp, [f.key])}
            onToggleOverride={(f) =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, [f.key]);
              })
            }
          />
        </div>
      );
    }
    if (sel.length === 2) {
      const row = sp.rows[r];
      if (!row) return null;
      const setRowSide = (key: string, v: string) =>
        mutate((bs) => {
          (section(bs, b).rows[r] as unknown as Record<string, string>)[key] = v;
        });
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-row")}</p>
          <VisibilityToggle
            get={(k) => (row as unknown as Record<string, string>)[k] === "true"}
            set={(k, v) => setRowSide(k, v ? "true" : "")}
          />
          <label className="block text-[11px] font-medium text-body">
            {t("designer-row-gap")}
            <BufferedInput
              type="number"
              placeholder={String(gapPx(pageSettings.gap) || 32)}
              value={String(gapPx(row.gap))}
              onCommit={(v) => setRowGap(b, r, v === "" ? undefined : `${v}px`)}
              className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
            />
          </label>
          <FourSideControl
            labelKey="designer-s-padding"
            icon={Frame}
            linked={linkedPadding}
            onToggleLink={() => setLinkedPadding((v) => !v)}
            getSide={(side) => (row as unknown as Record<string, string>)[PADDING_SIDE_KEYS[side]] ?? ""}
            setSide={(side, v) => setRowSide(PADDING_SIDE_KEYS[side], v)}
          />
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            sides={["top", "bottom"]}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => (row as unknown as Record<string, string>)[MARGIN_SIDE_KEYS[side as "top" | "bottom"]] ?? ""}
            setSide={(side, v) => setRowSide(MARGIN_SIDE_KEYS[side as "top" | "bottom"], v)}
          />
          <div className="flex gap-3">
            <button onClick={() => duplicateRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button onClick={() => copyRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => pasteRow(b, r)}
              disabled={!clipHas("row")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={() => copyStyleRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => pasteStyleRow(b, r)}
              disabled={!styleHas("row")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <button onClick={() => deleteRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete-row")}
          </button>
        </div>
      );
    }
    if (sel.length === 3) {
      const col = sp.rows[r]?.columns[c];
      if (!col) return null;
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-column")}</p>
          <VisibilityToggle
            get={(k) => col.props?.[k] === "true"}
            set={(k, v) =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.props = { ...(target.props ?? {}), [k]: v ? "true" : "" };
              })
            }
          />
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
            hasOverride={bpKeysOverridden(col.bp, Object.values(PADDING_SIDE_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
              })
            }
          />
          <FourSideControl
            labelKey="designer-f-radius"
            icon={SquareDashedBottom}
            linked={linkedRadius}
            onToggleLink={() => setLinkedRadius((v) => !v)}
            getSide={(side) => sideValue(col.props, col.bp, RADIUS_CORNER_KEYS[side], "radius")}
            setSide={(side, v) => setColSideValue(b, r, c, RADIUS_CORNER_KEYS[side], v)}
            hasOverride={bpKeysOverridden(col.bp, Object.values(RADIUS_CORNER_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
              })
            }
          />
          <FourSideControl
            labelKey="designer-f-marginy"
            icon={Frame}
            linked={linkedMargin}
            onToggleLink={() => setLinkedMargin((v) => !v)}
            getSide={(side) => sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
            setSide={(side, v) => setColSideValue(b, r, c, MARGIN_SIDE_KEYS[side], v)}
            hasOverride={bpKeysOverridden(col.bp, Object.values(MARGIN_SIDE_KEYS))}
            onToggleOverride={() =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
              })
            }
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
            hasOverride={(f) => bpKeysOverridden(col.bp, [f.key])}
            onToggleOverride={(f) =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, [f.key]);
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
          <button
            onClick={() => saveAsTemplate([b, r, c])}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent"
          >
            <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates-save")}
          </button>
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
      const elFields = [...def.fields, CSS_CLASS_FIELD];
      const hasContentFields = elFields.some((f) => (FIELD_GROUP_BY_KEY[f.key] ?? "content") === "content");
      const fieldGroupsProps = {
        fields: elFields,
        // "slides" is a structured JSON blob, not a simple style value — it
        // manages its own per-breakpoint overrides internally (each slide's
        // heading/subtitle has its own `SlideText.bp`, written by the
        // Text size/Alignment BpToggle inside the slides editor itself).
        // Routing it through the SAME generic bp mechanism as every other
        // field wrote a second, whole-array copy into `target.bp["mobile:
        // slides"]` on any edit made while previewing tablet/mobile — the
        // Inspector read that copy back (so it looked live), but the canvas
        // (ElPreview) reads `el.props.slides` directly and never checked
        // `el.bp`, so nothing ever appeared to change there. Bypassing bp
        // entirely for this one field/kind fixes both the data (edits land
        // in the one real `slides` string) and the ghost-toggle UI.
        getValue: (f: Field) => (f.kind === "slides" ? el.props[f.key] ?? "" : bpGetValue(el.props[f.key], el.bp, f.key)),
        setValue: (f: Field, v: string) =>
          mutate((bs) => {
            const target = section(bs, b).rows[r].columns[c].elements[e];
            if (bp === "desktop" || f.kind === "slides") {
              target.props[f.key] = v;
            } else {
              target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
            }
          }),
        hasOverride: (f: Field) => f.kind !== "slides" && bpKeysOverridden(el.bp, [f.key]),
        onToggleOverride: (f: Field) => {
          if (f.kind === "slides") return;
          mutate((bs) => {
            const target = section(bs, b).rows[r].columns[c].elements[e];
            target.bp = toggleBpKeys(target.bp, [f.key]);
          });
        },
      };
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t(def.labelKey)}</p>
          <VisibilityToggle
            get={(k) => el.props[k] === "true"}
            set={(k, v) =>
              mutate((bs) => {
                section(bs, b).rows[r].columns[c].elements[e].props[k] = v ? "true" : "";
              })
            }
          />
          {hasContentFields && (
            <div className="flex gap-1 rounded-full bg-canvas p-0.5">
              {(["content", "style"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setInspectorTab(tab)}
                  className={`flex-1 rounded-full py-1 text-[11px] font-semibold ${
                    inspectorTab === tab ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
                  }`}
                >
                  {t(tab === "content" ? "designer-inspector-tab-content" : "designer-inspector-tab-style")}
                </button>
              ))}
            </div>
          )}
          {(!hasContentFields || inspectorTab === "style") && (
            <>
              <FourSideControl
                labelKey="designer-s-padding"
                icon={Frame}
                linked={linkedPadding}
                onToggleLink={() => setLinkedPadding((v) => !v)}
                getSide={(side) => sideValue(el.props, el.bp, PADDING_SIDE_KEYS[side], "padding")}
                setSide={(side, v) => setElSideValue(b, r, c, e, PADDING_SIDE_KEYS[side], v)}
                hasOverride={bpKeysOverridden(el.bp, Object.values(PADDING_SIDE_KEYS))}
                onToggleOverride={() =>
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
                  })
                }
              />
              {(el.type === "image" || el.type === "embed" || el.type === "gallery") && (
                <FourSideControl
                  labelKey="designer-f-radius"
                  icon={SquareDashedBottom}
                  linked={linkedRadius}
                  onToggleLink={() => setLinkedRadius((v) => !v)}
                  getSide={(side) => sideValue(el.props, el.bp, RADIUS_CORNER_KEYS[side], "radius")}
                  setSide={(side, v) => setElSideValue(b, r, c, e, RADIUS_CORNER_KEYS[side], v)}
                  hasOverride={bpKeysOverridden(el.bp, Object.values(RADIUS_CORNER_KEYS))}
                  onToggleOverride={() =>
                    mutate((bs) => {
                      const target = section(bs, b).rows[r].columns[c].elements[e];
                      target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
                    })
                  }
                />
              )}
              <FourSideControl
                labelKey="designer-f-marginy"
                icon={Frame}
                linked={linkedMargin}
                onToggleLink={() => setLinkedMargin((v) => !v)}
                getSide={(side) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
                setSide={(side, v) => setElSideValue(b, r, c, e, MARGIN_SIDE_KEYS[side], v)}
                hasOverride={bpKeysOverridden(el.bp, Object.values(MARGIN_SIDE_KEYS))}
                onToggleOverride={() =>
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
                  })
                }
              />
              <FieldGroups {...fieldGroupsProps} only={hasContentFields ? "style" : undefined} />
            </>
          )}
          {hasContentFields && inspectorTab === "content" && <FieldGroups {...fieldGroupsProps} only="content" />}
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
            style={{ borderRadius: elRadius(p), boxShadow: shadowToCss(p.shadow), maxWidth: "100%" }}
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
            style={{ borderRadius: elRadius(p), boxShadow: shadowToCss(p.shadow) }}
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
      case "accordion": {
        const items = parsePairs(p.items);
        if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-accordion-items")}…</span>;
        return (
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="rounded-lg border border-line/30">
                <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  {it.a || `Q${i + 1}`}
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </div>
                {i === 0 && it.b && <div className="border-t border-line/20 px-3 py-2 text-xs text-sub">{it.b}</div>}
              </div>
            ))}
          </div>
        );
      }
      case "infobox": {
        const Icon = ICONS[p.name ?? "star"] ?? Star;
        const left = p.iconPosition === "left";
        return (
          <div className={left ? "flex items-start gap-3" : "space-y-2"} style={{ textAlign: p.align === "center" ? "center" : "left" }}>
            <Icon className={left ? "h-6 w-6 shrink-0" : "mx-auto h-6 w-6"} style={{ color: p.color || undefined, marginInline: left ? undefined : p.align === "center" ? "auto" : undefined }} />
            <div>
              <p className="text-sm font-bold">{p.heading || t("designer-f-infobox-heading")}</p>
              {p.text && <p className="mt-1 text-xs text-sub">{p.text}</p>}
            </div>
          </div>
        );
      }
      case "tabs": {
        const items = parsePairs(p.items);
        if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-tabs-items")}…</span>;
        return (
          <div className="rounded-lg border border-line/30">
            <div className="flex gap-1 border-b border-line/20 px-2 pt-1.5">
              {items.map((it, i) => (
                <span
                  key={i}
                  className={`rounded-t px-2.5 py-1 text-xs font-semibold ${i === 0 ? "bg-canvas text-ink" : "text-sub"}`}
                >
                  {it.a || `Tab ${i + 1}`}
                </span>
              ))}
            </div>
            <div className="px-3 py-2 text-xs text-sub">{items[0]?.b}</div>
          </div>
        );
      }
      case "slider": {
        const slides = parseSlides(p.slides);
        if (slides.length === 0) return <span className="text-xs opacity-40">{t("designer-f-slider-slides")}…</span>;
        // Clamped, not just defaulted: removing a slide can leave a stale
        // index pointing past the end of the array.
        const slideIdx = Math.min(sliderSlideIdx[el.id] ?? 0, slides.length - 1);
        const first = slides[slideIdx];
        if (!sliderPreviewRefs.current[el.id]) sliderPreviewRefs.current[el.id] = { box: null, items: {} };
        const previewRefs = sliderPreviewRefs.current[el.id];
        // One item ref covers all three draggable kinds this slide can have —
        // heading, subtitle, or a specific button — keyed into the same flat
        // `previewRefs.items` map so the smart-guide candidate search doesn't
        // need to special-case text vs buttons. Heading/subtitle keep the
        // same hand-drag/resize interaction buttons have; only the
        // Inspector's minimap went away for them (see renderTextAlign above),
        // replaced there by a plain align icon-row — dragging on the canvas
        // is still the only way to set a custom x/y, and the Inspector never
        // shows one for text, unlike buttons' full renderPositionEditor.
        type ItemRef = { kind: "heading" } | { kind: "subtitle" } | { kind: "button"; bi: number };
        const itemKey = (ref: ItemRef) => (ref.kind === "button" ? `btn-${ref.bi}` : ref.kind);
        // Canvas-direct drag/resize, same idea as the heading/text
        // contentEditable commit() above: always read the freshest slides off
        // `bs` inside mutate() rather than off the `first`/`slides` captured by
        // this render, since a pointermove fires many times per drag.
        const updateItem = (ref: ItemRef, patch: Record<string, unknown>) => {
          if (!path) return;
          const [b, r, c, e] = path;
          mutate((bs) => {
            const elx = section(bs, b).rows[r].columns[c].elements[e];
            const currentSlides = parseSlides(elx.props.slides);
            // slideIdx, not a hard-coded 0 — this was latent while the canvas
            // could only ever preview the first slide, but would silently
            // write a drag/resize onto slide 1 while you were looking at
            // slide 2 the moment that limitation was lifted.
            const s0 = currentSlides[slideIdx];
            if (!s0) return;
            // fontSize is the one dragged key that heading/subtitle also
            // expose a per-breakpoint override for (SlideText.bp, written by
            // the Inspector's BpToggle and honored by the real site). While
            // previewing tablet/mobile the drag has to land in that same bag,
            // matching where the Inspector's own stepper writes — otherwise a
            // drag edits the desktop size while the bp override keeps winning
            // on screen, so the handle would visibly do nothing. Everything
            // else (width/position/x/y) has no bp override and stays on base.
            const textPatch = (txt: SlideText): SlideText => {
              if (bp === "desktop" || patch.fontSize === undefined) return { ...txt, ...patch };
              const { fontSize, ...rest } = patch;
              return { ...txt, ...rest, bp: { ...(txt.bp ?? {}), [bpKey("fontSize")]: String(fontSize) } };
            };
            if (ref.kind === "heading") currentSlides[slideIdx] = { ...s0, heading: textPatch(s0.heading) };
            else if (ref.kind === "subtitle") currentSlides[slideIdx] = { ...s0, subtitle: textPatch(s0.subtitle) };
            else currentSlides[slideIdx] = { ...s0, buttons: s0.buttons.map((x, j) => (j === ref.bi ? { ...x, ...patch } : x)) };
            elx.props.slides = stringifySlides(currentSlides);
          });
        };
        // Drag-to-place: works from anywhere the item currently renders
        // (inline "flow" or an already-"custom" chip) — starting a drag
        // always switches it to "custom" at the pointer's position. Percent is
        // computed against the slide box itself (closest [data-slide-box]),
        // not the item's own small rect. While dragging, also snaps to the
        // box's own center on each axis within a small threshold (Figma-style
        // "smart guide") and shows spacing ticks (both vertical top/bottom AND
        // horizontal left/right) against whichever is nearest among every
        // OTHER item on this slide — all surfaced via `sliderGuide` state so
        // the render below can draw the actual guide lines.
        const CENTER_SNAP_THRESHOLD = 3; // percent
        const startMove = (ref: ItemRef, ev: React.PointerEvent<HTMLElement>) => {
          ev.stopPropagation();
          ev.preventDefault();
          const box = (ev.target as HTMLElement).closest<HTMLElement>("[data-slide-box]");
          if (!box) return;
          const rect = box.getBoundingClientRect();
          const key = itemKey(ref);
          // The dragged chip's own size, captured once at drag start — it
          // doesn't change size mid-drag, only position, so a snapshot is
          // enough to build its "virtual" rect around the live cursor point.
          const chipRect = previewRefs.items[key]?.getBoundingClientRect();
          const halfW = (chipRect?.width ?? 80) / 2;
          const halfH = (chipRect?.height ?? 32) / 2;
          const SIBLING_SNAP_PX = 6;
          const set = (clientX: number, clientY: number) => {
            let x = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
            let y = Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)));
            const vCenter = Math.abs(x - 50) <= CENTER_SNAP_THRESHOLD;
            const hCenter = Math.abs(y - 50) <= CENTER_SNAP_THRESHOLD;
            if (vCenter) x = 50;
            if (hCenter) y = 50;

            let snappedX = rect.left + (x / 100) * rect.width;
            let snappedY = rect.top + (y / 100) * rect.height;

            // Sibling alignment (Figma-style "smart guide"): snap this item
            // onto another item on either axis when close, independent of
            // the page-center snap above. Y only checks center-to-center
            // (heading centering under a button, etc); X also checks
            // left-edge-to-left-edge and right-edge-to-right-edge (not just
            // center) — three items stacked flush-left/flush-right is exactly
            // as common a layout as centered, and needed its own guide line.
            // Each X candidate carries TWO values that are only the same
            // number for a center-match: `snap` (where the DRAGGED item's own
            // center has to move to, used below to reposition it) and `line`
            // (the sibling's actual matched coordinate — its real left/right
            // edge or center, used only to draw the guide line). Drawing the
            // line at `snap` instead of `line` was a real bug: for an edge
            // match `snap` is offset from the true edge by the dragged item's
            // own half-width, so the line visibly sat away from the sibling's
            // actual edge whenever the two items weren't the same width.
            // Picks the nearest match overall, same "keep smallest" pattern
            // the vGap/hGap loop below uses.
            let alignX: number | null = null;
            let alignY: number | null = null;
            let snapCenterX: number | null = null;
            let bestDX = SIBLING_SNAP_PX;
            let bestDY = SIBLING_SNAP_PX;
            Object.entries(previewRefs.items).forEach(([k, node]) => {
              if (k === key || !node) return;
              const cr = node.getBoundingClientRect();
              const ccy = (cr.top + cr.bottom) / 2;
              const dy = Math.abs(snappedY - ccy);
              if (dy <= bestDY) {
                bestDY = dy;
                alignY = ccy - rect.top;
              }
              const ccx = (cr.left + cr.right) / 2;
              const xTargets = [
                { snap: ccx, line: ccx },
                { snap: cr.left + halfW, line: cr.left },
                { snap: cr.right - halfW, line: cr.right },
              ];
              for (const t of xTargets) {
                const dx = Math.abs(snappedX - t.snap);
                if (dx <= bestDX) {
                  bestDX = dx;
                  snapCenterX = t.snap;
                  alignX = t.line - rect.left;
                }
              }
            });
            if (snapCenterX !== null) {
              snappedX = snapCenterX;
              x = Math.round(((snapCenterX - rect.left) / rect.width) * 100);
            }
            if (alignY !== null) {
              snappedY = rect.top + alignY;
              y = Math.round((alignY / rect.height) * 100);
            }
            updateItem(ref, { position: "custom", x: String(x), y: String(y) });

            const dragRect: EdgeRect = { left: snappedX - halfW, right: snappedX + halfW, top: snappedY - halfH, bottom: snappedY + halfH };
            const others: EdgeRect[] = [];
            Object.entries(previewRefs.items).forEach(([k, node]) => {
              if (k !== key && node) others.push(node.getBoundingClientRect());
            });
            let vGap: GapMark | null = null;
            let hGap: GapMark | null = null;
            for (const c of others) {
              const v = edgeGap(dragRect, c, rect, "v");
              if (v && (!vGap || v.length < vGap.length)) vGap = v;
              const h = edgeGap(dragRect, c, rect, "h");
              if (h && (!hGap || h.length < hGap.length)) hGap = h;
            }
            // Equal-spacing check: does the gap the drag just formed match a
            // gap that ALREADY exists between two OTHER (non-dragged) items?
            // e.g. two untouched buttons either side of this one are already
            // 33px apart — surfacing that match too (not just the dragged
            // item's own nearest gap) is what actually reads as "aligned" to
            // someone eyeballing 3+ items in a row, matching Figma's own
            // equal-spacing guide. Compared by ROUNDED px (what the badge
            // actually displays), not raw sub-pixel distance — flex layout
            // can round two CSS-identical gaps to e.g. 31px vs 32px, and a
            // small float tolerance would flag those as "matching" while
            // still showing disagreeing numbers on screen, which reads as
            // broken rather than helpful.
            const vGapMatches: GapMark[] = [];
            const hGapMatches: GapMark[] = [];
            for (let i = 0; i < others.length; i++) {
              for (let j = i + 1; j < others.length; j++) {
                if (vGap) {
                  const v = edgeGap(others[i], others[j], rect, "v");
                  if (v && Math.round(v.length) === Math.round(vGap.length)) vGapMatches.push(v);
                }
                if (hGap) {
                  const h = edgeGap(others[i], others[j], rect, "h");
                  if (h && Math.round(h.length) === Math.round(hGap.length)) hGapMatches.push(h);
                }
              }
            }
            setSliderGuide({ elId: el.id, vCenter, hCenter, vGap, hGap, vGapMatches, hGapMatches, alignX, alignY });
          };
          set(ev.clientX, ev.clientY);
          const move = (mv: PointerEvent) => set(mv.clientX, mv.clientY);
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setSliderGuide(null);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        // Drag-to-resize: horizontal drag distance scales fontSize directly
        // (px) off whatever size the item starts at — mirrors the existing
        // padding/margin edge-drag handles elsewhere in this file, just
        // driving fontSize instead of a length prop. No upper bound — only a
        // floor of 1px so it can't go to zero/negative; asked not to cap how
        // big a drag can make text/buttons.
        const startResize = (ref: ItemRef, startFont: number, ev: React.PointerEvent<HTMLElement>) => {
          ev.stopPropagation();
          ev.preventDefault();
          const startX = ev.clientX;
          const move = (mv: PointerEvent) => {
            const next = Math.max(1, Math.round(startFont + (mv.clientX - startX) / 3));
            updateItem(ref, { fontSize: String(next) });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        // Drag-to-resize width ONLY (heading/subtitle only — no button use
        // case asked for): matches Canva's own text-box side handles — width
        // changes, font size doesn't, text reflows to the new width. `sign`
        // is which direction growing this particular handle moves in
        // (right-side handle: dragging right grows; left-side handle:
        // dragging left grows) so both edge handles can share one function.
        // No upper bound — same "asked not to cap it" precedent as
        // startResize's fontSize drag above. Dragging narrower is the
        // intentional, on-purpose way to force a wrap back to 2 lines —
        // textChip's normal (not forced-nowrap) white-space means a
        // narrower explicit width wraps exactly like the real site's <p>
        // would. Only a 1px floor remains, to keep the value sane.
        const startWidthResize = (ref: ItemRef, sign: 1 | -1, ev: React.PointerEvent<HTMLElement>) => {
          ev.stopPropagation();
          ev.preventDefault();
          const node = previewRefs.items[itemKey(ref)];
          if (!node) return;
          const startWidth = node.getBoundingClientRect().width;
          const startX = ev.clientX;
          const move = (mv: PointerEvent) => {
            const next = Math.max(1, Math.round(startWidth + sign * (mv.clientX - startX)));
            updateItem(ref, { width: String(next) });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        // Drag-to-resize a CORNER: Canva's uniform scale — font size AND
        // width grow/shrink together, proportionally, unlike the side
        // handles above which touch width only. `sign` per corner (below)
        // makes "pull the corner outward" always mean grow regardless of
        // which of the 4 corners is being dragged (nw/sw: dragging further
        // LEFT grows; ne/se: dragging further RIGHT grows). Scale factor is
        // relative to the box's own current width, so the same pixel drag
        // feels proportional whether the box starts small or already huge —
        // matches the "no upper/lower bound, only sane floors" precedent
        // used by every other drag handle in this file.
        const startCornerScale = (ref: ItemRef, startFont: number, sign: 1 | -1, ev: React.PointerEvent<HTMLElement>) => {
          ev.stopPropagation();
          ev.preventDefault();
          const node = previewRefs.items[itemKey(ref)];
          if (!node) return;
          const startWidth = node.getBoundingClientRect().width;
          const startX = ev.clientX;
          const move = (mv: PointerEvent) => {
            const scale = Math.max(0.1, 1 + (sign * (mv.clientX - startX)) / startWidth);
            updateItem(ref, {
              fontSize: String(Math.max(1, Math.round(startFont * scale))),
              width: String(Math.max(1, Math.round(startWidth * scale))),
            });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        const btnChip = (btn: SlideButton, bi: number) => {
          // rawFontPx is the true stored value — always what drag-resize
          // continues from, regardless of which bp is being previewed, so
          // resizing while looking at the mobile preview can't accidentally
          // persist a shrunk-for-preview size as the real one. fontPx (what
          // actually renders) is the bp-adjusted preview size.
          const rawFontPx = Number(btn.fontSize) || SIZE_PX[btn.size];
          const fontPx = fluidPreviewPx(rawFontPx, bp);
          const ref: ItemRef = { kind: "button", bi };
          return (
            <span
              key={bi}
              ref={(node) => {
                previewRefs.items[itemKey(ref)] = node;
              }}
              tabIndex={0}
              className="relative inline-flex cursor-move select-none items-center rounded-full font-semibold shadow focus:outline-none focus:ring-2 focus:ring-accent"
              style={{
                padding: "0.4em 1em",
                fontSize: `${fontPx}px`,
                // An unset color falls back to the SITE THEME's primary, not a
                // hard-coded white: same `var(--color-primary…)` pair the
                // standalone button preview already uses (set on the canvas
                // root from siteTheme), and the same value `.ds-btn-primary`
                // resolves to on the real site — so an untouched button
                // previews in the theme's own colour instead of a white pill
                // that matches nothing. A custom background still gets the
                // fixed dark label slideButtonStyle() falls back to there.
                background: btn.variant === "outline" ? "transparent" : btn.color || "var(--color-primary, #0f62fe)",
                color:
                  btn.textColor ||
                  (btn.variant === "outline" ? "#fff" : btn.color ? "#111827" : "var(--color-primary-content, #fff)"),
                border: btn.variant === "outline" ? `2px solid ${btn.textColor || "#fff"}` : undefined,
                borderRadius: btn.radius ? `${btn.radius}px` : "9999px",
              }}
              onPointerDown={(ev) => startMove(ref, ev)}
              onKeyDown={(ev) => {
                const patch = nudgePosition(btn, ev.key);
                if (patch) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  updateItem(ref, patch);
                }
              }}
            >
              {btn.label || "Button"}
              <span
                className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-full border border-white bg-accent"
                onPointerDown={(ev) => startResize(ref, rawFontPx, ev)}
              />
            </span>
          );
        };
        // Same drag/resize/nudge treatment as buttons, for the heading and
        // subtitle — kind picks the TEXT_BASE_PX fallback and default class
        // (bold/larger for heading, lighter/smaller for subtitle). `align`
        // applies as text-align regardless of flow/custom.
        // Corner handles, Canva-style: dragging a corner scales font size AND
        // width together (startCornerScale), not just fontSize — `sign`
        // makes pulling the corner outward always mean "grow" regardless of
        // which corner (nw/sw grow when dragged further left; ne/se grow
        // when dragged further right).
        const RESIZE_CORNERS = [
          { key: "nw", pos: "-top-1 -left-1", cursor: "cursor-nwse-resize", sign: -1 as const },
          { key: "ne", pos: "-top-1 -right-1", cursor: "cursor-nesw-resize", sign: 1 as const },
          { key: "sw", pos: "-bottom-1 -left-1", cursor: "cursor-nesw-resize", sign: -1 as const },
          { key: "se", pos: "-bottom-1 -right-1", cursor: "cursor-nwse-resize", sign: 1 as const },
        ];
        // bp-aware reads for a SlideText. The Inspector's BpToggle (next to
        // Text size / Alignment) stores a tablet/mobile-only value in
        // txt.bp, and the real site honors it (slideTextVisId's @media
        // rules) — so the canvas has to resolve the same way, or previewing
        // mobile shows the desktop value and the setting reads as dead.
        const slideAlign = (txt: SlideText): SlideText["align"] =>
          (bpGetValue(txt.align, txt.bp, "align") || "left") as SlideText["align"];
        const textChip = (kind: "heading" | "subtitle", txt: SlideText, fallback: string, extraClass: string) => {
          // Same rawFontPx/fontPx split as btnChip above — drag-resize always
          // continues from the true stored size, the canvas only ever shows
          // the bp-adjusted preview.
          const rawFontPx = Number(bpGetValue(txt.fontSize, txt.bp, "fontSize")) || TEXT_BASE_PX[kind];
          const fontPx = fluidPreviewPx(rawFontPx, bp);
          const ref: ItemRef = { kind };
          const editKey = itemKey(ref);
          const editCompositeKey = `${el.id}:${editKey}`;
          const sharedTextStyle: React.CSSProperties = {
            fontSize: `${fontPx}px`,
            color: txt.color || undefined,
            textAlign: slideAlign(txt),
            fontFamily: txt.fontFamily || undefined,
            fontWeight: txt.fontWeight || undefined,
            lineHeight: txt.lineHeight || "1",
            letterSpacing: txt.letterSpacing || undefined,
            textTransform: (txt.textTransform || undefined) as React.CSSProperties["textTransform"],
            fontStyle: txt.fontStyle || undefined,
            textDecoration: txt.textDecoration || undefined,
          };
          // Canvas-direct editing (double-click, since single click/drag is
          // already startMove): same stable-ref-snapshot pattern ElPreview's
          // own heading/text contentEditable branch uses above — the
          // rendered children come from editingSliderText's captured-once
          // value, never from `txt.text` directly, so a re-render mid-typing
          // (triggered by the onInput→updateItem→mutate round-trip) doesn't
          // feed new children back into the DOM and reset the caret.
          if (sliderEditingItem[el.id] === editKey) {
            if (editingSliderText.current[editCompositeKey] === undefined) editingSliderText.current[editCompositeKey] = txt.text;
            return (
              <span
                ref={(node) => {
                  previewRefs.items[editKey] = node;
                  if (node && document.activeElement !== node) node.focus();
                }}
                contentEditable
                suppressContentEditableWarning
                className={`relative inline-block whitespace-pre-wrap break-words border border-dashed border-accent outline-none ${extraClass}`}
                style={sharedTextStyle}
                onInput={(ev) => updateItem(ref, { text: ev.currentTarget.textContent ?? "" })}
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  // Enter must insert a literal "\n" character, not the
                  // browser's default (a new <div>/<br> node) — reading
                  // .textContent afterward would otherwise glue the lines
                  // back together with no separator between them.
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    document.execCommand("insertText", false, "\n");
                  }
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onBlur={() => {
                  delete editingSliderText.current[editCompositeKey];
                  setSliderEditingItem((prev) => ({ ...prev, [el.id]: null }));
                }}
              >
                {editingSliderText.current[editCompositeKey]}
              </span>
            );
          }
          return (
            <span
              ref={(node) => {
                previewRefs.items[editKey] = node;
                // An explicit `width` (set by the mid-edge drag handle below)
                // is a hard width, not just a floor: dragging left has to be
                // able to force a wrap back to 2 lines on purpose (the only
                // OTHER way to get a second line is a literal newline typed
                // via double-click-to-edit above, or the Inspector's
                // textarea) — same normal wrapping SectionBlock.astro's real
                // <p> already does. wordBreak is a safety net, not the
                // primary mechanism: if a later fontSize increase makes a
                // single unbreakable word wider than a width dragged at a
                // smaller size, this breaks the word instead of silently
                // overflowing past the box's own border. Must run after the
                // node is laid out at its natural width — see fitTextBox:
                // this is what actually keeps the dashed box tight around
                // wrapped text, since no CSS width value can.
                if (node) node.style.width = txt.width ? `${txt.width}px` : "";
                if (!txt.width) fitTextBox(node);
              }}
              tabIndex={0}
              className={`relative inline-block cursor-move select-none border border-dashed border-white/40 focus:outline-none focus:ring-2 focus:ring-accent ${extraClass}`}
              style={{ ...sharedTextStyle, wordBreak: "break-word" }}
              onPointerDown={(ev) => startMove(ref, ev)}
              onDoubleClick={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                setSliderEditingItem((prev) => ({ ...prev, [el.id]: editKey }));
              }}
              onKeyDown={(ev) => {
                const patch = nudgePosition(txt, ev.key);
                if (patch) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  updateItem(ref, patch);
                }
              }}
            >
              {txt.text || fallback}
              {RESIZE_CORNERS.map((c) => (
                <span
                  key={c.key}
                  className={`absolute h-2 w-2 rounded-sm border border-white bg-accent shadow ${c.pos} ${c.cursor}`}
                  onPointerDown={(ev) => startCornerScale(ref, rawFontPx, c.sign, ev)}
                />
              ))}
              {/* Side handles (left/right mid): width only, no font change —
                  the 4 corner dots above are the only ones that scale font
                  size, matching Canva's own text-box handle split. */}
              <span
                className="absolute -left-1 top-1/2 h-3 w-2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-accent shadow"
                onPointerDown={(ev) => startWidthResize(ref, -1, ev)}
              />
              <span
                className="absolute -right-1 top-1/2 h-3 w-2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-accent shadow"
                onPointerDown={(ev) => startWidthResize(ref, 1, ev)}
              />
            </span>
          );
        };
        const flowButtons = first.buttons.filter((btn) => btn.position !== "custom");
        const freeButtons = first.buttons.filter((btn) => btn.position === "custom");
        const headingFlow = first.heading.position !== "custom";
        const subtitleFlow = first.subtitle.position !== "custom";
        const showSubtitle = first.subtitle.text.length > 0;
        // textChip is whitespace-nowrap + shrink-to-fit, so `text-align` on
        // the chip itself has zero visible effect (box width == content
        // width, nothing to align within) — each flow item's own `align`
        // instead has to come from where it sits inside a full-width flex
        // row, same idea as justify-content in any other layout.
        const ALIGN_JUSTIFY: Record<SlideText["align"], string> = {
          left: "justify-start",
          center: "justify-center",
          right: "justify-end",
        };
        // Resolves the same way SectionBlock.astro's SLIDER_HEIGHT/lengthValue
        // does — a legacy keyword ("sm"/"md"/"lg"/"full") maps through the
        // table, anything else (a literal px/vh/rem/%/em an author typed via
        // the field's own "length" kind) passes through as-is. Falls back to
        // a fixed aspect-ratio only if height somehow resolves empty; in
        // practice this is always set (defaults to "32rem" for new sliders).
        const resolvedHeight = p.height ? (SLIDER_HEIGHT[p.height] ?? p.height) : "";
        // Real background + overlay, not the flat bg-black/70 placeholder
        // this box used to hardcode regardless of the slide's actual
        // settings — that made every slide look identically dark in the
        // canvas no matter what bgColor/overlayColor/opacity was actually
        // saved, a real mismatch against the published site (confirmed live:
        // a slide with no image is fully transparent there, its only tint
        // coming from whatever overlayColor/opacity is actually set). text-
        // white stays as the default because SectionBlock.astro's `.ds-slide`
        // now defaults to white too (see that file's own fix).
        const overlayOpacityFrac = Math.min(100, Math.max(0, Number(first.overlayOpacity) || 0)) / 100;
        return (
          <div
            data-slide-box
            ref={(node) => {
              previewRefs.box = node;
            }}
            className={`relative flex ${resolvedHeight ? "" : "aspect-[21/9]"} items-center justify-center overflow-hidden rounded-lg text-white`}
            style={{
              height: resolvedHeight || undefined,
              backgroundColor: first.bgColor || undefined,
              backgroundImage: first.imageUrl ? `url(${first.imageUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {overlayOpacityFrac > 0 && (
              <div className="pointer-events-none absolute inset-0" style={{ background: hexToRgba(first.overlayColor, overlayOpacityFrac) }} />
            )}
            <div
              // Mirrors .ds-slide-content (SectionBlock.astro) exactly: w-full
              // + max-w-[36rem] + p-6 for its 1.5rem padding. The old
              // max-w-[80%] was both a parity gap (the real column is capped at
              // an absolute 36rem, not a percentage of the slide) and, more
              // importantly, had no definite width — leaving this a
              // shrink-to-fit flex item that hugs its children. That let the
              // explicit width fitTextBox sets on the heading feed back into
              // THIS box's width, which then became the heading's available
              // width on the next measure: a ratchet that shrank the text
              // column until the heading wrapped on its own, with plenty of
              // empty slide left over. w-full also gives justify-* room to
              // actually align within, which a hugging box never had.
              className={`w-full max-w-[36rem] p-6 ${first.textPosition === "left" ? "self-start" : first.textPosition === "right" ? "self-end" : ""}`}
            >
              {headingFlow && (
                <div className={`flex ${ALIGN_JUSTIFY[slideAlign(first.heading)]}`}>
                  {textChip("heading", first.heading, "Slide heading", "text-sm font-bold")}
                </div>
              )}
              {subtitleFlow && showSubtitle && (
                <div className={`mt-1 flex ${ALIGN_JUSTIFY[slideAlign(first.subtitle)]}`}>
                  {textChip("subtitle", first.subtitle, "", "text-xs opacity-80")}
                </div>
              )}
              {flowButtons.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">{flowButtons.map((btn) => btnChip(btn, first.buttons.indexOf(btn)))}</div>
              )}
            </div>
            {!headingFlow && (
              <div
                className="absolute max-w-[80%] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${first.heading.x}%`, top: `${first.heading.y}%` }}
              >
                {textChip("heading", first.heading, "Slide heading", "text-sm font-bold")}
              </div>
            )}
            {!subtitleFlow && showSubtitle && (
              <div
                className="absolute max-w-[80%] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${first.subtitle.x}%`, top: `${first.subtitle.y}%` }}
              >
                {textChip("subtitle", first.subtitle, "", "text-xs opacity-80")}
              </div>
            )}
            {freeButtons.map((btn) => (
              <div
                key={first.buttons.indexOf(btn)}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${btn.x}%`, top: `${btn.y}%` }}
              >
                {btnChip(btn, first.buttons.indexOf(btn))}
              </div>
            ))}
            {sliderGuide?.elId === el.id && sliderGuide.vCenter && (
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-red-500" />
            )}
            {sliderGuide?.elId === el.id && sliderGuide.hCenter && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-red-500" />
            )}
            {sliderGuide?.elId === el.id && sliderGuide.alignX !== null && (
              <div className="pointer-events-none absolute inset-y-0 w-px bg-fuchsia-400" style={{ left: sliderGuide.alignX }} />
            )}
            {sliderGuide?.elId === el.id && sliderGuide.alignY !== null && (
              <div className="pointer-events-none absolute inset-x-0 h-px bg-fuchsia-400" style={{ top: sliderGuide.alignY }} />
            )}
            {sliderGuide?.elId === el.id && sliderGuide.vGap && (
              <div
                className="pointer-events-none absolute w-px bg-red-500"
                style={{ left: sliderGuide.vGap.left, top: sliderGuide.vGap.top, height: sliderGuide.vGap.length }}
              >
                <span className="absolute -left-1 top-0 h-px w-2 bg-red-500" />
                <span className="absolute -left-1 bottom-0 h-px w-2 bg-red-500" />
                <span className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-red-500 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                  {Math.round(sliderGuide.vGap.length)}px
                </span>
              </div>
            )}
            {sliderGuide?.elId === el.id && sliderGuide.hGap && (
              <div
                className="pointer-events-none absolute h-px bg-red-500"
                style={{ left: sliderGuide.hGap.left, top: sliderGuide.hGap.top, width: sliderGuide.hGap.length }}
              >
                <span className="absolute left-0 -top-1 h-2 w-px bg-red-500" />
                <span className="absolute right-0 -top-1 h-2 w-px bg-red-500" />
                <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                  {Math.round(sliderGuide.hGap.length)}px
                </span>
              </div>
            )}
            {sliderGuide?.elId === el.id &&
              sliderGuide.vGapMatches.map((m, i) => (
                <div
                  key={`vm-${i}`}
                  className="pointer-events-none absolute w-px bg-red-500"
                  style={{ left: m.left, top: m.top, height: m.length }}
                >
                  <span className="absolute -left-1 top-0 h-px w-2 bg-red-500" />
                  <span className="absolute -left-1 bottom-0 h-px w-2 bg-red-500" />
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-red-500 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                    {Math.round(m.length)}px
                  </span>
                </div>
              ))}
            {sliderGuide?.elId === el.id &&
              sliderGuide.hGapMatches.map((m, i) => (
                <div
                  key={`hm-${i}`}
                  className="pointer-events-none absolute h-px bg-red-500"
                  style={{ left: m.left, top: m.top, width: m.length }}
                >
                  <span className="absolute left-0 -top-1 h-2 w-px bg-red-500" />
                  <span className="absolute right-0 -top-1 h-2 w-px bg-red-500" />
                  <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                    {Math.round(m.length)}px
                  </span>
                </div>
              ))}
            {/* Real controls, not decoration — see sliderSlideIdx. The counter
                next to them exists because dots alone never made it obvious
                that the canvas shows ONE slide out of several, which is what
                made an added-to-slide-2 button look like it hadn't been added
                at all. pointerDown is stopped so a dot click can't start an
                element drag; the click itself still bubbles, so clicking a dot
                on an unselected slider selects it like any other click. */}
            <div className="absolute bottom-2 flex items-center justify-center gap-1.5">
              <div className="flex gap-1">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    title={`${i + 1}/${slides.length}`}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => setSliderSlideIdx((m) => ({ ...m, [el.id]: i }))}
                    className={`h-1.5 w-1.5 rounded-full ${i === slideIdx ? "bg-white" : "bg-white/40 hover:bg-white/70"}`}
                  />
                ))}
              </div>
              {slides.length > 1 && (
                <span className="rounded bg-black/50 px-1 text-[9px] font-semibold leading-tight text-white/80">
                  {slideIdx + 1}/{slides.length}
                </span>
              )}
            </div>
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
        <button onClick={() => saveAsTemplate([b])} className="px-0.5 text-accent" title={t("designer-templates-save")}>
          <LayoutTemplate className="h-3 w-3" />
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
          <button onClick={() => saveAsTemplate([b])} className={iconBtn} title={t("designer-templates-save")}><LayoutTemplate className="h-3.5 w-3.5" /></button>
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
          <button onClick={() => saveAsTemplate([b, r, c])} className={iconBtn} title={t("designer-templates-save")}><LayoutTemplate className="h-3.5 w-3.5" /></button>
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
              // Split so overflow-hidden (needed to clip the background/rounded
              // corners, and this section's own padding bands, cleanly) only
              // ever wraps a decorative backdrop layer — never the real rows/
              // columns/elements content. A column or element with little/no
              // padding of its own sits flush against this box's edge, and its
              // grip/delete/drag-handle badges stick out a few px past that
              // edge by design (see the -left-2/-top-2 offsets below); the old
              // single overflow-hidden div clipped those badges away entirely
              // whenever there wasn't enough padding to absorb the overhang.
              const { padding: sectionPadding, margin: sectionMargin, color: sectionColor, opacity: sectionOpacity, ...sectionBgStyle } = sectionBpStyle(sp);
              const sectionEffectiveBg = sp.bg || siteTheme?.backgroundColor || "#ffffff";
              const sectionOverlay = overlayColors(sectionEffectiveBg);
              // Real stroke set (new fields or the legacy preset) already
              // draws its own border via sectionBgStyle.border — the overlay
              // tint below is only a structural guide for an unset border,
              // so it must never paint over a color the author actually chose.
              const hasRealBorder = Boolean(sp.borderWidth || sp.border);
              const sectionHiddenAtBp = hiddenAtBp(sp as unknown as Record<string, string>);
              return (
                <div
                  key={b}
                  className={`group relative ${mode === "live" ? "" : "rounded-xl"} ${selCls([b])}`}
                  style={{ opacity: sectionHiddenAtBp ? 0.35 : sectionOpacity }}
                  onClick={(ev) => pick(ev, [b])}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setSel([b]);
                    setCtxMenu({ path: [b], x: ev.clientX, y: ev.clientY });
                  }}
                >
                  <HiddenAtBpBadge hidden={sectionHiddenAtBp} />
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
                                startSpacingDrag(
                                  ev,
                                  startPx,
                                  "y",
                                  edge === "top" ? 1 : -1,
                                  (next, px) => applyDrag(key, px)(next),
                                  bandKey(`sec.${b}.padding`, edge, linkedPadding),
                                );
                              }}
                              {...bandHoverProps(bandKey(`sec.${b}.padding`, edge, linkedPadding))}
                              className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "top" ? "-translate-y-1/2" : "translate-y-1/2"
                              }`}
                              // -1px, not 0, to land on the backdrop's own 1px
                              // border/outline instead of just inside it —
                              // the badge otherwise visibly floats off the
                              // selection line (user feedback).
                              style={{ top: edge === "top" ? "-2px" : undefined, bottom: edge === "bottom" ? "-2px" : undefined }}
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
                                startSpacingDrag(
                                  ev,
                                  startPx,
                                  "x",
                                  edge === "left" ? 1 : -1,
                                  (next, px) => applyDrag(key, px)(next),
                                  bandKey(`sec.${b}.padding`, edge, linkedPadding),
                                );
                              }}
                              {...bandHoverProps(bandKey(`sec.${b}.padding`, edge, linkedPadding))}
                              className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "left" ? "-translate-x-1/2" : "translate-x-1/2"
                              }`}
                              style={{ left: edge === "left" ? "-2px" : undefined, right: edge === "right" ? "-2px" : undefined }}
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
                      // (Inspector-text-only). Top/bottom right-aligned so they don't collide
                      // with the centered padding badges or the -top-3 "Section" hover tag;
                      // left/right offset down from the top edge so they don't collide with
                      // top/bottom's own badges.
                      const sidePx = (side: keyof typeof MARGIN_SIDE_KEYS) =>
                        Number(pxLabel(lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), PAD, "0"))) || 0;
                      const topPx = sidePx("top");
                      const rightPx = sidePx("right");
                      const bottomPx = sidePx("bottom");
                      const leftPx = sidePx("left");
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
                      const k = (edge: string) => bandKey(`sec.${b}.margin`, edge, linkedMargin);
                      const pxOf = { top: topPx, right: rightPx, bottom: bottomPx, left: leftPx } as const;
                      return (
                        <>
                          {hoverBand === k("top") && spacingBand("top", topPx, true)}
                          {hoverBand === k("bottom") && spacingBand("bottom", bottomPx, true)}
                          {hoverBand === k("left") && spacingBand("left", leftPx, true)}
                          {hoverBand === k("right") && spacingBand("right", rightPx, true)}
                          {(["top", "bottom"] as const).map((edge) => (
                            <span
                              key={edge}
                              onMouseDown={(ev) => {
                                startSpacingDrag(ev, pxOf[edge], "y", edge === "top" ? 1 : -1, (next, px) => applyDrag(MARGIN_SIDE_KEYS[edge], px)(next), k(edge));
                              }}
                              {...bandHoverProps(k(edge))}
                              className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "top" ? "-top-2" : "-bottom-2"
                              }`}
                            >
                              {pxOf[edge]}px
                            </span>
                          ))}
                          {(["left", "right"] as const).map((edge) => (
                            <span
                              key={edge}
                              onMouseDown={(ev) => {
                                startSpacingDrag(ev, pxOf[edge], "x", edge === "left" ? 1 : -1, (next, px) => applyDrag(MARGIN_SIDE_KEYS[edge], px)(next), k(edge));
                              }}
                              {...bandHoverProps(k(edge))}
                              className={`absolute top-8 z-20 cursor-ew-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                edge === "left" ? "-left-2" : "-right-2"
                              }`}
                            >
                              {pxOf[edge]}px
                            </span>
                          ))}
                        </>
                      );
                    })()}
                  <div className="relative" style={{ margin: sectionMargin, color: sectionColor }}>
                    <div
                      className={`pointer-events-none absolute inset-0 overflow-hidden ${mode === "live" ? "" : "rounded-xl border"}`}
                      style={{ ...sectionBgStyle, borderColor: mode === "live" || hasRealBorder ? undefined : sectionOverlay.line }}
                    />
                    <div className="relative" style={{ padding: sectionPadding }}>
                    {selEq([b]) && (
                      <>
                        {hoverBand === bandKey(`sec.${b}.padding`, "top", linkedPadding) &&
                          spacingBand(
                            "top",
                            Number(
                              pxLabel(lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.top, PADDING_SIDE_FALLBACK.top), PAD, PAD.md)),
                            ) || 0,
                          )}
                        {hoverBand === bandKey(`sec.${b}.padding`, "bottom", linkedPadding) &&
                          spacingBand(
                            "bottom",
                            Number(
                              pxLabel(
                                lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.bottom, PADDING_SIDE_FALLBACK.bottom), PAD, PAD.md),
                              ),
                            ) || 0,
                          )}
                        {hoverBand === bandKey(`sec.${b}.padding`, "left", linkedPadding) &&
                          spacingBand(
                            "left",
                            Number(
                              pxLabel(
                                lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.left, PADDING_SIDE_FALLBACK.left), PAD, "1.5rem"),
                              ),
                            ) || 0,
                          )}
                        {hoverBand === bandKey(`sec.${b}.padding`, "right", linkedPadding) &&
                          spacingBand(
                            "right",
                            Number(
                              pxLabel(
                                lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS.right, PADDING_SIDE_FALLBACK.right), PAD, "1.5rem"),
                              ),
                            ) || 0,
                          )}
                      </>
                    )}
                    <div className={mode === "live" ? (contained ? "mx-auto max-w-[68rem]" : "") : contained ? "mx-auto max-w-3xl" : ""}>
                      {(sp.rows ?? []).map((row, r) => {
                        const rowHiddenAtBp = hiddenAtBp(row as unknown as Record<string, string>);
                        return (
                        <div
                          key={r}
                          className="group/row relative"
                          style={{ ...rowMarginStyle(row, r === 0), opacity: rowHiddenAtBp ? 0.35 : undefined }}
                        >
                          <HiddenAtBpBadge hidden={rowHiddenAtBp} />
                          {mode !== "live" && (
                            <>
                              <button
                                onClick={(ev) => pick(ev, [b, r])}
                                title={t("designer-row-gap")}
                                className="absolute -left-2 -top-2 z-20 hidden items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-[10px] font-bold text-sub shadow-sm opacity-0 transition-opacity group-hover/row:flex group-hover/row:opacity-100"
                              >
                                {t("designer-row")}
                              </button>
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
                            </>
                          )}
                          <div
                            className={`grid ${mode !== "live" ? "rounded-lg" : ""} ${selCls([b, r])}`}
                            onClick={(ev) => pick(ev, [b, r])}
                            onContextMenu={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              setSel([b, r]);
                              setCtxMenu({ path: [b, r], x: ev.clientX, y: ev.clientY });
                            }}
                            style={{
                              gridTemplateColumns:
                                bp === "mobile" ? "1fr" : row.columns.map((cc) => `${cc.span}fr`).join(" "),
                              gap: row.gap ?? pageSettings.gap ?? (mode === "live" ? "2rem" : "1rem"),
                              ...rowPaddingStyle(row),
                            }}
                          >
                            {row.columns.map((col, c) => {
                            const colBg = col.props?.bg || sectionEffectiveBg;
                            const colOverlay = overlayColors(colBg);
                            const colHiddenAtBp = hiddenAtBp(col.props);
                            return (
                            <div
                              key={c}
                              className={`relative min-h-[3rem] transition-colors ${
                                mode === "live" ? "" : "rounded-lg border border-dashed p-1.5"
                              } ${selCls([b, r, c])} ${dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""}`}
                              style={{ ...bpColStyle(col), borderColor: mode === "live" ? undefined : colOverlay.line, opacity: colHiddenAtBp ? 0.35 : undefined }}
                              onClick={(ev) => pick(ev, [b, r, c])}
                              onContextMenu={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setSel([b, r, c]);
                                setCtxMenu({ path: [b, r, c], x: ev.clientX, y: ev.clientY });
                              }}
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
                              <HiddenAtBpBadge hidden={colHiddenAtBp} />
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
                                  const k = (edge: string) => bandKey(`col.${b}.${r}.${c}.padding`, edge, linkedPadding);
                                  return (
                                    <>
                                      {hoverBand === k("top") && spacingBand("top", topPx)}
                                      {hoverBand === k("bottom") && spacingBand("bottom", bottomPx)}
                                      {hoverBand === k("left") && spacingBand("left", leftPx)}
                                      {hoverBand === k("right") && spacingBand("right", rightPx)}
                                      {(["top", "bottom"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={(ev) => {
                                            const startPx = edge === "top" ? topPx : bottomPx;
                                            const key = PADDING_SIDE_KEYS[edge];
                                            startSpacingDrag(
                                              ev,
                                              startPx,
                                              "y",
                                              edge === "top" ? 1 : -1,
                                              (next, px) => {
                                                const target = section(next, b).rows[r].columns[c];
                                                writeDragSideKeys(
                                                  target,
                                                  Object.values(PADDING_SIDE_KEYS),
                                                  key,
                                                  px,
                                                  linkedPadding,
                                                );
                                              },
                                              k(edge),
                                            );
                                          }}
                                          {...bandHoverProps(k(edge))}
                                          className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "top" ? "-translate-y-1/2" : "translate-y-1/2"
                                          }`}
                                          // Same -2px both edges — this column has its own 1px
                                          // border-dashed, same reasoning as Section's badges above.
                                          style={{ top: edge === "top" ? "-2px" : undefined, bottom: edge === "bottom" ? "-2px" : undefined }}
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
                                            startSpacingDrag(
                                              ev,
                                              startPx,
                                              "x",
                                              edge === "left" ? 1 : -1,
                                              (next, px) => {
                                                const target = section(next, b).rows[r].columns[c];
                                                writeDragSideKeys(
                                                  target,
                                                  Object.values(PADDING_SIDE_KEYS),
                                                  key,
                                                  px,
                                                  linkedPadding,
                                                );
                                              },
                                              k(edge),
                                            );
                                          }}
                                          {...bandHoverProps(k(edge))}
                                          className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "left" ? "-translate-x-1/2" : "translate-x-1/2"
                                          }`}
                                          style={{ left: edge === "left" ? "-2px" : undefined, right: edge === "right" ? "-2px" : undefined }}
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
                                  const sidePx = (side: keyof typeof MARGIN_SIDE_KEYS) =>
                                    Number(pxLabel(lengthValue(sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), PAD, "0"))) ||
                                    0;
                                  const topPx = sidePx("top");
                                  const rightPx = sidePx("right");
                                  const bottomPx = sidePx("bottom");
                                  const leftPx = sidePx("left");
                                  const pxOf = { top: topPx, right: rightPx, bottom: bottomPx, left: leftPx } as const;
                                  const k = (edge: string) => bandKey(`col.${b}.${r}.${c}.margin`, edge, linkedMargin);
                                  const drag = (edge: "top" | "right" | "bottom" | "left") => (ev: React.MouseEvent) => {
                                    const axis = edge === "top" || edge === "bottom" ? "y" : "x";
                                    const dir = edge === "top" || edge === "left" ? 1 : -1;
                                    const key = MARGIN_SIDE_KEYS[edge];
                                    startSpacingDrag(
                                      ev,
                                      pxOf[edge],
                                      axis,
                                      dir,
                                      (next, px) => {
                                        const target = section(next, b).rows[r].columns[c];
                                        writeDragSideKeys(target, Object.values(MARGIN_SIDE_KEYS), key, px, linkedMargin);
                                      },
                                      k(edge),
                                    );
                                  };
                                  return (
                                    <>
                                      {hoverBand === k("top") && spacingBand("top", topPx, true)}
                                      {hoverBand === k("bottom") && spacingBand("bottom", bottomPx, true)}
                                      {hoverBand === k("left") && spacingBand("left", leftPx, true)}
                                      {hoverBand === k("right") && spacingBand("right", rightPx, true)}
                                      {(["top", "bottom"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={drag(edge)}
                                          {...bandHoverProps(k(edge))}
                                          className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "top" ? "-top-2" : "-bottom-2"
                                          }`}
                                        >
                                          {pxOf[edge]}px
                                        </span>
                                      ))}
                                      {(["left", "right"] as const).map((edge) => (
                                        <span
                                          key={edge}
                                          onMouseDown={drag(edge)}
                                          {...bandHoverProps(k(edge))}
                                          className={`absolute top-8 z-20 cursor-ew-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                            edge === "left" ? "-left-2" : "-right-2"
                                          }`}
                                        >
                                          {pxOf[edge]}px
                                        </span>
                                      ))}
                                    </>
                                  );
                                })()}
                              {/* space-y-* lives here, not on the outer column div — that div also
                                  holds the absolutely-positioned padding/margin badges as direct
                                  children, and space-y's sibling-selector margin-top doesn't know
                                  those are overlay UI, not real content: it was shoving every badge
                                  down by an extra 12px, off the selection outline it should sit on. */}
                              <div className={mode === "live" ? "space-y-5" : "space-y-3"}>
                              {col.elements.length === 0 && (
                                <div
                                  className="flex h-12 items-center justify-center rounded-lg border border-dashed text-[10px] font-medium"
                                  style={{ borderColor: colOverlay.line, color: colOverlay.text }}
                                >
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
                                  style={{ ...bpMarginStyle(el), ...bpPaddingStyle(el), opacity: hiddenAtBp(el.props) ? 0.35 : undefined }}
                                >
                                  <HiddenAtBpBadge hidden={hiddenAtBp(el.props)} />
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
                                      const sidePx = (side: keyof typeof MARGIN_SIDE_KEYS) =>
                                        Number(pxLabel(lengthValue(sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), SPACE, "0"))) || 0;
                                      const topPx = sidePx("top");
                                      const rightPx = sidePx("right");
                                      const bottomPx = sidePx("bottom");
                                      const leftPx = sidePx("left");
                                      const pxOf = { top: topPx, right: rightPx, bottom: bottomPx, left: leftPx } as const;
                                      const k = (edge: string) => bandKey(`el.${b}.${r}.${c}.${e}.margin`, edge, linkedMargin);
                                      const drag = (edge: "top" | "right" | "bottom" | "left") => (ev: React.MouseEvent) => {
                                        const axis = edge === "top" || edge === "bottom" ? "y" : "x";
                                        const dir = edge === "top" || edge === "left" ? 1 : -1;
                                        const key = MARGIN_SIDE_KEYS[edge];
                                        startSpacingDrag(
                                          ev,
                                          pxOf[edge],
                                          axis,
                                          dir,
                                          (next, px) => {
                                            const target = section(next, b).rows[r].columns[c].elements[e];
                                            writeDragSideKeys(target, Object.values(MARGIN_SIDE_KEYS), key, px, linkedMargin);
                                          },
                                          k(edge),
                                        );
                                      };
                                      return (
                                        <>
                                          {hoverBand === k("top") && spacingBand("top", topPx, true)}
                                          {hoverBand === k("bottom") && spacingBand("bottom", bottomPx, true)}
                                          {hoverBand === k("left") && spacingBand("left", leftPx, true)}
                                          {hoverBand === k("right") && spacingBand("right", rightPx, true)}
                                          {(["top", "bottom"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={drag(edge)}
                                              {...bandHoverProps(k(edge))}
                                              className={`absolute right-8 z-20 cursor-ns-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "top" ? "-top-2" : "-bottom-2"
                                              }`}
                                            >
                                              {pxOf[edge]}px
                                            </span>
                                          ))}
                                          {(["left", "right"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={drag(edge)}
                                              {...bandHoverProps(k(edge))}
                                              className={`absolute top-8 z-20 cursor-ew-resize select-none rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "left" ? "-left-2" : "-right-2"
                                              }`}
                                            >
                                              {pxOf[edge]}px
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
                                      const k = (edge: string) => bandKey(`el.${b}.${r}.${c}.${e}.padding`, edge, linkedPadding);
                                      return (
                                        <>
                                          {hoverBand === k("top") && spacingBand("top", topPx)}
                                          {hoverBand === k("bottom") && spacingBand("bottom", bottomPx)}
                                          {hoverBand === k("left") && spacingBand("left", leftPx)}
                                          {hoverBand === k("right") && spacingBand("right", rightPx)}
                                          {(["top", "bottom"] as const).map((edge) => (
                                            <span
                                              key={edge}
                                              onMouseDown={(ev) => {
                                                const startPx = edge === "top" ? topPx : bottomPx;
                                                const key = PADDING_SIDE_KEYS[edge];
                                                startSpacingDrag(
                                                  ev,
                                                  startPx,
                                                  "y",
                                                  edge === "top" ? 1 : -1,
                                                  (next, px) => {
                                                    const target = section(next, b).rows[r].columns[c].elements[e];
                                                    writeDragSideKeys(target, Object.values(PADDING_SIDE_KEYS), key, px, linkedPadding);
                                                  },
                                                  k(edge),
                                                );
                                              }}
                                              {...bandHoverProps(k(edge))}
                                              className={`absolute left-1/2 z-20 -translate-x-1/2 cursor-ns-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "top" ? "-translate-y-1/2" : "translate-y-1/2"
                                              }`}
                                              // -1px (no border on this wrapper, unlike Section/Column's
                                              // -2px) so the badge centers on the 2px selection outline's
                                              // own centerline instead of the plain padding edge.
                                              style={{ top: edge === "top" ? "-1px" : undefined, bottom: edge === "bottom" ? "-1px" : undefined }}
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
                                                startSpacingDrag(
                                                  ev,
                                                  startPx,
                                                  "x",
                                                  edge === "left" ? 1 : -1,
                                                  (next, px) => {
                                                    const target = section(next, b).rows[r].columns[c].elements[e];
                                                    writeDragSideKeys(target, Object.values(PADDING_SIDE_KEYS), key, px, linkedPadding);
                                                  },
                                                  k(edge),
                                                );
                                              }}
                                              {...bandHoverProps(k(edge))}
                                              className={`absolute top-1/2 z-20 -translate-y-1/2 cursor-ew-resize select-none rounded bg-accent px-1 py-0.5 text-[9px] font-bold leading-none text-white ${
                                                edge === "left" ? "-translate-x-1/2" : "translate-x-1/2"
                                              }`}
                                              style={{ left: edge === "left" ? "-1px" : undefined, right: edge === "right" ? "-1px" : undefined }}
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
                            </div>
                            );
                          })}
                          </div>
                        </div>
                        );
                      })}
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

      {showTemplates &&
        (() => {
          const filteredTemplates = templates.filter((tpl) => {
            const kind = (tpl.data?.kind as string | undefined) ?? "section";
            if (templateFilter !== "all" && kind !== templateFilter) return false;
            if (templateSearch.trim() && !tpl.name.toLowerCase().includes(templateSearch.trim().toLowerCase())) return false;
            return true;
          });
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
              onClick={() => {
                setShowTemplates(false);
                setPendingTemplate(null);
              }}
            >
              <div
                className="flex max-h-[85vh] w-[min(90vw,52rem)] flex-col overflow-hidden rounded-xl bg-white p-4 shadow-xl"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-bold text-ink">{t("designer-templates")}</p>
                  <button
                    onClick={() => {
                      setShowTemplates(false);
                      setPendingTemplate(null);
                    }}
                    className="text-body hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {pendingTemplate ? (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void confirmSaveTemplate();
                    }}
                    className="mb-3 flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={templateName}
                      onChange={(ev) => setTemplateName(ev.target.value)}
                      placeholder={t("designer-templates-save-prompt")}
                      className="min-w-0 flex-1 rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={!templateName.trim() || templatesBusy}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {t("designer-templates-save")}
                    </button>
                    <button type="button" onClick={() => setPendingTemplate(null)} className="text-body hover:text-ink">
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => saveAsTemplate()}
                    disabled={!templateKind() || templatesBusy}
                    className="mb-3 flex w-full items-center justify-center gap-1 rounded-full bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-40"
                  >
                    <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates-save")}
                  </button>
                )}
                {!pendingTemplate && !templateKind() && !templatesBusy && (
                  <p className="-mt-2 mb-3 text-[10px] text-sub">{t("designer-templates-need-selection")}</p>
                )}
                {templates.length === 0 ? (
                  <p className="text-xs text-sub">{t("designer-templates-empty")}</p>
                ) : (
                  <>
                    <input
                      value={templateSearch}
                      onChange={(ev) => setTemplateSearch(ev.target.value)}
                      placeholder={t("designer-templates-search-placeholder")}
                      className="mb-2 w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
                    />
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {(["all", "section", "row", "column", "element"] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() => setTemplateFilter(k)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            templateFilter === k ? "bg-accent text-white" : "bg-canvas text-body hover:bg-[#e8e8ed]"
                          }`}
                        >
                          {k === "all" ? t("designer-templates-filter-all") : templateKindLabel(k)}
                        </button>
                      ))}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {filteredTemplates.length === 0 ? (
                        <p className="text-xs text-sub">{t("designer-templates-no-match")}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {filteredTemplates.map((tpl) => {
                            const kind = (tpl.data?.kind as string | undefined) ?? "section";
                            return (
                              <div key={tpl.id} className="flex flex-col gap-1.5 rounded-lg border border-line/30 p-2">
                                <TemplatePreview tpl={tpl} />
                                <span className="truncate text-[11px] font-medium text-ink" title={tpl.name}>
                                  {tpl.name}
                                </span>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-sub">{templateKindLabel(kind)}</span>
                                  <span className="flex items-center gap-2">
                                    <button onClick={() => insertTemplate(tpl)} className="text-[11px] font-semibold text-accent">
                                      {t("designer-templates-insert")}
                                    </button>
                                    <button
                                      onClick={() => void deleteTemplateHandler(tpl.id)}
                                      className="text-red-500"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {ctxMenu &&
        (() => {
          const path = ctxMenu.path;
          const kind = templateKind(path);
          if (!kind) return null;
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
          const deleteItem = (label: string, onClick: () => void) => (
            <button
              onClick={() => {
                onClick();
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-red-500 hover:bg-canvas"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {label}
            </button>
          );
          const divider = <div className="my-1 border-t border-line/20" />;
          // Same set of actions at every depth (section/row/column/element) —
          // each level already has its own duplicate/copy/paste/copy-style/
          // paste-style/delete function (BlockControls/Inspector/
          // LiveEditToolbar already call these), so the menu just reuses them
          // instead of re-deriving the same splice/clip logic per depth.
          let body: React.ReactNode;
          if (kind === "section") {
            const [b] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateSection(b))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copySection(b))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteSection(b), !clipHas("section"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleSection(b))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleSection(b), !styleHas("section"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b]))}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteSection(b))}
              </>
            );
          } else if (kind === "row") {
            const [b, r] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateRow(b, r))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyRow(b, r))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteRow(b, r), !clipHas("row"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleRow(b, r))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleRow(b, r), !styleHas("row"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r]))}
                {divider}
                {deleteItem(t("designer-delete-row"), () => deleteRow(b, r))}
              </>
            );
          } else if (kind === "column") {
            const [b, r, c] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r, c]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateColumn(b, r, c))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyColumn(b, r, c))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteColumn(b, r, c), !clipHas("column"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleColumn(b, r, c))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleColumn(b, r, c), !styleHas("column"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r, c]))}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteColumn(b, r, c))}
              </>
            );
          } else {
            const [b, r, c, e] = path;
            const el = section(blocks, b).rows[r]?.columns[c]?.elements[e];
            if (!el) return null;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r, c, e]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateElement(b, r, c, e))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyElement(b, r, c, e))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteElement(b, r, c, e), !clipHas("element"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleElement(b, r, c, e))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleElement(b, r, c, e), !styleHas("element"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r, c, e]))}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteElement(b, r, c, e))}
              </>
            );
          }
          return (
            <div
              className="fixed z-[70] w-44 overflow-hidden rounded-lg border border-line/30 bg-white py-1 shadow-xl"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(ev) => ev.stopPropagation()}
            >
              {body}
            </div>
          );
        })()}
    </div>
  );
}
