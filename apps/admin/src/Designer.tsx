import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Component,
  Copy,
  ExternalLink,
  GripVertical,
  History,
  Layers,
  LayoutTemplate,
  Lock,
  Menu,
  Monitor,
  MousePointerClick,
  Paintbrush,
  Pencil,
  Plus,
  Redo2,
  Settings,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  Unlink,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import { bestTextColor, GOOGLE_FONTS, clone } from "@/lib/utils";
import type { Key } from "@/i18n";
import { moveSection, moveColumn } from "./designerTree";
import { section } from "./designer/blockPath";
import type { FieldGroupKey, Bp, ElType, El, Col, Row, SectionProps, Block, Sel } from "./designer/types";
import { TemplatePreview } from "./designer/TemplatePreview";
import {
  PAD, RADIUS, BORDER, overlayColors, shadowToCss, lengthValue, colStyle,
  SPACE, PADDING_SIDE_KEYS, PADDING_SIDE_FALLBACK, MARGIN_SIDE_KEYS, MARGIN_SIDE_FALLBACK, RADIUS_CORNER_KEYS,
} from "./designer/style";
import { COLUMN_FIELDS, COLUMN_SPACING_KEYS } from "./designer/fields";
import { Inspector } from "./designer/Inspector";
import { ElPreview } from "./designer/ElPreview";
import { ELS } from "./designer/elements";
import { BASE_LANG, type DesignerCtx } from "./designer/context";
import { useClipboard } from "./designer/hooks/useClipboard";
import { useUndoRedo } from "./designer/hooks/useUndoRedo";
import { useBpStyle } from "./designer/hooks/useBpStyle";
import { useLiveEditBridge } from "./designer/hooks/useLiveEditBridge";
import { useBlockOps } from "./designer/hooks/useBlockOps";
import { useTemplateLibrary } from "./designer/hooks/useTemplateLibrary";
import { usePageAndLanguage } from "./designer/hooks/usePageAndLanguage";
import { useSiteChrome } from "./designer/hooks/useSiteChrome";
import { usePersist } from "./designer/hooks/usePersist";
import { useStableFns } from "./designer/hooks/useStableFn";
import MediaPickerModal from "./MediaPickerModal";

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

// Hoisted to module scope so these keep a stable component identity across
// Designer renders — declared as nested functions inside Designer() before,
// React saw a new `type` at their JSX call site on every render (every
// keystroke/drag), forcing a full unmount+remount instead of a normal diff.
function HiddenAtBpBadge({ hidden, bp, t }: { hidden: boolean; bp: Bp; t: (k: Key) => string }) {
  if (!hidden) return null;
  const Icon = bp === "tablet" ? Tablet : Smartphone;
  return (
    <span className="absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-500 shadow-sm">
      <Icon className="h-2.5 w-2.5" /> {t("designer-hidden-at-bp")}
    </span>
  );
}

