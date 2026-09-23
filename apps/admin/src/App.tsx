import { createContext, lazy, Suspense, useContext, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  FileText,
  Globe,
  Inbox,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  ListTree,
  Loader2,
  LogOut,
  Menu,
  Palette,
  PanelTop,
  Rss,
  Settings as SettingsIcon,
  ShieldCheck,
  Users as UsersIcon,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { dict, type Key, type Lang } from "@/i18n";
import { ConfirmDialogProvider } from "@/hooks/useConfirm";
// PostEditorPage (BlockNote rich-text editor) and BlueprintGallery are
// heavy routed views — code-split so a session that only ever opens
// Media/Menus/etc never downloads them. Designer itself is code-split from
// inside DesignerRoutes.tsx, the only place that renders it.
export const BlueprintGallery = lazy(() => import("./BlueprintGallery").then((m) => ({ default: m.BlueprintGallery })));
import SetupWizard from "./SetupWizard";
import LoginForm from "./LoginForm";
import { BlueprintDesignerRoute, SymbolDesignerRoute, HeaderFooterDesignerRoute } from "./DesignerRoutes";
import { Dashboard, PortalFeedPanel } from "./Dashboard";
import TenantLanguagesForm from "./TenantLanguagesForm";
import SecurityPanel from "./SecurityPanel";
import RolesPanel from "./RolesPanel";
import UsersPanel from "./UsersPanel";
import ContentManager from "./ContentManager";
import TenantsPanel from "./TenantsPanel";
import SettingsPanel from "./SettingsPanel";
import { ThemeForm } from "./ThemeForm";
import MenusPanel from "./MenusPanel";
import HeaderFooterPanel from "./HeaderFooterPanel";
import EventsPanel from "./EventsPanel";

export const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  // Sessions cached before tenantHosts existed won't have it — log back in
  // to get a fresh one, but don't crash on the stale cached shape meanwhile.
  return { ...session, tenantHosts: session.tenantHosts ?? (session.tenantHost ? [session.tenantHost] : []) };
}

// ---------- i18n ----------
export const I18nCtx = createContext<{ lang: Lang; t: (k: Key) => string }>({
  lang: "en",
  t: (k) => dict.en[k],
});
export const useT = () => useContext(I18nCtx);

// ---------- shared styles (prototype look) ----------
export const inputCls =
  "w-full rounded-lg border border-line/30 bg-canvas px-3 py-2 text-xs text-ink outline-none transition-all focus:border-line focus:bg-white";
export const btnPrimary =
  "rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50";
export const btnGhost =
  "rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-[#e8e8ed]";
export const card = "rounded-xl border border-line/40 bg-white";

// Standardized form error — role="alert"/aria-live so a screen reader
// announces it the moment it appears, not just when focus happens to land
// on it. Replaces the same hand-repeated <p className="text-xs text-red-600">
// pattern that was duplicated across every panel's own error state.
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" aria-live="assertive" className="text-xs text-red-600">
      {children}
    </p>
  );
}

// Sprint 4 UX audit: standard loading/empty states, reused across the
// Pages/Posts/Media list panels instead of each rolling its own.
export function ListLoading() {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-sub">
      <Loader2 className="h-4 w-4 animate-spin" /> {t("list-loading")}
    </div>
  );
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs text-sub">
      <Inbox className="h-6 w-6 text-line" />
      <p>{children}</p>
    </div>
  );
}

export const PAGE_SIZE = 20;



// ---------- Users ----------
export const PERMISSIONS = [
  "pages.create",
  "pages.update",
  "pages.delete",
  "posts.create",
  "posts.update",
  "posts.delete",
  "media.upload",
  "media.delete",
  "theme.write",
  "users.manage",
  "sites.multi",
  "languages.write",
  "menus.write",
  "blueprints.write",
  "events.write",
  "headerFooter.write",
] as const;
export const PERMISSION_LABEL_KEY: Record<(typeof PERMISSIONS)[number], Key> = {
  "pages.create": "perm-pages-create",
  "pages.update": "perm-pages-update",
  "pages.delete": "perm-pages-delete",
  "posts.create": "perm-posts-create",
  "posts.update": "perm-posts-update",
  "posts.delete": "perm-posts-delete",
  "media.upload": "perm-media-upload",
  "media.delete": "perm-media-delete",
  "theme.write": "perm-theme-write",
  "users.manage": "perm-users-manage",
  "sites.multi": "perm-sites-multi",
  "languages.write": "perm-languages-write",
  "menus.write": "perm-menus-write",
  "blueprints.write": "perm-blueprints-write",
  "events.write": "perm-events-write",
  "headerFooter.write": "perm-header-footer-write",
};

