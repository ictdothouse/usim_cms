// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — NEW concern vs. that spec:
// the "save this Designer document" family grew past a single page-save
// since it was written (revision history, blueprint/symbol/siteChrome save
// paths, the preview-token minting flows). Groups renameSlug/save/
// saveBlueprint/saveSymbol/saveSiteChrome (the kind-specific persistence
// paths), page revision history, and the two preview-token mint flows.
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as api from "@/lib/api";
import { slugify, clone } from "@/lib/utils";
import type { Key } from "@/i18n";
import { BASE_LANG } from "../context";
import type { Block, PageSettings, SectionProps, Seo } from "../types";

type PreviewModalState = { src: string; device: "desktop" | "tablet" | "mobile"; orientation: "portrait" | "landscape" } | null;

export interface PersistDeps {
  tenantHost: string;
  token: string;
  page: { id?: unknown; slug?: unknown; status?: unknown; draft?: unknown };
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  bp: "desktop" | "tablet" | "mobile";
  chromeKind: "header" | "footer" | undefined;
  setChromeStatus: (s: "draft" | "published") => void;
  rawBlocks: Block[];
  setRawBlocksDirectly: (next: Block[]) => void;
  pageSettings: PageSettings;
  setPageSettings: (s: PageSettings) => void;
  pageSeo: Seo;
  pageLanguage: string;
  pageMultilangEnabled: boolean;
  langOverrides: Record<string, Record<string, Record<string, string>>>;
  slugDraft: string;
  setSlugDraft: (v: string) => void;
  setEditingSlug: (v: boolean) => void;
  setSlugError: (v: string | null) => void;
  dirty: boolean;
  setDirty: (v: boolean) => void;
  setHasDraft: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setSavedAny: (v: boolean) => void;
  setMsg: (v: string | null) => void;
  previewModal: PreviewModalState;
  setPreviewModal: Dispatch<SetStateAction<PreviewModalState>>;
  t: (k: Key) => string;
}

