import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as api from "@/lib/api";
import { GOOGLE_FONTS, clone } from "@/lib/utils";
import type { Key } from "@/i18n";
import { moveSection, moveColumn } from "./designerTree";
import { section } from "./designer/blockPath";
import type { FieldGroupKey, SectionProps, Block, Sel } from "./designer/types";
import { BASE_LANG, type DesignerCtx } from "./designer/context";
import { useClipboard } from "./designer/hooks/useClipboard";
import { useUndoRedo } from "./designer/hooks/useUndoRedo";
import { useBpStyle } from "./designer/hooks/useBpStyle";
import { useLiveEditBridge } from "./designer/hooks/useLiveEditBridge";
import { useBlockOps } from "./designer/hooks/useBlockOps";
import { useTemplateLibrary } from "./designer/hooks/useTemplateLibrary";
import { usePageAndLanguage } from "./designer/hooks/usePageAndLanguage";
import { useSiteChrome } from "./designer/hooks/useSiteChrome";
import { usePersist } from "./designer/hooks/usePersist";
import { useStableFns } from "./designer/hooks/useStableFn";
import MediaPickerModal from "./MediaPickerModal";
import { DesignerTopBar } from "./designer/DesignerTopBar";
import { DesignerPalette } from "./designer/DesignerPalette";
import { DesignerCanvas } from "./designer/DesignerCanvas";
import { DesignerTemplatesModal } from "./designer/DesignerTemplatesModal";
import { DesignerHistoryModal } from "./designer/DesignerHistoryModal";
import { DesignerDevicePreviewModal } from "./designer/DesignerDevicePreviewModal";
import { DeviceViewport } from "./designer/DeviceViewport";