// ---------- Shell (sidebar + header, prototype layout) ----------
// Shared with ContentManager.tsx's own sub-nav grouping (imported back from
// there) — the webmaster sidebar's flat Tab list groups by the same taxonomy.
export type NavGroup = "content" | "design" | "settings";
export const NAV_GROUP_ORDER: NavGroup[] = ["content", "design", "settings"];
export const NAV_GROUP_LABEL: Record<NavGroup, Key> = {
  content: "nav-group-content",
  design: "nav-group-design",
  settings: "nav-group-settings",
};
type Tab =
  | "dashboard"
  | "multisite"
  | "users"
  | "roles"
  | "content"
  | "theme"
  | "languages"
  | "menus"
  | "header-footer"
  | "blueprints"
  | "events"
  | "global-theme"
  | "feed"
  | "settings"
  | "security";

const TAB_META: Record<Tab, { labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = {
  dashboard: { labelKey: "tab-dashboard", icon: LayoutDashboard },
  multisite: { labelKey: "tab-multisite", icon: Layers },
  users: { labelKey: "tab-users", icon: UsersIcon },
  roles: { labelKey: "tab-roles", icon: ShieldCheck },
  content: { labelKey: "tab-content", icon: FileText },
  theme: { labelKey: "tab-theme", icon: Palette },
  languages: { labelKey: "tab-languages", icon: Globe },
  menus: { labelKey: "menus-title", icon: ListTree },
  "header-footer": { labelKey: "header-footer-title", icon: PanelTop },
  blueprints: { labelKey: "blueprints-title", icon: LayoutTemplate },
  events: { labelKey: "events-title", icon: CalendarDays },
  "global-theme": { labelKey: "tab-global-theme", icon: Palette },
  feed: { labelKey: "tab-feed", icon: Rss },
  settings: { labelKey: "tab-settings", icon: SettingsIcon },
  security: { labelKey: "tab-security", icon: KeyRound },
};

// Webmaster's sidebar has no site-picker, so ContentManager's own Content/
// Design/Settings sub-tabs (menus/theme/etc, see CONTENT_SUBTAB_GROUP above)
// surface as flat top-level Tabs instead — grouped here the same way so a
// webmaster gets the same taxonomy a superadmin sees inside Content Manager.
// Superadmin's own sidebar contentTabs (content/global-theme/feed) is left
// flat — only 3 items, not crowded.
const TAB_GROUP: Partial<Record<Tab, NavGroup>> = {
  content: "content",
  theme: "design",
  menus: "design",
  "header-footer": "design",
  blueprints: "design",
  languages: "settings",
  events: "settings",
};


function NavButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  const { t } = useT();
  const { labelKey, icon: Icon } = TAB_META[tab];
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        active ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{t(labelKey)}</span>
    </button>
  );
}

