// Designer's Templates gallery + Save-as-Blueprint modal (and, nested
// inside the Templates modal, the Make-Component naming dialog) — split out
// of Designer.tsx as part of the same God Component file-size refactor
// Inspector.tsx already went through (see Designer.tsx's own header
// comment). Fed almost entirely by useTemplateLibrary's own grouped
// return, so this component's props type is just that hook's return type
// plus the handful of outside values (t, isSuper) the JSX also reads.
//
// Holds no hooks of its own — deliberately NOT wrapped in React.memo (this
// region wasn't memoized before the split either).
import { LayoutTemplate, X, Trash2 } from "lucide-react";
import type * as api from "@/lib/api";
import type { Key } from "@/i18n";
import { TemplatePreview } from "./TemplatePreview";
import type { useTemplateLibrary } from "./hooks/useTemplateLibrary";

export type DesignerTemplatesModalProps = ReturnType<typeof useTemplateLibrary> & {
  t: (k: Key) => string;
  isSuper: boolean;
  // Designer's own state — fed INTO useTemplateLibrary as a dep (for
  // insertSymbol/deleteSymbolHandler to mutate via setAvailableSymbols),
  // not part of that hook's own return, so this modal needs it passed
  // separately to render the Symbols gallery below.
  availableSymbols: api.Symbol[];
};

export function DesignerTemplatesModal(props: DesignerTemplatesModalProps) {
  const {
    t, isSuper, availableSymbols,
    showTemplates, setShowTemplates, templates, templatesBusy,
    templateKind, saveAsTemplate, confirmSaveTemplate, insertTemplate, deleteTemplateHandler,
    templateFilter, setTemplateFilter, templateSearch, setTemplateSearch, templateKindLabel, templateRows,
    pendingTemplate, setPendingTemplate, templateName, setTemplateName,
    pendingSymbolEl, setPendingSymbolEl, symbolName, setSymbolName, symbolsBusy,
    confirmMakeComponent, insertSymbol, deleteSymbolHandler,
    showSaveBlueprint, setShowSaveBlueprint,
    blueprintName, setBlueprintName, blueprintDescription, setBlueprintDescription,
    blueprintCategory, setBlueprintCategory, blueprintScope, setBlueprintScope, blueprintBusy,
    confirmSaveAsBlueprint,
  } = props;

  return (
    <>
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
    </>
  );
}
