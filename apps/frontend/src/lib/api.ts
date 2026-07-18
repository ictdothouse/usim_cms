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

export interface Page {
  id: string;
  slug: string;
  title: string;
  layout: Array<{ type: string; props?: Record<string, unknown> }>;
  bannerImageUrl: string | null;
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
    const cached = cache.get(key);
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
  tags: string[];
  authorEmail: string | null;
}

// Public scope only returns status='published' rows (RLS policy in
// apps/api migrations/0003_create_posts.sql — "private" posts fall in the
// same non-published branch as a draft, so they never reach here either).
// query, when given, narrows via apps/api's generic list filters (category/
// tag/authorId/authorEmail exact-match, from/to range on publishedAt) — see
// generic-crud.ts's buildListFilters.
export async function getPostBySlug(tenantHost: string, slug: string): Promise<Post | null> {
  const { items } = await apiGet<{ items: Post[] }>("/api/posts", tenantHost);
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

// token here is a theme-preview token (see apps/admin's getThemePreviewToken)
// — a separate credential from getPageBySlug's draft-visibility token, even
// though both ride the same Bearer-forwarding apiGet helper.
export async function getTheme(tenantHost: string, token?: string): Promise<Record<string, unknown>> {
  const { theme } = await apiGet<{ theme: Record<string, unknown> }>("/api/theme", tenantHost, token);
  return theme;
}
