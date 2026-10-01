// Designer's top bar — title/slug editing, status pill, undo/redo/
// templates/save/publish/close buttons, breakpoint switcher. Split out of
// Designer.tsx as part of the same God Component file-size refactor
// Inspector.tsx already went through (see Designer.tsx's own header
// comment) — pure code motion, same JSX/conditions/handlers, just reached
// through one bundled props object instead of direct closure capture.
//
// Holds no hooks of its own — deliberately NOT wrapped in React.memo (this
// region wasn't memoized before the split either).
import {
  ExternalLink,
  History,
  LayoutTemplate,
  Menu,
  Monitor,
  MousePointerClick,
  Redo2,
  Settings,
  Smartphone,
  Tablet,
  Undo2,
  X,
} from "lucide-react";
import type { Key } from "@/i18n";
import type { Bp, Sel } from "./types";
import type { usePersist } from "./hooks/usePersist";
import type { LiveEditBridgeApi } from "./hooks/useLiveEditBridge";

export interface DesignerTopBarProps {
  mobilePanel: "palette" | null;
  setMobilePanel: (v: "palette" | null) => void;
  t: (k: Key) => string;
  page: Record<string, unknown>;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  editingSlug: boolean;
  setEditingSlug: (v: boolean) => void;
  slugDraft: string;
  setSlugDraft: (v: string) => void;
  slugError: string | null;
  setSlugError: (v: string | null) => void;
  renameSlug: ReturnType<typeof usePersist>["renameSlug"];
  busy: boolean;
  dirty: boolean;
  msg: string | null;
  error: string | null;
  undo: () => void;
  redo: () => void;
  openTemplates: () => void | Promise<void>;
  setSel: (p: Sel) => void;
  loadHistory: ReturnType<typeof usePersist>["loadHistory"];
  setShowSaveBlueprint: (v: boolean) => void;
  mode: LiveEditBridgeApi["mode"];
  toggleLive: LiveEditBridgeApi["toggleLive"];
  bp: Bp;
  setBp: (b: Bp) => void;
  openDevicePreview: ReturnType<typeof usePersist>["openDevicePreview"];
  saveBlueprint: ReturnType<typeof usePersist>["saveBlueprint"];
  saveSymbol: ReturnType<typeof usePersist>["saveSymbol"];
  saveSiteChrome: ReturnType<typeof usePersist>["saveSiteChrome"];
  save: ReturnType<typeof usePersist>["save"];
  chromeStatus: "draft" | "published";
  close: () => void;
}

export function DesignerTopBar({
  mobilePanel, setMobilePanel, t, page, kind,
  editingSlug, setEditingSlug, slugDraft, setSlugDraft, slugError, setSlugError, renameSlug,
  busy, dirty, msg, error, undo, redo, openTemplates, setSel, loadHistory, setShowSaveBlueprint,
  mode, toggleLive, bp, setBp, openDevicePreview,
  saveBlueprint, saveSymbol, saveSiteChrome, save, chromeStatus, close,
}: DesignerTopBarProps) {
  return (
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
  );
}
