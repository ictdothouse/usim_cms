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
  CloudAlert,
  CloudCheck,
  CloudUpload,
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
  tenantHost: string;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  editingSlug: boolean;
  setEditingSlug: (v: boolean) => void;
  slugDraft: string;
  setSlugDraft: (v: string) => void;
  slugError: string | null;
  setSlugError: (v: string | null) => void;
  renameSlug: ReturnType<typeof usePersist>["renameSlug"];
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  // A published page with an autosaved-but-unpublished edit (pages.draft) —
  // nothing is "unsaved", but it isn't live yet either.
  hasDraft: boolean;
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

// Canva-style save state: one fixed-size icon, so an autosave never resizes
// or recolors the bar; the words only show on hover. It replaced a text badge
// that flipped Unsaved → Saving... → Draft saved on every autosave.
function SaveStatus({ label, pending, unsaved }: { label: string; pending: boolean; unsaved: boolean }) {
  const Icon = unsaved ? CloudAlert : pending ? CloudUpload : CloudCheck;
  return (
    <span role="img" aria-label={label} className={`group relative grid h-9 w-9 shrink-0 place-items-center rounded-full ${unsaved ? "text-warn" : "text-sub"}`}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block">
        {label}
      </span>
    </span>
  );
}

export function DesignerTopBar({
  mobilePanel, setMobilePanel, t, page, tenantHost, kind,
  editingSlug, setEditingSlug, slugDraft, setSlugDraft, slugError, setSlugError, renameSlug,
  busy, canUndo, canRedo, dirty, hasDraft, error, undo, redo, openTemplates, setSel, loadHistory, setShowSaveBlueprint,
  mode, toggleLive, bp, setBp, openDevicePreview,
  saveBlueprint, saveSymbol, saveSiteChrome, save, chromeStatus, close,
}: DesignerTopBarProps) {
  // A published header/footer is the one thing autosave skips (no draft
  // column yet), so its edit stays a visible warning until Save/Publish.
  const unsaved = dirty && kind === "siteChrome" && chromeStatus === "published";
  const status = kind === "page" ? page.status : kind === "siteChrome" ? chromeStatus : null;
  const saveLabel = unsaved
    ? t("designer-dirty")
    : busy || dirty
      ? t("designer-saving")
      : hasDraft
        ? t("designer-draft-pending")
        : status
          ? `${t("designer-all-saved")} · ${t(status === "published" ? "pages-published" : "pages-draft")}`
          : t("designer-all-saved");
  return (
    <header className="shrink-0 border-b border-line/30 bg-white [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-accent">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:flex sm:flex-wrap sm:px-4">
      <button
        onClick={() => setMobilePanel(mobilePanel === "palette" ? null : "palette")}
        className={`min-h-10 min-w-10 rounded-full p-2 lg:hidden ${mobilePanel === "palette" ? "bg-accent/15 text-accent" : "text-body hover:bg-canvas"}`}
        aria-label={t("designer-tab-elements")}
        aria-expanded={mobilePanel === "palette"}
        aria-controls="designer-palette"
        title={t("designer-tab-elements")}
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1" title={`${page.title as string} · ${tenantHost}`}>
        <p className="line-clamp-2 break-words text-sm font-bold text-ink sm:truncate">{page.title as string}</p>
        <p className="hidden truncate text-sm text-sub sm:block">{tenantHost}</p>
      </div>
      <button onClick={close} className="min-h-10 min-w-10 rounded-full p-2 text-body hover:bg-canvas sm:hidden" aria-label={t("designer-close")} title={t("designer-close")}><X className="mx-auto h-4 w-4" /></button>
      {kind === "page" && (
        <>
          {editingSlug ? (
            <span className="col-span-3 flex items-center gap-1 sm:col-auto">
              <span className="font-mono text-sm text-sub">/</span>
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
                className="rounded border border-line/40 px-1.5 py-0.5 font-mono text-sm text-ink"
              />
            </span>
          ) : (
            <button
              onClick={() => {
                setSlugDraft(page.slug as string);
                setEditingSlug(true);
              }}
              className="font-mono text-sm text-sub hover:text-accent hover:underline"
              title={t("designer-slug-edit")}
            >
              /{page.slug as string}
            </button>
          )}
        </>
      )}
      {kind !== "page" && (
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-sm font-bold uppercase text-accent">
          {t(kind === "blueprint" ? "blueprints-title" : kind === "symbol" ? "designer-symbols-title" : "header-footer-title")}
        </span>
      )}
      <SaveStatus label={saveLabel} pending={busy || dirty} unsaved={unsaved} />
      {kind !== "page" && (
        <button onClick={() => void (kind === "blueprint" ? saveBlueprint() : kind === "symbol" ? saveSymbol() : saveSiteChrome())} disabled={busy} className="min-h-10 shrink-0 rounded-full bg-canvas px-4 text-sm font-semibold text-ink disabled:opacity-50">
          {busy ? t("designer-saving") : t("designer-save")}
        </button>
      )}
      {kind === "page" && (
        <button onClick={() => void save("published")} disabled={busy || (page.status === "published" && !dirty && !hasDraft)} className="min-h-10 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t("designer-saving") : page.status === "published" ? t("designer-update") : t("designer-publish")}
        </button>
      )}
      {kind === "siteChrome" && (chromeStatus === "published" ? (
        <button onClick={() => void saveSiteChrome("draft")} disabled={busy} className="min-h-10 shrink-0 rounded-full bg-canvas px-4 text-sm font-semibold text-body disabled:opacity-50">{t("header-footer-unpublish")}</button>
      ) : (
        <button onClick={() => void saveSiteChrome("published")} disabled={busy} className="min-h-10 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{t("designer-publish")}</button>
      ))}
      <button onClick={close} className="hidden min-h-10 min-w-10 shrink-0 rounded-full p-2 text-body hover:bg-canvas sm:block" aria-label={t("designer-close")} title={t("designer-close")}><X className="mx-auto h-4 w-4" /></button>
      </div>
      <div role="toolbar" aria-label={t("designer-page-settings")} className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-line/20 px-3 py-1.5 sm:px-4 [&>button]:min-h-9 [&>button]:shrink-0 [&>button:disabled]:opacity-40">
      <button
        onClick={undo}
        disabled={!canUndo}
        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
        title="Ctrl+Z"
      >
        <Undo2 className="h-3.5 w-3.5" /> {t("designer-undo")}
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
        title="Ctrl+Shift+Z"
      >
        <Redo2 className="h-3.5 w-3.5" /> {t("designer-redo")}
      </button>
      <button
        onClick={() => void openTemplates()}
        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
      >
        <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates")}
      </button>
      {kind === "page" && (
        <button
          onClick={() => setSel(null)}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
          title={t("designer-page-settings")}
        >
          <Settings className="h-3.5 w-3.5" /> {t("designer-page-settings")}
        </button>
      )}
      {kind === "page" && (
        <button
          onClick={() => void loadHistory()}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
          title={t("designer-history")}
        >
          <History className="h-3.5 w-3.5" /> {t("designer-history")}
        </button>
      )}
      {kind === "page" && (
        <button
          onClick={() => setShowSaveBlueprint(true)}
          className="flex items-center gap-1 rounded-full bg-canvas px-3 py-1.5 text-sm font-semibold text-ink hover:bg-[#e8e8ed]"
        >
          <LayoutTemplate className="h-3.5 w-3.5" /> {t("blueprints-save-as")}
        </button>
      )}
      {(kind === "page" || kind === "blueprint") && (
        <button
          onClick={() => void toggleLive()}
          aria-pressed={mode === "live"}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-canvas ${
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
            aria-label={t(labelKey)}
            aria-pressed={bp === key}
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
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-body hover:bg-canvas"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
        </button>
      )}
      </div>
      {slugError && <p role="alert" className="px-4 pb-2 text-sm text-red-700">{slugError}</p>}
      {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
    </header>
  );
}
