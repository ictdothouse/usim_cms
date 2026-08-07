// Server-side only fetch helpers for apps/api's public scope (no auth —
// see apps/api/src/index.ts's public route registration). tenantHost comes
// from the incoming request's Host header, forwarded as x-tenant-host.
const API_URL = import.meta.env.API_URL ?? "http://localhost:3000";
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
  // Page-wide Designer defaults — currently just the default column gap for
  // rows that don't set their own (see SectionBlock.astro's pageGap prop).
  settings?: { gap?: string };
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
  const { items } = await apiGet<{ items: Page[] }>("/api/pages", tenantHost, token);
  return items.find((p) => p.slug === slug) ?? null;
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
  const { items } = await apiGet<{ items: Post[] }>("/api/posts", tenantHost, token);
  return items.find((p) => p.slug === slug) ?? null;
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