function Shell({
  session,
  onLogout,
  onImpersonate,
  impersonating,
  onExitImpersonation,
}: {
  session: Session;
  onLogout: () => void;
  onImpersonate: (s: Session) => void;
  impersonating: boolean;
  onExitImpersonation: () => void;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const t = (k: Key) => dict[lang][k];
  const isSuper = session.role === "superadmin";
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = (location.pathname.split("/")[1] || "dashboard") as Tab;
  // Sidebar is a fixed off-canvas drawer below md (Sprint 2: responsive admin
  // shell), static in-flow at md+ — see the `aside`/backdrop classes below.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const goTo = (tb: Tab) => {
    navigate(`/${tb}`);
    setMobileNavOpen(false);
  };
  // superadmin picks which site to manage in the content tab; webmaster is locked to theirs
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [siteHost, setSiteHost] = useState<string>(session.tenantHost ?? "");

  useEffect(() => {
    if (isSuper) void api.listPortalTenants(session.token).then(setTenants);
  }, [isSuper, session.token]);

  // Webmaster with more than one assigned site gets the same site picker a
  // superadmin sees, restricted to just their own sites (no departmentName
  // available for these, host doubles as the label).
  const siteOptions = isSuper
    ? tenants
    : session.tenantHosts.map((h) => ({ id: h, host: h, departmentName: h }));
  const showSitePicker = isSuper || session.tenantHosts.length > 1;

  const mainTabs: Tab[] = isSuper ? ["dashboard", "multisite", "users", "roles", "settings", "security"] : ["dashboard", "security"];
  const contentTabs: Tab[] = isSuper
    ? ["content", "global-theme", "feed"]
    : ["content", "theme", "languages", "menus", "header-footer", "blueprints", "events"];

  return (
    <I18nCtx.Provider value={{ lang, t }}>
      {/* Nested here (not at the app root in main.tsx) so its confirm-dialog
          labels can call useT() and actually see this real lang state —
          every useConfirm() call site lives inside Shell anyway (nothing
          pre-login uses it), so nothing upstream needs it. */}
      <ConfirmDialogProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-canvas font-sans text-ink antialiased">
        {impersonating && (
          <div className="flex shrink-0 items-center justify-center gap-3 bg-warn px-4 py-1.5 text-[11px] font-semibold text-white">
            <span>
              {t("impersonate-banner")} {session.tenantHost} ({session.role})
            </span>
            <button onClick={onExitImpersonation} className="rounded-full bg-white/20 px-2.5 py-0.5 hover:bg-white/30">
              {t("impersonate-exit")}
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
        {/* Mobile-only backdrop, closes the drawer on outside tap */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* Sidebar: fixed off-canvas drawer below md, static in-flow at md+ */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 transform flex-col border-r border-line/50 bg-white transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center gap-3 border-b border-line/30 p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
              U
            </div>
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-ink">USIM CMS</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
            </div>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="ml-auto rounded-full p-1.5 text-sub hover:bg-canvas hover:text-ink md:hidden"
              aria-label={t("nav-close")}
              title={t("nav-close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex-1 space-y-1.5 overflow-y-auto p-4">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-main")}</div>
            {mainTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
            ))}
            {isSuper ? (
              <>
                <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-content")}</div>
                {contentTabs.map((tb) => (
                  <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
                ))}
              </>
            ) : (
              NAV_GROUP_ORDER.map((group) => {
                const tabs = contentTabs.filter((tb) => TAB_GROUP[tb] === group);
                if (tabs.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t(NAV_GROUP_LABEL[group])}</div>
                    {tabs.map((tb) => (
                      <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
                    ))}
                  </div>
                );
              })
            )}
          </nav>
          <div className="flex items-center gap-3 border-t border-line/30 bg-canvas/30 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold uppercase text-white">
              {session.role[0]}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-xs font-semibold capitalize text-ink">{session.role}</h4>
              {session.tenantHost && <p className="truncate text-[10px] text-sub">{session.tenantHost}</p>}
            </div>
            <button
              onClick={onLogout}
              className="rounded-full p-1.5 text-sub transition-colors hover:bg-canvas hover:text-ink"
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line/40 bg-white px-4 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="shrink-0 rounded-full p-1.5 text-sub hover:bg-canvas hover:text-ink md:hidden"
                aria-label={t("nav-open")}
                title={t("nav-open")}
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="hidden text-xs font-bold uppercase tracking-wider text-sub sm:inline">{t("header-workspace")}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 text-line sm:inline" />
              <span className="flex items-center gap-1.5 truncate rounded-full border border-line/30 bg-canvas px-2.5 py-0.5 text-xs font-bold text-ink">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="truncate">{t(TAB_META[activeTab].labelKey)}</span>
              </span>
              <span className="hidden shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent sm:inline">
                {session.role}
              </span>
            </div>
            <div className="flex shrink-0 rounded-lg border border-line/50 bg-canvas p-0.5">
              {(["ms", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex items-center gap-1 rounded px-3 py-1 text-[10px] transition-all ${
                    lang === l ? "bg-white font-semibold text-ink shadow-sm" : "font-medium text-sub hover:text-ink"
                  }`}
                >
                  <Languages className="h-3 w-3 text-accent" /> {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto bg-white p-4 sm:p-8">
            <div className="mx-auto max-w-7xl space-y-6 pb-10">
              <Suspense fallback={<ListLoading />}>
              <Routes>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard session={session} />} />
                <Route
                  path="multisite"
                  element={isSuper ? <TenantsPanel token={session.token} setSiteHost={setSiteHost} /> : <Navigate to="/dashboard" replace />}
                />
                <Route path="users" element={isSuper ? <UsersPanel token={session.token} onImpersonate={onImpersonate} /> : <Navigate to="/dashboard" replace />} />
                <Route path="roles" element={isSuper ? <RolesPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="content/*" element={<ContentManager isSuper={isSuper} showSitePicker={showSitePicker} siteHost={siteHost} setSiteHost={setSiteHost} tenants={siteOptions} token={session.token} />} />
                <Route path="theme" element={!isSuper && session.tenantHost ? (<ThemeForm title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(session.tenantHost!, session.token)} save={(s) => api.putTheme(session.tenantHost!, session.token, s)} token={session.token} allowDeactivate previewTenantHost={session.tenantHost!} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="languages" element={!isSuper && session.tenantHost ? (<TenantLanguagesForm tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="menus" element={!isSuper && session.tenantHost ? (<MenusPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="header-footer" element={!isSuper && session.tenantHost ? (<HeaderFooterPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route
                  path="header-footer/:id"
                  element={!isSuper && session.tenantHost ? (<HeaderFooterDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} backTo="/header-footer" />) : (<Navigate to="/dashboard" replace />)}
                />
                <Route path="blueprints" element={!isSuper && session.tenantHost ? (<BlueprintGallery tenantHost={session.tenantHost} token={session.token} mode="manage" isSuper={false} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="blueprints/:id" element={!isSuper && session.tenantHost ? (<BlueprintDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} backTo="/blueprints" />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="symbols/:id" element={!isSuper && session.tenantHost ? (<SymbolDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="events" element={!isSuper && session.tenantHost ? (<EventsPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="global-theme" element={isSuper ? (<ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="feed" element={isSuper ? <PortalFeedPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="settings" element={isSuper ? <SettingsPanel token={session.token} tenants={tenants} /> : <Navigate to="/dashboard" replace />} />
                <Route path="security" element={<SecurityPanel token={session.token} />} />
              </Routes>
              </Suspense>
            </div>
          </main>
        </div>
        </div>
      </div>
      </ConfirmDialogProvider>
    </I18nCtx.Provider>
  );
}

const IMPERSONATOR_KEY = "usim_cms_impersonator";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // Entra login lands here as a real browser navigation (never a fetch —
  // Microsoft's own login page needs a top-level redirect). entra/callback
  // deliberately does NOT put session data in this redirect's query string
  // (a URL leaks into server access logs and Referer far more readily than a
  // response body — see apps/api/CLAUDE.md's Auth hardening section), so on
  // landing here this fetches it back via GET /api/auth/session, authenticated
  // by the httpOnly cookie that route already set — there's no client-side
  // router mounted pre-login at all (see the BrowserRouter further down, only
  // wrapping the post-session Shell), so this is a plain pathname check, not
  // a routed page.
  const [entraError, setEntraError] = useState<string | null>(null);
  useEffect(() => {
    if (window.location.pathname !== "/entra-callback") return;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, "", "/");
    const err = params.get("entraError");
    if (err) {
      setEntraError(err);
      return;
    }
    api
      .fetchEntraSession()
      .then((s) => {
        const newSession: Session = { token: s.csrfToken, role: s.role, tenantHost: s.tenantHost, tenantHosts: s.tenantHosts };
        localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
        setSession(newSession);
      })
      .catch(() => setEntraError("verification_failed"));
  }, []);
  // Set only while a superadmin is "viewing as" a webmaster — the stashed
  // superadmin session to restore on exit. Persisted so a page refresh
  // mid-impersonation doesn't strand the admin in the webmaster's view.
  // Only a UI flag (banner + exit button) now — the superadmin's original
  // session cannot be restored from a value stashed in localStorage anymore
  // (the real session is an httpOnly cookie the impersonate call overwrote,
  // unreadable by JS even before that). exitImpersonation() below gets it
  // back via a real server round-trip instead. See POST
  // /api/portal/exit-impersonation.
  const [impersonating, setImpersonating] = useState<boolean>(() => localStorage.getItem(IMPERSONATOR_KEY) === "1");
  // null = still checking; a fresh install has zero users, so the wizard
  // must win the race against LoginForm rather than flash it on load.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) api.getSetupStatus().then(setNeedsSetup).catch(() => setNeedsSetup(false));
  }, [session]);

  async function logout() {
    const t = session?.token ?? null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(null);
    setImpersonating(false);
    try {
      await api.logout(t);
    } catch {
      // Clearing the local session already logs the user out of the UI;
      // the server-side cookie clear is best-effort (e.g. already expired).
    }
  }

  function impersonate(target: Session) {
    if (session) {
      localStorage.setItem(IMPERSONATOR_KEY, "1");
      setImpersonating(true);
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(target));
    setSession(target);
  }

  async function exitImpersonation() {
    if (!session) return;
    const restored = await api.exitImpersonation(session.token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(restored));
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(restored);
    setImpersonating(false);
  }

  if (!session) {
    if (needsSetup === null) return null;
    if (needsSetup) return <SetupWizard onDone={setSession} />;
    return <LoginForm onLogin={setSession} entraError={entraError} />;
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/*"
          element={
            <Shell
              // Forces a full remount on every session swap (login/impersonate/exit)
              // — Shell's siteHost/tab state only initializes from session on mount,
              // and without this a same-instance prop swap leaves both stuck on
              // whatever the previous session had (wrong x-tenant-host, dead tabs).
              key={session.token}
              session={session}
              onLogout={logout}
              onImpersonate={impersonate}
              impersonating={impersonating}
              onExitImpersonation={exitImpersonation}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
