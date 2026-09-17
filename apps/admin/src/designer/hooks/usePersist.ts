// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — NEW concern vs. that spec:
// the "save this Designer document" family grew past a single page-save
// since it was written (revision history, blueprint/symbol/siteChrome save
// paths, the preview-token minting flows). Groups renameSlug/save/
// saveBlueprint/saveSymbol/saveSiteChrome (the kind-specific persistence
// paths), page revision history, and the two preview-token mint flows.
import { useState } from "react";
import * as api from "@/lib/api";
import { slugify } from "@/lib/utils";
import type { Key } from "@/i18n";
import { BASE_LANG } from "../context";
import type { Block, PageSettings, SectionProps } from "../types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface PersistDeps {
  tenantHost: string;
  token: string;
  page: { id?: unknown; slug?: unknown; status?: unknown };
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  bp: "desktop" | "tablet" | "mobile";
  chromeKind: "header" | "footer" | undefined;
  setChromeStatus: (s: "draft" | "published") => void;
  rawBlocks: Block[];
  setRawBlocksDirectly: (next: Block[]) => void;
  pageSettings: PageSettings;
  setPageSettings: (s: PageSettings) => void;
  pageLanguage: string;
  pageMultilangEnabled: boolean;
  langOverrides: Record<string, Record<string, Record<string, string>>>;
  slugDraft: string;
  setSlugDraft: (v: string) => void;
  setEditingSlug: (v: boolean) => void;
  setSlugError: (v: string | null) => void;
  setDirty: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setSavedAny: (v: boolean) => void;
  setMsg: (v: string | null) => void;
  setPreviewMinting: (v: boolean) => void;
  setPreviewLink: (v: string | null) => void;
  setPreviewModal: (v: { src: string; device: "desktop" | "tablet" | "mobile" } | null) => void;
  t: (k: Key) => string;
}

