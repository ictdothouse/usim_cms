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
import {
  BarChart3,
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  Code2,
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
import type { Block, El, SlideButton, SlideText, EdgeRect, GapMark, Sel } from "./types";
import type { DesignerCtx } from "./context";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import { parseCards, parsePairs, parseRepeaterItems, parseSlides, stringifySlides } from "./parsers";
import { edgeGap, fitTextBox, fluidPreviewPx, nudgePosition } from "./geometry";
import {
  H_SIZE, ICON_SIZE, SIZE_PX, SLIDER_HEIGHT, SPACE, TEXT_SIZE,
  elRadius, headingFontFamily, hexToRgba, lengthValue, renderInline, shadowToCss, typoStyle,
} from "./style";
import { TEXT_BASE_PX } from "./fields";

// Only the one shape ElPreview's mutate() calls actually touch (props/bp on
// a row's column's element) — avoids importing SectionProps just for this.
type SectionPropsLike = { rows: { columns: { elements: { props: Record<string, string>; bp?: Record<string, string> }[] }[] }[] };
const section = (bs: Block[], b: number) => bs[b].props as unknown as SectionPropsLike;

const selEq = (sel: Sel, p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);

export function ElPreview({ ctx, el, path }: { ctx: DesignerCtx; el: El; path?: number[] }) {
  const {
    mode, t, mutate, bp, availableMenus, availableCategories,
    sliderSlideIdx, setSliderSlideIdx, sliderPreviewRefs, sliderGuide, setSliderGuide,
    sliderEditingItem, setSliderEditingItem, editingText, editingSliderText, bpGetValue, bpKey, sel,
  } = ctx;
  const p = el.props;
  // Blocks is a structure-only skeleton (icon + type + a short content
  // hint) — just enough to see layout/arrangement while dragging/
  // reordering. Live Edit is untouched below: same real rendering
  // (fonts/colors/images/slider drag, canvas text edit) it always had.
  if (mode === "blocks") {
    const Icon = ELS[el.type].icon;
    const hint = ((): string => {
      switch (el.type) {
        case "heading":
        case "text":
          return p.text ?? "";
        case "button":
          return p.label ?? "";
        case "image":
          return p.alt || p.src || "";
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
      // Inspector's minimap went away for them, replaced there by a plain
      // align icon-row — dragging on the canvas is still the only way to
      // set a custom x/y, and the Inspector never shows one for text,
      // unlike buttons' full renderPositionEditor.
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
        // already startMove): same stable-ref-snapshot pattern this file's
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
      // saved, a real mismatch against the published site. text-white
      // stays as the default because SectionBlock.astro's `.ds-slide` now
      // defaults to white too.
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
            // + max-w-[36rem] + p-6 for its 1.5rem padding.
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
    case "menu": {
      const linked = availableMenus.find((m) => m.id === el.props.menuId);
      return (
        <div className="flex items-center gap-3 rounded border border-dashed border-line/40 bg-canvas/40 px-3 py-2 text-xs text-sub">
          <Menu className="h-3.5 w-3.5" />
          {linked ? linked.name : t("designer-f-menu-none")}
        </div>
      );
    }
    case "cardgrid": {
      const cards = parseCards(p.cards);
      if (cards.length === 0) return <span className="text-xs opacity-40">{t("designer-f-cardgrid-items")}…</span>;
      return (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${p.columns ?? "3"}, 1fr)` }}>
          {cards.map((c, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-line/30 p-2 text-xs">
              {c.image && <img src={c.image} alt="" className="aspect-video w-full rounded object-cover" />}
              <div className="font-semibold">{c.title || `Card ${i + 1}`}</div>
              {c.description && <div className="text-sub">{c.description}</div>}
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
  }
}
