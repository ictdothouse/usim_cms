// Server-side only fetch helpers for apps/api's public scope (no auth —
// see apps/api/src/index.ts's public route registration). tenantHost comes
// from the incoming request's Host header, forwarded as x-tenant-host.
const API_URL = import.meta.env.API_URL ?? "http://localhost:3000";

export interface Page {
  id: string;
  slug: string;
  title: string;
  layout: Array<{ type: string; props?: Record<string, unknown> }>;
  bannerImageUrl: string | null;
}

async function apiGet<T>(path: string, tenantHost: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "x-tenant-host": tenantHost },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
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
