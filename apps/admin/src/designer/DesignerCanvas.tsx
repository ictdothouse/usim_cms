// Designer's main canvas — the Section/Row/Column/Element wireframe tree and
// its add-row/add-section buttons. Split out of Designer.tsx as part of the same God
// Component file-size refactor Inspector.tsx already went through (see
// Designer.tsx's own header comment) — pure code motion, same JSX, same
// conditions, same event handlers, same values, just reached through the
// same `ctx: DesignerCtx` bundle Inspector/ElPreview already use (Canvas
// renders ElPreview too) plus one extra canvas-only props bundle for
// everything DesignerCtx doesn't carry (section-level block ops, selection/
// context-menu plumbing that stays local to Designer.tsx).
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
import type { MutableRefObject } from "react";
import { bestTextColor } from "@/lib/utils";
import type { Key } from "@/i18n";
import { section } from "./blockPath";
import { newRow, newSection } from "./parsers";
import { overlayColors } from "./style";
import { flexWrapFor } from "@ucms/element-render";
import { ElPreview } from "./ElPreview";
import { DEVICE_DIMS } from "./DeviceViewport";
import type { Bp, Row, SectionProps, Drag } from "./types";
import type { DesignerCtx } from "./context";
import type { useBlockOps } from "./hooks/useBlockOps";

// Blocks draws every box on white (no author bg), so one overlay pair serves all.
const OVERLAY = overlayColors("#ffffff");

// Row presets offered by "add row": each entry is the column span list.
const ROW_PRESETS: number[][] = [[1], [1, 1], [1, 1, 1], [1, 1, 1, 1], [1, 2], [2, 1]];

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
  pick: (e: React.SyntheticEvent, p: number[]) => void;
  setCtxMenu: (v: { path: number[]; x: number; y: number } | null) => void;
  effectiveTheme: Record<string, string> | null;
  isCanvasMode: boolean;
  duplicateSection: ReturnType<typeof useBlockOps>["duplicateSection"];
  copySection: ReturnType<typeof useBlockOps>["copySection"];
  pasteSection: ReturnType<typeof useBlockOps>["pasteSection"];
  copyStyleSection: ReturnType<typeof useBlockOps>["copyStyleSection"];
  pasteStyleSection: ReturnType<typeof useBlockOps>["pasteStyleSection"];
  deleteSection: ReturnType<typeof useBlockOps>["deleteSection"];
  dropHint: string | null;
  setDropHint: (v: string | null) => void;
  dropIntoColumn: ReturnType<typeof useBlockOps>["dropIntoColumn"];
  dropIntoNewSection: ReturnType<typeof useBlockOps>["dropIntoNewSection"];
  drag: MutableRefObject<Drag | null>;
}

