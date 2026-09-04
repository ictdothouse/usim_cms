// Server-side only fetch helpers for apps/api's public scope (no auth —
// see apps/api/src/index.ts's public route registration). tenantHost comes
// from the incoming request's Host header, forwarded as x-tenant-host.
// process.env, not import.meta.env: Vite/Astro statically inlines
// import.meta.env.* at BUILD time, so a value only set at container runtime
// (docker-compose's API_URL: http://api:3000) would never be seen — the
// build-time fallback would get baked in permanently instead.
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const FETCH_TIMEOUT_MS = 5000;

// ponytail: in-memory stale-while-revalidate cache. CLAUDE.md: single
// instance, not one deployment per tenant, so one process-local Map is
// enough — lost on restart/deploy, add Redis if this ever runs multi-instance.
// Goal: an API blip never surfaces as a visitor-facing error page, only a
// slightly stale page.
const cache = new Map<string, unknown>();

type PageLayout = Array<{ type: string; props?: Record<string, unknown> }>;

export interface Page {
  id: string;
  slug: string;
  title: string;
  layout: PageLayout;
  bannerImageUrl: string | null;
  // Page-wide Designer defaults — column gap, content width, and left/right
  // padding that a Row/Section falls back to when it doesn't set its own (see
  // SectionBlock.astro's pageGap/pageContentWidth/pagePaddingX props), plus an
  // optional theme snapshot copied from a saved preset, overlaid onto the
  // tenant's own theme for this page's render only (see [...slug].astro).
  settings?: { gap?: string; contentWidth?: "contained" | "full"; paddingX?: string; theme?: Record<string, string> };
  // i18n Phase 5 — language is null until an author picks one for this
  // page's own base content; translations holds every OTHER language's
  // layout on this SAME row, keyed by code (no separate page per language —
  // see CLAUDE.md's i18n Phase 5 correction).
  language: string | null;
  translations: Record<string, { layout: PageLayout }>;
}

// Resolves which layout to render for a requested language code: the base
// layout when code is null/matches the page's own language/has no
// translation entry, otherwise that language's stored layout.
export function resolvePageLayout(page: Page, code: string | null): PageLayout {
  if (!code || code === page.language) return page.layout;
  return page.translations[code]?.layout ?? page.layout;
}

// token, when present, is forwarded as a Bearer header so apps/api's
// elevateIfAuthenticated (generic-crud.ts) includes draft rows for a valid
// admin session — this is what lets the admin preview a page before
// publishing it. The cache key gets a distinct suffix for token-bearing
// requests so a draft-inclusive response never becomes the stale-fallback
// served to an anonymous visitor if a later unauthenticated fetch fails.
async function apiGet<T>(path: string, tenantHost: string, token?: string): Promise<T> {
  const key = `${tenantHost}${path}${token ? ":preview" : ""}`;
  try {
    const headers: Record<string, string> = { "x-tenant-host": tenantHost };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    const data = (await res.json()) as T;
    cache.set(key, data);
    return data;
  } catch (err) {
    // Stale-cache fallback is for anonymous visitor traffic only (see the
    // module comment) — a token-bearing (preview) request must never fall
    // back to a stale cached response, since that could serve draft/private
    // content cached from an earlier, different, possibly-now-invalid token.
    const cached = !token ? cache.get(key) : undefined;
    if (cached !== undefined) {
      console.error(`apiGet: ${key} failed, serving stale cache`, err);
      return cached as T;
    }
    throw err;
  }
}

