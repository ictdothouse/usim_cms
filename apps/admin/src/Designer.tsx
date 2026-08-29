import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Award,
  BarChart3,
  Battery,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  Car,
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
  LayoutGrid,
  LayoutPanelTop,
  LayoutTemplate,
  Leaf,
  Link2,
  List,
  Lock,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  Minus,
  Monitor,
  Moon,
  MousePointerClick,
  MoveVertical,
  Music,
  Newspaper,
  Package,
  Paintbrush,
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
  Recycle,
  Redo2,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
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
import type { SlideButton, SlideText, EdgeRect, GapMark, Field, FieldGroupKey, Bp, ElType, El, Col, Row, SectionProps, Block, CardItem, Sel, PageSettings } from "./designer/types";
import { parsePairs, parseSlideText, parseSlideButtons, parseSlides, stringifySlides, parseCards } from "./designer/parsers";
import { nudgePosition, edgeGap, fitTextBox, fluidPreviewPx } from "./designer/geometry";
import { TemplatePreview } from "./designer/TemplatePreview";
import {
  PAD, RADIUS, BORDER, gapPx, hexToRgba, overlayColors, shadowToCss, lengthValue, colStyle, elRadius, typoStyle,
  SPACE, PADDING_SIDE_KEYS, PADDING_SIDE_FALLBACK, MARGIN_SIDE_KEYS, MARGIN_SIDE_FALLBACK, RADIUS_CORNER_KEYS,
} from "./designer/style";
import { TYPOGRAPHY_FIELDS, TEXT_BASE_PX, FIELD_GROUP_BY_KEY, GROUP_META, FieldLabel, SECTION_FIELDS, COLUMN_FIELDS, COLUMN_SPACING_KEYS, CSS_CLASS_FIELD } from "./designer/fields";
import { BufferedInput, BpToggle } from "./designer/FieldControls";
import { FieldGroups } from "./designer/FieldGroups";
import { Inspector } from "./designer/Inspector";
import { ElPreview } from "./designer/ElPreview";
import { ELS } from "./designer/elements";
import { ICONS } from "./designer/icons";
import { BASE_LANG, type DesignerCtx } from "./designer/context";

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

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
  menu: ["menuId"],
  cardgrid: ["cards"],
  ctabanner: ["heading", "description", "button1Label", "button2Label"],
  announcementbar: ["text", "linkLabel"],
  postlist: [],
  eventlist: [],
  testimonial: ["testimonials"],
  statscounter: ["stats"],
  peoplegrid: ["people"],
  socialicons: ["socials"],
  logocloud: ["logos"],
  timeline: ["timelineItems"],
  documentdownload: ["documents"],
  googlemap: ["embedUrl", "address"],
  announcementticker: ["tickerItems"],
};
// i18n follow-up — subset of CONTENT_KEYS that's actual freeform prose (not
// a URL/icon-name/enum/delimited-pairs blob/raw HTML), safe to run through
// /api/translate as a plain string. Everything else (accordion/tabs' `items`,
// slider's `slides` JSON, `html`) is intentionally NOT auto-translated here —
// translating delimited/structured data risks corrupting it — a switch to an
// empty language slot just verbatim-copies those fields, same as before this
// feature, and an author can hand-translate them.
const TRANSLATABLE_TEXT_KEYS: Partial<Record<ElType, string[]>> = {
  heading: ["text"],
  text: ["text"],
  button: ["label"],
  image: ["alt"],
  infobox: ["heading", "text"],
  ctabanner: ["heading", "description", "button1Label", "button2Label"],
  announcementbar: ["text", "linkLabel"],
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

// drag payload: a new palette element, or a move of an existing one
type Drag =
  | { kind: "new"; type: ElType }
  | { kind: "move"; path: number[] }
  | { kind: "tree-reorder"; treeKind: "section" | "column"; path: number[] };

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
  isSuper,
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  onClose: (saved: boolean) => void;
  isSuper: boolean;
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
  // Sprint 2: below `lg` the palette/inspector asides become off-canvas
  // drawers (same pattern as Shell's mobile nav) instead of the fixed
  // 3-column layout — `null` means both are closed.
  const [mobilePanel, setMobilePanel] = useState<"palette" | "inspector" | null>(null);
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
  // "Save as blueprint" — same in-app-modal naming pattern as templates above.
  const [showSaveBlueprint, setShowSaveBlueprint] = useState(false);
  const [blueprintName, setBlueprintName] = useState("");
  const [blueprintDescription, setBlueprintDescription] = useState("");
  const [blueprintCategory, setBlueprintCategory] = useState("");
  const [blueprintScope, setBlueprintScope] = useState<"system" | "tenant">("tenant");
  const [blueprintBusy, setBlueprintBusy] = useState(false);
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
  // Page-wide Designer defaults (default column gap, content width, left/right
  // padding, and an optional theme snapshot) — separate from `blocks`/history
  // since it's not part of the undo stack, same convention as slugDraft above.
  // Persisted via save()'s `settings`.
  const [pageSettings, setPageSettings] = useState<PageSettings>(() => (page.settings as PageSettings) ?? {});
  // "Theme" picker in Page Settings — this user's saved presets, same list
  // ThemeForm's own collection reads (api.listThemePresets).
  const [themePresets, setThemePresets] = useState<api.ThemePreset[]>([]);
  useEffect(() => {
    api.listThemePresets(token).then(setThemePresets).catch(() => {});
  }, [token]);
  // i18n Phase 4 — same page-level, not-part-of-the-undo-stack treatment as
  // pageSettings above; persisted via save()'s `language` field.
  const [pageLanguage, setPageLanguage] = useState<string>((page.language as string | null) ?? "");
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  // "menu" element's Inspector needs a live list to populate its menuId
  // picker — dynamic per-tenant data, unlike every other field here which
  // is a static enum, so it's fetched once (like siteLanguages above) rather
  // than baked into ELS.menu.fields' static `options`.
  const [availableMenus, setAvailableMenus] = useState<api.Menu[]>([]);
  useEffect(() => {
    void api.listMenus(tenantHost, token).then(setAvailableMenus);
  }, [tenantHost]);
  // "postlist" element's categoryId picker (Sprint 5, docs/laporan-audit-ui-ux.md
  // section 5.6) — same live-fetched-once-per-tenant shape as availableMenus.
  const [availableCategories, setAvailableCategories] = useState<api.Category[]>([]);
  useEffect(() => {
    void api.listCategories(tenantHost, token).then(setAvailableCategories);
  }, [tenantHost]);
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
  const [translating, setTranslating] = useState(false);
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
  // Real auto-translate (i18n follow-up — see CLAUDE.md): walks the layout
  // tree translating only TRANSLATABLE_TEXT_KEYS' plain-prose fields, one
  // /api/translate call at a time (sequential await, never Promise.all — see
  // CLAUDE.md's deadlock note). A field that fails to translate keeps its
  // original (base-language) value rather than blocking the whole switch.
  async function translateLayoutBlocks(src: Block[], target: string, source: string | undefined): Promise<Block[]> {
    const out = clone(src);
    for (const block of out) {
      if (block.type !== "section") continue;
      const sp = block.props as unknown as SectionProps;
      for (const row of sp.rows ?? []) {
        for (const col of row.columns ?? []) {
          for (const el of col.elements ?? []) {
            const keys = TRANSLATABLE_TEXT_KEYS[el.type as ElType];
            if (!keys) continue;
            for (const key of keys) {
              const val = el.props[key];
              if (typeof val === "string" && val.trim()) {
                try {
                  el.props[key] = await api.translateText(tenantHost, token, val, target, { source });
                } catch {
                  // keep original value on failure — don't block the switch
                }
              }
            }
          }
        }
      }
    }
    return out;
  }
  async function switchPageLanguage(target: string) {
    if (target === activeLang) return;
    const leaving = clone(blocks);
    let targetLayout = content[target];
    if (!targetLayout) {
      const sourceCode = activeLang === BASE_LANG ? (pageLanguage || undefined) : activeLang;
      setTranslating(true);
      try {
        targetLayout = await translateLayoutBlocks(leaving, target, sourceCode);
      } catch {
        targetLayout = leaving;
      } finally {
        setTranslating(false);
      }
    }
    setContent((prev) => ({ ...prev, [activeLang]: leaving, [target]: targetLayout! }));
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
    void switchPageLanguage(code === pageLanguage ? BASE_LANG : code);
  }
  // Force-regenerate an already-filled language slot — switchPageLanguage
  // above only translates an EMPTY slot, so a page whose translations were
  // saved before this real-translate fix existed (verbatim stub copies from
  // the old behavior) would otherwise stay stale forever, since clicking
  // that pill just switches to the existing (untranslated) content.
  async function retranslatePageLanguage(code: string) {
    const base = activeLang === BASE_LANG ? blocks : (content[BASE_LANG] ?? blocks);
    setTranslating(true);
    try {
      const fresh = await translateLayoutBlocks(base, code, pageLanguage || undefined);
      setContent((prev) => ({ ...prev, [code]: fresh }));
      if (activeLang === code) setBlocks(clone(fresh));
      setDirty(true);
    } finally {
      setTranslating(false);
    }
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

  async function confirmSaveAsBlueprint() {
    const name = blueprintName.trim();
    if (!name) return;
    setBlueprintBusy(true);
    try {
      await api.createBlueprint(tenantHost, token, {
        name,
        description: blueprintDescription.trim() || undefined,
        category: blueprintCategory.trim() || undefined,
        layout: blocks,
        settings: pageSettings,
        scope: blueprintScope,
      });
      setShowSaveBlueprint(false);
      setBlueprintName("");
      setBlueprintDescription("");
      setBlueprintCategory("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlueprintBusy(false);
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
  // Section lock (Page Blueprint deferred item) — a superadmin can mark a
  // section `locked` (props.locked === "true", toggled in the Inspector) so
  // a non-superadmin can view it but never mutate it. Only delete and
  // paste-style actually overwrite the locked section's own content (every
  // other section action — duplicate, copy, paste-after, move, save-as-
  // template — leaves it untouched, so those stay enabled). This is UX
  // only: the real gate is apps/api's pagesBeforeChange, which rejects any
  // save that changes or removes a locked section regardless of what the
  // client sends.
  function isSectionLocked(b: number): boolean {
    return !isSuper && (blocks[b]?.props as unknown as SectionProps | undefined)?.locked === "true";
  }
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
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const style = styleRead("section");
    if (style) mutate((bs) => Object.assign(bs[b].props, style));
  }
  function deleteSection(b: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
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
  // Named distinctly from designerTree.ts's imported `moveColumn` (a bulk
  // from/to array-mutation helper) — this one is the arrow-button single-step
  // nudge. They used to share a name, which let this local function
  // declaration (hoisted) shadow the import for the whole component body,
  // breaking the imported moveColumn's real call sites below.
  function nudgeColumn(b: number, r: number, c: number, dir: -1 | 1) {
    const target = c + dir;
    if (target < 0 || target >= section(blocks, b).rows[r].columns.length) return;
    mutate((bs) => {
      const cols = section(bs, b).rows[r].columns;
      cols.splice(target, 0, cols.splice(c, 1)[0]);
    });
    setSel([b, r, target]);
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
  function moveRow(b: number, r: number, dir: -1 | 1) {
    const target = r + dir;
    if (target < 0 || target >= section(blocks, b).rows.length) return;
    mutate((bs) => {
      const rows = section(bs, b).rows;
      rows.splice(target, 0, rows.splice(r, 1)[0]);
    });
    setSel([b, target]);
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
  function setPageContentWidth(contentWidth: "contained" | "full" | undefined) {
    setPageSettings((s) => ({ ...s, contentWidth }));
    setDirty(true);
  }
  function setPagePaddingX(paddingX: string | undefined) {
    setPageSettings((s) => ({ ...s, paddingX }));
    setDirty(true);
  }
  // Selecting a preset copies its settings in as a one-time snapshot (same
  // convention as every other "apply once, edit independently after" copy in
  // this codebase — see CLAUDE.md's i18n bookmark-card note) — editing the
  // preset later never retroactively changes this page.
  function setPageThemePreset(preset: api.ThemePreset | null) {
    setPageSettings((s) => (preset ? { ...s, theme: preset.settings, themePresetName: preset.name } : { ...s, theme: undefined, themePresetName: undefined }));
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
  function moveElement(b: number, r: number, c: number, e: number, dir: -1 | 1) {
    const target = e + dir;
    if (target < 0 || target >= section(blocks, b).rows[r].columns[c].elements.length) return;
    mutate((bs) => {
      const els = section(bs, b).rows[r].columns[c].elements;
      els.splice(target, 0, els.splice(e, 1)[0]);
    });
    setSel([b, r, c, target]);
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
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
                  aria-label={t(isOpen ? "designer-collapse" : "designer-expand")}
                >
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
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(colKey); }}
                              aria-label={t(colOpen ? "designer-collapse" : "designer-expand")}
                            >
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

  function templateKindLabel(kind: string): string {
    return kind === "row"
      ? t("designer-row")
      : kind === "column"
        ? t("designer-column")
        : kind === "element"
          ? t("designer-elements")
          : t("designer-section");
  }

  // Normalizes a DesignTemplate's kind/value into TemplatePreview's rows[]
  // shape — same normalization the old inline TemplatePreview used to do
  // internally, now a plain call-site helper so the preview component itself
  // stays templates-vs-blueprints agnostic.
  function templateRows(tpl: api.DesignTemplate): Row[] {
    const kind = (tpl.data?.kind as string | undefined) ?? "section";
    const value = tpl.data?.kind ? tpl.data.value : tpl.data;
    return kind === "section"
      ? ((value as SectionProps).rows ?? [])
      : kind === "row"
        ? [value as Row]
        : kind === "column"
          ? [{ columns: [value as Col] } as Row]
          : [{ columns: [{ elements: [value as El] }] } as Row];
  }

  // section/legacy-block level controls: move up/down, duplicate, delete
  function BlockControls({ b }: { b: number }) {
    const locked = isSectionLocked(b);
    return (
      <span className="flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
        {locked && (
          <span title={t("designer-section-locked-title")}>
            <Lock className="h-3 w-3 text-amber-500" />
          </span>
        )}
        <button
          onClick={() => b > 0 && mutate((bs) => bs.splice(b - 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === 0}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
          aria-label={t("designer-move-section-up")}
          title={t("designer-move-section-up")}
        >
          ↑
        </button>
        <button
          onClick={() => b < blocks.length - 1 && mutate((bs) => bs.splice(b + 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === blocks.length - 1}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
          aria-label={t("designer-move-section-down")}
          title={t("designer-move-section-down")}
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
          disabled={!styleHas("section") || locked}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button onClick={() => saveAsTemplate([b])} className="px-0.5 text-accent" title={t("designer-templates-save")}>
          <LayoutTemplate className="h-3 w-3" />
        </button>
        <button onClick={() => deleteSection(b)} disabled={locked} className="px-0.5 text-red-500 disabled:opacity-30" title={locked ? t("designer-section-locked-title") : t("designer-delete")}>
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

  // Bundled closure for the extracted Inspector/ElPreview (Layer 1b of the
  // God Component refactor, see designer/context.ts's own header comment)
  // — every value/mutator both of those need, in one place so adding a new
  // element/field only ever means adding a field here, not touching every
  // call site.
  const designerCtx: DesignerCtx = {
    t, bp, mode, sel, setSel, blocks, mutate,
    isSuper, isSectionLocked,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx, uploadImage,
    availableMenus, availableCategories,
    pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang, content,
    clickPageLanguagePill, translating, retranslatePageLanguage,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement,
    editingText, editingSliderText, sliderPreviewRefs, sliderGuide, setSliderGuide, sliderEditingItem, setSliderEditingItem,
  };

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas font-sans text-ink antialiased">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-line/30 bg-white px-4 py-2.5">
        <button
          onClick={() => setMobilePanel(mobilePanel === "palette" ? null : "palette")}
          className={`rounded-full p-1.5 lg:hidden ${mobilePanel === "palette" ? "bg-accent/15 text-accent" : "text-body hover:bg-canvas"}`}
          aria-label={t("designer-tab-elements")}
          title={t("designer-tab-elements")}
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          onClick={() => setMobilePanel(mobilePanel === "inspector" ? null : "inspector")}
          className={`rounded-full p-1.5 lg:hidden ${mobilePanel === "inspector" ? "bg-accent/15 text-accent" : "text-body hover:bg-canvas"}`}
          aria-label={t("designer-inspector")}
          title={t("designer-inspector")}
        >
          <Settings className="h-4 w-4" />
        </button>
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
          onClick={() => setShowSaveBlueprint(true)}
          className="flex items-center gap-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#e8e8ed]"
        >
          <LayoutTemplate className="h-3.5 w-3.5" /> {t("blueprints-save-as")}
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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile-only backdrop for the off-canvas palette/inspector drawers */}
        {mobilePanel && (
          <div className="absolute inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
        )}
        {/* palette */}
        <aside
          className={`absolute inset-y-0 left-0 z-40 w-64 transform overflow-y-auto border-r border-line/30 bg-white p-3 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-44 lg:translate-x-0 ${
            mobilePanel === "palette" ? "translate-x-0" : "-translate-x-full"
          }`}
        >
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
                                  {ElPreview({ ctx: designerCtx, el, path: [b, r, c, e] })}
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
        <aside
          className={`absolute inset-y-0 right-0 z-40 w-72 transform overflow-y-auto border-l border-line/30 bg-white p-4 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
            mobilePanel === "inspector" ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-inspector")}</p>
          {Inspector({ ctx: designerCtx })}
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
                    aria-label={t("designer-close")}
                    title={t("designer-close")}
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
                    <button
                      type="button"
                      onClick={() => setPendingTemplate(null)}
                      className="text-body hover:text-ink"
                      aria-label={t("designer-cancel")}
                      title={t("designer-cancel")}
                    >
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
                                <TemplatePreview rows={templateRows(tpl)} />
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
                                      aria-label={t("designer-templates-delete")}
                                      title={t("designer-templates-delete")}
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

      {showSaveBlueprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowSaveBlueprint(false)}>
          <div className="w-[min(90vw,28rem)] rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{t("blueprints-save-as")}</p>
              <button onClick={() => setShowSaveBlueprint(false)} aria-label={t("designer-close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void confirmSaveAsBlueprint();
              }}
              className="space-y-2"
            >
              <input
                autoFocus
                value={blueprintName}
                onChange={(ev) => setBlueprintName(ev.target.value)}
                placeholder={t("blueprints-name-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                value={blueprintDescription}
                onChange={(ev) => setBlueprintDescription(ev.target.value)}
                placeholder={t("blueprints-description-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                value={blueprintCategory}
                onChange={(ev) => setBlueprintCategory(ev.target.value)}
                placeholder={t("blueprints-category-placeholder")}
                className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
              />
              {isSuper && (
                <select
                  value={blueprintScope}
                  onChange={(ev) => setBlueprintScope(ev.target.value as "system" | "tenant")}
                  className="w-full rounded-full border border-line/30 px-3 py-1.5 text-xs"
                >
                  <option value="tenant">{t("blueprints-scope-tenant")}</option>
                  <option value="system">{t("blueprints-scope-system")}</option>
                </select>
              )}
              <button
                type="submit"
                disabled={!blueprintName.trim() || blueprintBusy}
                className="w-full rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {t("blueprints-save-as")}
              </button>
            </form>
          </div>
        </div>
      )}

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
