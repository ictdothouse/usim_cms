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
import type { MutableRefObject } from "react";
import type { Key } from "@/i18n";
import { Inspector } from "./Inspector";
import { ELS } from "./elements";
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

export interface DesignerPaletteProps {
  ctx: DesignerCtx;
  mobilePanel: "palette" | null;
  activeLeftTab: "elements" | "layers" | "settings";
  setActiveLeftTab: (tab: "elements" | "layers" | "settings") => void;
  drag: MutableRefObject<Drag | null>;
  blocks: Block[];
  treeDropHint: { key: string; pos: "before" | "after" } | null;
  rowDragProps: (kind: "section" | "column" | "element", path: number[], key: string) => Record<string, unknown>;
  expanded: Set<string>;
  selEq: (p: number[]) => boolean;
  pick: (e: React.MouseEvent, p: number[]) => void;
  toggleExpand: (key: string) => void;
  t: (k: Key) => string;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  chromeKind: ReturnType<typeof useSiteChrome>["chromeKind"];
  chromeIsDefault: ReturnType<typeof useSiteChrome>["chromeIsDefault"];
  chromeMobileNav: ReturnType<typeof useSiteChrome>["chromeMobileNav"];
  patchChromeMeta: ReturnType<typeof useSiteChrome>["patchChromeMeta"];
}

export function DesignerPalette({
  ctx, mobilePanel, activeLeftTab, setActiveLeftTab, drag,
  blocks, treeDropHint, rowDragProps, expanded, selEq, pick, toggleExpand, t,
  kind, chromeKind, chromeIsDefault, chromeMobileNav, patchChromeMeta,
}: DesignerPaletteProps) {
  return (
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
          <Inspector ctx={ctx} />
        </div>
      )}
    </aside>
  );
}
