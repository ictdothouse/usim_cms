// Designer's main canvas — the Section/Row/Column/Element render tree,
// spacing-drag handles, add-row/add-section buttons, and header/footer
// chrome iframes. Split out of Designer.tsx as part of the same God
// Component file-size refactor Inspector.tsx already went through (see
// Designer.tsx's own header comment) — pure code motion, same JSX, same
// conditions, same event handlers, same values, just reached through the
// same `ctx: DesignerCtx` bundle Inspector/ElPreview already use (Canvas
// renders ElPreview too) plus one extra canvas-only props bundle for
// everything DesignerCtx doesn't carry (section-level block ops, spacing-
// drag plumbing, site-chrome iframe heights, selection/context-menu
// plumbing that stays local to Designer.tsx).
//
// Holds no hooks of its own (every piece of state it reads comes from
// `ctx`/props, same as Inspector/ElPreview) — deliberately NOT wrapped in
// React.memo: none of Designer's regions were memoized before this split,
// so wrapping it now would be a behavior change, not a pure move.
import {
  Clipboard,
  ClipboardPaste,
  Copy,
  GripVertical,
  LayoutTemplate,
  Lock,
  Paintbrush,
  Plus,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import * as api from "@/lib/api";
import { bestTextColor } from "@/lib/utils";
import type { Key } from "@/i18n";
import { section } from "./blockPath";
import { newRow, newSection } from "./parsers";
import {
  PAD, PADDING_SIDE_KEYS, PADDING_SIDE_FALLBACK, MARGIN_SIDE_KEYS, MARGIN_SIDE_FALLBACK,
  SPACE, lengthValue, colStyle, overlayColors, shadowToCss, RADIUS, BORDER, RADIUS_CORNER_KEYS,
} from "./style";
import { COLUMN_FIELDS, COLUMN_SPACING_KEYS } from "./fields";
import { ElPreview } from "./ElPreview";
import { DEVICE_DIMS } from "./DeviceViewport";
import type { Bp, Block, Col, Row, El, SectionProps, Drag } from "./types";
import type { DesignerCtx } from "./context";
import type { UndoRedoApi } from "./hooks/useUndoRedo";
import type { useBlockOps } from "./hooks/useBlockOps";
import type { useSiteChrome } from "./hooks/useSiteChrome";

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

export interface DesignerCanvasProps {
  ctx: DesignerCtx;
  selEq: (p: number[]) => boolean;
  selCls: (p: number[]) => string;
  pick: (e: React.MouseEvent, p: number[]) => void;
  setCtxMenu: (v: { path: number[]; x: number; y: number } | null) => void;
  effectiveTheme: Record<string, string> | null;
  desktopBoxed: boolean;
  isCanvasMode: boolean;
  tenantHost: string;
  resolvedHeaderId: ReturnType<typeof useSiteChrome>["resolvedHeaderId"];
  resolvedFooterId: ReturnType<typeof useSiteChrome>["resolvedFooterId"];
  headerFrameHeight: ReturnType<typeof useSiteChrome>["headerFrameHeight"];
  footerFrameHeight: ReturnType<typeof useSiteChrome>["footerFrameHeight"];
  startSpacingDrag: UndoRedoApi["startSpacingDrag"];
  draggingBand: UndoRedoApi["draggingBand"];
  hoverBand: string | null;
  setHoverBand: Dispatch<SetStateAction<string | null>>;
  duplicateSection: ReturnType<typeof useBlockOps>["duplicateSection"];
  copySection: ReturnType<typeof useBlockOps>["copySection"];
  pasteSection: ReturnType<typeof useBlockOps>["pasteSection"];
  copyStyleSection: ReturnType<typeof useBlockOps>["copyStyleSection"];
  pasteStyleSection: ReturnType<typeof useBlockOps>["pasteStyleSection"];
  deleteSection: ReturnType<typeof useBlockOps>["deleteSection"];
  dropHint: string | null;
  setDropHint: (v: string | null) => void;
  dropIntoColumn: ReturnType<typeof useBlockOps>["dropIntoColumn"];
  drag: MutableRefObject<Drag | null>;
}

export function DesignerCanvas({
  ctx,
  selEq, selCls, pick, setCtxMenu,
  effectiveTheme, desktopBoxed, isCanvasMode, tenantHost,
  resolvedHeaderId, resolvedFooterId, headerFrameHeight, footerFrameHeight,
  startSpacingDrag, draggingBand, hoverBand, setHoverBand,
  duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
  dropHint, setDropHint, dropIntoColumn, drag,
}: DesignerCanvasProps) {
  const {
    t, bp, bpKey, bpGetValue, bpKeysOverridden, sideValue, fourSideValue, mode, blocks, setSel,
    isSectionLocked, mutate, linkedPadding, linkedMargin, pageSettings, saveAsTemplate, clipHas, styleHas,
    deleteRow, deleteColumn, deleteElement,
  } = ctx;

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

  return (
    <main
      // No isCanvasMode means genuinely edge-to-edge content (Live Edit
      // desktop, or a "full" contentWidth page) — the old unconditional
      // p-6 left a same-color gap around it with nothing to explain it,
      // reading as an accidental leftover margin ("macam island") rather
      // than a deliberate frame. Only the boxed/backdropped case gets
      // that breathing room now.
      className={`min-w-0 flex-1 overflow-y-auto ${isCanvasMode ? "bg-canvas p-6" : ""}`}
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
          // Device-sim (tablet/mobile, Blocks mode) moves the theme bg
          // off <main> and onto the framed box below instead, so the
          // area outside the simulated screen reads as canvas backdrop
          // (bg-canvas above, or pageSettings.canvasColor when the
          // author picked one in Page Settings) rather than looking
          // like unfilled/leftover theme-bg space.
          background: isCanvasMode ? pageSettings.canvasColor || undefined : "var(--color-bg, #ffffff)",
          color: "var(--color-text, inherit)",
          fontFamily: "var(--font-family, inherit)",
        } as React.CSSProperties
      }
    >
      <div
        className="relative mx-auto"
        style={{
          // Same DEVICE_DIMS Preview and Live Edit frame the real page at
          // (DeviceViewport) — this bp simulation, those two, and a real
          // phone/tablet all agree on the width a free-position element's
          // fixed-px size gets judged against.
          maxWidth: bp !== "desktop" ? `${DEVICE_DIMS[bp].w}px` : mode === "live" || !desktopBoxed ? undefined : "56rem",
        }}
      >
        {isCanvasMode && (
          // Decorative-only layer (bg/rounded corners/border/shadow), kept
          // OUT of the real content below — same split this file's own
          // per-section render already uses (see its "Split so
          // overflow-hidden ... only ever wraps a decorative backdrop
          // layer" comment a bit further down): an overflow-hidden box
          // around the real content would clip every padding/margin
          // drag-handle badge that deliberately overhangs its own edge by
          // design, and here that overhang lands right on this box's own
          // left/right edge (sections span its full width, no gap to
          // absorb it) — that was clipping the "0px" badges at
          // tablet/mobile. The sibling content div right below is
          // `relative` (not static) so it still stacks above this
          // `absolute` one despite coming later in paint order only by
          // position, not z-index.
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.5rem] border border-line/60 shadow-lg"
            style={{ background: "var(--color-bg, #ffffff)" }}
          />
        )}
        <div className="relative" style={{ color: isCanvasMode ? "var(--color-text, inherit)" : undefined }}>
        {resolvedHeaderId && (
          // Inside the same bp-width-constrained box as the page content below
          // (was a full-width sibling of it) — the iframe's own real CSS media
          // queries only ever see this box's rendered width, so a tablet/mobile
          // simulation needs the header iframe narrowed too, or its bp-only
          // styles never activate and it always renders at the desktop tier.
          <div className="overflow-hidden border-b border-dashed border-line/40">
            <iframe
              key={resolvedHeaderId}
              src={api.chromePreviewUrl(tenantHost, resolvedHeaderId, "header", { embed: true })}
              className="w-full border-0"
              style={{ height: headerFrameHeight || 64, pointerEvents: "none" }}
              title="Header preview"
            />
          </div>
        )}
        <div className={mode === "live" ? "" : "space-y-4"}>
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
                                  // A slider column also force-stretches while
                                  // stacked — mirrors SectionBlock.astro's
                                  // data-fill rule (a slider has no intrinsic
                                  // width there, so a non-stretch align-items
                                  // would otherwise shrink it to 0px).
                                  { flex: "1 1 100%", ...(col.elements.some((el) => el.type === "slider") ? { alignSelf: "stretch" } : {}) }
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
                              <ElPreview ctx={ctx} el={el} path={[b, r, c, e]} />
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
                        onClick={() => mutate((bs) => section(bs, b).rows.push(newRow(preset)))}
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
          // Also a drop target for the Layout palette's "Section" preset
          // (drag.current.kind === "new-section") — same append-to-end
          // mutation as the click handler right above, just drag-triggered.
          // Dropping that preset onto an EXISTING section's column instead
          // inserts right after it (see useBlockOps.ts's dropIntoColumn).
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const d = drag.current;
            drag.current = null;
            if (d?.kind === "new-section") mutate((bs) => bs.push(newSection()));
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/50 bg-white/60 py-4 text-xs font-semibold text-body hover:border-accent hover:text-accent"
        >
          <Plus className="h-4 w-4" /> {t("designer-add-section")}
        </button>
        </div>
        {resolvedFooterId && (
          <div className="overflow-hidden border-t border-dashed border-line/40">
            <iframe
              key={resolvedFooterId}
              src={api.chromePreviewUrl(tenantHost, resolvedFooterId, "footer", { embed: true })}
              className="w-full border-0"
              style={{ height: footerFrameHeight || 96, pointerEvents: "none" }}
              title="Footer preview"
            />
          </div>
        )}
        </div>
      </div>
    </main>
  );
}
