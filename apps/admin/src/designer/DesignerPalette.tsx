// Designer's left sidebar — the Elements/Layers/Settings tab switcher
// (Settings renders the shared Inspector unchanged). Split out of
// Designer.tsx as part of the same God Component file-size refactor
// Inspector.tsx already went through (see Designer.tsx's own header
// comment) — pure code motion, same JSX/conditions/handlers, just reached
// through one bundled props object instead of direct closure capture.
//
// Also carries LayersTreeView, moved in verbatim (zero signature changes) —
// it was already a standalone top-level function with fully explicit props,
// just physically relocated.
//
// Holds no hooks of its own — deliberately NOT wrapped in React.memo (this
// region wasn't memoized before the split either).
import { ChevronDown, ChevronRight, Layers, Lock, Settings } from "lucide-react";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { Key } from "@/i18n";
import { Inspector } from "./Inspector";
import { ELS, LAYOUT_PRESETS, PALETTE_CATEGORY } from "./elements";
import type { Block, SectionProps, ElType, Drag } from "./types";
import type { DesignerCtx } from "./context";
import type { useSiteChrome } from "./hooks/useSiteChrome";

export function LayersTreeView({
  blocks, treeDropHint, rowDragProps, expanded, selEq, pick, toggleExpand, t,
}: {
  blocks: Block[];
  treeDropHint: { key: string; pos: "before" | "after" } | null;
  rowDragProps: (kind: "section" | "column" | "element", path: number[], key: string) => Record<string, unknown>;
  expanded: Set<string>;
  selEq: (p: number[]) => boolean;
  pick: (e: React.SyntheticEvent, p: number[]) => void;
  toggleExpand: (key: string) => void;
  t: (k: Key) => string;
}) {
  const selectOnKey = (ev: React.KeyboardEvent<HTMLElement>, path: number[]) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    ev.stopPropagation();
    pick(ev, path);
  };
  return (
    <div role="tree" aria-label={t("designer-tab-layers")} className="space-y-0.5 text-sm">
      {blocks.map((block, b) => {
        if (block.type !== "section") {
          const key = `${b}`;
          return (
            <div
              key={b}
              role="treeitem"
              tabIndex={0}
              aria-selected={selEq([b])}
              onKeyDown={(ev) => selectOnKey(ev, [b])}
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
              role="treeitem"
              tabIndex={0}
              aria-selected={selEq([b])}
              aria-expanded={isOpen}
              onKeyDown={(ev) => selectOnKey(ev, [b])}
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
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={selEq([b, r])}
                      onKeyDown={(ev) => selectOnKey(ev, [b, r])}
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold cursor-pointer ${selEq([b, r]) ? "bg-accent/10 text-accent" : "text-sub hover:bg-canvas"}`}
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
                          role="treeitem"
                          tabIndex={0}
                          aria-selected={selEq([b, r, c])}
                          aria-expanded={colOpen}
                          onKeyDown={(ev) => selectOnKey(ev, [b, r, c])}
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
                                role="treeitem"
                                tabIndex={0}
                                aria-selected={selEq([b, r, c, e])}
                                onKeyDown={(ev) => selectOnKey(ev, [b, r, c, e])}
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

export interface DesignerPaletteProps {
  ctx: DesignerCtx;
  mobilePanel: "palette" | null;
  setMobilePanel: (v: "palette" | null) => void;
  isDesktop: boolean;
  activeLeftTab: "elements" | "layers" | "settings";
  setActiveLeftTab: (tab: "elements" | "layers" | "settings") => void;
  drag: MutableRefObject<Drag | null>;
  mode: "blocks" | "live";
  startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void;
  dropIntoColumn: (path: number[], index?: number) => void;
  dropIntoNewSection: (afterBlockIndex?: number) => void;
  blocks: Block[];
  treeDropHint: { key: string; pos: "before" | "after" } | null;
  rowDragProps: (kind: "section" | "column" | "element", path: number[], key: string) => Record<string, unknown>;
  expanded: Set<string>;
  selEq: (p: number[]) => boolean;
  pick: (e: React.SyntheticEvent, p: number[]) => void;
  toggleExpand: (key: string) => void;
  t: (k: Key) => string;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  chromeKind: ReturnType<typeof useSiteChrome>["chromeKind"];
  chromeIsDefault: ReturnType<typeof useSiteChrome>["chromeIsDefault"];
  chromeMobileNav: ReturnType<typeof useSiteChrome>["chromeMobileNav"];
  patchChromeMeta: ReturnType<typeof useSiteChrome>["patchChromeMeta"];
}

export function DesignerPalette({
  ctx, mobilePanel, setMobilePanel, isDesktop, activeLeftTab, setActiveLeftTab, drag, mode, startPaletteDrag, dropIntoColumn, dropIntoNewSection,
  blocks, treeDropHint, rowDragProps, expanded, selEq, pick, toggleExpand, t,
  kind, chromeKind, chromeIsDefault, chromeMobileNav, patchChromeMeta,
}: DesignerPaletteProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (isDesktop || mobilePanel !== "palette") return;
    const previous = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobilePanel(null); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [isDesktop, mobilePanel, setMobilePanel]);
  function addFromPalette(payload: Drag) {
    const selected = ctx.sel;
    drag.current = payload;
    if (selected && blocks[selected[0]]?.type === "section") {
      const sp = blocks[selected[0]].props as unknown as SectionProps;
      const row = Math.min(selected[1] ?? 0, sp.rows.length - 1);
      const col = Math.min(selected[2] ?? 0, (sp.rows[row]?.columns.length ?? 1) - 1);
      if (row >= 0 && col >= 0) dropIntoColumn([selected[0], row, col]);
      else dropIntoNewSection();
    } else {
      dropIntoNewSection();
    }
    setMobilePanel(null);
  }
  // One palette tile — Layout presets and every element category share the
  // same click/drag wiring, only the payload differs.
  const tile = (key: string, Icon: typeof Settings, label: string, payload: Drag) => (
    <button
      type="button"
      key={key}
      draggable={mode !== "live"}
      onClick={(ev) => { if (mode !== "live" || ev.detail === 0) addFromPalette(payload); }}
      onDragStart={
        mode === "live"
          ? undefined
          : (ev) => {
              drag.current = payload;
              ev.dataTransfer.effectAllowed = "copy";
            }
      }
      onDragEnd={mode === "live" ? undefined : () => (drag.current = null)}
      onPointerDown={mode === "live" ? (e) => startPaletteDrag(e, payload, label) : undefined}
      // touch-none: without it, a touch-drag on this item
      // scrolls the sidebar instead (the browser's own
      // default touch-scroll gesture wins before pointermove
      // ever fires), firing pointercancel immediately — the
      // gesture never gets a chance to start on a touch
      // device (final review finding).
      className="touch-none flex cursor-grab flex-col items-center gap-1 rounded-lg border border-line/30 bg-canvas/60 px-2 py-2.5 text-center text-xs font-medium leading-tight text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
    >
      <Icon className="h-4 w-4 text-accent" /> {label}
    </button>
  );
  const paletteTypes = Object.keys(PALETTE_CATEGORY) as Exclude<ElType, "container">[];
  return (
    <aside
      id="designer-palette"
      ref={(node) => { panelRef.current = node; if (node) node.inert = !isDesktop && mobilePanel !== "palette"; }}
      aria-hidden={!isDesktop && mobilePanel !== "palette"}
      role={!isDesktop && mobilePanel === "palette" ? "dialog" : undefined}
      aria-modal={!isDesktop && mobilePanel === "palette" ? true : undefined}
      aria-label={t(activeLeftTab === "settings" ? "designer-inspector" : activeLeftTab === "layers" ? "designer-tab-layers" : "designer-tab-elements")}
      className={`designer-palette absolute inset-y-0 left-0 z-40 w-72 transform overflow-y-auto border-r border-line/30 bg-white p-3 transition-transform duration-200 ease-out motion-reduce:transition-none lg:static lg:z-auto lg:w-72 lg:translate-x-0 ${
        mobilePanel === "palette" ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <button type="button" onClick={() => setMobilePanel(null)} className="mb-2 min-h-10 w-full rounded-lg border border-line/40 text-sm font-semibold text-body lg:hidden">{t("designer-close")}</button>
      <div className="mb-2 flex gap-1 rounded-lg bg-canvas p-0.5 text-xs font-semibold">
        <button
          onClick={() => setActiveLeftTab("elements")}
          aria-pressed={activeLeftTab === "elements"}
          className={`flex-1 rounded-md py-1 ${activeLeftTab === "elements" ? "bg-white shadow-sm" : "text-sub"}`}
        >
          {t("designer-tab-elements")}
        </button>
        <button
          onClick={() => setActiveLeftTab("layers")}
          aria-pressed={activeLeftTab === "layers"}
          className={`flex-1 rounded-md py-1 inline-flex items-center justify-center gap-1 ${activeLeftTab === "layers" ? "bg-white shadow-sm" : "text-sub"}`}
        >
          <Layers className="h-3 w-3" /> {t("designer-tab-layers")}
        </button>
        <button
          onClick={() => setActiveLeftTab("settings")}
          aria-pressed={activeLeftTab === "settings"}
          className={`flex-1 rounded-md py-1 inline-flex items-center justify-center gap-1 ${activeLeftTab === "settings" ? "bg-white shadow-sm" : "text-sub"}`}
        >
          <Settings className="h-3 w-3" /> {t("designer-inspector")}
        </button>
      </div>
      {activeLeftTab === "elements" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-sub">{t("designer-category-layout")}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {LAYOUT_PRESETS.map((preset) => tile(preset.key, preset.icon, t(preset.labelKey), preset.drag))}
            </div>
          </div>
          {[...new Set(Object.values(PALETTE_CATEGORY))].map((category) => (
            <div key={category} className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-sub">{t(category)}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {paletteTypes
                  .filter((type) => PALETTE_CATEGORY[type] === category)
                  .map((type) => tile(type, ELS[type].icon, t(ELS[type].labelKey), { kind: "new", type }))}
              </div>
            </div>
          ))}
          <p className="pt-2 text-xs leading-relaxed text-sub">{t("designer-drop-hint")}</p>
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
          <p className="text-xs font-bold uppercase tracking-wider text-sub">{t("designer-inspector")}</p>
          {kind === "siteChrome" && (
            <div className="mb-1 space-y-3 rounded-lg border border-line/30 p-3">
              <p className="text-xs font-bold text-ink">{t("header-footer-settings")}</p>
              <label className="flex items-center gap-2 text-sm font-medium text-body">
                <input
                  type="checkbox"
                  checked={chromeIsDefault}
                  onChange={(e) => void patchChromeMeta({ isDefault: e.target.checked })}
                />
                {t("header-footer-set-default")}
              </label>
              {chromeKind === "header" && (
                <div className="space-y-2 border-t border-line/20 pt-2">
                  <p className="text-sm font-semibold text-body">{t("header-footer-mobile-nav")}</p>
                  <label className="block text-sm text-body">
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
                  <label className="block text-sm text-body">
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
                  <label className="block text-sm text-body">
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
                  <label className="block text-sm text-body">
                    {t("header-footer-mobile-color")}
                    <input
                      type="color"
                      value={chromeMobileNav.color ?? "#111827"}
                      onChange={(e) => void patchChromeMeta({ mobileNav: { color: e.target.value } })}
                      className="mt-1 h-7 w-full rounded-md border border-line/30"
                    />
                  </label>
                  <label className="block text-sm text-body">
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
          <Inspector ctx={ctx} />
        </div>
      )}
    </aside>
  );
}