export function usePersist(deps: PersistDeps) {
  const {
    tenantHost, token, page, kind, bp, chromeKind, setChromeStatus,
    rawBlocks, setRawBlocksDirectly, pageSettings, setPageSettings, pageSeo,
    pageLanguage, pageMultilangEnabled, langOverrides,
    slugDraft, setSlugDraft, setEditingSlug, setSlugError,
    dirty, setDirty, setHasDraft, setBusy, setError, setSavedAny, setMsg,
    previewModal, setPreviewModal, t,
  } = deps;

  // Latest-render mirror of the editable state — a save captures what it
  // SENT at its own start, and on completion only clears `dirty` if nothing
  // has changed since (immer gives every edit a new rawBlocks identity). An
  // edit made while a save was in flight would otherwise be marked clean and
  // silently never autosaved.
  const latest = useRef({ rawBlocks, pageSettings, pageSeo, langOverrides, pageLanguage, pageMultilangEnabled });
  latest.current = { rawBlocks, pageSettings, pageSeo, langOverrides, pageLanguage, pageMultilangEnabled };
  function unchangedSince(sent: typeof latest.current) {
    const now = latest.current;
    return (
      now.rawBlocks === sent.rawBlocks &&
      now.pageSettings === sent.pageSettings &&
      now.pageSeo === sent.pageSeo &&
      now.langOverrides === sent.langOverrides &&
      now.pageLanguage === sent.pageLanguage &&
      now.pageMultilangEnabled === sent.pageMultilangEnabled
    );
  }

  // Every write goes through one chain, in call order — autosave, an
  // explicit Update, and Preview's own pre-mint flush can all fire close
  // together, and two overlapping PATCHes could otherwise land out of order
  // (an older snapshot overwriting a newer one).
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  function queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.current.then(fn, fn);
    chain.current = run.catch(() => undefined);
    return run;
  }

  // Bumped after every successful write — the open Preview modal re-mints
  // off this (below), so it refreshes exactly when the DB it renders from
  // actually changed, instead of on its own independent timer.
  const [savedTick, setSavedTick] = useState(0);
  // Same counter, readable synchronously — lets the refresh effect skip a
  // re-mint the open Preview already reflects (e.g. the flush openDevice-
  // Preview just did before its own first mint).
  const savedTickRef = useRef(0);
  const lastMintedTick = useRef(-1);
  function markSaved() {
    savedTickRef.current += 1;
    setSavedTick(savedTickRef.current);
  }
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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

  // The editable page fields, as one payload — the live columns on a real
  // save, or the pages.draft blob (apps/api migration 0029) on a draft save.
  // `rawBlocks` is always the shared base tree regardless of which language
  // pill happens to be active, since editing under a non-base pill never
  // touches `rawBlocks` in the first place.
  // Reads `latest.current`, not this render's closure: a queued save runs
  // after whatever was queued before it, by which point a newer render may
  // exist — it must send the newest state, never the snapshot from whenever
  // it happened to be queued (that's how an older draft could overwrite a
  // newer one).
  function pageContentPayload() {
    const s = latest.current;
    return {
      layout: clone(s.rawBlocks),
      translations: currentTranslationsPayload(),
      settings: s.pageSettings,
      seo: s.pageSeo,
      language: s.pageLanguage || null,
      multilangEnabled: s.pageMultilangEnabled,
    };
  }

  // Writes the LIVE columns (what real visitors see) and clears any pending
  // draft — this is Publish/Update, and also the plain autosave for a page
  // that isn't published yet (nobody outside the admin can see it anyway).
  function save(status?: "published") {
    return queued(async () => {
      const sent = latest.current;
      setBusy(true);
      setError(null);
      try {
        await api.updatePage(tenantHost, token, page.id as string, {
          ...pageContentPayload(),
          draft: null,
          ...(status ? { status, publishedAt: new Date().toISOString() } : {}),
        });
        if (status) page.status = status;
        page.draft = null;
        setHasDraft(false);
        if (unchangedSince(sent)) setDirty(false);
        setSavedAny(true);
        markSaved();
        setMsg(status ? t("designer-published") : t("designer-saved"));
        setTimeout(() => setMsg(null), 2500);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  // Canva-style autosave for an already-published page: persists the
  // in-progress edit to pages.draft only — the live columns (what visitors
  // see) stay untouched until an explicit Update. Preview renders this same
  // row via a preview token, so it shows exactly what's on the canvas
  // without anything going live first. No toast: the header badge already
  // says "Draft saved — not published".
  function saveDraft() {
    return queued(async () => {
      const sent = latest.current;
      setBusy(true);
      setError(null);
      try {
        const draft = pageContentPayload();
        await api.updatePage(tenantHost, token, page.id as string, { draft });
        page.draft = draft;
        setHasDraft(true);
        if (unchangedSince(sent)) setDirty(false);
        setSavedAny(true);
        markSaved();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
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
      // apps/api's restore also clears pages.draft (see pagesCollection's
      // revisions.restore) — mirror it so the badge/Update state agrees.
      page.draft = null;
      setHasDraft(false);
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
  function saveBlueprint() {
    return queued(async () => {
      const sent = latest.current;
      setBusy(true);
      setError(null);
      try {
        await api.updateBlueprint(tenantHost, token, page.id as string, {
          layout: clone(latest.current.rawBlocks),
          settings: latest.current.pageSettings,
        });
        if (unchangedSince(sent)) setDirty(false);
        setSavedAny(true);
        markSaved();
        setMsg(t("designer-saved"));
        setTimeout(() => setMsg(null), 2500);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
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

  // `translations` payload shape save()/saveDraft() PATCH.
  function currentTranslationsPayload(): Record<string, { overrides: Record<string, Record<string, string>> }> {
    const translations: Record<string, { overrides: Record<string, Record<string, string>> }> = {};
    for (const [code, overrides] of Object.entries(latest.current.langOverrides)) {
      if (code !== BASE_LANG) translations[code] = { overrides };
    }
    return translations;
  }

  // Tags the iframe src with the device it's about to be framed in (skipped
  // for desktop, which gets no bezel/scrollbar-hiding treatment at all) —
  // apps/frontend's BaseLayout reads this same param to hide its own
  // scrollbar and turn on mouse drag-scrolling, since the modal's bezel
  // mockup has no room for a real scrollbar and a desktop mouse has no touch
  // to drag-scroll with otherwise. src is always an absolute URL with at
  // least a `token` param already on it (every caller below passes a fresh
  // previewToken), so this always has a `?` to build on.
  function withDeviceFrame(src: string, device: "desktop" | "tablet" | "mobile") {
    if (device === "desktop") return src;
    const url = new URL(src);
    url.searchParams.set("deviceFrame", device);
    return url.toString();
  }

  // The one autosave target per kind (Designer.tsx's debounced autosave
  // effect, Live Edit's reload, and Preview's pre-mint flush all call this) —
  // a published page autosaves to its pages.draft only (Canva-style: never
  // live until Update), an unpublished page/blueprint/symbol/header-footer
  // writes its own row as before.
  function autosave() {
    if (kind === "page") return page.status === "published" ? saveDraft() : save();
    if (kind === "blueprint") return saveBlueprint();
    if (kind === "symbol") return saveSymbol();
    return saveSiteChrome();
  }

  // Mints a fresh, un-framed preview URL — the shared core both
  // openDevicePreview (first open, resets device/orientation to match the
  // canvas's own bp) and the refresh effect below (already-open modal,
  // device/orientation left alone) build on.
  //
  // Page/blueprint: flush any pending edit to the DB FIRST, then mint a
  // plain token — the preview renders the exact same row (pages.draft for a
  // published page, the row itself otherwise) Live Edit's own autosave
  // writes, so Preview can never show something the canvas doesn't. This
  // replaced handing the in-memory state to an ephemeral per-process store
  // (apps/api's live-preview-store.ts), which silently fell back to the
  // last REAL save whenever the mint and the render's read-back landed on
  // different api replicas — reported as "Preview only matches after
  // Update". Header/footer keeps that ephemeral path: a published one has no
  // draft column of its own yet (follow-up if asked).
  async function mintPreviewSrc(): Promise<{ src: string; tick: number }> {
    if (kind === "siteChrome") {
      const previewToken = await api.getSiteChromePreviewToken(tenantHost, token, page.id as string, {
        layout: clone(latest.current.rawBlocks),
      });
      return {
        src: api.chromePreviewUrl(tenantHost, page.id as string, chromeKind as "header" | "footer", { previewToken }),
        tick: savedTickRef.current,
      };
    }
    if (dirtyRef.current) await autosave();
    const tick = savedTickRef.current;
    const previewToken =
      kind === "blueprint"
        ? await api.getBlueprintPreviewToken(tenantHost, token, page.id as string)
        : await api.getPagePreviewToken(tenantHost, token, page.id as string);
    return {
      src:
        kind === "blueprint"
          ? api.blueprintPreviewUrl(tenantHost, page.id as string, previewToken)
          : api.previewUrl(tenantHost, page.slug as string, previewToken),
      tick,
    };
  }

  // Modal iframe, not a new tab — no popup blocker to fight.
  async function openDevicePreview() {
    setError(null);
    try {
      const { src, tick } = await mintPreviewSrc();
      lastMintedTick.current = tick;
      // Opens at whatever breakpoint the canvas itself is currently
      // previewing (bp) instead of always "desktop" — editing under
      // Mobile/Tablet and hitting Preview used to silently jump back to
      // desktop, a mismatch reported as "preview tak tepat".
      setPreviewModal({ src: withDeviceFrame(src, bp), device: bp, orientation: "portrait" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Refresh while the modal stays open — page/blueprint re-mint right after
  // each successful save (savedTick), i.e. exactly when the row Preview
  // renders actually changed, never on an independent timer that could race
  // the save. Skipped when the open frame already reflects that save (the
  // flush openDevicePreview itself just did). Header/footer, still on the
  // ephemeral path, re-mints off its in-memory canvas state instead.
  // Device/orientation are left exactly as the viewer has them.
  useEffect(() => {
    if (!previewModal) return;
    if (kind !== "siteChrome" && lastMintedTick.current === savedTickRef.current) return;
    const timer = setTimeout(
      () => {
        void mintPreviewSrc()
          .then(({ src, tick }) => {
            lastMintedTick.current = tick;
            setPreviewModal((m) => (m ? { ...m, src: withDeviceFrame(src, m.device) } : m));
          })
          .catch(() => {
            // Best-effort — a failed background refresh just leaves the
            // modal showing its last-good render rather than surfacing an
            // error over a still-open, still-usable preview.
          });
      },
      kind === "siteChrome" ? 900 : 0,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick, kind === "siteChrome" ? rawBlocks : null]);

  return {
    showHistory, setShowHistory, revisions, revisionsLoaded, restoring,
    renameSlug, save, saveDraft, autosave, loadHistory, restoreRevision, saveBlueprint, saveSymbol, saveSiteChrome,
    currentTranslationsPayload, openDevicePreview, withDeviceFrame,
  };
}