export default function Designer({
  page,
  tenantHost,
  token,
  t,
  onClose,
  isSuper,
  kind = "page",
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  onClose: (saved: boolean) => void;
  isSuper: boolean;
  // "blueprint" strips everything that assumes a real published page with a
  // live frontend route (slug, publish status, Live Edit, Preview) — a
  // blueprint has no route of its own to preview/live-edit against. Blocks
  // canvas editing, Undo/Redo, Templates, and Page Settings all work
  // unchanged either way. "siteChrome" (header/footer designer) gets the
  // same treatment as "blueprint" for slug/publish/Live-Edit, minus the
  // device-preview button too — a header/footer has no preview-token route
  // of its own yet (a real, scoped-out-for-now follow-up), Blocks-mode
  // canvas editing is enough for v1.
  // "symbol" (a live-linked component's own master, see SymbolDesignerRoute
  // in App.tsx) gets the same no-slug/no-publish treatment as "blueprint" —
  // Save just PATCHes the symbol's node, no Preview/Live-Edit (a bare
  // component has no route of its own to preview).
  kind?: "page" | "blueprint" | "siteChrome" | "symbol";
}) {
  // Reopen onto an autosaved-but-unpublished edit (pages.draft, apps/api
  // migration 0029 — a published page's autosave target, see usePersist's
  // saveDraft) instead of the live content: overlaid onto `page` itself,
  // once, before ANY state below seeds from page.layout/settings/seo/
  // translations/language/multilangEnabled, so every one of those seed sites
  // picks the draft up with no per-site change (Canva-style: you come back
  // to exactly where you left off, published or not). Mutates the same
  // object the rest of this file already treats as a plain mutable record.
  const draftMerged = useRef(false);
  if (!draftMerged.current) {
    draftMerged.current = true;
    if (kind === "page" && page.draft && typeof page.draft === "object") Object.assign(page, page.draft);
  }
  const [hasDraft, setHasDraft] = useState(() => kind === "page" && !!page.draft);
  // Declared ahead of the useUndoRedo() call below, which needs it.
  const [dirty, setDirty] = useState(false);
  // Bumped by every structural (shape/order-changing) mutate() call reachable
  // from Live Edit — duplicate/paste/delete at any level, plus the iframe's
  // own drag-reorder. Live Edit's iframe is a real server-rendered page, not
  // a local render of `blocks`, so unlike a prop/style edit a shape change
  // needs an actual reload to become visible (useLiveEditBridge's own
  // debounced-reload effect). Declared here, not inside useLiveEditBridge,
  // because useUndoRedo (called first, below) also needs bumpStructural —
  // owning it in useLiveEditBridge would make the two hooks depend on each
  // other circularly.
  const [structuralTick, setStructuralTick] = useState(0);
  function bumpStructural() {
    setStructuralTick((n) => n + 1);
  }
  // The Blocks/Live-Edit canvas used to be an iframe of the real frontend, so
  // it always showed the tenant's actual theme colors/fonts. Once that became
  // an in-app canvas (see mode === "live" below), it lost that for-free theme
  // parity — this fetches the same merged theme apps/frontend reads and
  // reapplies it as the same CSS custom properties BaseLayout.astro sets, so
  // the canvas approximates the real site again instead of always showing
  // Tailwind's default white/black.
  const [siteTheme, setSiteTheme] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    api.getTheme(tenantHost, token).then(setSiteTheme).catch(() => {});
  }, [tenantHost, token]);
  const [sel, setSel] = useState<Sel>(null);
  // True base tree — always the shared, single source of truth for structure
  // AND style, regardless of which language pill is active (see `blocks`
  // below, and the `langOverrides` state further down, for how a
  // non-base-language view is derived from this without ever mutating it
  // directly). Only `mutate`/`startSpacingDrag`/`undo`/`redo` — and save() —
  // touch this state directly; everything else in this file reads/renders
  // the memoized `blocks` view instead.
  // Figma-style spacing overlay: the hatched fill band only shows while the
  // matching handle is hovered or actively dragged, not for the whole
  // selected box's perimeter at once — a persistent 4-sided hatch on every
  // selection was too visually noisy (user feedback). The small "Npx" badge
  // itself still always shows once selected; only the colored band is gated.
  // Declared ahead of the useUndoRedo() call below, which needs its setter.
  const [hoverBand, setHoverBand] = useState<string | null>(null);
  const {
    rawBlocks,
    mutate,
    setRawBlocksDirectly,
    startSpacingDrag,
    undo,
    redo,
    draggingBand,
  } = useUndoRedo(clone((page.layout as Block[] | undefined) ?? []), setDirty, setSel, bumpStructural, setHoverBand);
  const [activeLeftTab, setActiveLeftTab] = useState<"elements" | "layers" | "settings">("elements");
  // Sprint 2: below `lg` the palette/inspector asides become off-canvas
  // drawers (same pattern as Shell's mobile nav) instead of the fixed
  // 3-column layout — `null` means both are closed.
  const [mobilePanel, setMobilePanel] = useState<"palette" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Grouped Styles panel: which Inspector field-groups are collapsed. Shared
  // across every selection (not reset per-select) — matches Framer/Webflow,
  // where collapsing "Typography" stays collapsed while you click around.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<FieldGroupKey>>(new Set(["advanced"]));
  // Element Inspector only — Content (raw data: text/src/href/items/etc) vs
  // Style (spacing + every other GROUP_META bucket) tabs, so a long element
  // like Heading doesn't force scrolling past Padding/Margin/Typography just
  // to reach the Text field, or vice versa.
  const [inspectorTab, setInspectorTab] = useState<"content" | "style">("content");
  function toggleGroup(g: FieldGroupKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  const {
    bp,
    setBp,
    bpKey,
    bpGetValue,
    bpKeysOverridden,
    toggleBpKeys,
    sideValue,
    linkedPadding,
    setLinkedPadding,
    linkedRadius,
    setLinkedRadius,
    linkedMargin,
    setLinkedMargin,
  } = useBpStyle();

  const {
    blocks,
    pageSettings, setPageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageCanvasColor, setPageThemePreset, themePresets,
    pageSeo, setPageSeo,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled,
    siteLanguages, pageLanguage, setPageLanguage,
    activeLang, hasLangSlot, clickPageLanguagePill, translating, retranslatePageLanguage,
    langOverrides, isTextKey, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
  } = usePageAndLanguage({ rawBlocks, page, tenantHost, token, bp, bpKey, setDirty, setSel });
  // Page Settings' Theme picker snapshots a preset onto pageSettings.theme
  // (setPageThemePreset, above) — the canvas below used to read siteTheme
  // (the SITE-WIDE default) directly, so a page using a non-default preset
  // rendered the wrong colors/fonts here while the published site correctly
  // merged the two (apps/frontend's [...slug].astro: `{ ...siteTheme,
  // ...page.settings.theme }`) — mirrored exactly here so Live Edit and the
  // real page agree again.
  const effectiveTheme = pageSettings.theme ? { ...siteTheme, ...pageSettings.theme } : siteTheme;
  function fourSideValue(sp: SectionProps, perSideKey: string, fallbackKey: string): string {
    return sideValue(sp as unknown as Record<string, string>, sp.bp, perSideKey, fallbackKey);
  }
  function setFourSideValue(b: number, perSideKey: string, value: string) {
    const path = pathKey(b);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
    mutate((bs) => {
      const block = bs[b];
      if (bp === "desktop") {
        (block.props as Record<string, unknown>)[perSideKey] = value;
      } else {
        const props = block.props as unknown as SectionProps;
        props.bp = { ...(props.bp ?? {}), [bpKey(perSideKey)]: value };
      }
    });
  }
  function setColSideValue(b: number, r: number, c: number, perSideKey: string, value: string) {
    const path = pathKey(b, r, c);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c];
      if (bp === "desktop") target.props = { ...(target.props ?? {}), [perSideKey]: value };
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function setElSideValue(b: number, r: number, c: number, e: number, perSideKey: string, value: string) {
    const path = pathKey(b, r, c, e);
    if (activeLang !== BASE_LANG && langKeysOverridden(path, [perSideKey])) {
      setLangValue(path, perSideKey, value);
      return;
    }
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c].elements[e];
      if (bp === "desktop") target.props[perSideKey] = value;
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  const [treeDropHint, setTreeDropHint] = useState<{ key: string; pos: "before" | "after" } | null>(null);
  // True from the moment any iframe (re)load starts (initial open, mode
  // toggle back into Live, or a debounced structural/style reload) until
  // its onLoad fires — covers the skeleton overlay below so a reload never
  // shows the browser's own blank-frame flash, however brief.
  const [reloading, setReloading] = useState(false);
  const [savedAny, setSavedAny] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  // Modal device preview (Desktop/Tablet/Mobile) — separate from preview()'s
  // new-tab flow below: that one is a real browser navigation for a page's
  // published-and-clean case, this one is for blueprints (no public URL to
  // navigate to) and for anyone who'd rather check breakpoints without
  // leaving the Designer.
  const [previewModal, setPreviewModal] = useState<{
    src: string;
    device: "desktop" | "tablet" | "mobile";
    orientation: "portrait" | "landscape";
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ path: number[]; x: number; y: number } | null>(null);
  const [iconSearch, setIconSearch] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(page.slug as string);
  const [slugError, setSlugError] = useState<string | null>(null);
  const {
    chromeKind, chromeStatus, setChromeStatus, chromeIsDefault, chromeMobileNav, patchChromeMeta,
    availableHeaders, availableFooters,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, patchPageChrome,
    resolvedHeaderId, resolvedFooterId, headerFrameHeight, footerFrameHeight,
  } = useSiteChrome({ tenantHost, token, page, kind, setError, bumpStructural });

  const {
    showHistory, setShowHistory, revisions, revisionsLoaded, restoring,
    renameSlug, save, autosave, loadHistory, restoreRevision, saveBlueprint, saveSymbol, saveSiteChrome,
    openDevicePreview, withDeviceFrame,
  } = usePersist({
    tenantHost, token, page, kind, bp, chromeKind, setChromeStatus,
    rawBlocks, setRawBlocksDirectly, pageSettings, setPageSettings, pageSeo,
    pageLanguage, pageMultilangEnabled, langOverrides,
    slugDraft, setSlugDraft, setEditingSlug, setSlugError,
    dirty, setDirty, setHasDraft, setBusy, setError, setSavedAny, setMsg,
    previewModal, setPreviewModal, t,
  });

  // Autosave: debounced silent save while dirty (usePersist's autosave()
  // picks the target). A PUBLISHED page autosaves to its pages.draft only —
  // the live columns visitors read stay untouched until an explicit Update,
  // so autosave still can never push an unreviewed edit onto the live site,
  // while Preview (which renders that draft) always matches the canvas.
  // Draft pages/blueprints/symbols write their own row (nothing public to
  // protect). A published header/footer still only saves on its explicit
  // Publish click — it has no draft column of its own yet.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const eligible = kind !== "siteChrome" || chromeStatus !== "published";
    if (!dirty || !eligible || busy) return;
    autosaveTimerRef.current = setTimeout(() => void autosave(), 1000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, busy, kind, page.status, chromeStatus, rawBlocks, pageSettings]);

  // "menu" element's Inspector needs a live list to populate its menuId
  // picker — dynamic per-tenant data, unlike every other field here which
  // is a static enum, so it's fetched once (like siteLanguages above) rather
  // than baked into ELS.menu.fields' static `options`.
  const [availableMenus, setAvailableMenus] = useState<api.Menu[]>([]);
  useEffect(() => {
    void api.listMenus(tenantHost, token).then(setAvailableMenus);
  }, [tenantHost]);
  // "postlist" element's categoryId picker (Sprint 5, docs/laporan-audit-ui-ux.md
  // section 5.6) — same live-fetched-once-per-tenant shape as availableMenus.
  const [availableCategories, setAvailableCategories] = useState<api.Category[]>([]);
  useEffect(() => {
    void api.listCategories(tenantHost, token).then(setAvailableCategories);
  }, [tenantHost]);
  // "symbol" element's symbolId picker — same live-fetched-once-per-tenant
  // shape as availableMenus above. ponytail: fetched once per Designer
  // mount, so an "Edit Master" save in another tab won't refresh this list
  // until reload — fine at this scale, upgrade to refetch-on-focus if it
  // becomes annoying.
  const [availableSymbols, setAvailableSymbols] = useState<api.Symbol[]>([]);
  useEffect(() => {
    void api.listSymbols(tenantHost, token).then(setAvailableSymbols);
  }, [tenantHost]);
  const editingText = useRef<Record<string, string>>({});
  // Which slide each slider element is previewing on the Blocks canvas, keyed
  // by element id (a page can hold several sliders). The canvas used to
  // hard-code slides[0], so adding content to slide 2+ appeared to do nothing
  // at all: the Inspector edits every slide, the canvas only ever drew the
  // first one. The dots along the bottom of the preview drive this now
  // instead of being decorative.
  const [sliderSlideIdx, setSliderSlideIdx] = useState<Record<string, number>>({});
  // Which nested row/column/element inside the CURRENTLY-PREVIEWED slide is
  // selected for editing, keyed by the slider element's own id — separate
  // from Designer's own global `sel` (which only ever addresses
  // section/row/column/element paths, never reaches inside a slide). Set by
  // clicking a Text/Button/Image/Row chip on the slide's own mini-canvas;
  // read by Inspector to show that nested element's own Content/Style tabs
  // instead of the slider's own fields.
  const [sliderInnerSel, setSliderInnerSel] = useState<Record<string, { r: number; c: number; e: number } | null>>({});
  // Canvas-direct edit mode for a nested slide heading/text child, keyed by
  // that child's own id — see designer/context.ts's DesignerCtx comment for
  // why this can't just reuse sliderInnerSel/editingText directly.
  const [sliderInnerEditing, setSliderInnerEditing] = useState<Record<string, boolean>>({});

  // The Settings/Inspector tab shares the left sidebar with Elements/Layers
  // now (previously a permanently-visible right-hand aside) — without this,
  // clicking a section/row/column/element (or a slider's own nested child)
  // would update Inspector's content invisibly behind whichever tab the
  // author was already on. Jumps to Settings on any new selection so the
  // click-to-edit flow still feels immediate.
  useEffect(() => {
    if (sel || Object.values(sliderInnerSel).some(Boolean)) setActiveLeftTab("settings");
  }, [sel, sliderInnerSel]);

  // Auto-expand the Layers tree around the current selection so switching to
  // the tab, or changing selection via the canvas/Live Edit, always reveals
  // the selected row without requiring a manual expand-click first.
  useEffect(() => {
    if (!sel) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= sel.length; i++) next.add(sel.slice(0, i).join("."));
      return next;
    });
  }, [sel]);

  // Forces a re-render on window resize so LiveEditToolbar's position (which
  // reads liveFrame.current.getBoundingClientRect() directly at render time,
  // not from state) picks up the iframe's new page position even when
  // selectedRect itself hasn't changed.
  const [, bumpLayoutTick] = useState(0);
  useEffect(() => {
    const onResize = () => bumpLayoutTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas } = useClipboard();

  const {
    drag,
    isSectionLocked,
    duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
    duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
    deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
    dropIntoColumn,
  } = useBlockOps({
    blocks,
    mutate,
    setSel,
    bumpStructural,
    isSuper,
    t,
    clipboard: { clipCopy, clipRead, styleCopy, styleRead },
    setDropHint,
  });

  const templateLibrary = useTemplateLibrary({
    blocks,
    mutate,
    sel,
    bumpStructural,
    isSectionLocked,
    t,
    tenantHost,
    token,
    pageSettings,
    availableSymbols,
    setAvailableSymbols,
    setError,
  });
  // Only these 6 are read directly in this file (TopBar/stableFns/the
  // device-preview modal's context menu) — everything else templateLibrary
  // returns (showTemplates, templates, blueprintName, etc.) is consumed
  // entirely through the `{...templateLibrary}` spread onto
  // DesignerTemplatesModal below, so destructuring those individually here
  // too would just be unused locals.
  const { openTemplates, templateKind, saveAsTemplate, makeComponent, detachSymbolInstance, setShowSaveBlueprint } = templateLibrary;

  const {
    mode,
    toggleLive,
    liveSrcA,
    liveSrcB,
    activeSlot,
    frameARef,
    frameBRef,
    handleFrameLoad,
  } = useLiveEditBridge({
    bp,
    sliderSlideIdx,
    sliderInnerSel,
    blocks,
    mutate,
    sel,
    setSel,
    undo,
    redo,
    structuralTick,
    bumpStructural,
    isSectionLocked,
    t,
    tenantHost,
    token,
    pageId: page.id as string,
    pageSlug: page.slug as string,
    kind,
    dirty,
    // autosave, not save(): Live Edit's reload flush used to call the real
    // save(), which on a PUBLISHED page wrote the in-progress edit straight
    // onto the live site without an Update click. autosave() routes a
    // published page to its pages.draft instead (see usePersist).
    save: autosave,
    saveBlueprint,
    setError,
    setReloading,
    setCtxMenu,
    setSliderSlideIdx,
    setSliderInnerSel,
  });

  // Desktop only gets a boxed reading-width canvas (and the backdrop that
  // marks it) when the page itself is set to "contained" content width —
  // a page set to "full" is meant to render edge-to-edge at desktop, so
  // boxing the Blocks-mode canvas there would show a backdrop around
  // content that never actually has any dead space to mark. Tablet/mobile
  // bp simulation always boxes (a narrower box is the whole point of
  // simulating a smaller screen, independent of contentWidth), and Live
  // Edit at desktop stays edge-to-edge same as before.
  const desktopBoxed = (pageSettings.contentWidth ?? "contained") !== "full";
  const isCanvasMode = bp !== "desktop" || (mode !== "live" && desktopBoxed);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Preloads the whole curated GOOGLE_FONTS list as one stylesheet so the
  // Typography font picker's dropdown can render every option in its own
  // face (not just whichever font is already applied somewhere) — same
  // batched-<link> approach ThemeForm uses for its own font pickers
  // (App.tsx, id="admin-font-picker-preview"), guarded by the same id since
  // this admin build never mounts both pages at once but the guard is free.
  useEffect(() => {
    if (document.getElementById("admin-font-picker-preview")) return;
    const link = document.createElement("link");
    link.id = "admin-font-picker-preview";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map((f) => `family=${encodeURIComponent(f)}`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, []);

  // Keeps a Google Font <link> in document.head for every distinct
  // fontFamily in use, so the canvas preview approximates the real render
  // (SectionBlock.astro/[...slug].astro do the equivalent server-side) —
  // covers fonts picked outside the curated GOOGLE_FONTS list above (hand-typed
  // names), which the batched preload doesn't include.
  useEffect(() => {
    const fonts = new Set<string>();
    for (const block of blocks) {
      if (block.type !== "section") continue;
      for (const row of (block.props as unknown as SectionProps).rows ?? []) {
        for (const col of row.columns ?? []) {
          for (const el of col.elements ?? []) {
            if ((el.type === "heading" || el.type === "text" || el.type === "list") && el.props.fontFamily) {
              fonts.add(el.props.fontFamily);
            }
          }
        }
      }
    }
    fonts.forEach((f) => {
      const selector = `link[data-designer-font="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(f) : f}"]`;
      if (document.querySelector(selector)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.designerFont = f;
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}&display=swap`;
      document.head.appendChild(link);
    });
  }, [blocks]);

  // Opens straight into the Blocks canvas by default — same-document
  // React state + native drag/drop, an editing APPROXIMATION of the page.
  // The Live toggle (DesignerTopBar) mounts the real server-rendered page
  // (useLiveEditBridge's double-buffered iframes, BaseLayout.astro's
  // designerEdit bridge) inside the same DeviceViewport Preview uses, so
  // Live Edit and Preview are the same render at the same viewport.

  function close() {
    if (dirty && !confirm(t("designer-unsaved"))) return;
    onClose(savedAny);
  }

  // ---------- selection helpers ----------
  const selEq = (p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);
  const selCls = (p: number[]) =>
    selEq(p) ? "outline outline-2 outline-accent" : "outline outline-1 outline-transparent hover:outline-accent/30";

  function pick(e: React.MouseEvent, p: number[]) {
    e.stopPropagation();
    setSel(p);
  }

  // ---------- layers tree ----------
  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function rowDragProps(kind: "section" | "column" | "element", path: number[], key: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        if (kind === "element") drag.current = { kind: "move", path };
        else drag.current = { kind: "tree-reorder", treeKind: kind, path };
      },
      onDragEnd: () => (drag.current = null),
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        setTreeDropHint({ key, pos });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const d = drag.current;
        drag.current = null;
        const hint = treeDropHint;
        setTreeDropHint(null);
        if (!d || !hint) return;
        if (kind === "element" && d.kind === "move") {
          dropIntoColumn([path[0], path[1], path[2]], hint.pos === "before" ? path[3] : path[3] + 1);
          return;
        }
        if (d.kind !== "tree-reorder" || d.treeKind !== kind) return;
        // Column reorder is scoped to within the same row — a row's grid-template
        // and each column's span are only meaningful there. Cross-row drags no-op.
        if (kind === "column" && (d.path[0] !== path[0] || d.path[1] !== path[1])) return;
        const to = hint.pos === "before" ? path[path.length - 1] : path[path.length - 1] + 1;
        const from = d.path[d.path.length - 1];
        const adjustedTo = from < to ? to - 1 : to;
        if (kind === "section") {
          mutate((bs) => moveSection(bs, from, adjustedTo));
        } else {
          if (isSectionLocked(path[0])) {
            toast.error(t("designer-section-locked-toast"));
            return;
          }
          mutate((bs) => moveColumn(bs, path[0], path[1], from, adjustedTo));
        }
      },
    };
  }

  // ---------- inspector ----------
  // Media library picker (docs/SliderProblem.pdf #3 — an image field should
  // let an author pick an already-uploaded file, not just paste a URL or
  // upload a fresh one) — holds the pending onSelect callback for whichever
  // field opened it; reuses the same MediaPickerModal PostEditorPage's own
  // feature-image picker already renders.
  const [mediaPickerCallback, setMediaPickerCallback] = useState<((url: string) => void) | null>(null);
  function openMediaPicker(onSelect: (url: string) => void) {
    setMediaPickerCallback(() => onSelect);
  }

  async function uploadImage(file: File, setValue: (v: string) => void) {
    setUploading(true);
    try {
      setValue(api.publicMediaBase(tenantHost) + (await api.uploadMedia(tenantHost, token, file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  // React.memo on ElPreview/Inspector (Layer (a)) only bails on a render
  // where EVERY prop keeps its identity — every mutator below is otherwise a
  // fresh closure every render (none of the owning hooks memoize their own
  // return values), so without this, memo would never bail on an edit
  // elsewhere in the tree. useStableFns wraps each one in a permanently-
  // stable ref-passthrough instead of a hand-tracked useCallback dependency
  // array per function — several of these call through 2-3 layers of other
  // unmemoized functions (bumpStructural, isSectionLocked), where a missed
  // transitive dependency would silently reintroduce a stale closure; a
  // ref-passthrough can't have that bug by construction.
  const stableFns = useStableFns({
    mutate, isSectionLocked,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue,
    toggleGroup, uploadImage, openMediaPicker,
    setPageGap, setPageContentWidth, setPagePaddingX, setPageCanvasColor, setPageThemePreset, setPageSeo, patchPageChrome,
    hasLangSlot, clickPageLanguagePill, retranslatePageLanguage,
    langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement,
  });

  // Bundled closure for the extracted Inspector/ElPreview (Layer 1b of the
  // God Component refactor, see designer/context.ts's own header comment)
  // — every value/mutator both of those need, in one place so adding a new
  // element/field only ever means adding a field here, not touching every
  // call site. Memoized (render-perf refactor Layer (c)) so React.memo on
  // ElPreview/Inspector can actually bail on an edit elsewhere in the tree —
  // depends on every plain value here plus stableFns (itself
  // reference-stable across the component's lifetime, so its presence in
  // the array never triggers a recompute, only satisfies the lint rule).
  const designerCtx: DesignerCtx = useMemo(() => ({
    t, bp, mode, kind, sel, setSel, blocks,
    isSuper,
    ...stableFns,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, sliderInnerEditing, setSliderInnerEditing,
    availableMenus, availableCategories, availableSymbols,
    pageSettings, themePresets, pageSeo, tenantHost, pageSlug: page.slug as string, pageTitle: page.title as string,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang,
    translating,
    isTextKey, pathKey,
    editingText,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    t, bp, mode, kind, sel, setSel, blocks,
    isSuper,
    stableFns,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, sliderInnerEditing, setSliderInnerEditing,
    availableMenus, availableCategories, availableSymbols,
    pageSettings, themePresets, pageSeo, tenantHost, page.slug, page.title,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang,
    translating,
    isTextKey, pathKey,
    editingText,
  ]);

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas font-sans text-ink antialiased">
      <DesignerTopBar
        mobilePanel={mobilePanel}
        setMobilePanel={setMobilePanel}
        t={t}
        page={page}
        kind={kind}
        editingSlug={editingSlug}
        setEditingSlug={setEditingSlug}
        slugDraft={slugDraft}
        setSlugDraft={setSlugDraft}
        slugError={slugError}
        setSlugError={setSlugError}
        renameSlug={renameSlug}
        busy={busy}
        dirty={dirty}
        hasDraft={hasDraft}
        msg={msg}
        error={error}
        undo={undo}
        redo={redo}
        openTemplates={openTemplates}
        setSel={setSel}
        loadHistory={loadHistory}
        setShowSaveBlueprint={setShowSaveBlueprint}
        mode={mode}
        toggleLive={toggleLive}
        bp={bp}
        setBp={setBp}
        openDevicePreview={openDevicePreview}
        saveBlueprint={saveBlueprint}
        saveSymbol={saveSymbol}
        saveSiteChrome={saveSiteChrome}
        save={save}
        chromeStatus={chromeStatus}
        close={close}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile-only backdrop for the off-canvas palette/inspector drawers */}
        {mobilePanel && (
          <div className="absolute inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
        )}
        <DesignerPalette
          ctx={designerCtx}
          mobilePanel={mobilePanel}
          activeLeftTab={activeLeftTab}
          setActiveLeftTab={setActiveLeftTab}
          drag={drag}
          blocks={blocks}
          treeDropHint={treeDropHint}
          rowDragProps={rowDragProps}
          expanded={expanded}
          selEq={selEq}
          pick={pick}
          toggleExpand={toggleExpand}
          t={t}
          kind={kind}
          chromeKind={chromeKind}
          chromeIsDefault={chromeIsDefault}
          chromeMobileNav={chromeMobileNav}
          patchChromeMeta={patchChromeMeta}
        />

        {mode === "live" ? (
          // Live Edit = the real page (same URL renderer as Preview) framed at
          // the device's exact viewport. Double-buffered: a reload loads into
          // the hidden slot and swaps in on load, so the visible frame never
          // blinks (useLiveEditBridge's handleFrameLoad).
          <main className="relative min-w-0 flex-1 bg-canvas p-4">
            <DeviceViewport device={bp}>
              <iframe
                ref={frameARef}
                src={liveSrcA ?? undefined}
                onLoad={() => handleFrameLoad("a")}
                className={`absolute inset-0 h-full w-full border-0 bg-white ${activeSlot === "a" ? "" : "pointer-events-none opacity-0"}`}
                title="live-view"
              />
              <iframe
                ref={frameBRef}
                src={liveSrcB ?? undefined}
                onLoad={() => handleFrameLoad("b")}
                className={`absolute inset-0 h-full w-full border-0 bg-white ${activeSlot === "b" ? "" : "pointer-events-none opacity-0"}`}
                title="live-view-buffer"
              />
              {reloading && (
                <div className="absolute inset-0 z-10 animate-pulse space-y-4 bg-white p-6">
                  <div className="h-8 w-2/3 rounded bg-canvas" />
                  <div className="h-4 w-full rounded bg-canvas" />
                  <div className="h-4 w-5/6 rounded bg-canvas" />
                  <div className="h-40 w-full rounded bg-canvas" />
                </div>
              )}
            </DeviceViewport>
          </main>
        ) : (
        <DesignerCanvas
          ctx={designerCtx}
          selEq={selEq}
          selCls={selCls}
          pick={pick}
          setCtxMenu={setCtxMenu}
          effectiveTheme={effectiveTheme}
          desktopBoxed={desktopBoxed}
          isCanvasMode={isCanvasMode}
          tenantHost={tenantHost}
          resolvedHeaderId={resolvedHeaderId}
          resolvedFooterId={resolvedFooterId}
          headerFrameHeight={headerFrameHeight}
          footerFrameHeight={footerFrameHeight}
          startSpacingDrag={startSpacingDrag}
          draggingBand={draggingBand}
          hoverBand={hoverBand}
          setHoverBand={setHoverBand}
          duplicateSection={duplicateSection}
          copySection={copySection}
          pasteSection={pasteSection}
          copyStyleSection={copyStyleSection}
          pasteStyleSection={pasteStyleSection}
          deleteSection={deleteSection}
          dropHint={dropHint}
          setDropHint={setDropHint}
          dropIntoColumn={dropIntoColumn}
          drag={drag}
        />
        )}
      </div>

      {mediaPickerCallback && (
        <MediaPickerModal
          tenantHost={tenantHost}
          token={token}
          onSelect={(url) => {
            mediaPickerCallback(url);
            setMediaPickerCallback(null);
          }}
          onClose={() => setMediaPickerCallback(null)}
        />
      )}

      <DesignerDevicePreviewModal
        t={t}
        previewModal={previewModal}
        setPreviewModal={setPreviewModal}
        withDeviceFrame={withDeviceFrame}
        ctxMenu={ctxMenu}
        setCtxMenu={setCtxMenu}
        ctx={designerCtx}
        templateKind={templateKind}
        makeComponent={makeComponent}
        detachSymbolInstance={detachSymbolInstance}
        duplicateSection={duplicateSection}
        copySection={copySection}
        pasteSection={pasteSection}
        copyStyleSection={copyStyleSection}
        pasteStyleSection={pasteStyleSection}
        deleteSection={deleteSection}
        duplicateColumn={duplicateColumn}
      />

      <DesignerTemplatesModal
        {...templateLibrary}
        t={t}
        isSuper={isSuper}
        availableSymbols={availableSymbols}
      />

      <DesignerHistoryModal
        t={t}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        revisions={revisions}
        revisionsLoaded={revisionsLoaded}
        restoring={restoring}
        restoreRevision={restoreRevision}
      />
    </div>
  );
}
