export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Session {
  token: string;
  role: "superadmin" | "webmaster";
  tenantHost: string | null;
}

async function request(path: string, tenantHost: string | null, token: string | null, init?: RequestInit) {
  const headers: Record<string, string> = {};
  // Fastify's JSON body parser rejects an empty body when this header is
  // set (FST_ERR_CTP_EMPTY_JSON_BODY) — only send it when there's a body
  // (publishPage and any future bodyless call has none).
  if (init?.body) headers["Content-Type"] = "application/json";
  if (tenantHost) headers["x-tenant-host"] = tenantHost;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function login(email: string, password: string): Promise<Session> {
  const body = await request("/api/auth/login", null, null, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { token: body.token, role: body.role, tenantHost: body.tenantHost };
}

export const getPages = (tenantHost: string, token: string) =>
  request("/api/pages", tenantHost, token).then((b) => b.items as Array<Record<string, unknown>>);

export const createPage = (tenantHost: string, token: string, data: { slug: string; title: string }) =>
  request("/api/pages", tenantHost, token, { method: "POST", body: JSON.stringify(data) });

export const publishPage = (tenantHost: string, token: string, id: string) =>
  request(`/api/pages/${id}/publish`, tenantHost, token, { method: "POST" });

export const updatePage = (tenantHost: string, token: string, id: string, data: Record<string, unknown>) =>
  request(`/api/pages/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(data) });

export const deletePage = (tenantHost: string, token: string, id: string) =>
  request(`/api/pages/${id}`, tenantHost, token, { method: "DELETE" });

export const getTheme = (tenantHost: string, token: string) =>
  request("/api/theme", tenantHost, token).then((b) => b.theme as Record<string, string>);

export const putTheme = (tenantHost: string, token: string, settings: Record<string, string>) =>
  request("/api/theme", tenantHost, token, { method: "PUT", body: JSON.stringify(settings) });

export async function uploadMedia(tenantHost: string, token: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/media`, {
    method: "POST",
    headers: { "x-tenant-host": tenantHost, Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  return body.url as string;
}

// Superadmin-only portal management (no x-tenant-host — these aren't scoped
// to one tenant).
export const listPortalTenants = (token: string) =>
  request("/api/portal/tenants", null, token).then((b) => b.tenants as Array<Record<string, unknown>>);

export const createPortalTenant = (token: string, host: string, departmentName: string) =>
  request("/api/portal/tenants", null, token, {
    method: "POST",
    body: JSON.stringify({ host, departmentName }),
  });

export const listPortalUsers = (token: string) =>
  request("/api/portal/users", null, token).then((b) => b.users as Array<Record<string, unknown>>);

export const createPortalUser = (
  token: string,
  data: { email: string; password: string; role: string; tenantHost?: string },
) => request("/api/portal/users", null, token, { method: "POST", body: JSON.stringify(data) });

export const getGlobalTheme = (token: string) =>
  request("/api/portal/theme", null, token).then((b) => b.theme as Record<string, string>);

export const putGlobalTheme = (token: string, settings: Record<string, string>) =>
  request("/api/portal/theme", null, token, { method: "PUT", body: JSON.stringify(settings) });

export const listPortalSharedContent = (token: string) =>
  request("/api/portal/shared-content", null, token).then((b) => b.items as Array<Record<string, unknown>>);
