// Inspector's "nothing selected" page-settings panel — split out of
// Inspector.tsx as part of the same God Component file-size refactor (see
// that file's own header comment). Holds no hooks of its own, called as a
// plain function the same way Inspector/ElPreview/FieldGroups already are.
import { RefreshCw } from "lucide-react";
import { BASE_LANG, type DesignerCtx } from "./context";
import { BufferedInput } from "./FieldControls";
import { gapPx } from "./style";

export function InspectorPageSettings({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, kind,
    pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageCanvasColor, setPageThemePreset, themePresets,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters, patchPageChrome,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang, hasLangSlot,
    clickPageLanguagePill, translating, retranslatePageLanguage,
  } = ctx;
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-ink">{t("designer-page-settings")}</p>
      <label className="block text-[11px] font-medium text-body">
        {t("designer-page-gap")}
        <BufferedInput
          type="number"
          placeholder="32"
          value={String(gapPx(pageSettings.gap))}
          onCommit={(v) => setPageGap(v === "" ? undefined : `${v}px`)}
          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        />
      </label>
      <label className="block text-[11px] font-medium text-body">
        {t("designer-page-content-width")}
        <select
          value={pageSettings.contentWidth ?? "contained"}
          onChange={(e) => setPageContentWidth(e.target.value === "full" ? "full" : undefined)}
          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        >
          <option value="contained">contained</option>
          <option value="full">full</option>
        </select>
      </label>
      {(pageSettings.contentWidth ?? "contained") !== "full" && (
        // Only meaningful once the page is boxed (desktop included) —
        // "full" width has no canvas backdrop to color at all (see
        // Designer.tsx's isCanvasMode).
        <label className="block text-[11px] font-medium text-body">
          {t("designer-page-canvas-color")}
          <input
            type="color"
            value={pageSettings.canvasColor ?? "#f5f5f7"}
            onChange={(e) => setPageCanvasColor(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-line/30 p-0.5"
          />
        </label>
      )}
      <label className="block text-[11px] font-medium text-body">
        {t("designer-page-padding-x")}
        <BufferedInput
          type="number"
          placeholder="24"
          value={String(gapPx(pageSettings.paddingX))}
          onCommit={(v) => setPagePaddingX(v === "" ? undefined : `${v}px`)}
          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        />
      </label>
      <label className="block text-[11px] font-medium text-body">
        {t("designer-page-theme")}
        <select
          value={pageSettings.themePresetName ?? ""}
          onChange={(e) => setPageThemePreset(themePresets.find((p) => p.name === e.target.value) ?? null)}
          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        >
          <option value="">{t("designer-page-theme-default")}</option>
          {themePresets.map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>
      </label>
      {kind === "page" && (
        <div className="space-y-2 border-t border-line/30 pt-3">
          <p className="text-[11px] font-bold text-ink">{t("header-footer-page-assignment")}</p>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-page-header")}
            <select
              value={pageHeaderId}
              onChange={(e) => void patchPageChrome({ headerId: e.target.value })}
              disabled={pageHideHeader}
              className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
            >
              <option value="">{t("designer-page-header-default")}</option>
              {availableHeaders.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-medium text-body">
            <input type="checkbox" checked={pageHideHeader} onChange={(e) => void patchPageChrome({ hideHeader: e.target.checked })} />
            {t("designer-page-hide-header")}
          </label>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-page-footer")}
            <select
              value={pageFooterId}
              onChange={(e) => void patchPageChrome({ footerId: e.target.value })}
              disabled={pageHideFooter}
              className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
            >
              <option value="">{t("designer-page-header-default")}</option>
              {availableFooters.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-medium text-body">
            <input type="checkbox" checked={pageHideFooter} onChange={(e) => void patchPageChrome({ hideFooter: e.target.checked })} />
            {t("designer-page-hide-footer")}
          </label>
        </div>
      )}
      {siteMultilangEnabled && (
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-body">{t("designer-page-language")}</label>
        <label className="flex items-center gap-2 text-[11px] font-medium text-body">
          <input
            type="checkbox"
            checked={pageMultilangEnabled}
            onChange={(e) => {
              setPageMultilangEnabled(e.target.checked);
              setDirty(true);
            }}
          />
          {t("designer-page-multilang-enable")}
        </label>
        {pageMultilangEnabled ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {siteLanguages.map((l) => {
              const slotKey = l.code === pageLanguage ? BASE_LANG : l.code;
              const isCurrent = activeLang === slotKey;
              const hasContent = hasLangSlot(slotKey);
              const isBase = l.code === pageLanguage;
              return (
                <span key={l.code} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={isCurrent || translating}
                    onClick={() => clickPageLanguagePill(l.code)}
                    title={isBase ? t("posts-language-default-badge") : !pageLanguage || hasContent ? undefined : t("posts-translate-btn")}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                      isBase ? "ring-2 ring-amber-400 ring-offset-1" : ""
                    } ${
                      isCurrent
                        ? "bg-accent text-white"
                        : hasContent
                          ? "bg-canvas text-ink hover:bg-[#e8e8ed]"
                          : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
                    }`}
                  >
                    {isBase && "★ "}{l.label}{!isCurrent && !hasContent && (translating ? "…" : " +")}
                  </button>
                  {!isBase && hasContent && (
                    <button
                      type="button"
                      disabled={translating}
                      onClick={() => void retranslatePageLanguage(l.code)}
                      title={t("designer-page-retranslate")}
                      className="rounded p-1 text-sub hover:bg-canvas hover:text-accent disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <select
            value={pageLanguage || "__none"}
            onChange={(e) => {
              setPageLanguage(e.target.value === "__none" ? "" : e.target.value);
              setDirty(true);
            }}
            className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="__none">{t("designer-page-language-none")}</option>
            {siteLanguages.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        )}
      </div>
      )}
      <p className="text-[10px] text-sub">{t("designer-none-selected")}</p>
    </div>
  );
}
