import { lazy, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "@/lib/api";
import { useT } from "./App";

// Designer (page-builder canvas) is the heaviest routed view — code-split so
// a session that only ever opens Media/Menus/etc never downloads it.
const Designer = lazy(() => import("@/Designer"));

function useDesignerRecord<T>(load: () => Promise<T | null>) {
  const [item, setItem] = useState<T | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    setItem(undefined);
    setError(null);
    void load().then((value) => { if (active) setItem(value); }).catch((err) => {
      if (active) setError((err as Error).message);
    });
    return () => { active = false; };
  }, [load, retryKey]);
  return { item, error, retry: () => setRetryKey((n) => n + 1) };
}

function RouteFeedback({ error, missing, retry, back }: { error?: string | null; missing?: boolean; retry: () => void; back: () => void }) {
  const { t } = useT();
  return <div className="mx-auto max-w-xl rounded-xl border border-line/40 bg-white p-6 text-sm text-body" role={error ? "alert" : "status"}>
    <p>{error ? `${t("list-load-error")}: ${error}` : missing ? t("nav-not-found") : t("list-loading")}</p>
    {(error || missing) && <div className="mt-4 flex gap-4">
      {error && <button type="button" onClick={retry} className="font-semibold text-accent underline">{t("list-retry")}</button>}
      <button type="button" onClick={back} className="font-semibold text-body underline">{t("designer-close")}</button>
    </div>}
  </div>;
}

export function PageDesignerRoute({ tenantHost, token, isSuper }: { tenantHost: string; token: string; isSuper: boolean }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const load = useCallback(async () => (await api.getPages(tenantHost, token)).find((p) => p.id === id) ?? null, [tenantHost, token, id]);
  const { item: page, error, retry } = useDesignerRecord(load);
  if (page === undefined || error) return <RouteFeedback error={error} retry={retry} back={() => navigate("/content/pages")} />;
  if (page === null) return <RouteFeedback missing retry={retry} back={() => navigate("/content/pages")} />;
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
  const load = useCallback(async () => (await api.listBlueprints(tenantHost, token)).find((b) => b.id === id) ?? null, [tenantHost, token, id]);
  const { item: bp, error, retry } = useDesignerRecord(load);
  if (bp === undefined || error) return <RouteFeedback error={error} retry={retry} back={() => navigate(backTo)} />;
  if (bp === null) return <RouteFeedback missing retry={retry} back={() => navigate(backTo)} />;
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
  const load = useCallback(() => api.getSymbol(tenantHost, token, id as string), [tenantHost, token, id]);
  const { item: sym, error, retry } = useDesignerRecord(load);
  if (sym === undefined || error) return <RouteFeedback error={error} retry={retry} back={() => window.close()} />;
  if (sym === null) return <RouteFeedback missing retry={retry} back={() => window.close()} />;
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
  const load = useCallback(async () => (await api.listSiteChrome(tenantHost, token)).find((i) => i.id === id) ?? null, [tenantHost, token, id]);
  const { item, error, retry } = useDesignerRecord(load);
  if (item === undefined || error) return <RouteFeedback error={error} retry={retry} back={() => navigate(backTo)} />;
  if (item === null) return <RouteFeedback missing retry={retry} back={() => navigate(backTo)} />;
  return (
    <Designer
      page={{ id: item.id, title: item.name, layout: item.layout, settings: item.settings, kind: item.kind, isDefault: item.isDefault, status: item.status, draft: item.draft }}
      tenantHost={tenantHost}
      token={token}
      t={t}
      onClose={() => navigate(`${backTo}?tab=${item.kind}`)}
      isSuper={isSuper}
      kind="siteChrome"
    />
  );
}