export async function getPageBySlug(tenantHost: string, slug: string, token?: string): Promise<Page | null> {
  // Filters straight to Postgres via generic-crud's buildListFilters (any
  // column name is an exact-match query param) instead of fetching every
  // page and searching in JS — same DB round-trip cost regardless of how
  // many pages the tenant has.
  const { items } = await apiGet<{ items: Page[] }>(`/api/pages?slug=${encodeURIComponent(slug)}`, tenantHost, token);
  return items[0] ?? null;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  body: string; // sanitized HTML (apps/api sanitizes on write)
  excerpt: string | null;
  bannerImageUrl: string | null;
  publishedAt: string | null;
  category: string | null;
  categorySlug: string | null;
  // Category i18n follow-up — {} unless the category itself opted into
  // multilangEnabled (see apps/api's postsAfterRead); "keep original name"
  // is just this staying empty, so resolveCategoryName falls through to
  // `category` above for every language.
  categoryTranslations: Record<string, { name: string }>;
  tags: string[];
  authorEmail: string | null;
  status: "draft" | "published" | "private";
  // Per-post override of the theme's site-wide show/hide default; null =
  // inherit the theme's showPost* setting (see getTheme's returned keys).
  showTags: boolean | null;
  showCategory: boolean | null;
  showAuthor: boolean | null;
  showPublishedDate: boolean | null;
  // i18n Phase 5 — language is null until an author picks one for this
  // post's own base content; translations holds every OTHER language's
  // {title, excerpt, body} on this SAME row, keyed by code (no separate
  // post per language — see CLAUDE.md's i18n Phase 5 correction).
  language: string | null;
  translations: Record<string, { title: string; excerpt: string; body: string }>;
}

// Resolves which title/excerpt/body to render for a requested language
// code: the base fields when code is null/matches the post's own
// language/has no translation entry, otherwise that language's stored copy.
export function resolvePostContent(post: Post, code: string | null): { title: string; excerpt: string | null; body: string } {
  if (!code || code === post.language) return { title: post.title, excerpt: post.excerpt, body: post.body };
  const tr = post.translations[code];
  return tr ? { title: tr.title, excerpt: tr.excerpt, body: tr.body } : { title: post.title, excerpt: post.excerpt, body: post.body };
}

// Category name for the requested language — falls back to the category's
// own name when it never opted into per-language names (multilangEnabled
// off) or has no entry for this code yet.
export function resolveCategoryName(post: Post, code: string | null): string | null {
  if (!code) return post.category;
  return post.categoryTranslations[code]?.name ?? post.category;
}

// Public scope only returns status='published' rows (RLS policy in
// apps/api migrations/0003_create_posts.sql — "private" posts fall in the
// same non-published branch as a draft, so they never reach here either).
// query, when given, narrows via apps/api's generic list filters (category/
// tag/authorId/authorEmail exact-match, from/to range on publishedAt) — see
// generic-crud.ts's buildListFilters.
export async function getPostBySlug(tenantHost: string, slug: string, token?: string): Promise<Post | null> {
  const { items } = await apiGet<{ items: Post[] }>(`/api/posts?slug=${encodeURIComponent(slug)}`, tenantHost, token);
  return items[0] ?? null;
}

export async function listPosts(
  tenantHost: string,
  query?: Record<string, string>,
): Promise<Post[]> {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  const { items } = await apiGet<{ items: Post[] }>(`/api/posts${qs}`, tenantHost);
  return items;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
}

// GET /api/categories is public (registerPublicCollectionRoutes in
// apps/api's index.ts) — used by category/[slug].astro to resolve a
// category's URL slug to its id before filtering posts, since posts.category
// is a virtual (afterRead-computed) field and can't be filtered directly —
// see generic-crud.ts's buildListFilters, which only matches real columns.
export async function listCategories(tenantHost: string): Promise<Category[]> {
  const { items } = await apiGet<{ items: Category[] }>("/api/categories", tenantHost);
  return items;
}

// Events calendar (UX audit backlog "Event listing" element) — referenced,
// not copied, the same way listPosts backs postlist: EventListBlock.astro
// fetches and filters/sorts (upcoming-first) at render time.
export interface EventItem {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string | null;
  location: string | null;
  imageUrl: string | null;
  registrationUrl: string | null;
}

