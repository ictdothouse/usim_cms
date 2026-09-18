import { useEffect, useState } from "react";
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
  useEffect(() => {
    void api.listPortalSharedContent(token).then(setItems);
  }, []);
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Rss className="h-4 w-4 text-accent" /> {t("feed-title")}
      </h2>
      <ul className={`${card} divide-y divide-line/20`}>
        {items.map((i) => (
          <li key={i.id as string} className="px-4 py-3 text-xs">
            <a href={i.link as string} className="font-semibold text-accent hover:underline" target="_blank" rel="noreferrer">
              {i.title as string}
            </a>
            <span className="ml-2 text-sub">
              {t("feed-from")} {i.sourceHost as string}
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("feed-empty")}</li>}
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
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">
            {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard({ session }: { session: Session }) {
  const { t } = useT();
  const [counts, setCounts] = useState<{ tenants?: number; users?: number; feed?: number; pages?: number }>({});

  useEffect(() => {
    if (session.role === "superadmin") {
      void api.listPortalTenants(session.token).then((x) => setCounts((c) => ({ ...c, tenants: x.length })));
      void api.listPortalUsers(session.token).then((x) => setCounts((c) => ({ ...c, users: x.length })));
      void api.listPortalSharedContent(session.token).then((x) => setCounts((c) => ({ ...c, feed: x.length })));
    } else if (session.tenantHost) {
      void api.getPages(session.tenantHost, session.token).then((x) => setCounts((c) => ({ ...c, pages: x.length })));
    }
  }, [session]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-canvas p-8">
        <div className="relative z-10 max-w-2xl">
          <span className="rounded-full bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
            USIM CMS v1.0
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">{t("welcome-title")}</h2>
          <p className="mt-2 text-xs leading-relaxed text-sub">{t("welcome-desc")}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {session.role === "superadmin" ? (
          <>
            <MetricCard label={t("m-portals")} value={counts.tenants ?? "…"} unit={t("m-portals-unit")} icon={<Globe className="h-4 w-4 text-ok" />} />
            <MetricCard label={t("m-users")} value={counts.users ?? "…"} unit={t("m-users-unit")} icon={<UsersIcon className="h-4 w-4 text-accent" />} />
            <MetricCard label={t("m-feed")} value={counts.feed ?? "…"} unit={t("m-feed-unit")} icon={<Rss className="h-4 w-4 text-warn" />} />
          </>
        ) : (
          <MetricCard label={t("m-pages")} value={counts.pages ?? "…"} unit={t("m-pages-unit")} icon={<FileText className="h-4 w-4 text-accent" />} />
        )}
      </div>
    </div>
  );
}
