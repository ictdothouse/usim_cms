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

export async function getTheme(tenantHost: string): Promise<Record<string, unknown>> {
  const { theme } = await apiGet<{ theme: Record<string, unknown> }>("/api/theme", tenantHost);
  return theme;
}