export function usePersist(deps: PersistDeps) {
  const {
    tenantHost, token, page, kind, bp, chromeKind, setChromeStatus,
    rawBlocks, setRawBlocksDirectly, pageSettings, setPageSettings,
    pageLanguage, pageMultilangEnabled, langOverrides,
    slugDraft, setSlugDraft, setEditingSlug, setSlugError,
    setDirty, setBusy, setError, setSavedAny, setMsg,
    setPreviewMinting, setPreviewLink, setPreviewModal, t,
  } = deps;

  // Page revision history (kind === "page" only — see api.PageRevision).
  // Fetched lazily, only when the panel is actually opened, mirroring
  // PostEditorPage's own PostHistory panel.
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<api.PageRevision[]>([]);
  const [revisionsLoaded, setRevisionsLoaded] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Quick-create (App.tsx's PagesPanel) only auto-derives the slug up
  // front — this is the "then boleh edit" half, exposed as a click-to-edit
  // field in the header instead of a whole page-settings screen.
  async function renameSlug() {
    const next = slugify(slugDraft);
    if (!next) {
      setSlugError(t("designer-slug-empty"));
      return;
    }
    if (next === page.slug) {
      setEditingSlug(false);
      return;
    }
    try {
      await api.updatePage(tenantHost, token, page.id as string, { slug: next });
      page.slug = next;
      setSlugDraft(next);
      setEditingSlug(false);
      setSlugError(null);
    } catch (err) {
      setSlugError((err as Error).message);
    }
  }

  async function save(status?: "published") {
    setBusy(true);
    setError(null);
    try {
      // `rawBlocks` is always the shared base tree regardless of which
      // language pill happens to be active — no "commit the active language
      // back first" step needed the way the old full-tree-fork model
      // required, since editing under a non-base pill never touched
      // `rawBlocks` in the first place.
      const translations: Record<string, { overrides: Record<string, Record<string, string>> }> = {};
      for (const [code, overrides] of Object.entries(langOverrides)) {
        if (code !== BASE_LANG) translations[code] = { overrides };
      }
      await api.updatePage(tenantHost, token, page.id as string, {
        layout: clone(rawBlocks),
        translations,
        settings: pageSettings,
        language: pageLanguage || null,
        multilangEnabled: pageMultilangEnabled,
        ...(status ? { status, publishedAt: new Date().toISOString() } : {}),
      });
      if (status) page.status = status;
      setDirty(false);
      setSavedAny(true);
      setMsg(status ? t("designer-published") : t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    setShowHistory(true);
    if (revisionsLoaded) return;
    try {
      setRevisions(await api.listPageRevisions(tenantHost, token, page.id as string));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevisionsLoaded(true);
    }
  }

  // Restoring never re-publishes — mirrors the API's own restore route
  // (always writes status:"draft"). Reloads rawBlocks/pageSettings straight
  // from the restored row so the canvas reflects it immediately, same as
  // PostEditorPage's bodyVersion-bump reload after a post restore.
  async function restoreRevision(revisionId: string) {
    if (!confirm(t("designer-restore-confirm"))) return;
    setRestoring(true);
    setError(null);
    try {
      const restored = await api.restorePageRevision(tenantHost, token, page.id as string, revisionId);
      setRawBlocksDirectly(clone((restored.layout as Block[] | undefined) ?? []));
      setPageSettings((restored.settings as PageSettings) ?? {});
      page.status = restored.status as string;
      (page as { layout?: unknown }).layout = restored.layout;
      (page as { settings?: unknown }).settings = restored.settings;
      (page as { bannerImageUrl?: unknown }).bannerImageUrl = restored.bannerImageUrl;
      setDirty(false);
      setShowHistory(false);
      setMsg(t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  // Blueprint's own save path — no slug/status/publish/translations concept,
  // just the layout + page-wide settings, PATCHed straight to the blueprint
  // row (apps/api's PATCH /api/blueprints/:id already accepts both).
  async function saveBlueprint() {
    setBusy(true);
    setError(null);
    try {
      await api.updateBlueprint(tenantHost, token, page.id as string, { layout: clone(rawBlocks), settings: pageSettings });
      setDirty(false);
      setSavedAny(true);
      setMsg(t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Symbol master's own save path (kind === "symbol", see SymbolDesignerRoute
  // in App.tsx) — same shape as saveBlueprint, but unwraps rawBlocks' one
  // throwaway section/row/column shell back down to the bare El node before
  // PATCHing, since that's all `symbols.node` actually stores. Live (no
  // sync/propagate step needed): every page instance resolves this same row
  // at render time, see ElPreview.tsx/SectionBlock.astro's "symbol" case.
  async function saveSymbol() {
    setBusy(true);
    setError(null);
    try {
      const wrapped = rawBlocks[0] as unknown as { props: SectionProps };
      const node = wrapped.props.rows[0].columns[0].elements[0];
      await api.updateSymbol(tenantHost, token, page.id as string, { node: node as unknown as Record<string, unknown> });
      setDirty(false);
      setSavedAny(true);
      setMsg(t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Header/Footer's own save path — same shape as saveBlueprint, just the
  // layout PATCHed to the siteChrome row. isDefault/mobileNav settings are
  // edited via the small standalone panel below the canvas (immediate PATCH
  // through api.updateSiteChrome, same pattern the Header & Footer list's
  // own "Set default" star already uses) — not part of this dirty/Save flow.
  async function saveSiteChrome(status?: "draft" | "published") {
    setBusy(true);
    setError(null);
    try {
      await api.updateSiteChrome(tenantHost, token, page.id as string, {
        layout: clone(rawBlocks),
        ...(status ? { status } : {}),
      });
      if (status) setChromeStatus(status);
      setDirty(false);
      setSavedAny(true);
      setMsg(status === "published" ? t("designer-published") : status === "draft" ? t("header-footer-unpublished") : t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // `translations` payload shape save() itself PATCHes — reused here so
  // Preview's draft override matches exactly what a real Save would send,
  // minus the DB write.
  function currentTranslationsPayload(): Record<string, { overrides: Record<string, Record<string, string>> }> {
    const translations: Record<string, { overrides: Record<string, Record<string, string>> }> = {};
    for (const [code, overrides] of Object.entries(langOverrides)) {
      if (code !== BASE_LANG) translations[code] = { overrides };
    }
    return translations;
  }

  // Only reached when there's unsaved content or the page is a draft — a
  // saved+published page renders a plain <a href target="_blank"> instead,
  // since a real anchor click is a genuine browser navigation and never
  // hits the popup/redirect-blocking heuristic below.
  //
  // No Save first (Elementor/Avada-style: Preview shows whatever's on
  // screen, not whatever's persisted) — the canvas's current in-memory state
  // is sent straight to the preview-token mint, which stashes it in an
  // ephemeral server-side store (see apps/api's live-preview-store.ts) and
  // embeds a reference in the token; nothing is written to pages/blueprints.
  //
  // Two clicks, deliberately, not window.open()+later-navigate: opening a
  // blank tab synchronously then setting its location after this mint's
  // await used to leave a permanently blank about:blank tab in some
  // browsers/settings — script-driven navigation of an already-open window,
  // once any await separates the two, is exactly what a popup/redirect
  // blocker can silently eat, with no error and no console trace. A real
  // anchor click is a genuine user-gesture navigation and has no such window.
  async function mintPreviewLink() {
    setError(null);
    setPreviewMinting(true);
    try {
      const previewToken =
        kind === "blueprint"
          ? await api.getBlueprintPreviewToken(tenantHost, token, page.id as string, {
              layout: clone(rawBlocks),
              settings: pageSettings,
            })
          : await api.getPagePreviewToken(tenantHost, token, page.id as string, {
              layout: clone(rawBlocks),
              settings: pageSettings,
              translations: currentTranslationsPayload(),
            });
      setPreviewLink(
        kind === "blueprint"
          ? api.blueprintPreviewUrl(tenantHost, page.id as string, previewToken)
          : api.previewUrl(tenantHost, page.slug as string, previewToken),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewMinting(false);
    }
  }

  // Modal iframe, not a new tab — no popup blocker to fight, so unlike
  // mintPreviewLink() above this can mint straight into the iframe's src in
  // one call. No Save first either (same draft-override mechanism as
  // mintPreviewLink): the canvas's current in-memory state goes into the
  // token mint, nothing is written to pages/blueprints/site_chrome.
  async function openDevicePreview() {
    setError(null);
    try {
      if (kind === "siteChrome") {
        const previewToken = await api.getSiteChromePreviewToken(tenantHost, token, page.id as string, {
          layout: clone(rawBlocks),
        });
        // Opens at whatever breakpoint the canvas itself is currently
        // previewing (bp) instead of always "desktop" — editing under
        // Mobile/Tablet and hitting Preview used to silently jump back to
        // desktop, a mismatch reported as "preview tak tepat".
        setPreviewModal({
          src: api.chromePreviewUrl(tenantHost, page.id as string, chromeKind as "header" | "footer", { previewToken }),
          device: bp,
        });
        return;
      }
      const previewToken =
        kind === "blueprint"
          ? await api.getBlueprintPreviewToken(tenantHost, token, page.id as string, { layout: clone(rawBlocks), settings: pageSettings })
          : await api.getPagePreviewToken(tenantHost, token, page.id as string, {
              layout: clone(rawBlocks),
              settings: pageSettings,
              translations: currentTranslationsPayload(),
            });
      const src =
        kind === "blueprint"
          ? api.blueprintPreviewUrl(tenantHost, page.id as string, previewToken)
          : api.previewUrl(tenantHost, page.slug as string, previewToken);
      // Same bp-matches-canvas fix as the siteChrome branch above.
      setPreviewModal({ src, device: bp });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return {
    showHistory, setShowHistory, revisions, revisionsLoaded, restoring,
    renameSlug, save, loadHistory, restoreRevision, saveBlueprint, saveSymbol, saveSiteChrome,
    currentTranslationsPayload, mintPreviewLink, openDevicePreview,
  };
}
