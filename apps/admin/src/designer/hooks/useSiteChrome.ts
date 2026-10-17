// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — NEW concern vs. that spec
// (the header/footer designer was added to main after it was written).
// Covers both facets of "site chrome": a PAGE's assignment of which header/
// footer it uses (patchPageChrome, relevant when kind==="page"), and a
// chrome DOCUMENT's own editing state (patchChromeMeta/saveSiteChrome's
// status, relevant when kind==="siteChrome"). saveSiteChrome itself stays
// in usePersist (the "save this Designer document" family) — this hook
// only owns chromeStatus's value, exposing its setter for usePersist to
// call after a successful save.
import { useEffect, useState } from "react";
import * as api from "@/lib/api";

export interface SiteChromeDeps {
  tenantHost: string;
  token: string;
  page: {
    id?: unknown;
    kind?: unknown;
    status?: unknown;
    isDefault?: unknown;
    settings?: unknown;
    headerId?: unknown;
    footerId?: unknown;
    hideHeader?: unknown;
    hideFooter?: unknown;
  };
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  setError: (msg: string | null) => void;
  bumpStructural: () => void;
}

export function useSiteChrome(deps: SiteChromeDeps) {
  const { tenantHost, token, page, kind, setError, bumpStructural } = deps;

  // Header/Footer designer (kind === "siteChrome") — isDefault + mobileNav
  // style, edited via the standalone panel below the canvas, saved with an
  // immediate api.updateSiteChrome PATCH rather than folded into the
  // dirty/Save flow (see saveSiteChrome's own comment in usePersist).
  const chromeKind = page.kind as "header" | "footer" | undefined;
  const [chromeStatus, setChromeStatus] = useState<"draft" | "published">((page.status as "draft" | "published") ?? "draft");
  const [chromeIsDefault, setChromeIsDefault] = useState<boolean>(Boolean(page.isDefault));
  const [chromeMobileNav, setChromeMobileNav] = useState<{ position?: string; size?: string; color?: string; animation?: string; style?: string }>(
    () => (page.settings as { mobileNav?: Record<string, string> } | undefined)?.mobileNav ?? {},
  );
  async function patchChromeMeta(patch: { isDefault?: boolean; mobileNav?: Record<string, string | undefined> }) {
    const nextDefault = patch.isDefault ?? chromeIsDefault;
    const nextMobileNav = patch.mobileNav ? { ...chromeMobileNav, ...patch.mobileNav } : chromeMobileNav;
    setChromeIsDefault(nextDefault);
    setChromeMobileNav(nextMobileNav);
    try {
      await api.updateSiteChrome(tenantHost, token, page.id as string, {
        isDefault: nextDefault,
        settings: { ...(page.settings as Record<string, unknown>), mobileNav: nextMobileNav },
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Page's own header/footer assignment (kind === "page") — same immediate-
  // PATCH pattern as chrome meta above, real pages columns not part of
  // `pageSettings`' jsonb bag. availableHeaders/Footers are fetched once,
  // same shape as availableMenus.
  const [availableHeaders, setAvailableHeaders] = useState<api.SiteChrome[]>([]);
  const [availableFooters, setAvailableFooters] = useState<api.SiteChrome[]>([]);
  useEffect(() => {
    if (kind !== "page") return;
    void api.listSiteChrome(tenantHost, token, "header").then(setAvailableHeaders);
    void api.listSiteChrome(tenantHost, token, "footer").then(setAvailableFooters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, kind]);
  const [pageHeaderId, setPageHeaderId] = useState<string>((page.headerId as string | null) ?? "");
  const [pageFooterId, setPageFooterId] = useState<string>((page.footerId as string | null) ?? "");
  const [pageHideHeader, setPageHideHeader] = useState<boolean>(Boolean(page.hideHeader));
  const [pageHideFooter, setPageHideFooter] = useState<boolean>(Boolean(page.hideFooter));
  async function patchPageChrome(patch: { headerId?: string; footerId?: string; hideHeader?: boolean; hideFooter?: boolean }) {
    const next = {
      headerId: patch.headerId !== undefined ? patch.headerId : pageHeaderId,
      footerId: patch.footerId !== undefined ? patch.footerId : pageFooterId,
      hideHeader: patch.hideHeader !== undefined ? patch.hideHeader : pageHideHeader,
      hideFooter: patch.hideFooter !== undefined ? patch.hideFooter : pageHideFooter,
    };
    setPageHeaderId(next.headerId);
    setPageFooterId(next.footerId);
    setPageHideHeader(next.hideHeader);
    setPageHideFooter(next.hideFooter);
    try {
      await api.updatePage(tenantHost, token, page.id as string, {
        headerId: next.headerId || null,
        footerId: next.footerId || null,
        hideHeader: next.hideHeader,
        hideFooter: next.hideFooter,
      });
      // Picking a header/footer here PATCHes the page directly (not through
      // mutate()/the layout draft), so nothing was telling the Live Edit
      // iframe to reload — it kept showing whatever header/footer was
      // active when it first mounted. bumpStructural() is the same signal
      // every other structural change already uses to trigger the debounced
      // reload.
      bumpStructural();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // A page's real header/footer shows in Live Edit (the real page), where a
  // click on it opens that header/footer's own Designer (Designer.tsx's
  // openChrome). The Blocks canvas used to embed them read-only too
  // (chrome-preview.astro?embed=1), removed once Blocks became a wireframe.
  return {
    chromeKind, chromeStatus, setChromeStatus, chromeIsDefault, chromeMobileNav, patchChromeMeta,
    availableHeaders, availableFooters,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, patchPageChrome,
  };
}
