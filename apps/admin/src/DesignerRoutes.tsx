import { lazy, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "@/lib/api";
import { useT } from "./App";

// Designer (page-builder canvas) is the heaviest routed view — code-split so
// a session that only ever opens Media/Menus/etc never downloads it.
const Designer = lazy(() => import("@/Designer"));

export function PageDesignerRoute({ tenantHost, token, isSuper }: { tenantHost: string; token: string; isSuper: boolean }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    void api.getPages(tenantHost, token).then((pages) => setPage(pages.find((p) => p.id === id) ?? null));
  }, [tenantHost, id]);
  if (page === undefined) return null;
  if (page === null) return <p className="text-xs text-sub">{t("pages-empty")}</p>;
  return (
    <Designer
      page={page}
      tenantHost={tenantHost}
      token={token}
      t={t}
      onClose={() => navigate("/content/pages")}
      isSuper={isSuper}
    />
  );
}

// Same shape as PageDesignerRoute, for editing a blueprint's own layout
// instead of a real page's — Designer's `kind="blueprint"` prop strips the
// slug/publish/Live-Edit/Preview UI, since a blueprint has no live route of
// its own. `backTo` is explicit (not a relative "..") since this route is
// mounted at two different bases (superadmin's "/content/blueprints" and a
// webmaster's own "/blueprints").
export function BlueprintDesignerRoute({ tenantHost, token, isSuper, backTo }: { tenantHost: string; token: string; isSuper: boolean; backTo: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [bp, setBp] = useState<api.PageBlueprint | null | undefined>(undefined);
  useEffect(() => {
    void api.listBlueprints(tenantHost, token).then((items) => setBp(items.find((b) => b.id === id) ?? null));
  }, [tenantHost, id]);
  if (bp === undefined) return null;
  if (bp === null) return <p className="text-xs text-sub">{t("blueprints-empty")}</p>;
  return (
    <Designer
      page={{ id: bp.id, title: bp.name, layout: bp.layout, settings: bp.settings }}
      tenantHost={tenantHost}
      token={token}
      t={t}
      onClose={() => navigate(backTo)}
      isSuper={isSuper}
      kind="blueprint"
    />
  );
}

// Same shape as BlueprintDesignerRoute, for "Edit Master" on a live-linked
// symbol (Designer.tsx's kind="symbol") — the bare El node is wrapped in a
// throwaway section/row/column shell so every existing Designer mechanism
// (Inspector, drag, undo, mutate) works completely unmodified; saveSymbol()
// (Designer.tsx) unwraps back down to the bare node on save. Always opened
// in a new tab (see Designer.tsx's "Edit Master" context-menu item), so
// there's no `backTo` — onClose just closes that tab.
export function SymbolDesignerRoute({ tenantHost, token, isSuper }: { tenantHost: string; token: string; isSuper: boolean }) {
  const { t } = useT();
  const { id } = useParams();
  const [sym, setSym] = useState<api.Symbol | null | undefined>(undefined);
  useEffect(() => {
    void api
      .getSymbol(tenantHost, token, id as string)
      .then(setSym)
      .catch(() => setSym(null));
  }, [tenantHost, id]);
  if (sym === undefined) return null;
  if (sym === null) return <p className="text-xs text-sub">{t("designer-symbols-missing")}</p>;
  return (
    <Designer
      page={{
        id: sym.id,
        title: sym.name,
        layout: [{ type: "section", props: { rows: [{ columns: [{ elements: [sym.node] }] }] } }],
        settings: {},
      }}
      tenantHost={tenantHost}
      token={token}
      t={t}
      onClose={() => window.close()}
      isSuper={isSuper}
      kind="symbol"
    />
  );
}

// Same shape as BlueprintDesignerRoute, for a header/footer's own layout —
// see docs/superpowers/specs/2026-09-04-header-footer-designer-design.md.
// `kind`/`isDefault`/`status` ride along on `page` since Designer's own
// standalone chrome-settings panel (kind === "siteChrome") reads them
// straight off `page`, same as it reads `page.headerId` etc for a real page.
export function HeaderFooterDesignerRoute({ tenantHost, token, isSuper, backTo }: { tenantHost: string; token: string; isSuper: boolean; backTo: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<api.SiteChrome | null | undefined>(undefined);
  useEffect(() => {
    void api.listSiteChrome(tenantHost, token).then((items) => setItem(items.find((i) => i.id === id) ?? null));
  }, [tenantHost, id]);
  if (item === undefined) return null;
  if (item === null) return <p className="text-xs text-sub">{t("header-footer-empty")}</p>;
  return (
    <Designer
      page={{ id: item.id, title: item.name, layout: item.layout, settings: item.settings, kind: item.kind, isDefault: item.isDefault, status: item.status }}
      tenantHost={tenantHost}
      token={token}
      t={t}
      onClose={() => navigate(backTo)}
      isSuper={isSuper}
      kind="siteChrome"
    />
  );
}
