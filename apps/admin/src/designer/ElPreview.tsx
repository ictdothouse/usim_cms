// Canvas element preview: a structure-only skeleton in Blocks mode, or a
// visual approximation of SectionBlock.astro's real render (including
// canvas-direct text editing and the slider heading/subtitle/button
// drag/resize/smart-guide system). Split out of Designer.tsx as part of
// Layer 1b of the God Component refactor (see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
//
// Holds no hooks of its own (verified during extraction — every piece of
// state it reads/writes comes from `ctx`), so it's safe to call directly as
// a plain function, same as FieldGroups/FieldInput/Inspector already are.
//
// Rendered as real JSX + wrapped in React.memo (2026-09-24 render-perf pass,
// see docs/superpowers/specs/2026-09-24-designer-render-perf-design.md) —
// memo can't yet skip a re-render (ctx/props aren't memoized upstream until
// that doc's parts (b)/(c) land), this only removes the structural blocker.
import { Fragment, memo } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BarChart3,
  Bell,
  CopyPlus,
  Ellipsis,
  Link2,
  Lock,
  LockOpen,
  Move,
  RotateCw,
  Trash2,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Code2,
  Component,
  FileText,
  Image as ImageIcon,
  Images,
  MapPin,
  Menu,
  Newspaper,
  Quote,
  Radio,
  Share2,
  Star,
  Users,
  Video,
} from "lucide-react";
import type { El, Sel, SectionProps, SlideItem } from "./types";
import type { DesignerCtx } from "./context";
import { getNode } from "../designerTree";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import { bestTextColor } from "../lib/utils";
import {
  deleteSlideElement,
  duplicateSlideElement,
  parseCards,
  parsePairs,
  parseRepeaterItems,
  parseSlides,
  stringifySlides,
  updateSlideElementBp,
  updateSlideElementProps,
} from "./parsers";
import { centerXCandidates, centerYCandidates, edgeXCandidates, edgeYCandidates, snapValue, type FreeRectPx } from "./snap";
import {
  H_SIZE, ICON_SIZE, SLIDER_HEIGHT, SPACE, TEXT_SIZE,
  elBorderShadowStyle, elHoverClass, elMarginStyle, elPaddingStyle, elRadius, headingFontFamily, hexToRgba, lengthValue, renderInline, scaledFreeFont, shadowToCss, typoStyle,
} from "./style";
import { computeFreePositionStyle } from "@ucms/element-render";

const selEq = (sel: Sel, p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);

// Matches apps/frontend/src/components/ElementBlock.astro's own RATIO map —
// not shared (that file duplicates it too, per the Astro frontmatter rule),
// kept here so the canvas preview's embed aspect ratio stops being a
// hardcoded aspect-video and actually reflects the "ratio" field like the
// real render does.
const EMBED_RATIO: Record<string, string> = { "16:9": "16 / 9", "4:3": "4 / 3", "1:1": "1 / 1" };

// One-render-stale cache of each slide box's own rendered pixel size, keyed
// `${sliderElId}:${slideIdx}` — written by a plain ref callback on the
// `.ds-slide-box` div (below, no hook needed, same as this file's other
// imperative DOM reads) and read by the out-of-bounds check a few lines
// later in the SAME render pass, which runs before that callback fires for
// THIS pass. A slide box's size rarely changes except on window resize/bp
// switch, so the one-frame lag is never visible; an unset entry (first
// paint) just skips the far-edge check gracefully (see its own comment).
const slideBoxSizeCache = new Map<string, { width: number; height: number }>();

// See its one call site (top of ElPreview) for why this exists.
// Slide-nested free-position drag: percentage math against the FULL slide
// box (`.ds-slide-box`, the "slider" case's outer position:relative div) —
// NOT `.ds-slide-canvas` (the narrower 36rem text column nested inside it).
// A free child's own `position:absolute` (see the childIsFree style branch)
// makes its offsetLeft/offsetTop already resolve against `.ds-slide-box`
// (the nearest positioned ancestor, since `.ds-slide-canvas` deliberately
// lost `position:relative` — see that div's own comment), so `container`
// here must match or the % this computes won't match what CSS renders.
// Plain imperative pointer listeners, not a hook — ElPreview holds no
// hooks of its own (see file header) since it's called as a plain function,
// including recursively for nested slide elements.
// A free sibling's current box, in the % (x/y) + px (posWidth/posHeight)
// units it's actually stored in — the caller (the "slider" case's own
// `.map()`, which already has every sibling's resolved props at hand) reads
// these off the slide directly; startFreeElDrag/Resize convert to a live
// px FreeRectPx once they know the container's own rect.
interface FreeSiblingPct {
  xPct: number;
  yPct: number;
  widthPx: number;
  heightPx: number;
}

// Canva-style magenta guide line across the whole slide, shown while a drag
// is snapped to that axis (slide center or a sibling's center). Plain DOM
// appended into `.ds-slide-box` for the gesture's lifetime only — no React
// state, same imperative approach as the rest of this drag code.
function guideLine(container: HTMLElement, axis: "x" | "y") {
  const line = document.createElement("div");
  line.style.cssText = `position:absolute;pointer-events:none;z-index:60;background:#e100ff;display:none;${
    axis === "x" ? "top:0;bottom:0;width:1px;" : "left:0;right:0;height:1px;"
  }`;
  container.appendChild(line);
  return {
    show(px: number | null) {
      line.style.display = px === null ? "none" : "block";
      if (px !== null) line.style[axis === "x" ? "left" : "top"] = `${px}px`;
    },
    remove: () => line.remove(),
  };
}