function LayersTreeView({
  blocks, treeDropHint, rowDragProps, expanded, selEq, pick, toggleExpand, t,
}: {
  blocks: Block[];
  treeDropHint: { key: string; pos: "before" | "after" } | null;
  rowDragProps: (kind: "section" | "column" | "element", path: number[], key: string) => Record<string, unknown>;
  expanded: Set<string>;
  selEq: (p: number[]) => boolean;
  pick: (e: React.MouseEvent, p: number[]) => void;
  toggleExpand: (key: string) => void;
  t: (k: Key) => string;
}) {
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

export default function Designer({
  page,
  tenantHost,
  token,
  t,
  onClose,
  isSuper,
  kind = "page",
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  onClose: (saved: boolean) => void;
  isSuper: boolean;
  // "blueprint" strips everything that assumes a real published page with a
  // live frontend route (slug, publish status, Live Edit, Preview) — a
  // blueprint has no route of its own to preview/live-edit against. Blocks
  // canvas editing, Undo/Redo, Templates, and Page Settings all work
  // unchanged either way. "siteChrome" (header/footer designer) gets the
  // same treatment as "blueprint" for slug/publish/Live-Edit, minus the
  // device-preview button too — a header/footer has no preview-token route
  // of its own yet (a real, scoped-out-for-now follow-up), Blocks-mode
  // canvas editing is enough for v1.
  // "symbol" (a live-linked component's own master, see SymbolDesignerRoute
  // in App.tsx) gets the same no-slug/no-publish treatment as "blueprint" —
  // Save just PATCHes the symbol's node, no Preview/Live-Edit (a bare
  // component has no route of its own to preview).
  kind?: "page" | "blueprint" | "siteChrome" | "symbol";
}) {
  // Declared ahead of the useUndoRedo() call below, which needs it.
  const [dirty, setDirty] = useState(false);
  // Bumped by every structural (shape/order-changing) mutate() call reachable
  // from Live Edit — duplicate/paste/delete at any level, plus the iframe's
  // own drag-reorder. Live Edit's iframe is a real server-rendered page, not
  // a local render of `blocks`, so unlike a prop/style edit a shape change
  // needs an actual reload to become visible (useLiveEditBridge's own
  // debounced-reload effect). Declared here, not inside useLiveEditBridge,
  // because useUndoRedo (called first, below) also needs bumpStructural —
  // owning it in useLiveEditBridge would make the two hooks depend on each
  // other circularly.
  const [structuralTick, setStructuralTick] = useState(0);
  function bumpStructural() {
    setStructuralTick((n) => n + 1);
  }
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
  // True base tree — always the shared, single source of truth for structure
  // AND style, regardless of which language pill is active (see `blocks`
  // below, and the `langOverrides` state further down, for how a
  // non-base-language view is derived from this without ever mutating it
  // directly). Only `mutate`/`startSpacingDrag`/`undo`/`redo` — and save() —
  // touch this state directly; everything else in this file reads/renders
  // the memoized `blocks` view instead.
  // Figma-style spacing overlay: the hatched fill band only shows while the
  // matching handle is hovered or actively dragged, not for the whole
  // selected box's perimeter at once — a persistent 4-sided hatch on every
  // selection was too visually noisy (user feedback). The small "Npx" badge
  // itself still always shows once selected; only the colored band is gated.
  // Declared ahead of the useUndoRedo() call below, which needs its setter.
  const [hoverBand, setHoverBand] = useState<string | null>(null);
  const {
    rawBlocks,
    mutate,
    setRawBlocksDirectly,
    startSpacingDrag,
    undo,
    redo,
    draggingBand,
  } = useUndoRedo(clone((page.layout as Block[] | undefined) ?? []), setDirty, setSel, bumpStructural, setHoverBand);
  const [activeLeftTab, setActiveLeftTab] = useState<"elements" | "layers" | "settings">("elements");
  // Sprint 2: below `lg` the palette/inspector asides become off-canvas
  // drawers (same pattern as Shell's mobile nav) instead of the fixed
  // 3-column layout — `null` means both are closed.
  const [mobilePanel, setMobilePanel] = useState<"palette" | null>(null);
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
  function toggleGroup(g: FieldGroupKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  const {
    bp,
    setBp,
    bpKey,
    bpGetValue,
    bpKeysOverridden,
    toggleBpKeys,
    sideValue,
    linkedPadding,
    setLinkedPadding,
    linkedRadius,
    setLinkedRadius,
    linkedMargin,
    setLinkedMargin,
  } = useBpStyle();

  const {
    blocks,
    pageSettings, setPageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled,
    siteLanguages, pageLanguage, setPageLanguage,
    activeLang, hasLangSlot, clickPageLanguagePill, translating, retranslatePageLanguage,
    langOverrides, isTextKey, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
  } = usePageAndLanguage({ rawBlocks, page, tenantHost, token, bp, bpKey, setDirty, setSel });
  // Page Settings' Theme picker snapshots a preset onto pageSettings.theme
  // (setPageThemePreset, above) — the canvas below used to read siteTheme
  // (the SITE-WIDE default) directly, so a page using a non-default preset
  // rendered the wrong colors/fonts here while the published site correctly
  // merged the two (apps/frontend's [...slug].astro: `{ ...siteTheme,
  // ...page.settings.theme }`) — mirrored exactly here so Live Edit and the
  // real page agree again.
  const effectiveTheme = pageSettings.theme ? { ...siteTheme, ...pageSettings.theme } : siteTheme;
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
  function fourSideValue(sp: SectionProps, perSideKey: string, fallbackKey: string): string {
    return sideValue(sp as unknown as Record<string, string>, sp.bp, perSideKey, fallbackKey);
  }
  function setFourSideValue(b: number, perSideKey: string, value: string) {
    const path = pathKey(b);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
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
    const path = pathKey(b, r, c);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c];
      if (bp === "desktop") target.props = { ...(target.props ?? {}), [perSideKey]: value };
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function setElSideValue(b: number, r: number, c: number, e: number, perSideKey: string, value: string) {
    const path = pathKey(b, r, c, e);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
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
  // Column span per screen size — desktop's own span is always the base;
  // switching the canvas to tablet/mobile and setting a column's span there
  // (Inspector's Column panel BpToggle) stores it as col.bp["tablet:span"]/
  // ["mobile:span"], same bag/convention as every other per-breakpoint
  // override. Mirrors SectionBlock.astro's rowGridTemplate (frontend copy)
  // so the canvas preview matches what actually publishes. Mobile's default
  // (no column has an explicit mobile:span) stays the pre-existing "stack to
  // one column" behavior — an explicit override opts a row OUT of that.
  function rowGridTemplate(row: Row, atBp: Bp): string {
    const cols = row.columns ?? [];
    if (atBp === "desktop") return cols.map((cc) => `${cc.span ?? 1}fr`).join(" ");
    const hasOverride = cols.some((cc) => bpKeysOverridden(cc.bp, ["span"]));
    if (hasOverride) return cols.map((cc) => `${bpGetValue(String(cc.span ?? 1), cc.bp, "span")}fr`).join(" ");
    return atBp === "mobile" ? "1fr" : cols.map((cc) => `${cc.span ?? 1}fr`).join(" ");
  }
  // Flex mode's own per-bp direction override — mirrors rowGridTemplate's
  // "explicit override opts a row out of the forced-stack default" shape.
  // Mobile's default (no explicit row.bp["mobile:flexDirection"]) stays the
  // old hardcoded stack-to-column; tablet has no forced default of its own
  // (inherits the desktop flexDirection unless explicitly overridden) — real,
  // not admin-preview-only, mirrored in SectionBlock.astro's own copy.
  function rowFlexDirectionAtBp(row: Row, atBp: Bp): string {
    if (atBp === "desktop") return row.flexDirection ?? "row";
    const ov = row.bp?.[`${atBp}:flexDirection`];
    if (ov !== undefined) return ov;
    return atBp === "mobile" ? "column" : row.flexDirection ?? "row";
  }
  const [treeDropHint, setTreeDropHint] = useState<{ key: string; pos: "before" | "after" } | null>(null);
  // True from the moment any iframe (re)load starts (initial open, mode
  // toggle back into Live, or a debounced structural/style reload) until
  // its onLoad fires — covers the skeleton overlay below so a reload never
  // shows the browser's own blank-frame flash, however brief.
  const [, setReloading] = useState(true);
  const [savedAny, setSavedAny] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  // Modal device preview (Desktop/Tablet/Mobile) — separate from preview()'s
  // new-tab flow below: that one is a real browser navigation for a page's
  // published-and-clean case, this one is for blueprints (no public URL to
  // navigate to) and for anyone who'd rather check breakpoints without
  // leaving the Designer.
  const [previewModal, setPreviewModal] = useState<{ src: string; device: "desktop" | "tablet" | "mobile" } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ path: number[]; x: number; y: number } | null>(null);
  const [iconSearch, setIconSearch] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(page.slug as string);
  const [slugError, setSlugError] = useState<string | null>(null);
  const {
    chromeKind, chromeStatus, setChromeStatus, chromeIsDefault, chromeMobileNav, patchChromeMeta,
    availableHeaders, availableFooters,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, patchPageChrome,
    resolvedHeaderId, resolvedFooterId, headerFrameHeight, footerFrameHeight,
  } = useSiteChrome({ tenantHost, token, page, kind, setError, bumpStructural });

  const {
    showHistory, setShowHistory, revisions, revisionsLoaded, restoring,
    renameSlug, save, loadHistory, restoreRevision, saveBlueprint, saveSymbol, saveSiteChrome,
    openDevicePreview,
  } = usePersist({
    tenantHost, token, page, kind, bp, chromeKind, setChromeStatus,
    rawBlocks, setRawBlocksDirectly, pageSettings, setPageSettings,
    pageLanguage, pageMultilangEnabled, langOverrides,
    slugDraft, setSlugDraft, setEditingSlug, setSlugError,
    setDirty, setBusy, setError, setSavedAny, setMsg,
    setPreviewModal, t,
  });

  // Autosave (2026-09-16): debounced silent save while dirty, restricted to
  // draft-status content only — a page/siteChrome already published only
  // saves on an explicit Update/Publish click, so autosave can never
  // silently push an unreviewed edit onto the live site. Blueprints/symbols
  // have no publish concept at all (every save just overwrites the same
  // row, same as a draft page), so they're always autosave-eligible.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const eligible =
      kind === "blueprint" ||
      kind === "symbol" ||
      (kind === "page" && page.status !== "published") ||
      (kind === "siteChrome" && chromeStatus !== "published");
    if (!dirty || !eligible || busy) return;
    autosaveTimerRef.current = setTimeout(() => {
      if (kind === "blueprint") void saveBlueprint();
      else if (kind === "symbol") void saveSymbol();
      else if (kind === "siteChrome") void saveSiteChrome();
      else void save();
    }, 2000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, busy, kind, page.status, chromeStatus, rawBlocks, pageSettings]);

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
  // "symbol" element's symbolId picker — same live-fetched-once-per-tenant
  // shape as availableMenus above. ponytail: fetched once per Designer
  // mount, so an "Edit Master" save in another tab won't refresh this list
  // until reload — fine at this scale, upgrade to refetch-on-focus if it
  // becomes annoying.
  const [availableSymbols, setAvailableSymbols] = useState<api.Symbol[]>([]);
  useEffect(() => {
    void api.listSymbols(tenantHost, token).then(setAvailableSymbols);
  }, [tenantHost]);
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
  const editingText = useRef<Record<string, string>>({});
  // Which slide each slider element is previewing on the Blocks canvas, keyed
  // by element id (a page can hold several sliders). The canvas used to
  // hard-code slides[0], so adding content to slide 2+ appeared to do nothing
  // at all: the Inspector edits every slide, the canvas only ever drew the
  // first one. The dots along the bottom of the preview drive this now
  // instead of being decorative.
  const [sliderSlideIdx, setSliderSlideIdx] = useState<Record<string, number>>({});
  // Which nested row/column/element inside the CURRENTLY-PREVIEWED slide is
  // selected for editing, keyed by the slider element's own id — separate
  // from Designer's own global `sel` (which only ever addresses
  // section/row/column/element paths, never reaches inside a slide). Set by
  // clicking a Text/Button/Image/Row chip on the slide's own mini-canvas;
  // read by Inspector to show that nested element's own Content/Style tabs
  // instead of the slider's own fields.
  const [sliderInnerSel, setSliderInnerSel] = useState<Record<string, { r: number; c: number; e: number } | null>>({});
  // Canvas-direct edit mode for a nested slide heading/text child, keyed by
  // that child's own id — see designer/context.ts's DesignerCtx comment for
  // why this can't just reuse sliderInnerSel/editingText directly.
  const [sliderInnerEditing, setSliderInnerEditing] = useState<Record<string, boolean>>({});

  // The Settings/Inspector tab shares the left sidebar with Elements/Layers
  // now (previously a permanently-visible right-hand aside) — without this,
  // clicking a section/row/column/element (or a slider's own nested child)
  // would update Inspector's content invisibly behind whichever tab the
  // author was already on. Jumps to Settings on any new selection so the
  // click-to-edit flow still feels immediate.
  useEffect(() => {
    if (sel || Object.values(sliderInnerSel).some(Boolean)) setActiveLeftTab("settings");
  }, [sel, sliderInnerSel]);

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

  const { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas } = useClipboard();

  const {
    drag,
    isSectionLocked,
    duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
    duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
    deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
    dropIntoColumn,
  } = useBlockOps({
    blocks,
    mutate,
    setSel,
    bumpStructural,
    isSuper,
    t,
    clipboard: { clipCopy, clipRead, styleCopy, styleRead },
    setDropHint,
  });

  const {
    showTemplates, setShowTemplates, templates, templatesBusy,
    openTemplates, templateKind, saveAsTemplate, confirmSaveTemplate, insertTemplate, deleteTemplateHandler,
    templateFilter, setTemplateFilter, templateSearch, setTemplateSearch, templateKindLabel, templateRows,
    pendingTemplate, setPendingTemplate, templateName, setTemplateName,
    pendingSymbolEl, setPendingSymbolEl, symbolName, setSymbolName, symbolsBusy,
    makeComponent, confirmMakeComponent, insertSymbol, deleteSymbolHandler, detachSymbolInstance,
    showSaveBlueprint, setShowSaveBlueprint,
    blueprintName, setBlueprintName, blueprintDescription, setBlueprintDescription,
    blueprintCategory, setBlueprintCategory, blueprintScope, setBlueprintScope, blueprintBusy,
    confirmSaveAsBlueprint,
  } = useTemplateLibrary({
    blocks,
    mutate,
    sel,
    bumpStructural,
    isSectionLocked,
    t,
    tenantHost,
    token,
    pageSettings,
    availableSymbols,
    setAvailableSymbols,
    setError,
  });

  const {
    mode,
    toggleLive,
  } = useLiveEditBridge({
    blocks,
    mutate,
    sel,
    setSel,
    undo,
    redo,
    structuralTick,
    bumpStructural,
    isSectionLocked,
    t,
    tenantHost,
    token,
    pageId: page.id as string,
    pageSlug: page.slug as string,
    kind,
    dirty,
    save,
    saveBlueprint,
    setError,
    setReloading,
    setCtxMenu,
    setSliderSlideIdx,
    setSliderInnerSel,
  });

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
      if (next.has(key)) next.delete(key); else next.add(key);
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
        if (kind === "section") {
          mutate((bs) => moveSection(bs, from, adjustedTo));
        } else {
          if (isSectionLocked(path[0])) {
            toast.error(t("designer-section-locked-toast"));
            return;
          }
          mutate((bs) => moveColumn(bs, path[0], path[1], from, adjustedTo));
        }
      },
    };
  }

  // ---------- inspector ----------
  // Media library picker (docs/SliderProblem.pdf #3 — an image field should
  // let an author pick an already-uploaded file, not just paste a URL or
  // upload a fresh one) — holds the pending onSelect callback for whichever
  // field opened it; reuses the same MediaPickerModal PostEditorPage's own
  // feature-image picker already renders.
  const [mediaPickerCallback, setMediaPickerCallback] = useState<((url: string) => void) | null>(null);
  function openMediaPicker(onSelect: (url: string) => void) {
    setMediaPickerCallback(() => onSelect);
  }

  async function uploadImage(file: File, setValue: (v: string) => void) {
    setUploading(true);
    try {
      setValue(api.publicMediaBase(tenantHost) + (await api.uploadMedia(tenantHost, token, file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
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

  // React.memo on ElPreview/Inspector (Layer (a)) only bails on a render
  // where EVERY prop keeps its identity — every mutator below is otherwise a
  // fresh closure every render (none of the owning hooks memoize their own
  // return values), so without this, memo would never bail on an edit
  // elsewhere in the tree. useStableFns wraps each one in a permanently-
  // stable ref-passthrough instead of a hand-tracked useCallback dependency
  // array per function — several of these call through 2-3 layers of other
  // unmemoized functions (bumpStructural, isSectionLocked), where a missed
  // transitive dependency would silently reintroduce a stale closure; a
  // ref-passthrough can't have that bug by construction.
  const stableFns = useStableFns({
    mutate, isSectionLocked,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue,
    toggleGroup, uploadImage, openMediaPicker,
    setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, patchPageChrome,
    hasLangSlot, clickPageLanguagePill, retranslatePageLanguage,
    langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement,
  });

  // Bundled closure for the extracted Inspector/ElPreview (Layer 1b of the
  // God Component refactor, see designer/context.ts's own header comment)
  // — every value/mutator both of those need, in one place so adding a new
  // element/field only ever means adding a field here, not touching every
  // call site. Memoized (render-perf refactor Layer (c)) so React.memo on
  // ElPreview/Inspector can actually bail on an edit elsewhere in the tree —
  // depends on every plain value here plus stableFns (itself
  // reference-stable across the component's lifetime, so its presence in
  // the array never triggers a recompute, only satisfies the lint rule).
  const designerCtx: DesignerCtx = useMemo(() => ({
    t, bp, mode, kind, sel, setSel, blocks,
    isSuper,
    ...stableFns,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, sliderInnerEditing, setSliderInnerEditing,
    availableMenus, availableCategories, availableSymbols,
    pageSettings, themePresets,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang,
    translating,
    isTextKey, pathKey,
    editingText,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    t, bp, mode, kind, sel, setSel, blocks,
    isSuper,
    stableFns,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, sliderInnerEditing, setSliderInnerEditing,
    availableMenus, availableCategories, availableSymbols,
    pageSettings, themePresets,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang,
    translating,
    isTextKey, pathKey,
    editingText,
  ]);

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
        <span className="text-xs font-bold text-ink">{page.title as string}</span>
        {kind === "page" && (
          <>
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
                busy ? "bg-accent/10 text-accent" : page.status === "published" && !dirty ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
              }`}
            >
              {busy ? t("designer-saving") : dirty ? t("designer-dirty") : page.status === "published" ? t("pages-published") : t("pages-draft")}
            </span>
          </>
        )}
        {kind === "blueprint" && (
          <>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
              {t("blueprints-title")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${busy ? "bg-accent/10 text-accent" : dirty ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
            >
              {busy ? t("designer-saving") : dirty ? t("designer-dirty") : t("designer-saved")}
            </span>
          </>
        )}
        {kind === "symbol" && (
          <>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
              {t("designer-symbols-title")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${busy ? "bg-accent/10 text-accent" : dirty ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
            >
              {busy ? t("designer-saving") : dirty ? t("designer-dirty") : t("designer-saved")}
            </span>
          </>
        )}
        {kind === "siteChrome" && (
          <>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
              {t("header-footer-title")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                busy ? "bg-accent/10 text-accent" : chromeStatus === "published" && !dirty ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
              }`}
            >
              {busy ? t("designer-saving") : dirty ? t("designer-dirty") : chromeStatus === "published" ? t("pages-published") : t("pages-draft")}
            </span>
          </>
        )}
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
        {kind === "page" && (
          <button
            onClick={() => setSel(null)}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
            title={t("designer-page-settings")}
          >
            <Settings className="h-3.5 w-3.5" /> {t("designer-page-settings")}
          </button>
        )}
        {kind === "page" && (
          <button
            onClick={() => void loadHistory()}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
            title={t("designer-history")}
          >
            <History className="h-3.5 w-3.5" /> {t("designer-history")}
          </button>
        )}
        {kind === "page" && (
          <button
            onClick={() => setShowSaveBlueprint(true)}
            className="flex items-center gap-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#e8e8ed]"
          >
            <LayoutTemplate className="h-3.5 w-3.5" /> {t("blueprints-save-as")}
          </button>
        )}
        {(kind === "page" || kind === "blueprint") && (
          <button
            onClick={() => void toggleLive()}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-canvas ${
              mode === "live" ? "bg-accent/15 text-accent" : "text-body"
            }`}
          >
            <MousePointerClick className="h-3.5 w-3.5" /> {mode === "live" ? t("designer-block-view") : t("designer-live-view")}
          </button>
        )}
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
        {(kind === "blueprint" || kind === "siteChrome" || kind === "page") && (
          <button
            onClick={() => void openDevicePreview()}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
          </button>
        )}
        {kind !== "page" && (
          <button
            onClick={() => void (kind === "blueprint" ? saveBlueprint() : kind === "symbol" ? saveSymbol() : saveSiteChrome())}
            disabled={busy}
            className="rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-50"
          >
            {busy ? t("designer-saving") : t("designer-save")}
          </button>
        )}
        {kind === "page" && (
          <button
            onClick={() => void save("published")}
            disabled={busy || (page.status === "published" && !dirty)}
            className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("designer-saving") : page.status === "published" ? t("designer-update") : t("designer-publish")}
          </button>
        )}
        {kind === "siteChrome" &&
          (chromeStatus === "published" ? (
            <button
              onClick={() => void saveSiteChrome("draft")}
              disabled={busy}
              className="rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-body hover:bg-[#e8e8ed] disabled:opacity-50"
            >
              {t("header-footer-unpublish")}
            </button>
          ) : (
            <button
              onClick={() => void saveSiteChrome("published")}
              disabled={busy}
              className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {t("designer-publish")}
            </button>
          ))}
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
          className={`absolute inset-y-0 left-0 z-40 w-72 transform overflow-y-auto border-r border-line/30 bg-white p-3 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
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
            <button
              onClick={() => setActiveLeftTab("settings")}
              className={`flex-1 rounded-md py-1 inline-flex items-center justify-center gap-1 ${activeLeftTab === "settings" ? "bg-white shadow-sm" : "text-sub"}`}
            >
              <Settings className="h-3 w-3" /> {t("designer-inspector")}
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
          ) : activeLeftTab === "layers" ? (
            <LayersTreeView
              blocks={blocks}
              treeDropHint={treeDropHint}
              rowDragProps={rowDragProps}
              expanded={expanded}
              selEq={selEq}
              pick={pick}
              toggleExpand={toggleExpand}
              t={t}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-inspector")}</p>
              {kind === "siteChrome" && (
                <div className="mb-1 space-y-3 rounded-lg border border-line/30 p-3">
                  <p className="text-xs font-bold text-ink">{t("header-footer-settings")}</p>
                  <label className="flex items-center gap-2 text-[11px] font-medium text-body">
                    <input
                      type="checkbox"
                      checked={chromeIsDefault}
                      onChange={(e) => void patchChromeMeta({ isDefault: e.target.checked })}
                    />
                    {t("header-footer-set-default")}
                  </label>
                  {chromeKind === "header" && (
                    <div className="space-y-2 border-t border-line/20 pt-2">
                      <p className="text-[11px] font-semibold text-body">{t("header-footer-mobile-nav")}</p>
                      <label className="block text-[11px] text-body">
                        {t("header-footer-mobile-style")}
                        <select
                          value={chromeMobileNav.style ?? "dropdown"}
                          onChange={(e) => void patchChromeMeta({ mobileNav: { style: e.target.value } })}
                          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
                        >
                          <option value="dropdown">{t("header-footer-mobile-style-dropdown")}</option>
                          <option value="fly">{t("header-footer-mobile-style-fly")}</option>
                          <option value="fullscreen">{t("header-footer-mobile-style-fullscreen")}</option>
                        </select>
                      </label>
                      <label className="block text-[11px] text-body">
                        {t("header-footer-mobile-position")}
                        <select
                          value={chromeMobileNav.position ?? "right"}
                          onChange={(e) => void patchChromeMeta({ mobileNav: { position: e.target.value } })}
                          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
                        >
                          <option value="left">{t("header-footer-mobile-left")}</option>
                          <option value="right">{t("header-footer-mobile-right")}</option>
                        </select>
                      </label>
                      <label className="block text-[11px] text-body">
                        {t("header-footer-mobile-size")}
                        <select
                          value={chromeMobileNav.size ?? "md"}
                          onChange={(e) => void patchChromeMeta({ mobileNav: { size: e.target.value } })}
                          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
                        >
                          <option value="sm">{t("header-footer-mobile-sm")}</option>
                          <option value="md">{t("header-footer-mobile-md")}</option>
                          <option value="lg">{t("header-footer-mobile-lg")}</option>
                        </select>
                      </label>
                      <label className="block text-[11px] text-body">
                        {t("header-footer-mobile-color")}
                        <input
                          type="color"
                          value={chromeMobileNav.color ?? "#111827"}
                          onChange={(e) => void patchChromeMeta({ mobileNav: { color: e.target.value } })}
                          className="mt-1 h-7 w-full rounded-md border border-line/30"
                        />
                      </label>
                      <label className="block text-[11px] text-body">
                        {t("header-footer-mobile-animation")}
                        <select
                          value={chromeMobileNav.animation ?? "slide"}
                          onChange={(e) => void patchChromeMeta({ mobileNav: { animation: e.target.value } })}
                          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
                        >
                          <option value="slide">{t("header-footer-mobile-slide")}</option>
                          <option value="fade">{t("header-footer-mobile-fade")}</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
              <Inspector ctx={designerCtx} />
            </div>
          )}
        </aside>

        {/* canvas */}
        <main
          className="min-w-0 flex-1 overflow-y-auto p-6"
          onClick={() => setSel(null)}
          style={
            {
              "--color-primary": effectiveTheme?.primaryColor,
              "--color-primary-content": effectiveTheme?.primaryColor ? bestTextColor(effectiveTheme.primaryColor) : undefined,
              "--color-secondary": effectiveTheme?.secondaryColor,
              "--color-bg": effectiveTheme?.backgroundColor,
              "--color-text": effectiveTheme?.textColor,
              "--font-family": effectiveTheme?.fontFamily,
              "--font-heading": effectiveTheme?.headingFont,
              "--font-subheading": effectiveTheme?.subHeadingFont,
              background: "var(--color-bg, #ffffff)",
              color: "var(--color-text, inherit)",
              fontFamily: "var(--font-family, inherit)",
            } as React.CSSProperties
          }
        >
          {resolvedHeaderId && (
            <div className="mb-3 overflow-hidden rounded-lg border border-dashed border-line/40">
              <iframe
                key={resolvedHeaderId}
                src={api.chromePreviewUrl(tenantHost, resolvedHeaderId, "header", { embed: true })}
                className="w-full border-0"
                style={{ height: headerFrameHeight || 64, pointerEvents: "none" }}
                title="Header preview"
              />
            </div>
          )}
          <div
            className={`mx-auto ${mode === "live" ? "" : "space-y-4"}`}
            style={{ maxWidth: bp === "tablet" ? "48rem" : bp === "mobile" ? "24rem" : mode === "live" ? undefined : "56rem" }}
          >
            {blocks.length === 0 && <p className="py-10 text-center text-xs text-sub">{t("designer-empty")}</p>}
            {blocks.map((block, b) => {
              // apps/api's pagesAfterRead upgrades any surviving legacy
              // top-level block (the retired BlockBuilder "hero" shape) into
              // a real section before Designer ever sees it, so nothing but
              // "section" reaches this point — skip defensively rather than
              // resurrect an editor for a shape that can no longer arrive.
              if (block.type !== "section") return null;
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
              const sectionEffectiveBg = sp.bg || effectiveTheme?.backgroundColor || "#ffffff";
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
                  <HiddenAtBpBadge hidden={sectionHiddenAtBp} bp={bp} t={t} />
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
                          <HiddenAtBpBadge hidden={rowHiddenAtBp} bp={bp} t={t} />
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
                            className={`${row.layoutMode === "flex" ? "flex" : "grid"} ${mode !== "live" ? "rounded-lg" : ""} ${selCls([b, r])}`}
                            onClick={(ev) => pick(ev, [b, r])}
                            onContextMenu={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              setSel([b, r]);
                              setCtxMenu({ path: [b, r], x: ev.clientX, y: ev.clientY });
                            }}
                            style={{
                              ...(row.layoutMode === "flex"
                                ? {
                                    // Mirrors rowGridTemplate's own per-bp
                                    // convention — rowFlexDirectionAtBp
                                    // defaults mobile to "column" (the old
                                    // hardcoded stack) unless the row's own
                                    // bp bag explicitly overrides it.
                                    flexDirection: rowFlexDirectionAtBp(row, bp) as React.CSSProperties["flexDirection"],
                                    justifyContent: row.justifyContent ?? "flex-start",
                                    alignItems: row.alignItems ?? "stretch",
                                    flexWrap: row.flexWrap ?? "wrap",
                                  }
                                : { gridTemplateColumns: rowGridTemplate(row, bp) }),
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
                              className={`relative min-h-[3rem] min-w-0 transition-colors ${
                                mode === "live" ? "" : "rounded-lg border border-dashed p-1.5"
                              } ${selCls([b, r, c])} ${dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""}`}
                              style={{
                                ...bpColStyle(col),
                                // Row's own `span` field is reused as this
                                // column's flex-grow factor in flex mode
                                // (same field, same author intent — "this
                                // column is roughly twice as wide" — instead
                                // of a grid fr-track) so flipping a row
                                // between grid/flex never discards a
                                // column's relative-width setting.
                                ...(row.layoutMode === "flex"
                                  ? rowFlexDirectionAtBp(row, bp).startsWith("column")
                                    ? // Stacked (column/column-reverse) — full flex-basis, same
                                      // override the old hardcoded-column CSS always applied,
                                      // now conditional on the resolved direction instead of
                                      // unconditional on any non-desktop bp.
                                      { flex: "1 1 100%" }
                                    : { flex: `${bpGetValue(String(col.span ?? 1), col.bp, "span")} 1 0%` }
                                  : {}),
                                borderColor: mode === "live" ? undefined : colOverlay.line,
                                opacity: colHiddenAtBp ? 0.35 : undefined,
                              }}
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
                              <HiddenAtBpBadge hidden={colHiddenAtBp} bp={bp} t={t} />
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
                                  <HiddenAtBpBadge hidden={hiddenAtBp(el.props)} bp={bp} t={t} />
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
                                  {selEq([b, r, c, e]) && mode !== "live" && el.type === "image" && (
                                    <span
                                      onMouseDown={(ev) => {
                                        const wrapper = (ev.currentTarget as HTMLElement).parentElement;
                                        const img = wrapper?.querySelector("img");
                                        const startPx = img ? Math.round(img.getBoundingClientRect().width) : 200;
                                        startSpacingDrag(ev, startPx, "x", 1, (next, px) => {
                                          const target = section(next, b).rows[r].columns[c].elements[e];
                                          const value = `${Math.max(20, px)}px`;
                                          if (bp === "desktop") target.props = { ...(target.props ?? {}), imgWidth: value };
                                          else target.bp = { ...(target.bp ?? {}), [bpKey("imgWidth")]: value };
                                        });
                                      }}
                                      title={t("designer-f-width")}
                                      className="absolute -bottom-2 -right-2 z-20 h-3 w-3 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow-sm"
                                    />
                                  )}
                                  <ElPreview ctx={designerCtx} el={el} path={[b, r, c, e]} />
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
          {resolvedFooterId && (
            <div className="mt-3 overflow-hidden rounded-lg border border-dashed border-line/40">
              <iframe
                key={resolvedFooterId}
                src={api.chromePreviewUrl(tenantHost, resolvedFooterId, "footer", { embed: true })}
                className="w-full border-0"
                style={{ height: footerFrameHeight || 96, pointerEvents: "none" }}
                title="Footer preview"
              />
            </div>
          )}
        </main>
      </div>

      {mediaPickerCallback && (
        <MediaPickerModal
          tenantHost={tenantHost}
          token={token}
          onSelect={(url) => {
            mediaPickerCallback(url);
            setMediaPickerCallback(null);
          }}
          onClose={() => setMediaPickerCallback(null)}
        />
      )}

      {previewModal &&
        (() => {
          const DEVICE_WIDTH: Record<"desktop" | "tablet" | "mobile", string> = {
            desktop: "100%",
            tablet: "48rem",
            mobile: "24rem",
          };
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
              onClick={() => setPreviewModal(null)}
            >
              <div
                className="flex h-[90vh] w-[min(95vw,80rem)] flex-col overflow-hidden rounded-xl bg-white shadow-xl"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-line/30 px-4 py-2.5">
                  <p className="text-xs font-bold text-ink">{t("designer-preview")}</p>
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
                        onClick={() => setPreviewModal((m) => (m ? { ...m, device: key } : m))}
                        title={t(labelKey)}
                        className={`rounded-full p-1.5 ${
                          previewModal.device === key ? "bg-white text-accent shadow-sm" : "text-sub hover:text-body"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPreviewModal(null)}
                    className="rounded-full p-1.5 text-body hover:bg-canvas"
                    title={t("designer-close")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-1 items-start justify-center overflow-auto bg-canvas/60 p-4">
                  {previewModal.device === "desktop" ? (
                    <iframe
                      key={previewModal.src}
                      src={previewModal.src}
                      className="h-full rounded-lg border border-line/30 bg-white shadow-sm"
                      style={{ width: DEVICE_WIDTH[previewModal.device] }}
                      title={t("designer-preview")}
                    />
                  ) : (
                    // Device bezel so tablet/mobile preview reads as an actual
                    // phone/tablet instead of a plain narrowed box — the
                    // iframe itself is unchanged, just wrapped.
                    <div
                      className={`flex shrink-0 flex-col gap-1.5 bg-ink shadow-xl ${
                        previewModal.device === "mobile"
                          ? "aspect-[9/19.5] h-full max-h-[42rem] rounded-[2.5rem] p-3"
                          : "h-full rounded-[1.5rem] p-2.5"
                      }`}
                      style={
                        previewModal.device === "mobile"
                          ? undefined
                          : { width: `calc(${DEVICE_WIDTH[previewModal.device]} + 1.5rem)` }
                      }
                    >
                      {previewModal.device === "mobile" && (
                        <div className="mx-auto h-1.5 w-16 shrink-0 rounded-full bg-white/25" />
                      )}
                      <iframe
                        key={previewModal.src}
                        src={previewModal.src}
                        className={`w-full flex-1 bg-white ${previewModal.device === "mobile" ? "rounded-[1.75rem]" : "rounded-xl"}`}
                        title={t("designer-preview")}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

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
                setPendingSymbolEl(null);
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
                {pendingSymbolEl ? (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void confirmMakeComponent();
                    }}
                    className="mb-3 flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={symbolName}
                      onChange={(ev) => setSymbolName(ev.target.value)}
                      placeholder={t("designer-symbols-make-prompt")}
                      className="min-w-0 flex-1 rounded-full border border-line/30 px-3 py-1.5 text-xs outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={!symbolName.trim() || symbolsBusy}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {t("designer-symbols-make")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingSymbolEl(null)}
                      className="text-body hover:text-ink"
                      aria-label={t("designer-cancel")}
                      title={t("designer-cancel")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : pendingTemplate ? (
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
                <div className="mt-4 border-t border-line/20 pt-3">
                  <p className="mb-2 text-xs font-bold text-ink">{t("designer-symbols-title")}</p>
                  {availableSymbols.length === 0 ? (
                    <p className="text-xs text-sub">{t("designer-symbols-empty")}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {availableSymbols.map((sym) => (
                        <div key={sym.id} className="flex flex-col gap-1.5 rounded-lg border border-line/30 p-2">
                          <span className="truncate text-[11px] font-medium text-ink" title={sym.name}>
                            {sym.name}
                          </span>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => insertSymbol(sym)} className="text-[11px] font-semibold text-accent">
                              {t("designer-templates-insert")}
                            </button>
                            <button
                              onClick={() => void deleteSymbolHandler(sym.id)}
                              className="text-red-500"
                              aria-label={t("designer-symbols-delete")}
                              title={t("designer-symbols-delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHistory(false)}>
          <div className="w-[min(90vw,28rem)] rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink"><History className="h-3.5 w-3.5" /> {t("designer-history")}</p>
              <button onClick={() => setShowHistory(false)} aria-label={t("designer-close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {!revisionsLoaded && <p className="text-[11px] text-sub">{t("designer-saving")}</p>}
            {revisionsLoaded && revisions.length === 0 && <p className="text-[11px] text-sub">{t("designer-history-empty")}</p>}
            <ul className="max-h-80 divide-y divide-line/20 overflow-y-auto">
              {revisions.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-sub">{new Date(r.createdAt).toLocaleString()} · {r.title}</span>
                  <button
                    onClick={() => void restoreRevision(r.id)}
                    disabled={restoring}
                    className="shrink-0 font-semibold text-accent hover:underline disabled:opacity-40"
                  >
                    {t("designer-restore")}
                  </button>
                </li>
              ))}
            </ul>
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
                {el.type !== "slider" && (
                  <>
                    {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleElement(b, r, c, e))}
                    {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleElement(b, r, c, e), !styleHas("element"))}
                  </>
                )}
                {divider}
                {el.type === "symbol" ? (
                  <>
                    {item(<ExternalLink className="h-3.5 w-3.5" />, t("designer-symbols-edit-master"), () =>
                      window.open(`${isSuper ? "/content/symbols" : "/symbols"}/${el.props.symbolId}`, "_blank"),
                    )}
                    {item(<Unlink className="h-3.5 w-3.5" />, t("designer-symbols-detach"), () => detachSymbolInstance(b, r, c, e))}
                  </>
                ) : (
                  <>
                    {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r, c, e]))}
                    {item(<Component className="h-3.5 w-3.5" />, t("designer-symbols-make"), () => makeComponent([b, r, c, e]))}
                  </>
                )}
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