export async function listEvents(tenantHost: string): Promise<EventItem[]> {
  const { items } = await apiGet<{ items: EventItem[] }>("/api/events?status=published", tenantHost);
  return items;
}

// i18n Phase 3 — whether/what the site's header language switcher offers.
// Not cached through apiGet's stale-while-revalidate path (deliberately
// simple): this is a small, rarely-changing settings fetch, not core page
// content whose absence would break the page.
export interface SiteLanguageInfo {
  code: string;
  label: string;
}

export async function getLanguages(tenantHost: string): Promise<{ enabled: SiteLanguageInfo[]; showHeaderSwitcher: boolean }> {
  return apiGet("/api/languages", tenantHost);
}

// token here is a theme-preview token (see apps/admin's getThemePreviewToken)
// — a separate credential from getPageBySlug's draft-visibility token, even
// though both ride the same Bearer-forwarding apiGet helper.
export async function getTheme(tenantHost: string, token?: string): Promise<Record<string, unknown>> {
  const { theme } = await apiGet<{ theme: Record<string, unknown> }>("/api/theme", tenantHost, token);
  return theme;
}

// Backs blueprint-preview.astro (Designer's blueprint Live Edit iframe) —
// a blueprint has no slug/route of its own, so unlike getPageBySlug this
// has no anonymous-visitor case at all: token is always required, and a
// failed/missing preview always resolves to null rather than a stale-cache
// fallback (apiGet already refuses stale-cache for any token-bearing call).
export interface BlueprintPreview {
  id: string;
  layout: PageLayout;
  settings?: Page["settings"];
}

export async function getBlueprintPreview(tenantHost: string, id: string, token: string): Promise<BlueprintPreview | null> {
  try {
    const { item } = await apiGet<{ item: BlueprintPreview }>(`/api/blueprints/${id}/preview`, tenantHost, token);
    return item;
  } catch {
    return null;
  }
}

export interface MenuItem {
  id: string;
  label: string;
  translations?: Record<string, { label: string }>;
  linkType: "page" | "post" | "category" | "custom";
  refId?: string;
  url?: string;
  target?: "_self" | "_blank";
  children?: MenuItem[];
  megaMenu?: {
    columns: Array<{
      heading?: string;
      items: Array<{
        label: string;
        translations?: Record<string, { label: string }>;
        linkType: "page" | "post" | "category" | "custom";
        refId?: string;
        url?: string;
        target?: "_self" | "_blank";
        icon?: string;
        image?: string;
      }>;
    }>;
  };
}

export interface Menu {
  id: string;
  name: string;
  items: MenuItem[];
}

export async function getMenu(tenantHost: string, id: string): Promise<Menu | null> {
  if (!id) return null;
  try {
    const { item } = await apiGet<{ item: Menu | null }>(`/api/menus/${id}`, tenantHost);
    return item;
  } catch (err) {
    // A menuId can reference a since-deleted menu (deleted from the admin
    // after a page/Designer element still points at it) — MenuBlock.astro
    // already renders nothing for menu === null, so failing soft here keeps
    // a missing menu a no-op nav instead of a whole-page 500.
    console.error(`getMenu: ${id} failed, rendering no menu`, err);
    return null;
  }
}

// Resolved, render-ready shape — href is always a plain string (already
// slug-resolved for page/post/category links), label is already the
// requested language's own translation (or the item's stored default).
export interface ResolvedMenuLink {
  label: string;
  href: string;
  target: "_self" | "_blank";
}
export interface ResolvedMenuItem extends ResolvedMenuLink {
  children?: ResolvedMenuItem[];
  megaMenu?: { columns: Array<{ heading: string; items: Array<ResolvedMenuLink & { icon?: string; image?: string }> }> };
}

// The lists a menu's page/post/category links resolve against — fetched at
// most ONCE per resolveMenuTree call (see fetchMenuLinkTargets), not once
// per menu item, to avoid an N-item nav firing N sequential full-list
// round-trips (each pulling every page's full layout jsonb).
interface MenuLinkTargets {
  pages: Array<{ id: string; slug: string; language: string | null }>;
  posts: Array<{ id: string; slug: string; language: string | null }>;
  categories: Array<{ id: string; slug: string }>;
}