// `target` is the free child's own wrapper — usually ev.currentTarget, but
// the floating Move button (below the element) passes the wrapper explicitly.
function startFreeElDrag(
  ev: React.PointerEvent,
  siblings: FreeSiblingPct[],
  apply: (xPct: number, yPct: number) => void,
  target = ev.currentTarget as HTMLElement,
) {
  if ((ev.currentTarget as HTMLElement).dataset.editing === "true") return;
  ev.stopPropagation();
  // The slider element's own outer wrapper (Designer.tsx's column-elements
  // map) is `draggable` for block reordering — that's native HTML5 drag,
  // a separate mechanism from these pointer events, and stopPropagation()
  // alone can't stop it. preventDefault() here blocks the native drag from
  // ever starting so it can't hijack this pointer-drag (the whole slide
  // dragging as one ghost image instead of just this one free-positioned
  // child moving).
  ev.preventDefault();
  const container = target.closest(".ds-slide-box") as HTMLElement | null;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  // offsetWidth/Height, not getBoundingClientRect: CSS `rotate` grows the
  // bounding box, but left/top (what we store) position the unrotated box.
  const halfW = target.offsetWidth / 2;
  const halfH = target.offsetHeight / 2;
  const gx = guideLine(container, "x");
  const gy = guideLine(container, "y");
  const startLeft = target.offsetLeft;
  const startTop = target.offsetTop;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const freeSiblings: FreeRectPx[] = siblings.map((s) => ({
    left: (s.xPct / 100) * rect.width,
    top: (s.yPct / 100) * rect.height,
    width: s.widthPx,
    height: s.heightPx,
  }));
  const cxCandidates = centerXCandidates(rect.width, freeSiblings);
  const cyCandidates = centerYCandidates(rect.height, freeSiblings);
  // No 0-100 clamp: an author may deliberately want a component to bleed
  // past the slide's own edge (e.g. a badge half-hanging off a photo) —
  // the Inspector's own X/Y inputs already allowed typing an out-of-range
  // number, this just gives drag the same freedom. The "safe area" overlay
  // (this file's slider case, near `.ds-slide-box`) is the actual visual
  // warning; the REAL guard against bleeding into the NEXT carousel slide
  // is that box's own `overflow:hidden` (and SliderBlock.astro's mirrored
  // `.ds-slider-viewport`) — a sibling slide is cropped against, never
  // painted into, regardless of how far past this slide's edge the
  // element sits. Alignment snap (above) pulls the element's own CENTER —
  // not its raw top-left — onto the slide's true center or another free
  // sibling's center when within a few px, the two alignments an author
  // reaches for by hand most often; it's a soft nudge (still just a
  // `snapValue` clamp), never a hard restrict.
  function move(e: PointerEvent) {
    const rawLeft = startLeft + (e.clientX - startX);
    const rawTop = startTop + (e.clientY - startY);
    const snappedCenterX = snapValue(rawLeft + halfW, cxCandidates);
    const snappedCenterY = snapValue(rawTop + halfH, cyCandidates);
    gx.show(snappedCenterX !== rawLeft + halfW ? snappedCenterX : null);
    gy.show(snappedCenterY !== rawTop + halfH ? snappedCenterY : null);
    const xPct = ((snappedCenterX - halfW) / rect.width) * 100;
    const yPct = ((snappedCenterY - halfH) / rect.height) * 100;
    apply(Math.round(xPct * 10) / 10, Math.round(yPct * 10) / 10);
  }
  function up() {
    gx.remove();
    gy.remove();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// Canva-style 8-handle resize for a free-positioned slide child. `dir` is
// which edge(s) the grabbed handle moves (-1 = left/top, 1 = right/bottom,
// 0 = that axis untouched) — the OPPOSITE edge stays anchored, so a left/top
// handle also shifts x/y. Corners scale proportionally (aspect locked) and
// report `sizeRatio` so the caller can scale a text child's font with the
// box ("drag the corner, the text grows with it"); side handles change one
// dimension only (ratio 1, font untouched — text just rewraps) and snap the
// moving edge to the safe-area margin / a sibling's edge. Starts from the
// wrapper's real rendered size (offsetWidth/Height — unrotated, matching
// what left/top/width/height store), not the stored posWidth/posHeight,
// which are often ""/"auto". ponytail: deltas are screen-space, not
// projected onto a rotated box's own axes — a rotated element resizes
// slightly "off-axis"; project through the angle if that ever bothers anyone.
type ResizeDir = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
interface FreeRectPct {
  xPct: number;
  yPct: number;
  widthPx: number;
  heightPx: number;
}
function startFreeElResize(
  ev: React.PointerEvent,
  dir: ResizeDir,
  siblings: FreeSiblingPct[],
  apply: (rect: FreeRectPct, sizeRatio: number) => void,
) {
  ev.stopPropagation();
  ev.preventDefault();
  const wrapper = (ev.currentTarget as HTMLElement).closest("[data-child-el]") as HTMLElement | null;
  const container = wrapper?.closest(".ds-slide-box") as HTMLElement | null;
  if (!wrapper || !container) return;
  const box = container.getBoundingClientRect();
  const startL = wrapper.offsetLeft;
  const startT = wrapper.offsetTop;
  const startW = wrapper.offsetWidth;
  const startH = wrapper.offsetHeight;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const corner = dir.x !== 0 && dir.y !== 0;
  const exCandidates = edgeXCandidates(
    box.width,
    siblings.map((s) => ({ left: (s.xPct / 100) * box.width, top: 0, width: s.widthPx, height: 0 })),
  );
  const eyCandidates = edgeYCandidates(
    box.height,
    siblings.map((s) => ({ left: 0, top: (s.yPct / 100) * box.height, width: 0, height: s.heightPx })),
  );
  const round1 = (n: number) => Math.round(n * 10) / 10;
  function move(e: PointerEvent) {
    let w = startW + (e.clientX - startX) * dir.x;
    let h = startH + (e.clientY - startY) * dir.y;
    let ratio = 1;
    if (corner) {
      ratio = Math.max(20 / startW, 20 / startH, (w / startW + h / startH) / 2);
      w = startW * ratio;
      h = startH * ratio;
    } else {
      if (dir.x === 1) w = snapValue(startL + w, exCandidates) - startL;
      if (dir.x === -1) w = startL + startW - snapValue(startL + startW - w, exCandidates);
      if (dir.y === 1) h = snapValue(startT + h, eyCandidates) - startT;
      if (dir.y === -1) h = startT + startH - snapValue(startT + startH - h, eyCandidates);
      w = Math.max(20, w);
      h = Math.max(20, h);
    }
    const left = dir.x === -1 ? startL + startW - w : startL;
    const top = dir.y === -1 ? startT + startH - h : startT;
    apply(
      { xPct: round1((left / box.width) * 100), yPct: round1((top / box.height) * 100), widthPx: Math.round(w), heightPx: Math.round(h) },
      ratio,
    );
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// Rotate handle: angle of the pointer around the element's center, relative
// to where the drag started, added to the stored rotation. Snaps to every
// 45° within 4° (Canva's "click" at 0/45/90…), integer degrees otherwise.
function startFreeElRotate(ev: React.PointerEvent, startDeg: number, apply: (deg: number) => void) {
  ev.stopPropagation();
  ev.preventDefault();
  const wrapper = (ev.currentTarget as HTMLElement).closest("[data-child-el]") as HTMLElement | null;
  if (!wrapper) return;
  const r = wrapper.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const a0 = Math.atan2(ev.clientY - cy, ev.clientX - cx);
  function move(e: PointerEvent) {
    let deg = startDeg + ((Math.atan2(e.clientY - cy, e.clientX - cx) - a0) * 180) / Math.PI;
    deg = ((((deg + 180) % 360) + 360) % 360) - 180;
    const snap = Math.round(deg / 45) * 45;
    apply(Math.abs(deg - snap) < 4 ? snap : Math.round(deg));
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// The 8 resize handles: corners as white dots, sides as short pills
// (Canva's look). Heading/text get no top/bottom pills — their height
// follows the text, so only width/corner-scale is meaningful.
const RESIZE_HANDLES: { dir: ResizeDir; cls: string; side?: "v" | "h" }[] = [
  { dir: { x: -1, y: -1 }, cls: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { dir: { x: 1, y: -1 }, cls: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { dir: { x: -1, y: 1 }, cls: "-left-1.5 -bottom-1.5 cursor-nesw-resize" },
  { dir: { x: 1, y: 1 }, cls: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
  { dir: { x: -1, y: 0 }, cls: "-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize", side: "v" },
  { dir: { x: 1, y: 0 }, cls: "-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize", side: "v" },
  { dir: { x: 0, y: -1 }, cls: "-top-1 left-1/2 -translate-x-1/2 cursor-ns-resize", side: "h" },
  { dir: { x: 0, y: 1 }, cls: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize", side: "h" },
];

function mergeElBp(
  type: El["type"],
  props: Record<string, string>,
  bpBag: Record<string, string> | undefined,
  bp: "desktop" | "tablet" | "mobile",
  bpGetValue: (base: string | undefined, overrides: Record<string, string> | undefined, key: string) => string,
): Record<string, string> {
  if (bp === "desktop" || !bpBag) return props;
  const keys = new Set(Object.keys(props));
  for (const k of Object.keys(bpBag)) keys.add(k.slice(k.indexOf(":") + 1));
  keys.delete("slides");
  // "image"-kind fields (logo/bgImage) are excluded from bp routing at the
  // Inspector level (see its own comment) — deleting any of their keys here
  // too means an element saved BEFORE that fix, still carrying a stray
  // empty "mobile:src"/"tablet:src" override from the old footgun, self-
  // heals on next render instead of permanently masking the real src.
  for (const f of ELS[type].fields) if (f.kind === "image") keys.delete(f.key);
  const merged: Record<string, string> = { ...props };
  for (const k of keys) merged[k] = bpGetValue(props[k], bpBag, k);
  return merged;
}

function ElPreviewImpl({ ctx, el, path }: { ctx: DesignerCtx; el: El; path?: number[] }) {
  const {
    mode, kind, t, mutate, bp, availableMenus, availableCategories, availableSymbols,
    sliderSlideIdx, setSliderSlideIdx, sliderInnerSel, setSliderInnerSel,
    sliderInnerEditing, setSliderInnerEditing,
    editingText, bpGetValue, sel,
  } = ctx;
  // Merge el.bp's active tier onto the base props so a per-breakpoint
  // override (any Content/Style field's BpToggle) actually shows live on
  // the canvas while previewing tablet/mobile — previously this read
  // el.props raw, so every such override wrote real data (and the
  // Inspector's toggle showed "active") but the canvas silently kept
  // rendering the desktop value. Same root cause the "slides" field hit
  // (see fieldGroupsProps's own comment in Inspector.tsx); "slides" is
  // excluded here for the same reason that fix bypasses it — it manages
  // its own per-item bp overrides internally, not via this bag.
  const p = mergeElBp(el.type, el.props, el.bp, bp, bpGetValue);
  // Blocks is a structure-only skeleton (icon + type + a short content
  // hint) — just enough to see layout/arrangement while dragging/
  // reordering. Live Edit is untouched below: same real rendering
  // (fonts/colors/images/slider drag, canvas text edit) it always had.
  // "image"/"menu" are exempted from the skeleton, but ONLY in the
  // Header/Footer Designer (kind === "siteChrome"), which has no Live Edit
  // toggle at all (Designer.tsx only renders it for kind !== "siteChrome")
  // — a logo/image or nav menu there could never otherwise be seen or
  // usefully drag-resized, only ever showing the generic hint chip with a
  // resize handle floating over a tiny box instead of the actual picture/
  // items (a header/footer nav bar's whole point is showing its real items,
  // including the mobile hamburger settings). A regular page DOES have a
  // Live Edit toggle to see the real picture, so its Blocks view should stay
  // a consistent structure-only skeleton for every element type, image
  // included — this used to exempt "image" unconditionally (any kind),
  // which leaked the real, potentially large picture straight into the
  // Blocks canvas layout on ordinary pages too.
  const skipSkeleton = (el.type === "image" || el.type === "menu") && kind === "siteChrome";
  if (mode === "blocks" && !skipSkeleton) {
    const Icon = ELS[el.type].icon;
    const hint = ((): string => {
      switch (el.type) {
        case "heading":
        case "text":
          return p.text ?? "";
        case "button":
        case "badge":
          return p.label ?? "";
        case "image":
          return p.alt || p.src || "";
        case "video":
          return p.src ?? "";
        case "icon":
          return p.name ?? "";
        case "embed":
          return p.url ?? "";
        case "list": {
          const n = (p.items ?? "").split("\n").filter(Boolean).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "accordion":
        case "tabs": {
          const n = parsePairs(p.items).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "gallery": {
          const n = (p.images ?? "").split("\n").filter(Boolean).length;
          return n ? `${n} image${n === 1 ? "" : "s"}` : "";
        }
        case "slider": {
          const n = parseSlides(p.slides).length;
          return n ? `${n} slide${n === 1 ? "" : "s"}` : "";
        }
        case "infobox":
          return p.heading ?? "";
        case "menu":
          return availableMenus.find((m) => m.id === p.menuId)?.name ?? "";
        case "testimonial": {
          const n = parseRepeaterItems(p.testimonials).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "statscounter": {
          const n = parseRepeaterItems(p.stats).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "peoplegrid": {
          const n = parseRepeaterItems(p.people).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "socialicons": {
          const n = parseRepeaterItems(p.socials).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "logocloud": {
          const n = parseRepeaterItems(p.logos).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "timeline": {
          const n = parseRepeaterItems(p.timelineItems).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "documentdownload": {
          const n = parseRepeaterItems(p.documents).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "googlemap":
          return p.address ?? "";
        case "announcementticker": {
          const n = parseRepeaterItems(p.tickerItems).length;
          return n ? `${n} item${n === 1 ? "" : "s"}` : "";
        }
        case "container": {
          const n = (el.children ?? []).length;
          return n ? `${n} element${n === 1 ? "" : "s"}` : "";
        }
        default:
          return "";
      }
    })();
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line/40 bg-canvas/40 px-3 py-2.5 text-xs">
        <Icon className="h-4 w-4 shrink-0 text-accent" />
        <span className="font-semibold text-ink">{t(ELS[el.type].labelKey)}</span>
        {hint && <span className="truncate text-sub">— {hint}</span>}
      </div>
    );
  }
  const align = { textAlign: (p.align as "left" | "center" | "right") ?? "left" };
  // Canvas-direct text editing (in addition to the Inspector sidebar): while
  // this exact element is selected, heading/text swap their formatted
  // preview for a plain contentEditable showing the raw text (same value
  // the Inspector textarea edits). editingText holds the value captured at
  // focus time so re-renders from typing don't feed new children back into
  // the DOM node (which would reset the caret) — only onBlur clears it.
  const editable = path && selEq(sel, path);
  if (editable && (el.type === "heading" || el.type === "text")) {
    if (editingText.current[el.id] === undefined) editingText.current[el.id] = p.text ?? "";
    const commit = (v: string) =>
      mutate((bs) => {
        (getNode(bs, path) as El).props.text = v;
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
          className={elHoverClass(p)}
          style={{
            ...align,
            // A free-positioned heading's own drag-resize handle (the slider
            // case below) writes posFontSize so the text visibly scales with
            // its box instead of floating small in a corner of it — same
            // free-position-override idea as posWidth/posHeight overriding
            // the normal box, since "level" is a fixed preset, not something
            // a drag ratio can scale in place.
            fontSize: p.position === "custom" && p.posFontSize ? p.posFontSize : H_SIZE[p.level ?? "2"],
            fontWeight: 700,
            lineHeight: 1.2,
            fontFamily: headingFontFamily(p.level),
            ...typoStyle(p),
            ...elBorderShadowStyle(p),
            // A canvas-only placeholder ("Heading", shown until the author
            // types real content) must stay legible regardless of ambient
            // inherited color — a slide's own box defaults to white text
            // (see SectionBlock.astro's .ds-slide), which made an empty
            // heading/text placeholder here invisible against a light/no-bg
            // slide (docs/SliderProblem.pdf #1). Only overrides when there's
            // no real content yet; a typed heading still uses typoStyle's
            // own color (or inherits, same as before) unchanged.
            ...(!p.text ? { color: "#9ca3af" } : {}),
          }}
          dangerouslySetInnerHTML={{ __html: p.text ? renderInline(p.text) : "Heading" }}
        />
      );
    case "text":
      return p.text ? (
        <div
          className={elHoverClass(p)}
          style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md), whiteSpace: "pre-wrap", lineHeight: 1.65, ...typoStyle(p), ...elBorderShadowStyle(p) }}
          dangerouslySetInnerHTML={{ __html: renderInline(p.text) }}
        />
      ) : (
        <div style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md), color: "#9ca3af" }}>
          {t("designer-f-text")}…
        </div>
      );
    case "image":
      return p.src ? (
        <div style={align}>
          <img
            src={p.src}
            alt={p.alt ?? ""}
            className={elHoverClass(p)}
            style={{
              borderRadius: elRadius(p),
              // A free-positioned slide image's own box (posWidth/posHeight,
              // set by the canvas corner-resize handle) sizes the WRAPPER div
              // — the <img> itself still needs to be told to fill it, or the
              // resize handle visibly does nothing to the actual picture.
              width: p.position === "custom" && p.posWidth ? "100%" : p.imgWidth || undefined,
              height: p.position === "custom" && p.posHeight ? "100%" : undefined,
              objectFit: p.position === "custom" && p.posHeight ? "cover" : undefined,
              maxWidth: "100%",
              ...elBorderShadowStyle(p),
            }}
          />
        </div>
      ) : (
        <div
          className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line/50 bg-canvas/50 text-sub"
          // Same free-position fill need as the real <img> above — h-24 is
          // just this placeholder's UNSIZED default, not a hardcoded final
          // size; a free-positioned box's posWidth/posHeight still has to
          // win once the author resizes it, image chosen or not.
          style={
            p.position === "custom"
              ? { width: p.posWidth ? "100%" : undefined, height: p.posHeight ? "100%" : undefined }
              : undefined
          }
        >
          <ImageIcon className="h-6 w-6" />
        </div>
      );
    case "video":
      return p.src ? (
        <video
          src={p.src}
          controls
          style={{
            borderRadius: elRadius(p),
            maxWidth: "100%",
            ...elBorderShadowStyle(p),
          }}
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line/50 bg-canvas/50 text-sub">
          <Video className="h-6 w-6" />
        </div>
      );
    case "button": {
      // Same free-position box-fill need as "image" above: a resized
      // wrapper (posWidth/posHeight) means nothing unless the actual pill
      // is told to fill it — otherwise the box grows but the button stays
      // its small intrinsic size, floating in a corner of an invisible box.
      const freeFill =
        p.position === "custom"
          ? {
              ...(p.posWidth ? { width: "100%" } : {}),
              ...(p.posHeight ? { height: "100%", display: "flex", alignItems: "center", justifyContent: "center" } : {}),
              // Mirrors the heading case's own posFontSize override — a
              // free-positioned button's drag-resize handle (the slider
              // case below) scales this alongside posWidth/posHeight so the
              // label actually grows with the pill instead of staying a
              // fixed text-sm while the pill balloons around it.
              ...(p.posFontSize ? { fontSize: p.posFontSize } : {}),
            }
          : {};
      // The <span> above fills 100% of THIS div, not of the outer
      // absolutely-positioned slide wrapper (a separate ancestor, see
      // ElPreview's "slider" case) — without this, the span's own
      // height:100% resolves against an auto-height parent (i.e. does
      // nothing), which is exactly the bug: box grows on resize, pill
      // stays put top-left with dead space around it.
      const wrapFill =
        p.position === "custom"
          ? { ...(p.posWidth ? { width: "100%" } : {}), ...(p.posHeight ? { height: "100%" } : {}) }
          : {};
      return (
        <div style={{ ...align, ...wrapFill }}>
          <span
            className={`inline-block rounded-full px-5 py-2 text-sm font-semibold ${elHoverClass(p) ?? ""}`}
            style={
              p.variant === "outline"
                ? { border: "2px solid currentColor", color: p.color || undefined, ...freeFill, ...elBorderShadowStyle(p) }
                : {
                    backgroundColor: "var(--color-primary, #0f62fe)",
                    color: p.color || "var(--color-primary-content, #fff)",
                    ...freeFill,
                    ...elBorderShadowStyle(p),
                  }
            }
          >
            {p.label || "Button"}
          </span>
        </div>
      );
    }
    case "badge": {
      const variantStyle: React.CSSProperties =
        p.variant === "outline"
          ? { border: "1.5px solid currentColor", color: p.color || undefined, background: "transparent" }
          : p.variant === "filled"
            ? { backgroundColor: "var(--color-primary, #0f62fe)", color: p.color || "var(--color-primary-content, #fff)" }
            : {
                backgroundColor: "color-mix(in srgb, var(--color-primary, #0f62fe) 15%, transparent)",
                color: p.color || "var(--color-primary, #0f62fe)",
              };
      const BADGE_SCALE = {
        sm: { cls: "px-2 py-0.5 text-[10px] gap-1", icon: 10 },
        md: { cls: "px-3 py-0.5 text-xs gap-1", icon: 12 },
        lg: { cls: "px-3.5 py-1 text-sm gap-1.5", icon: 14 },
      } as const;
      const scale = BADGE_SCALE[p.scale as keyof typeof BADGE_SCALE] ?? BADGE_SCALE.md;
      const BadgeIcon = p.name ? ICONS[p.name] : undefined;
      return (
        <div style={align}>
          <span className={`inline-flex items-center rounded-full font-semibold ${scale.cls}`} style={variantStyle}>
            {BadgeIcon && <BadgeIcon style={{ width: scale.icon, height: scale.icon }} />}
            {p.label || "Badge"}
          </span>
        </div>
      );
    }
    case "spacer":
      return (
        <div style={{ height: lengthValue(p.height, SPACE, SPACE.md) }} className="rounded border border-dashed border-line/30" />
      );
    case "divider":
      return <hr className="border-current opacity-20" />;
    case "embed":
      return (
        <div
          className="flex items-center justify-center bg-black/70 text-white"
          style={{ aspectRatio: EMBED_RATIO[p.ratio ?? "16:9"] ?? EMBED_RATIO["16:9"], borderRadius: elRadius(p), boxShadow: shadowToCss(p.shadow) }}
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
      const slide = slides[slideIdx];
      const innerSel = sliderInnerSel[el.id] ?? null;
      // Resolves the same way SectionBlock.astro's SLIDER_HEIGHT/lengthValue
      // does — a legacy keyword ("sm"/"md"/"lg"/"full") maps through the
      // table, anything else (a literal px/vh/rem/%/em an author typed via
      // the field's own "length" kind) passes through as-is. `p.height` is
      // already bp-resolved here (mergeElBp at the top of this function
      // merges every El.bp key, height included, while previewing tablet/
      // mobile) — SectionBlock.astro's real per-breakpoint height is the
      // separate, real-site-render half of that same feature.
      const resolvedHeight = p.height ? (SLIDER_HEIGHT[p.height] ?? p.height) : "";
      const overlayOpacityFrac = Math.min(100, Math.max(0, Number(slide.overlayOpacity) || 0)) / 100;
      const bgSize = slide.bgSize || "cover";
      // Default text color for nested content that hasn't set its own
      // Typography color override — was hardcoded white (fine for the
      // classic dark-photo-hero look), but that's invisible whenever the
      // slide's real backdrop is light (a light bgColor, or a light-tinted
      // overlay, or a plain light photo with no overlay at all). Picks the
      // readable side of whatever we can actually see: the flat bgColor if
      // set, else a strong-enough overlay tint; a bare light photo with no
      // overlay/bgColor still defaults white since there's no color to
      // check contrast against (unchanged from before for that case).
      const slideTextColor = slide.bgColor
        ? bestTextColor(slide.bgColor)
        : overlayOpacityFrac > 0.3
          ? bestTextColor(slide.overlayColor)
          // No image either — a blank slide shows through to the canvas's own
          // light background, so white text there is invisible until hovered/
          // selected. Only default white when there's an actual (presumed-dark)
          // photo backdrop with no bgColor/overlay override.
          : slide.imageUrl
            ? "#ffffff"
            : "#000000";
      return (
        <div
          // Identifies this slide's own canvas box for the Inspector's free-
          // position toggle, which measures the child's live rendered rect
          // against this box (getBoundingClientRect) to preserve its visual
          // spot when switching flow -> custom, instead of guessing a fixed
          // x/y — see Inspector.tsx's childIsFree toggle handler.
          data-slide-box={`${el.id}:${slideIdx}`}
          ref={(node) => {
            if (node) slideBoxSizeCache.set(`${el.id}:${slideIdx}`, { width: node.clientWidth, height: node.clientHeight });
          }}
          className={`ds-slide-box relative flex ${resolvedHeight ? "" : "aspect-[21/9]"} items-center justify-center overflow-hidden`}
          style={{
            height: resolvedHeight || undefined,
            borderRadius: elRadius(p),
            color: slideTextColor,
            backgroundColor: slide.bgColor || undefined,
            backgroundImage: slide.imageUrl ? `url(${slide.imageUrl})` : undefined,
            backgroundSize: bgSize === "repeat" || bgSize === "no-repeat" ? "auto" : bgSize,
            backgroundRepeat: bgSize === "repeat" ? "repeat" : "no-repeat",
            backgroundPosition: "center",
          }}
        >
          {overlayOpacityFrac > 0 && (
            <div className="pointer-events-none absolute inset-0" style={{ background: hexToRgba(slide.overlayColor, overlayOpacityFrac) }} />
          )}
          {/* The slide's own mini-canvas: nothing but a placeholder until
              the author adds Text/Button/Image/Row (FieldInput.tsx's slides
              editor) — each nested element renders through ElPreview's own
              per-type switch above (real typography/colors/sizing, no
              slide-specific duplicate rendering code). A selected heading/
              text child swaps to a contentEditable branch instead (below,
              mirrors the top-level `editable` block earlier in this file)
              once double-clicked into edit mode (`sliderInnerEditing`) — a
              separate step from selection because a free-positioned child
              also drags on plain pointerdown; only one of drag/type can
              own a given click. An element with props.position === "custom"
              opts out of the row/column flow and into drag-to-move
              (startFreeElDrag, below) — position is computed against THIS
              div (`.ds-slide-canvas`), which must stay the nearest
              `position:relative` ancestor so the on-canvas math matches the
              site's own `.ds-slide-content` containing block (see
              SectionBlock.astro's mirrored CSS). Clicking a nested element
              sets this slider's own `sliderInnerSel` so the Inspector shows
              that element's Content/Style fields instead of the slider's own. */}
          {(() => {
            const selectedChild = innerSel ? slide.rows[innerSel.r]?.columns[innerSel.c]?.elements[innerSel.e] : undefined;
            const selectedChildFree = !!selectedChild && bpGetValue(selectedChild.props.position, selectedChild.bp, "position") === "custom";
            const selX = selectedChild ? Number(bpGetValue(selectedChild.props.x, selectedChild.bp, "x") || "50") : 0;
            const selY = selectedChild ? Number(bpGetValue(selectedChild.props.y, selectedChild.bp, "y") || "50") : 0;
            // Far-edge check: converts posWidth/posHeight (px) to a % of
            // this box via slideBoxSizeCache (a live measurement, not
            // guessed) so "mostly in bounds but the far edge sticks out"
            // gets flagged too, not just the origin corner. Skips cleanly
            // (0% width/height) before the box's first paint or when
            // posWidth/posHeight is still unset — same as the origin-only
            // check already did in either case.
            const cachedBoxSize = slideBoxSizeCache.get(`${el.id}:${slideIdx}`);
            const selPosWidthPx = selectedChild ? parseFloat(bpGetValue(selectedChild.props.posWidth, selectedChild.bp, "posWidth")) : NaN;
            const selPosHeightPx = selectedChild ? parseFloat(bpGetValue(selectedChild.props.posHeight, selectedChild.bp, "posHeight")) : NaN;
            const selWidthPct = cachedBoxSize && cachedBoxSize.width > 0 && !Number.isNaN(selPosWidthPx) ? (selPosWidthPx / cachedBoxSize.width) * 100 : 0;
            const selHeightPct =
              cachedBoxSize && cachedBoxSize.height > 0 && !Number.isNaN(selPosHeightPx) ? (selPosHeightPx / cachedBoxSize.height) * 100 : 0;
            const selOutOfBounds =
              selectedChildFree &&
              (selX < 0 || selX > 100 || selY < 0 || selY > 100 || selX + selWidthPct > 100 || selY + selHeightPct > 100);
            return (
              <div
                // No `relative` here on purpose — a free-positioned child's
                // top/left % must resolve against the FULL slide (the outer
                // div a few lines up, already position:relative), not this
                // box's own narrow 36rem column, or "drag to 90%" would only
                // reach 90% across a skinny centered box instead of 90%
                // across the actual slide. Still a real flex item of that
                // outer div, so z-[1] alone keeps it painting above the
                // overlay (flex items honor z-index at position:static too)
                // — mirrors SectionBlock.astro's own `.ds-slide-content`.
                className={`ds-slide-canvas z-[1] w-full max-w-[36rem] space-y-2 p-6 ${
                  slide.textPosition === "left" ? "self-start" : slide.textPosition === "right" ? "self-end" : ""
                }`}
              >
                {selectedChildFree && (
                  // Inset by a real margin (not 0) now that this border
                  // draws against the full slide — a "safe area" that
                  // exactly hugged the slide's own edge was never actually
                  // safe (it was also, before this fix, only the narrow
                  // text column's edge, not the slide's).
                  <div
                    className={`pointer-events-none absolute inset-[6%] rounded border-2 border-dashed ${
                      selOutOfBounds ? "border-red-500" : "border-white/30"
                    }`}
                  />
                )}
                {selOutOfBounds && (
                  <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {t("designer-slide-out-of-bounds")}
                  </span>
                )}
                {slide.rows.length === 0 ? (
              slide.imageUrl ? null : (
                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-black/20 bg-black/10 px-4 py-6 text-center text-black/50">
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-xs">{t("designer-slide-empty")}</span>
                </div>
              )
            ) : (
              slide.rows.map((row, r) => (
                <div
                  key={r}
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: bp === "desktop" ? row.columns.map((c) => `${c.span ?? 1}fr`).join(" ") : "1fr",
                  }}
                >
                  {row.columns.map((col, c) => (
                    <div key={c} className="space-y-2">
                      {col.elements.map((childEl, e) => {
                      const selected = innerSel?.r === r && innerSel?.c === c && innerSel?.e === e;
                      const childIsFree = bpGetValue(childEl.props.position, childEl.bp, "position") === "custom";
                      const childTextType = childEl.type === "heading" || childEl.type === "text";
                      const childEditing = selected && childTextType && !!sliderInnerEditing[childEl.id];
                      if (childEditing && editingText.current[childEl.id] === undefined) {
                        editingText.current[childEl.id] = childEl.props.text ?? "";
                      }
                      const commitChildText = (v: string) => {
                        if (!path) return;
                        mutate((bs) => {
                          const target = (bs[path[0]].props as unknown as SectionProps).rows[path[1]].columns[path[2]].elements[path[3]];
                          const currentSlides = parseSlides(target.props.slides);
                          const s0 = currentSlides[slideIdx];
                          if (!s0) return;
                          currentSlides[slideIdx] = updateSlideElementProps(s0, r, c, e, { text: v });
                          target.props.slides = stringifySlides(currentSlides);
                        });
                      };
                      const childPosWidth = childIsFree ? bpGetValue(childEl.props.posWidth, childEl.bp, "posWidth") : undefined;
                      const childPosHeight = childIsFree ? bpGetValue(childEl.props.posHeight, childEl.bp, "posHeight") : undefined;
                      // Every OTHER free-positioned element on this same slide
                      // (any row/column) — the alignment-snap candidate set
                      // for this child's own drag/resize (see startFreeElDrag/
                      // Resize's own comments). Only computed when it'll
                      // actually be used.
                      const siblingsPct: FreeSiblingPct[] = childIsFree
                        ? slide.rows.flatMap((rr) =>
                            rr.columns.flatMap((cc) =>
                              cc.elements
                                .filter((ee) => ee.id !== childEl.id && bpGetValue(ee.props.position, ee.bp, "position") === "custom")
                                .map((ee) => ({
                                  xPct: Number(bpGetValue(ee.props.x, ee.bp, "x") || "50"),
                                  yPct: Number(bpGetValue(ee.props.y, ee.bp, "y") || "50"),
                                  widthPx: parseFloat(bpGetValue(ee.props.posWidth, ee.bp, "posWidth") || "") || 100,
                                  heightPx: parseFloat(bpGetValue(ee.props.posHeight, ee.bp, "posHeight") || "") || 40,
                                })),
                            ),
                          )
                        : [];
                      const childLocked = childEl.props.locked === "true";
                      // One write path for every canvas gesture/toolbar action
                      // on this child: re-parse the slider's slides JSON,
                      // transform this slide, write it back.
                      const writeSlide = (fn: (s0: SlideItem) => SlideItem) => {
                        if (!path) return;
                        mutate((bs) => {
                          const target = (bs[path[0]].props as unknown as SectionProps).rows[path[1]].columns[path[2]].elements[path[3]];
                          const currentSlides = parseSlides(target.props.slides);
                          const s0 = currentSlides[slideIdx];
                          if (!s0) return;
                          currentSlides[slideIdx] = fn(s0);
                          target.props.slides = stringifySlides(currentSlides);
                        });
                      };
                      // Free-position fields are per-breakpoint — on tablet/
                      // mobile a gesture writes that tier's override, same as
                      // the Inspector's own X/Y/Width/Height inputs.
                      const commitFree = (patch: Record<string, string>) =>
                        writeSlide((s0) =>
                          bp === "desktop"
                            ? updateSlideElementProps(s0, r, c, e, patch)
                            : updateSlideElementBp(s0, r, c, e, {
                                ...(childEl.bp ?? {}),
                                ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${bp}:${k}`, v])),
                              }),
                        );
                      const dragApply = (xPct: number, yPct: number) => commitFree({ x: String(xPct), y: String(yPct) });
                      return (
                        <Fragment key={childEl.id}>
                          {childIsFree && (
                            // A `position: absolute` element is removed from the flex
                            // column entirely — it contributes no height and no gap,
                            // so without this spacer every sibling below it shifts up
                            // the instant free-position turns on, even though the
                            // freed element itself lands back at the exact spot it
                            // measured from (Inspector.tsx's toggle handler). Same fix
                            // needed in SliderBlock.astro's posStyle() mirror.
                            <div aria-hidden style={{ height: childPosHeight || undefined, visibility: "hidden" }} />
                          )}
                        <div
                          data-child-el={childEl.id}
                          data-editing={childEditing ? "true" : undefined}
                          onClick={() => setSliderInnerSel((m) => ({ ...m, [el.id]: { r, c, e } }))}
                          onDoubleClick={
                            childTextType
                              ? () => setSliderInnerEditing((m) => ({ ...m, [childEl.id]: true }))
                              : undefined
                          }
                          onPointerDown={
                            childIsFree && path && !childEditing && !childLocked
                              ? (ev) => startFreeElDrag(ev, siblingsPct, dragApply)
                              : undefined
                          }
                          className={`cursor-pointer rounded ${
                            selected ? "outline outline-2 outline-accent" : "hover:outline hover:outline-1 hover:outline-white/40"
                          } ${childIsFree && !childLocked ? "cursor-move" : ""}`}
                          style={
                            childIsFree
                              ? (computeFreePositionStyle({
                                  rotate: bpGetValue(childEl.props.rotate, childEl.bp, "rotate"),
                                  x: bpGetValue(childEl.props.x, childEl.bp, "x"),
                                  y: bpGetValue(childEl.props.y, childEl.bp, "y"),
                                  posWidth: childPosWidth || undefined,
                                  posHeight: childPosHeight || undefined,
                                  zIndex: bpGetValue(childEl.props.zIndex, childEl.bp, "zIndex"),
                                }) as React.CSSProperties)
                              : {
                                  ...elMarginStyle(childEl.props ?? {}),
                                  ...elPaddingStyle(childEl.props ?? {}),
                                  // Was previously shrunk to `width:
                                  // "fit-content"` (plus a raw, non-bp-aware
                                  // childEl.props.align read for margin
                                  // centering) so the selection outline
                                  // wouldn't look wider than the visible
                                  // pill — but that made this wrapper's own
                                  // box model diverge from the real site's
                                  // (SectionBlock.astro's button case is a
                                  // plain full-width div with `text-align`,
                                  // no width override at all), which is
                                  // exactly what caused Live Edit and
                                  // Published to size/wrap the button
                                  // differently (see docs/SliderProblem.pdf
                                  // #2). Matching the site's own approach —
                                  // full-width wrapper, alignment via
                                  // text-align — fixes that mismatch AND
                                  // makes a per-breakpoint align override
                                  // actually apply here (bpGetValue, same as
                                  // every other slide-child prop read in
                                  // this function), at the minor cosmetic
                                  // cost of a same-width-as-text-elements
                                  // selection outline for a short button
                                  // label.
                                  ...(childEl.type === "button"
                                    ? { textAlign: (bpGetValue(childEl.props.align, childEl.bp, "align") as "left" | "center" | "right" | undefined) || undefined }
                                    : {}),
                                }
                          }
                        >
                          {childEditing ? (
                            <div
                              contentEditable
                              suppressContentEditableWarning
                              ref={(node) => {
                                if (node && document.activeElement !== node) node.focus();
                              }}
                              style={
                                childEl.type === "heading"
                                  ? {
                                      fontSize:
                                        childIsFree && childEl.props.posFontSize ? childEl.props.posFontSize : H_SIZE[childEl.props.level ?? "2"],
                                      fontWeight: 700,
                                      lineHeight: 1.2,
                                    }
                                  : { fontSize: lengthValue(childEl.props.size, TEXT_SIZE, TEXT_SIZE.md), whiteSpace: "pre-wrap", lineHeight: 1.65 }
                              }
                              className="outline-none"
                              onInput={(ev) => commitChildText(ev.currentTarget.textContent ?? "")}
                              onBlur={() => {
                                delete editingText.current[childEl.id];
                                setSliderInnerEditing((m) => {
                                  const next = { ...m };
                                  delete next[childEl.id];
                                  return next;
                                });
                              }}
                            >
                              {editingText.current[childEl.id]}
                            </div>
                          ) : (
                            <ElPreview ctx={ctx} el={childEl} />
                          )}
                          {selected && childIsFree && path && !childLocked && (
                            <>
                              {RESIZE_HANDLES.filter((h) => h.side !== "h" || !childTextType).map((h) => (
                                <div
                                  key={`${h.dir.x}:${h.dir.y}`}
                                  onPointerDown={(ev) =>
                                    startFreeElResize(ev, h.dir, siblingsPct, (box, sizeRatio) => {
                                      const patch: Record<string, string> = {
                                        x: String(box.xPct),
                                        y: String(box.yPct),
                                        posWidth: `${box.widthPx}px`,
                                        posHeight: `${box.heightPx}px`,
                                      };
                                      // Corner = Canva-style "text grows with the
                                      // box" (scaledFreeFont, shared with Live
                                      // Edit). Side handles pass ratio 1 — the
                                      // text rewraps, the font stays.
                                      if (sizeRatio !== 1 && (childTextType || childEl.type === "button")) {
                                        Object.assign(
                                          patch,
                                          scaledFreeFont(childEl.type, (k) => bpGetValue(childEl.props[k], childEl.bp, k), sizeRatio),
                                        );
                                      }
                                      commitFree(patch);
                                    })
                                  }
                                  className={`absolute z-[61] border border-accent bg-white shadow-sm ${h.cls} ${
                                    h.side === "v" ? "h-4 w-2 rounded-full" : h.side === "h" ? "h-2 w-4 rounded-full" : "h-3 w-3 rounded-full"
                                  }`}
                                />
                              ))}
                              {/* Rotate + Move under the box (Canva's pair) —
                                  Move still drags while a heading/text is in
                                  double-click edit mode, where the box's own
                                  pointerdown belongs to the text caret. */}
                              <div className="absolute left-1/2 top-[calc(100%+10px)] z-[61] flex -translate-x-1/2 gap-1.5">
                                <button
                                  type="button"
                                  title={t("designer-rotate")}
                                  onPointerDown={(ev) =>
                                    startFreeElRotate(ev, Number(bpGetValue(childEl.props.rotate, childEl.bp, "rotate") || "0"), (deg) =>
                                      commitFree({ rotate: String(deg) }),
                                    )
                                  }
                                  className="flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-line/40 bg-white text-body shadow"
                                >
                                  <RotateCw className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title={t("designer-move")}
                                  onPointerDown={(ev) =>
                                    startFreeElDrag(ev, siblingsPct, dragApply, ev.currentTarget.closest("[data-child-el]") as HTMLElement)
                                  }
                                  className="flex h-6 w-6 cursor-move items-center justify-center rounded-full bg-accent text-white shadow"
                                >
                                  <Move className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                          {selected && childIsFree && path && (() => {
                            // Floating toolbar — a SIBLING of the box, not a
                            // child, so a rotated element doesn't rotate its
                            // toolbar too. Positioned off the same stored x/y
                            // (+ half posWidth to center it); flips below the
                            // box near the slide's top edge, where the slide's
                            // own overflow:hidden would otherwise crop it.
                            const tx = Number(bpGetValue(childEl.props.x, childEl.bp, "x") || "50");
                            const ty = Number(bpGetValue(childEl.props.y, childEl.bp, "y") || "50");
                            const wPx = parseFloat(childPosWidth || "") || 0;
                            const hPx = parseFloat(childPosHeight || "") || 40;
                            const below = ty < 18;
                            const btn = "flex h-7 w-7 items-center justify-center rounded-full hover:bg-canvas";
                            const menu = "absolute top-full z-10 mt-2 rounded-lg border border-line/30 bg-white p-1.5 text-[11px] text-body shadow-lg";
                            const alignToSlide = (ev: React.MouseEvent<HTMLElement>, k: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
                              const boxEl = ev.currentTarget.closest(".ds-slide-box") as HTMLElement | null;
                              const node = boxEl?.querySelector<HTMLElement>(`[data-child-el="${childEl.id}"]`);
                              if (!boxEl || !node) return;
                              const wPct = (node.offsetWidth / boxEl.clientWidth) * 100;
                              const hPct = (node.offsetHeight / boxEl.clientHeight) * 100;
                              const r1 = (n: number) => String(Math.round(n * 10) / 10);
                              commitFree(
                                k === "left" ? { x: "0" }
                                : k === "center" ? { x: r1((100 - wPct) / 2) }
                                : k === "right" ? { x: r1(100 - wPct) }
                                : k === "top" ? { y: "0" }
                                : k === "middle" ? { y: r1((100 - hPct) / 2) }
                                : { y: r1(100 - hPct) },
                              );
                              ev.currentTarget.closest("details")?.removeAttribute("open");
                            };
                            const ALIGN = [
                              ["left", AlignStartVertical, "designer-align-left"],
                              ["center", AlignCenterVertical, "designer-align-center"],
                              ["right", AlignEndVertical, "designer-align-right"],
                              ["top", AlignStartHorizontal, "designer-align-top"],
                              ["middle", AlignCenterHorizontal, "designer-align-middle"],
                              ["bottom", AlignEndHorizontal, "designer-align-bottom"],
                            ] as const;
                            return (
                              <div
                                onPointerDown={(ev) => ev.stopPropagation()}
                                onClick={(ev) => ev.stopPropagation()}
                                className="absolute z-[62] flex items-center gap-0.5 whitespace-nowrap rounded-full border border-line/30 bg-white px-1 py-0.5 text-body shadow-lg"
                                style={{
                                  left: wPx ? `calc(${tx}% + ${wPx / 2}px)` : `${tx}%`,
                                  top: below ? `calc(${ty}% + ${hPx + 44}px)` : `${ty}%`,
                                  transform: `translate(${wPx ? "-50%" : "0"}, ${below ? "0" : "calc(-100% - 12px)"})`,
                                }}
                              >
                                {childEl.type === "button" && (
                                  <details className="relative">
                                    <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-full px-2 text-[11px] font-semibold hover:bg-canvas">
                                      <Link2 className="h-3.5 w-3.5" /> {t("designer-edit-link")}
                                    </summary>
                                    <div className={`${menu} left-0 w-60`}>
                                      <input
                                        defaultValue={childEl.props.href ?? ""}
                                        placeholder="https://"
                                        onKeyDown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()}
                                        onBlur={(ev) => {
                                          const href = ev.currentTarget.value.trim();
                                          writeSlide((s0) => updateSlideElementProps(s0, r, c, e, { href }));
                                        }}
                                        className="w-full rounded-md border border-line/30 px-2 py-1 text-[11px]"
                                      />
                                    </div>
                                  </details>
                                )}
                                <button
                                  type="button"
                                  title={t(childLocked ? "designer-unlock" : "designer-lock")}
                                  onClick={() => writeSlide((s0) => updateSlideElementProps(s0, r, c, e, { locked: childLocked ? "" : "true" }))}
                                  className={`${btn} ${childLocked ? "text-accent" : ""}`}
                                >
                                  {childLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  title={t("designer-duplicate")}
                                  onClick={() => {
                                    writeSlide((s0) => duplicateSlideElement(s0, r, c, e));
                                    setSliderInnerSel((m) => ({ ...m, [el.id]: { r, c, e: e + 1 } }));
                                  }}
                                  className={btn}
                                >
                                  <CopyPlus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title={t("designer-delete")}
                                  onClick={() => {
                                    writeSlide((s0) => deleteSlideElement(s0, r, c, e));
                                    setSliderInnerSel((m) => ({ ...m, [el.id]: null }));
                                  }}
                                  className={btn}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                <details className="relative">
                                  <summary title={t("designer-align-to-slide")} className={`${btn} cursor-pointer list-none`}>
                                    <Ellipsis className="h-3.5 w-3.5" />
                                  </summary>
                                  <div className={`${menu} right-0 w-44`}>
                                    <p className="px-1.5 pb-1 font-semibold text-sub">{t("designer-align-to-slide")}</p>
                                    {ALIGN.map(([k, Icon, label], i) => (
                                      <button
                                        key={k}
                                        type="button"
                                        disabled={childLocked}
                                        onClick={(ev) => alignToSlide(ev, k)}
                                        className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-canvas disabled:opacity-40 ${
                                          i === 3 ? "mt-1 border-t border-line/20 pt-1.5" : ""
                                        }`}
                                      >
                                        <Icon className="h-3.5 w-3.5" /> {t(label)}
                                      </button>
                                    ))}
                                  </div>
                                </details>
                              </div>
                            );
                          })()}
                        </Fragment>
                      );
                    })}
                    </div>
                  ))}
                </div>
              ))
            )}
              </div>
            );
          })()}
          {/* Real controls, not decoration — see sliderSlideIdx. The counter
              next to them exists because dots alone never made it obvious
              that the canvas shows ONE slide out of several. pointerDown is
              stopped so a dot click can't start an element drag; the click
              itself still bubbles, so clicking a dot on an unselected
              slider selects it like any other click. */}
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
    case "menu": {
      const linked = availableMenus.find((m) => m.id === el.props.menuId);
      if (!linked || linked.items.length === 0) {
        return (
          <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
            <Menu className="h-3.5 w-3.5" />
            {linked ? linked.name : t("designer-f-menu-none")}
          </div>
        );
      }
      if (bp === "mobile") {
        // The real site collapses ANY .ds-menu to a hamburger-only trigger
        // below 768px (global.css) regardless of where it's placed — mirror
        // that here so previewing the mobile breakpoint doesn't still show
        // the full desktop item list, which read as identical to desktop/
        // tablet and hid the real published behavior from the author.
        return (
          <div className="flex items-center justify-end rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2">
            <Menu className="h-4 w-4 text-body" />
          </div>
        );
      }
      return (
        <nav className={`flex items-center gap-4 text-xs ${p.layout === "vertical" ? "flex-col items-start gap-1.5" : ""}`}>
          {linked.items.map((item) => (
            <span key={item.id} className="whitespace-nowrap text-body">
              {item.label}
              {item.children && item.children.length > 0 && <ChevronsUpDown className="ml-0.5 inline h-2.5 w-2.5 text-sub" />}
            </span>
          ))}
        </nav>
      );
    }
    case "symbol": {
      const linked = availableSymbols.find((s) => s.id === el.props.symbolId);
      if (!linked) {
        return (
          <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
            <Component className="h-3.5 w-3.5" />
            {t("designer-symbols-missing")}
          </div>
        );
      }
      // Resolved read-only, no path — same "not this canvas's job" boundary
      // the "menu" case above already draws for its own linked.items:
      // editing the resolved subtree happens via "Edit Master" (Designer.tsx),
      // never by selecting into it here (path: undefined disables click-to-
      // select on any of its own nested children too, see "container" case).
      return <ElPreview ctx={ctx} el={linked.node as unknown as El} path={undefined} />;
    }
    case "cardgrid": {
      const cards = parseCards(p.cards);
      if (cards.length === 0) return <span className="text-xs opacity-40">{t("designer-f-cardgrid-items")}…</span>;
      const equal = p.equalHeight !== "false";
      return (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${p.columns ?? "3"}, 1fr)` }}>
          {cards.map((c, i) => (
            <div key={i} className={`space-y-1.5 rounded-lg border border-line/30 p-2 text-xs${equal ? " flex h-full flex-col" : ""}`}>
              {c.image && <img src={c.image} alt="" className="aspect-video w-full rounded object-cover" />}
              <div className="font-semibold">{c.title || `Card ${i + 1}`}</div>
              {c.description && <div className="text-sub">{c.description}</div>}
              {c.buttonLabel && c.href && (
                <div className={equal ? "mt-auto pt-1" : "pt-1"}>
                  <span className="inline-block rounded bg-primary/90 px-2 py-1 text-[10px] font-medium text-primary-content">
                    {c.buttonLabel}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
    case "ctabanner": {
      return (
        <div
          className="space-y-2 rounded-lg p-4"
          style={{
            textAlign: (p.align as "left" | "center" | "right") || "center",
            background: p.bgColor || undefined,
            backgroundImage: p.bgImage ? `url(${p.bgImage})` : undefined,
            backgroundSize: "cover",
          }}
        >
          <div className="font-semibold">{p.heading || t("designer-f-ctabanner-heading")}</div>
          {p.description && <div className="text-xs text-sub">{p.description}</div>}
          <div className="flex justify-center gap-2">
            {p.button1Label && <span className="rounded-full bg-accent px-3 py-1 text-xs text-white">{p.button1Label}</span>}
            {p.button2Label && <span className="rounded-full border border-line/40 px-3 py-1 text-xs">{p.button2Label}</span>}
          </div>
        </div>
      );
    }
    case "announcementbar": {
      return (
        <div
          className="flex items-center justify-center gap-2 rounded px-3 py-2 text-xs"
          style={{ background: p.bgColor || "#111827", color: p.textColor || "#ffffff" }}
        >
          <Bell className="h-3.5 w-3.5 shrink-0" />
          <span>{p.text || t("designer-el-announcementbar")}</span>
          {p.linkLabel && <span className="underline">{p.linkLabel}</span>}
        </div>
      );
    }
    case "postlist": {
      const linked = availableCategories.find((c) => c.id === p.categoryId);
      return (
        <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
          <Newspaper className="h-3.5 w-3.5" />
          {linked ? linked.name : t("designer-f-category-none")} · {p.count ?? "3"}
        </div>
      );
    }
    case "eventlist": {
      return (
        <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
          <CalendarDays className="h-3.5 w-3.5" />
          {t("designer-el-eventlist")} · {p.count ?? "3"}
        </div>
      );
    }
    case "testimonial": {
      const items = parseRepeaterItems(p.testimonials);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-testimonial-items")}…</span>;
      return (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${p.columns ?? "2"}, 1fr)` }}>
          {items.map((it, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line/30 p-3 text-xs">
              <Quote className="h-4 w-4 text-accent/60" />
              {it.quote && <p className="text-sub">{it.quote}</p>}
              <div className="flex items-center gap-2">
                {it.avatar && <img src={it.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />}
                <div>
                  <div className="font-semibold">{it.name || "Name"}</div>
                  {it.role && <div className="text-[10px] text-sub">{it.role}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "statscounter": {
      const items = parseRepeaterItems(p.stats);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-statscounter-items")}…</span>;
      return (
        <div className="grid gap-3 text-center" style={{ gridTemplateColumns: `repeat(${p.columns ?? "3"}, 1fr)` }}>
          {items.map((it, i) => {
            const Icon = ICONS[it.icon ?? ""] ?? BarChart3;
            return (
              <div key={i} className="space-y-1">
                <Icon className="mx-auto h-5 w-5 text-accent" />
                <div className="text-lg font-bold">{it.number || "0"}</div>
                <div className="text-[10px] text-sub">{it.label}</div>
              </div>
            );
          })}
        </div>
      );
    }
    case "peoplegrid": {
      const items = parseRepeaterItems(p.people);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-peoplegrid-items")}…</span>;
      return (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${p.columns ?? "3"}, 1fr)` }}>
          {items.map((it, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-line/30 p-2 text-center text-xs">
              {it.photo ? (
                <img src={it.photo} alt="" className="mx-auto h-14 w-14 rounded-full object-cover" />
              ) : (
                <Users className="mx-auto h-14 w-14 rounded-full bg-canvas/50 p-3 text-sub" />
              )}
              <div className="font-semibold">{it.name || "Name"}</div>
              {it.role && <div className="text-sub">{it.role}</div>}
            </div>
          ))}
        </div>
      );
    }
    case "socialicons": {
      const items = parseRepeaterItems(p.socials);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-socialicons-items")}…</span>;
      return (
        <div className="flex gap-2" style={{ justifyContent: p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start" }}>
          {items.map((it, i) => {
            const Icon = ICONS[it.platform ?? ""] ?? Share2;
            return (
              <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border border-line/30">
                <Icon className="h-4 w-4" />
              </div>
            );
          })}
        </div>
      );
    }
    case "logocloud": {
      const items = parseRepeaterItems(p.logos);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-logocloud-items")}…</span>;
      return (
        <div className="grid items-center gap-3" style={{ gridTemplateColumns: `repeat(${p.columns ?? "4"}, 1fr)` }}>
          {items.map((it, i) =>
            it.image ? (
              <img key={i} src={it.image} alt={it.alt ?? ""} className="h-10 w-full object-contain grayscale" />
            ) : (
              <div key={i} className="flex h-10 items-center justify-center rounded border border-dashed border-line/40">
                <Building2 className="h-4 w-4 text-sub" />
              </div>
            ),
          )}
        </div>
      );
    }
    case "timeline": {
      const items = parseRepeaterItems(p.timelineItems);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-timeline-items")}…</span>;
      return (
        <div className="space-y-3 border-l-2 border-line/30 pl-3 text-xs">
          {items.map((it, i) => (
            <div key={i}>
              <div className="text-[10px] font-semibold text-accent">{it.date}</div>
              <div className="font-semibold">{it.title}</div>
              {it.description && <div className="text-sub">{it.description}</div>}
            </div>
          ))}
        </div>
      );
    }
    case "documentdownload": {
      const items = parseRepeaterItems(p.documents);
      if (items.length === 0) return <span className="text-xs opacity-40">{t("designer-f-docdownload-items")}…</span>;
      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${p.columns ?? "2"}, 1fr)` }}>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-line/30 p-2 text-xs">
              <FileText className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{it.label || "Document"}</div>
                <div className="text-[10px] text-sub">{[it.fileType, it.fileSize].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "googlemap":
      return (
        <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line/40 bg-canvas/40 text-xs text-sub">
          <MapPin className="h-5 w-5" />
          <span>{p.address || t("designer-f-googlemap-address")}</span>
        </div>
      );
    case "announcementticker": {
      const items = parseRepeaterItems(p.tickerItems);
      return (
        <div
          className="flex items-center gap-2 overflow-hidden whitespace-nowrap rounded px-3 py-2 text-xs"
          style={{ background: p.bgColor || "#111827", color: p.textColor || "#ffffff" }}
        >
          <Radio className="h-3.5 w-3.5 shrink-0" />
          <span>{items.map((it) => it.text).join(" • ") || t("designer-el-announcementticker")}</span>
        </div>
      );
    }
    case "container": {
      const children = el.children ?? [];
      return (
        <div
          style={{
            display: "flex",
            flexDirection: (p.flexDirection as React.CSSProperties["flexDirection"]) || "row",
            justifyContent: p.justifyContent || "flex-start",
            alignItems: p.alignItems || "stretch",
            flexWrap: (p.flexWrap as React.CSSProperties["flexWrap"]) || "wrap",
            gap: p.gap || "1rem",
            background: p.bg || undefined,
            borderRadius: elRadius(p),
            minHeight: children.length ? undefined : "3rem",
            ...elBorderShadowStyle(p),
          }}
        >
          {children.length === 0 && (
            <p className="w-full py-2 text-center text-[11px] italic text-sub/60">{t("designer-container-empty")}</p>
          )}
          {children.map((child, i) => {
            const childPath = path ? [...path, i] : undefined;
            const childSelected = mode !== "live" && !!childPath && selEq(sel, childPath);
            const childP = mergeElBp(child.type, child.props, child.bp, bp, bpGetValue);
            return (
              <div
                key={child.id}
                onClick={(ev) => {
                  if (!childPath) return;
                  ev.stopPropagation();
                  ctx.setSel(childPath);
                }}
                className={`relative min-w-0 ${
                  mode !== "live" ? `cursor-pointer rounded ${childSelected ? "outline outline-2 outline-accent outline-offset-2" : ""}` : ""
                }`}
                style={{ ...elMarginStyle(childP), ...elPaddingStyle(childP) }}
              >
                <ElPreview ctx={ctx} el={child} path={childPath} />
              </div>
            );
          })}
        </div>
      );
    }
  }
}

// Render-perf design doc step (d): the default shallow-per-prop compare
// can't bail here because Designer.tsx hands every instance the SAME
// designerCtx object (which bundles blocks/sel — both churn on nearly every
// edit) and `path` is a freshly-allocated array literal on every render
// regardless of whether it actually changed. This comparator only checks
// the ctx fields ElPreviewImpl actually reads (never blocks/the other ~70
// fields), compares `path` by value, and treats selection as a DERIVED
// per-instance check (selEq(sel, path) flipping) rather than comparing
// `sel`'s own identity, which changes on every click regardless of which
// element that click affects. If ElPreviewImpl's own top destructure ever
// grows a new ctx field, this must gain a matching line too.
function arePropsEqual(
  prev: { ctx: DesignerCtx; el: El; path?: number[] },
  next: { ctx: DesignerCtx; el: El; path?: number[] },
): boolean {
  if (prev.el !== next.el) return false;
  const p1 = prev.path, p2 = next.path;
  if (p1 !== p2) {
    if (!p1 || !p2 || p1.length !== p2.length || !p1.every((v, i) => v === p2[i])) return false;
  }
  const a = prev.ctx, b = next.ctx;
  if (
    a.mode !== b.mode || a.kind !== b.kind || a.t !== b.t || a.bp !== b.bp ||
    a.mutate !== b.mutate || a.setSel !== b.setSel || a.bpGetValue !== b.bpGetValue ||
    a.availableMenus !== b.availableMenus || a.availableCategories !== b.availableCategories ||
    a.availableSymbols !== b.availableSymbols || a.editingText !== b.editingText
  ) return false;
  if (p2 && selEq(a.sel, p2) !== selEq(b.sel, p2)) return false;
  const id = next.el.id;
  if (
    a.sliderSlideIdx[id] !== b.sliderSlideIdx[id] ||
    a.sliderInnerSel[id] !== b.sliderInnerSel[id] ||
    a.sliderInnerEditing[id] !== b.sliderInnerEditing[id]
  ) return false;
  return true;
}

export const ElPreview = memo(ElPreviewImpl, arePropsEqual);
ElPreview.displayName = "ElPreview";