export function DesignerCanvas({
  ctx,
  selEq, selCls, pick, setCtxMenu,
  effectiveTheme, isCanvasMode,
  duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
  dropHint, setDropHint, dropIntoColumn, dropIntoNewSection, drag,
}: DesignerCanvasProps) {
  const {
    t, bp, bpGetValue, bpKeysOverridden, mode, blocks, setSel,
    isSectionLocked, mutate, pageSettings, saveAsTemplate, clipHas, styleHas,
    deleteRow, deleteColumn, deleteElement,
  } = ctx;
  // Blocks is a structure-only wireframe for every kind (Divi's Wireframe
  // View / Elementor's Navigator idea): no section/row/column/element
  // spacing, bg, border, shadow or contained max-width applies here, every
  // level gets the same uniform gaps instead, and the canvas fills a framed
  // box like Live. Live Edit is where a page or header/footer is seen and
  // spaced for real (the Header/Footer Designer kept the real styling here
  // until it got Live Edit too, 2026-10-17).

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
      <span className="flex items-center gap-1 [&>button]:min-h-8 [&>button]:min-w-8 [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-accent" onClick={(ev) => ev.stopPropagation()}>
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
        <button onClick={() => duplicateSection(b)} className="px-0.5 text-accent" aria-label={t("designer-duplicate")} title={t("designer-duplicate")}>
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => copySection(b)} className="px-0.5 text-accent" aria-label={t("designer-copy")} title={t("designer-copy")}>
          <Clipboard className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteSection(b)}
          disabled={!clipHas("section")}
          aria-label={t("designer-paste")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste")}
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <button onClick={() => copyStyleSection(b)} className="px-0.5 text-accent" aria-label={t("designer-copy-style")} title={t("designer-copy-style")}>
          <Paintbrush className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteStyleSection(b)}
          disabled={!styleHas("section") || locked}
          aria-label={t("designer-paste-style")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button onClick={() => saveAsTemplate([b])} className="px-0.5 text-accent" aria-label={t("designer-templates-save")} title={t("designer-templates-save")}>
          <LayoutTemplate className="h-3 w-3" />
        </button>
        <button onClick={() => deleteSection(b)} disabled={locked} className="px-0.5 text-red-500 disabled:opacity-30" aria-label={t("designer-delete")} title={locked ? t("designer-section-locked-title") : t("designer-delete")}>
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <div
      role="region"
      aria-label={t("designer-block-view")}
      data-testid="designer-canvas"
      // No isCanvasMode means genuinely edge-to-edge content (Live Edit
      // desktop, or a "full" contentWidth page) — the old unconditional
      // p-6 left a same-color gap around it with nothing to explain it,
      // reading as an accidental leftover margin ("macam island") rather
      // than a deliberate frame. Only the boxed/backdropped case gets
      // that breathing room now.
      className="min-w-0 flex-1 overflow-y-auto bg-zinc-200 p-4 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-accent"
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
          // (bg-zinc-200 above, or pageSettings.canvasColor when the
          // author picked one in Page Settings) rather than looking
          // like unfilled/leftover theme-bg space.
          background: pageSettings.canvasColor || undefined,
          color: "var(--color-text, inherit)",
          fontFamily: "var(--font-family, inherit)",
        } as React.CSSProperties
      }
    >
      <div
        className="relative mx-auto min-h-full"
        style={{
          // Same DEVICE_DIMS Preview and Live Edit frame the real page at
          // (DeviceViewport) — this bp simulation, those two, and a real
          // phone/tablet all agree on the width a free-position element's
          // fixed-px size gets judged against.
          maxWidth: bp !== "desktop" ? `${DEVICE_DIMS[bp].w}px` : undefined,
        }}
      >
        {/* Decorative-only layer (bg/rounded corners/border/shadow), kept
            OUT of the real content below — same split this file's own
            per-section render already uses (see its "Split so
            overflow-hidden ... only ever wraps a decorative backdrop
            layer" comment a bit further down): an overflow-hidden box
            around the real content would clip every padding/margin
            drag-handle badge that deliberately overhangs its own edge by
            design, and here that overhang lands right on this box's own
            left/right edge (sections span its full width, no gap to
            absorb it) — that was clipping the "0px" badges at
            tablet/mobile. The sibling content div right below is
            `relative` (not static) so it still stacks above this
            `absolute` one despite coming later in paint order only by
            position, not z-index. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.5rem] border border-line/60 bg-white shadow-lg" />
        <div className="relative p-4" style={{ color: isCanvasMode ? "var(--color-text, inherit)" : undefined }}>
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
          // Split so overflow-hidden (needed to clip the rounded corners
          // cleanly) only ever wraps a decorative backdrop layer — never the
          // real rows/columns/elements content. A column or element sits
          // flush against this box's edge, and its grip/delete/drag-handle
          // badges stick out a few px past that edge by design (see the
          // -left-2/-top-2 offsets below); the old single overflow-hidden div
          // clipped those badges away.
          const sectionHiddenAtBp = hiddenAtBp(sp as unknown as Record<string, string>);
          return (
            <div
              key={b}
              className={`group relative ${mode === "live" ? "" : "rounded-xl"} ${selCls([b])}`}
              style={{ opacity: sectionHiddenAtBp ? 0.35 : undefined }}
              onClick={(ev) => pick(ev, [b])}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setSel([b]);
                setCtxMenu({ path: [b], x: ev.clientX, y: ev.clientY });
              }}
            >
              <HiddenAtBpBadge hidden={sectionHiddenAtBp} bp={bp} t={t} />
              <div className={`absolute -top-3 left-3 z-10 items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-xs font-bold text-sub shadow-sm ${selEq([b]) ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}>
                {t("designer-section")} {BlockControls({ b })}
              </div>
              <div className="relative">
                <div
                  className={`pointer-events-none absolute inset-0 overflow-hidden ${mode === "live" ? "" : "rounded-xl border"}`}
                  style={{ borderColor: mode === "live" ? undefined : OVERLAY.line }}
                />
                {/* Top band leaves room for the hover Section pill above row 0's Row badge. */}
                <div className="relative" style={{ padding: "1.5rem 0.75rem 0.75rem" }}>
                <div>
                  {(sp.rows ?? []).map((row, r) => {
                    const rowHiddenAtBp = hiddenAtBp(row as unknown as Record<string, string>);
                    return (
                    <div
                      key={r}
                      className="group/row relative"
                      style={{ marginTop: r === 0 ? 0 : "0.75rem", opacity: rowHiddenAtBp ? 0.35 : undefined }}
                    >
                      <HiddenAtBpBadge hidden={rowHiddenAtBp} bp={bp} t={t} />
                      {mode !== "live" && (
                        <>
                          <button
                            onClick={(ev) => pick(ev, [b, r])}
                            title={t("designer-row-gap")}
                            className={`absolute -left-2 -top-2 z-20 items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-xs font-bold text-sub shadow-sm ${selEq([b, r]) ? "flex" : "hidden group-hover/row:flex group-focus-within/row:flex"}`}
                          >
                            {t("designer-row")}
                          </button>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              deleteRow(b, r);
                            }}
                            title={t("designer-delete-row")}
                            aria-label={t("designer-delete-row")}
                            className={`absolute -right-2 -top-2 z-20 rounded-full bg-white p-1 text-red-500 shadow-sm ring-1 ring-line/30 ${selEq([b, r]) ? "flex" : "hidden group-hover/row:flex group-focus-within/row:flex"}`}
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
                                flexWrap: flexWrapFor(rowFlexDirectionAtBp(row, bp), row.flexWrap),
                              }
                            : { gridTemplateColumns: rowGridTemplate(row, bp) }),
                          gap: "0.75rem",
                        }}
                      >
                        {row.columns.map((col, c) => {
                        const colHiddenAtBp = hiddenAtBp(col.props);
                        return (
                        <div
                          key={c}
                          className={`relative min-h-[3rem] min-w-0 transition-colors ${
                            mode === "live" ? "" : "rounded-lg border border-dashed p-1.5"
                          } ${selCls([b, r, c])} ${dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""}`}
                          style={{
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
                            borderColor: mode === "live" ? undefined : OVERLAY.line,
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
                              aria-label={t("designer-delete")}
                              className="absolute -right-2 -top-2 z-30 rounded-full bg-white p-1 text-red-500 shadow-sm ring-1 ring-line/30"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                          {/* space-y-* lives here, not on the outer column div — that div also
                              holds the absolutely-positioned padding/margin badges as direct
                              children, and space-y's sibling-selector margin-top doesn't know
                              those are overlay UI, not real content: it was shoving every badge
                              down by an extra 12px, off the selection outline it should sit on. */}
                          <div className={mode === "live" ? "space-y-5" : "space-y-3"}>
                          {col.elements.length === 0 && (
                            <div
                              className="flex h-12 items-center justify-center rounded-lg border border-dashed text-[10px] font-medium"
                              style={{ borderColor: OVERLAY.line, color: OVERLAY.text }}
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
                              style={{ opacity: hiddenAtBp(el.props) ? 0.35 : undefined }}
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
                                  aria-label={t("designer-delete")}
                                  className="absolute -right-2 -top-2 z-30 rounded-full bg-white p-1 text-red-500 shadow-sm ring-1 ring-line/30"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
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
                  <div className={`items-center gap-1.5 pt-1 ${selEq([b]) ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`} onClick={(ev) => ev.stopPropagation()}>
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
          // Also a drop target for ANY drag (Layout palette's "Section"
          // preset, a regular element from the Content palette, or an
          // existing element being moved) — dropIntoNewSection handles all
          // 3, creating the section the drop needs instead of requiring a
          // click on this same button first. Dropping a "Section" preset
          // onto an EXISTING section's column instead inserts right after it
          // (see useBlockOps.ts's dropIntoColumn).
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            dropIntoNewSection();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/50 bg-white/60 py-4 text-xs font-semibold text-body hover:border-accent hover:text-accent"
        >
          <Plus className="h-4 w-4" /> {t("designer-add-section")}
        </button>
        </div>
        </div>
      </div>
    </div>
  );
}
