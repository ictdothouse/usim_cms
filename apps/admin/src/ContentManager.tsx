import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutTemplate,
  ListTree,
  Newspaper,
  Palette,
  PanelTop,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, ListLoading, BlueprintGallery, NAV_GROUP_ORDER, NAV_GROUP_LABEL, type NavGroup } from "./App";
import { ThemeForm } from "./ThemeForm";
import { PageDesignerRoute, BlueprintDesignerRoute, SymbolDesignerRoute, HeaderFooterDesignerRoute } from "./DesignerRoutes";
import CategoriesPanel from "./CategoriesPanel";
import PagesPanel from "./PagesPanel";
import PostsPanel from "./PostsPanel";
import MediaManager from "./MediaManager";
import MenusPanel from "./MenusPanel";
import HeaderFooterPanel from "./HeaderFooterPanel";
import EventsPanel from "./EventsPanel";
import TenantLanguagesForm from "./TenantLanguagesForm";

const PostEditorPage = lazy(() => import("./PostEditorPage"));

type ContentSubTab = "pages" | "posts" | "media" | "theme" | "languages" | "menus" | "header-footer" | "blueprints" | "events";

// Content Manager's sub-nav and the webmaster sidebar's own flat tab list
// both grew past a comfortable single row (9 sub-tabs / 7 tabs) — grouped
// per WordPress/Wix/Webflow convention (Content vs Design vs Settings)
// instead of one long list. Pure render-layer grouping: no ContentSubTab/Tab
// value, route, or permission changed, so nothing else depends on this.
// NAV_GROUP_ORDER/NAV_GROUP_LABEL live in App.tsx since Shell's own flat Tab
// sidebar (webmaster view) groups by the same taxonomy.
const CONTENT_SUBTAB_GROUP: Record<ContentSubTab, NavGroup> = {
  pages: "content",
  posts: "content",
  media: "content",
  theme: "design",
  menus: "design",
  "header-footer": "design",
  blueprints: "design",
  languages: "settings",
  events: "settings",
};

export default function ContentManager({
  isSuper,
  showSitePicker,
  siteHost,
  setSiteHost,
  tenants,
  token,
}: {
  isSuper: boolean;
  showSitePicker: boolean;
  siteHost: string;
  setSiteHost: (host: string) => void;
  tenants: Array<Record<string, unknown>>;
  token: string;
}) {
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const activeSubTab = (location.pathname.split("/")[2] || "pages") as ContentSubTab;
  const subTabs: Array<{ id: ContentSubTab; labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "pages", labelKey: "pages-title", icon: FileText },
    { id: "posts", labelKey: "posts-title", icon: Newspaper },
    { id: "media", labelKey: "media-title", icon: ImageIcon },
    ...(isSuper
      ? [
          { id: "theme" as const, labelKey: "theme-title" as const, icon: Palette },
          { id: "languages" as const, labelKey: "tenant-languages-title" as const, icon: Globe },
          { id: "menus" as const, labelKey: "menus-title" as const, icon: ListTree },
          { id: "header-footer" as const, labelKey: "header-footer-title" as const, icon: PanelTop },
          { id: "blueprints" as const, labelKey: "blueprints-title" as const, icon: LayoutTemplate },
          { id: "events" as const, labelKey: "events-title" as const, icon: CalendarDays },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {showSitePicker && (
        <div className="max-w-sm space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("content-site")}</label>
          <Select value={siteHost} onValueChange={setSiteHost}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("content-pick")} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tn) => (
                <SelectItem key={tn.id as string} value={tn.host as string}>
                  {tn.departmentName as string} — {tn.host as string}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {siteHost && (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <nav className="flex flex-col gap-4 md:w-48 md:shrink-0 md:border-r md:border-line/30 md:pr-4">
            {NAV_GROUP_ORDER.map((group) => {
              const items = subTabs.filter((st) => CONTENT_SUBTAB_GROUP[st.id] === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="space-y-0.5">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t(NAV_GROUP_LABEL[group])}</div>
                  {items.map(({ id, labelKey, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => navigate(id)}
                      className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        activeSubTab === id ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">
          <Suspense fallback={<ListLoading />}>
          <Routes>
            <Route index element={<Navigate to="pages" replace />} />
            <Route path="pages" element={<PagesPanel tenantHost={siteHost} token={token} />} />
            <Route path="pages/:id" element={<PageDesignerRoute tenantHost={siteHost} token={token} isSuper={isSuper} />} />
            <Route path="posts" element={<PostsPanel key={`posts-${siteHost}`} tenantHost={siteHost} token={token} />} />
            <Route path="posts/categories" element={<CategoriesPanel tenantHost={siteHost} token={token} />} />
            <Route path="posts/:id" element={<PostEditorPage tenantHost={siteHost} token={token} />} />
            <Route path="media" element={<MediaManager key={`media-${siteHost}`} tenantHost={siteHost} token={token} />} />
            <Route path="menus" element={<MenusPanel tenantHost={siteHost} token={token} />} />
            <Route path="header-footer" element={<HeaderFooterPanel key={siteHost} tenantHost={siteHost} token={token} />} />
            <Route
              path="header-footer/:id"
              element={<HeaderFooterDesignerRoute tenantHost={siteHost} token={token} isSuper backTo="/content/header-footer" />}
            />
            {isSuper && (
              <Route path="theme" element={<ThemeForm key={siteHost} title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(siteHost, token)} save={(s) => api.putTheme(siteHost, token, s)} token={token} allowDeactivate previewTenantHost={siteHost} />} />
            )}
            {isSuper && (
              <Route path="languages" element={<TenantLanguagesForm key={siteHost} tenantHost={siteHost} token={token} />} />
            )}
            {isSuper && (
              <Route path="blueprints" element={<BlueprintGallery key={siteHost} tenantHost={siteHost} token={token} mode="manage" isSuper />} />
            )}
            {isSuper && (
              <Route path="blueprints/:id" element={<BlueprintDesignerRoute tenantHost={siteHost} token={token} isSuper backTo="/content/blueprints" />} />
            )}
            {isSuper && (
              <Route path="symbols/:id" element={<SymbolDesignerRoute tenantHost={siteHost} token={token} isSuper />} />
            )}
            {isSuper && (
              <Route path="events" element={<EventsPanel key={`events-${siteHost}`} tenantHost={siteHost} token={token} />} />
            )}
          </Routes>
          </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
