import { useCallback, useEffect, useState } from "react";
import { FileText, Globe, Rss, Users as UsersIcon } from "lucide-react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useT, card } from "./App";

// Not actually a sibling of Dashboard in the route tree (mounted at its own
// "/feed" route, superadmin-only) — folded in here anyway since it's tiny
// and thematically the same "overview widget" as Dashboard/MetricCard.
export function PortalFeedPanel({ token }: { token: string }) {
  const { t } = useT();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setItems(await api.listPortalSharedContent(token)); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Rss className="h-4 w-4 text-accent" /> {t("feed-title")}
      </h2>
      {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">{t("list-retry")}</button></p>}
      {loading && <p role="status" className="text-sm text-sub">{t("list-loading")}</p>}
      <ul className={`${card} divide-y divide-line/20`}>
        {items.map((i) => (
          <li key={i.id as string} className="px-4 py-3 text-sm">
            <a href={i.link as string} className="font-semibold text-accent hover:underline" target="_blank" rel="noreferrer">
              {i.title as string}
            </a>
            <span className="ml-2 text-sub">
              {t("feed-from")} {i.sourceHost as string}
            </span>
          </li>
        ))}
        {!loading && !error && items.length === 0 && <li className="px-4 py-3 text-sm text-sub">{t("feed-empty")}</li>}
      </ul>
    </section>
  );
}

// ---------- Dashboard ----------
function MetricCard({ label, value, unit, icon }: { label: string; value: number | string; unit: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {icon}
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">
            {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard({ session }: { session: Session }) {
  const { t } = useT();
  const [counts, setCounts] = useState<{ tenants?: number; users?: number; feed?: number; pages?: number }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (session.role === "superadmin") {
        const [tenants, users, feed] = await Promise.all([
          api.listPortalTenants(session.token), api.listPortalUsers(session.token), api.listPortalSharedContent(session.token),
        ]);
        setCounts({ tenants: tenants.length, users: users.length, feed: feed.length });
      } else if (session.tenantHost) {
        const pages = await api.getPages(session.tenantHost, session.token);
        setCounts({ pages: pages.length });
      } else {
        setCounts({ pages: 0 });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-canvas p-8">
        <div className="relative z-10 max-w-2xl">
          <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-bold uppercase tracking-wider text-accent">
            USIM CMS v1.0
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">{t("welcome-title")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-sub">{t("welcome-desc")}</p>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t("list-load-error")} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">{t("list-retry")}</button></div>}
      {loading && <p role="status" className="text-sm text-sub">{t("list-loading")}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {session.role === "superadmin" ? (
          <>
            <MetricCard label={t("m-portals")} value={error ? "—" : counts.tenants ?? "…"} unit={t("m-portals-unit")} icon={<Globe className="h-4 w-4 text-ok" />} />
            <MetricCard label={t("m-users")} value={error ? "—" : counts.users ?? "…"} unit={t("m-users-unit")} icon={<UsersIcon className="h-4 w-4 text-accent" />} />
            <MetricCard label={t("m-feed")} value={error ? "—" : counts.feed ?? "…"} unit={t("m-feed-unit")} icon={<Rss className="h-4 w-4 text-warn" />} />
          </>
        ) : (
          <MetricCard label={t("m-pages")} value={error ? "—" : counts.pages ?? "…"} unit={t("m-pages-unit")} icon={<FileText className="h-4 w-4 text-accent" />} />
        )}
      </div>
    </div>
  );
}
