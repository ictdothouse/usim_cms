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
  CalendarDays,
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
import type { Block, El, Sel, SectionProps } from "./types";
import type { DesignerCtx } from "./context";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import { parseCards, parsePairs, parseRepeaterItems, parseSlides, stringifySlides, updateSlideElementBp, updateSlideElementProps } from "./parsers";
import {
  H_SIZE, ICON_SIZE, SLIDER_HEIGHT, SPACE, TEXT_SIZE,
  elBorderShadowStyle, elMarginStyle, elPaddingStyle, elRadius, headingFontFamily, hexToRgba, lengthValue, renderInline, shadowToCss, typoStyle,
} from "./style";

// Only the one shape ElPreview's mutate() calls actually touch (props/bp on
// a row's column's element) — avoids importing SectionProps just for this.
type SectionPropsLike = { rows: { columns: { elements: { props: Record<string, string>; bp?: Record<string, string> }[] }[] }[] };
const section = (bs: Block[], b: number) => bs[b].props as unknown as SectionPropsLike;

const selEq = (sel: Sel, p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);

// See its one call site (top of ElPreview) for why this exists.
// Slide-nested free-position drag: percentage math against the slide's own
// canvas box (`.ds-slide-canvas`, the "slider" case's outer position:relative
// div). Plain imperative pointer listeners, not a hook — ElPreview holds no
// hooks of its own (see file header) since it's called as a plain function,
// including recursively for nested slide elements.
function startFreeElDrag(ev: React.PointerEvent, apply: (xPct: number, yPct: number) => void) {
  ev.stopPropagation();
  const container = (ev.currentTarget as HTMLElement).closest(".ds-slide-canvas") as HTMLElement | null;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const target = ev.currentTarget as HTMLElement;
  const startLeft = target.offsetLeft;
  const startTop = target.offsetTop;
  const startX = ev.clientX;
  const startY = ev.clientY;
  function move(e: PointerEvent) {
    const xPct = Math.min(100, Math.max(0, ((startLeft + (e.clientX - startX)) / rect.width) * 100));
    const yPct = Math.min(100, Math.max(0, ((startTop + (e.clientY - startY)) / rect.height) * 100));
    apply(Math.round(xPct * 10) / 10, Math.round(yPct * 10) / 10);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

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

export function ElPreview({ ctx, el, path }: { ctx: DesignerCtx; el: El; path?: number[] }) {
  const {
    mode, t, mutate, bp, availableMenus, availableCategories,
    sliderSlideIdx, setSliderSlideIdx, sliderInnerSel, setSliderInnerSel,
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
  // "image" is exempted from the skeleton: the Header/Footer Designer
  // (kind === "siteChrome") has no Live Edit toggle at all (Designer.tsx
  // only renders it for kind !== "siteChrome"), so a logo/image element
  // there could never be seen or usefully drag-resized — it only ever
  // showed the generic hint chip below, with the resize handle (Designer.tsx,
  // gated on mode !== "live") floating over that tiny box instead of the
  // actual picture.
  const isImage = el.type === "image";
  if (mode === "blocks" && !isImage) {
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
            ...elBorderShadowStyle(p),
          }}
          dangerouslySetInnerHTML={{ __html: p.text ? renderInline(p.text) : "Heading" }}
        />
      );
    case "text":
      return p.text ? (
        <div
          style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md), whiteSpace: "pre-wrap", lineHeight: 1.65, ...typoStyle(p), ...elBorderShadowStyle(p) }}
          dangerouslySetInnerHTML={{ __html: renderInline(p.text) }}
        />
      ) : (
        <div style={{ ...align, fontSize: lengthValue(p.size, TEXT_SIZE, TEXT_SIZE.md) }} className="opacity-40">
          {t("designer-f-text")}…
        </div>
      );
    case "image":
      return p.src ? (
        <div style={align}>
          <img
            src={p.src}
            alt={p.alt ?? ""}
            style={{ borderRadius: elRadius(p), width: p.imgWidth || undefined, maxWidth: "100%", ...elBorderShadowStyle(p) }}
          />
        </div>
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
                ? { border: "2px solid currentColor", color: p.color || undefined, ...elBorderShadowStyle(p) }
                : { backgroundColor: "var(--color-primary, #0f62fe)", color: p.color || "var(--color-primary-content, #fff)", ...elBorderShadowStyle(p) }
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
      return (
        <div
          className={`relative flex ${resolvedHeight ? "" : "aspect-[21/9]"} items-center justify-center overflow-hidden rounded-lg text-white`}
          style={{
            height: resolvedHeight || undefined,
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
              slide-specific duplicate rendering code), just without a
              `path` (no canvas-direct inline-text-edit for nested content —
              an accepted scope reduction). An element with props.position
              === "custom" opts out of the row/column flow and into drag-to-
              move (startFreeElDrag, below) — position is computed against
              THIS div (`.ds-slide-canvas`), which must stay the nearest
              `position:relative` ancestor so the on-canvas math matches the
              site's own `.ds-slide-content` containing block (see
              SectionBlock.astro's mirrored CSS). Clicking a nested element
              sets this slider's own `sliderInnerSel` so the Inspector shows
              that element's Content/Style fields instead of the slider's own. */}
          <div
            className={`ds-slide-canvas relative z-[1] w-full max-w-[36rem] space-y-2 p-6 ${
              slide.textPosition === "left" ? "self-start" : slide.textPosition === "right" ? "self-end" : ""
            }`}
          >
            {slide.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-white/40 px-4 py-6 text-center text-white/70">
                <ImageIcon className="h-6 w-6" />
                <span className="text-xs">{t("designer-slide-empty")}</span>
              </div>
            ) : (
              slide.rows.map((row, r) =>
                row.columns.map((col, c) => (
                  <div key={`${r}.${c}`} className="space-y-2">
                    {col.elements.map((childEl, e) => {
                      const selected = innerSel?.r === r && innerSel?.c === c && innerSel?.e === e;
                      const childIsFree = bpGetValue(childEl.props.position, childEl.bp, "position") === "custom";
                      return (
                        <div
                          key={childEl.id}
                          onClick={() => setSliderInnerSel((m) => ({ ...m, [el.id]: { r, c, e } }))}
                          onPointerDown={
                            childIsFree && path
                              ? (ev) => {
                                  startFreeElDrag(ev, (xPct, yPct) => {
                                    mutate((bs) => {
                                      const target = (bs[path[0]].props as unknown as SectionProps).rows[path[1]].columns[path[2]].elements[path[3]];
                                      const currentSlides = parseSlides(target.props.slides);
                                      const s0 = currentSlides[slideIdx];
                                      if (!s0) return;
                                      const xv = String(xPct);
                                      const yv = String(yPct);
                                      currentSlides[slideIdx] =
                                        bp === "desktop"
                                          ? updateSlideElementProps(s0, r, c, e, { x: xv, y: yv })
                                          : updateSlideElementBp(s0, r, c, e, { ...(childEl.bp ?? {}), [`${bp}:x`]: xv, [`${bp}:y`]: yv });
                                      target.props.slides = stringifySlides(currentSlides);
                                    });
                                  });
                                }
                              : undefined
                          }
                          className={`cursor-pointer rounded ${
                            selected ? "outline outline-2 outline-accent" : "hover:outline hover:outline-1 hover:outline-white/40"
                          } ${childIsFree ? "cursor-move" : ""}`}
                          style={
                            childIsFree
                              ? {
                                  position: "absolute",
                                  top: `${bpGetValue(childEl.props.y, childEl.bp, "y") || "10"}%`,
                                  left: `${bpGetValue(childEl.props.x, childEl.bp, "x") || "10"}%`,
                                  width: bpGetValue(childEl.props.posWidth, childEl.bp, "posWidth") || undefined,
                                  height: bpGetValue(childEl.props.posHeight, childEl.bp, "posHeight") || undefined,
                                }
                              : { ...elMarginStyle(childEl.props ?? {}), ...elPaddingStyle(childEl.props ?? {}) }
                          }
                        >
                          {ElPreview({ ctx, el: childEl })}
                        </div>
                      );
                    })}
                  </div>
                )),
              )
            )}
          </div>
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
  }
}