async function fetchMenuLinkTargets(tenantHost: string): Promise<MenuLinkTargets> {
  // Sequential, not Promise.all — this codebase's own i18n notes (CLAUDE.md)
  // call out a real Postgres 40P01 deadlock from firing concurrent requests
  // against a cold/unmigrated tenant DB connection (ensureTenantDatabase's
  // own DDL race); a menu can be the first thing resolved on a fresh tenant.
  const pages = (await apiGet<{ items: MenuLinkTargets["pages"] }>("/api/pages", tenantHost)).items;
  const posts = (await apiGet<{ items: MenuLinkTargets["posts"] }>("/api/posts", tenantHost)).items;
  const categories = (await apiGet<{ items: MenuLinkTargets["categories"] }>("/api/categories", tenantHost)).items;
  return { pages, posts, categories };
}

// Matches [...slug].astro's/posts/[slug].astro's own langSwitcher href
// convention exactly: omit ?lang when it already matches the linked row's
// own base language, since resolvePageLayout/resolvePostContent already
// no-op in that case anyway.
function withLangParam(path: string, baseLanguage: string | null, lang: string | null): string {
  if (!lang || lang === baseLanguage) return path;
  return `${path}?lang=${encodeURIComponent(lang)}`;
}

function resolveHref(linkType: MenuItem["linkType"], refId: string | undefined, url: string | undefined, targets: MenuLinkTargets, lang: string | null): string {
  if (linkType === "custom") return url ?? "#";
  if (!refId) return "#";
  if (linkType === "page") {
    const page = targets.pages.find((p) => p.id === refId);
    return page ? withLangParam(`/${page.slug}`, page.language, lang) : "#";
  }
  if (linkType === "post") {
    const post = targets.posts.find((p) => p.id === refId);
    return post ? withLangParam(`/posts/${post.slug}`, post.language, lang) : "#";
  }
  // Category archive page is documented as not language-aware — no ?lang.
  const category = targets.categories.find((c) => c.id === refId);
  return category ? `/category/${category.slug}` : "#";
}

function resolveLabel(label: string, translations: Record<string, { label: string }> | undefined, lang: string | null): string {
  if (lang && translations?.[lang]) return translations[lang].label;
  return label;
}

function resolveLink(
  lang: string | null,
  targets: MenuLinkTargets,
  o: { label: string; translations?: Record<string, { label: string }>; linkType: MenuItem["linkType"]; refId?: string; url?: string; target?: "_self" | "_blank" },
): ResolvedMenuLink {
  return {
    label: resolveLabel(o.label, o.translations, lang),
    href: resolveHref(o.linkType, o.refId, o.url, targets, lang),
    target: o.target ?? "_self",
  };
}

export async function resolveMenuTree(items: MenuItem[], lang: string | null, tenantHost: string): Promise<ResolvedMenuItem[]> {
  const targets = await fetchMenuLinkTargets(tenantHost);
  return resolveMenuTreeWithTargets(items, lang, targets);
}

function resolveMenuTreeWithTargets(items: MenuItem[], lang: string | null, targets: MenuLinkTargets): ResolvedMenuItem[] {
  return items.map((item) => {
    const out: ResolvedMenuItem = { ...resolveLink(lang, targets, item) };
    if (item.megaMenu) {
      out.megaMenu = {
        columns: item.megaMenu.columns.map((col) => ({
          heading: col.heading || "",
          items: col.items.map((colItem) => ({
            ...resolveLink(lang, targets, colItem),
            icon: colItem.icon,
            image: colItem.image,
          })),
        })),
      };
    } else if (item.children) {
      out.children = resolveMenuTreeWithTargets(item.children, lang, targets);
    }
    return out;
  });
}
