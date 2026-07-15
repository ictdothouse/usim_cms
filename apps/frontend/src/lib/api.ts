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

async function apiGet<T>(path: string, tenantHost: string): Promise<T> {
  const key = `${tenantHost}${path}`;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { "x-tenant-host": tenantHost },
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

export async function getPageBySlug(tenantHost: string, slug: string): Promise<Page | null> {
  const { items } = await apiGet<{ items: Page[] }>("/api/pages", tenantHost);
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
}

// Public scope only returns status='published' rows (RLS policy in
// apps/api migrations/0003_create_posts.sql).
export async function getPostBySlug(tenantHost: string, slug: string): Promise<Post | null> {
  const { items } = await apiGet<{ items: Post[] }>("/api/posts", tenantHost);
  return items.find((p) => p.slug === slug) ?? null;
}

export async function getTheme(tenantHost: string): Promise<Record<string, unknown>> {
  const { theme } = await apiGet<{ theme: Record<string, unknown> }>("/api/theme", tenantHost);
  return theme;
}
