export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Base for the "View" link on a page/post. In production each tenant IS its
// own real domain (tenantHost), so no separate frontend URL is needed there.
// Locally there's one shared `astro dev` server, so this points at it with
// a `?__tenant=` override (see apps/frontend's [...slug].astro) letting the
// admin preview any local tenant, not just whichever one DEV_TENANT_HOST names.
const FRONTEND_DEV_URL = import.meta.env.VITE_FRONTEND_URL ?? "http://localhost:4321";
export const previewUrl = (tenantHost: string, slug: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)/.test(FRONTEND_DEV_URL)
    ? `${FRONTEND_DEV_URL}/${slug}?__tenant=${encodeURIComponent(tenantHost)}`
    : `https://${tenantHost}/${slug}`;

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

export const getSetupStatus = () =>
  request("/api/setup/status", null, null).then((b) => b.needsSetup as boolean);

export async function setup(input: {
  email: string;
  password: string;
  host?: string;
  departmentName?: string;
}): Promise<Session> {
  const body = await request("/api/setup", null, null, { method: "POST", body: JSON.stringify(input) });
  return { token: body.token, role: body.role, tenantHost: body.tenantHost };
}

// Superadmin "view as" — swaps in the target webmaster's real session
// (their own permissions/tenant), not a synthetic all-access preview.
export async function impersonateUser(token: string, userId: string): Promise<Session> {
  const body = await request("/api/portal/impersonate", null, token, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  return { token: body.token, role: body.role, tenantHost: body.tenantHost };
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

export const getPosts = (tenantHost: string, token: string) =>
  request("/api/posts", tenantHost, token).then((b) => b.items as Array<Record<string, unknown>>);

export const createPost = (tenantHost: string, token: string, data: { slug: string; title: string }) =>
  request("/api/posts", tenantHost, token, { method: "POST", body: JSON.stringify(data) });

export const updatePost = (tenantHost: string, token: string, id: string, data: Record<string, unknown>) =>
  request(`/api/posts/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(data) });

export const deletePost = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}`, tenantHost, token, { method: "DELETE" });

export const sharePost = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}/publish`, tenantHost, token, { method: "POST" });

export const getTheme = (tenantHost: string, token: string) =>
  request("/api/theme", tenantHost, token).then((b) => b.theme as Record<string, string>);

export const putTheme = (tenantHost: string, token: string, settings: Record<string, string>) =>
  request("/api/theme", tenantHost, token, { method: "PUT", body: JSON.stringify(settings) });

export async function uploadMedia(tenantHost: string, token: string, file: File, folderId?: string | null): Promise<string> {
  const form = new FormData();
  // folderId MUST be appended before "file": the API reads it off busboy's
  // fields-seen-so-far at the point it opens the file stream.
  if (folderId) form.append("folderId", folderId);
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

export const listMedia = (tenantHost: string, token: string, folderId?: string | null) =>
  request(folderId ? `/api/media?folderId=${folderId}` : "/api/media", tenantHost, token).then(
    (b) => b.items as Array<Record<string, unknown>>,
  );

export const updateMedia = (
  tenantHost: string,
  token: string,
  id: string,
  data: { originalName?: string; altText?: string | null; description?: string | null; folderId?: string | null },
) => request(`/api/media/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(data) });

export const deleteMedia = (tenantHost: string, token: string, id: string) =>
  request(`/api/media/${id}`, tenantHost, token, { method: "DELETE" });

export const listMediaFolders = (tenantHost: string, token: string) =>
  request("/api/media/folders", tenantHost, token).then((b) => b.items as Array<Record<string, unknown>>);

export const createMediaFolder = (tenantHost: string, token: string, name: string) =>
  request("/api/media/folders", tenantHost, token, { method: "POST", body: JSON.stringify({ name }) });

export const deleteMediaFolder = (tenantHost: string, token: string, id: string) =>
  request(`/api/media/folders/${id}`, tenantHost, token, { method: "DELETE" });

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
  data: { email: string; password: string; role: string; tenantHost?: string; roleId?: string | null },
) => request("/api/portal/users", null, token, { method: "POST", body: JSON.stringify(data) });

export const updatePortalUserRole = (token: string, id: string, roleId: string | null) =>
  request(`/api/portal/users/${id}`, null, token, {
    method: "PATCH",
    body: JSON.stringify({ roleId }),
  });

// Binary downloads (backup / static export) — plain <a href> can't carry the
// Authorization header, so fetch to a blob and click a synthetic link.
async function downloadZip(path: string, token: string, fallbackName: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const downloadTenantBackup = (token: string, host: string) =>
  downloadZip(`/api/portal/tenants/${host}/backup`, token, `backup-${host}.zip`);

export const downloadStaticExport = (token: string, host: string) =>
  downloadZip(`/api/portal/tenants/${host}/static-export`, token, `static-${host}.zip`);

export async function restoreTenantBackup(token: string, host: string, file: File): Promise<number> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/portal/tenants/${host}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Restore failed");
  return body.restored as number;
}

export const listPortalRoles = (token: string) =>
  request("/api/portal/roles", null, token).then((b) => b.roles as Array<Record<string, unknown>>);

export const createPortalRole = (token: string, name: string, permissions: string[]) =>
  request("/api/portal/roles", null, token, { method: "POST", body: JSON.stringify({ name, permissions }) });

export const updatePortalRole = (token: string, id: string, permissions: string[]) =>
  request(`/api/portal/roles/${id}`, null, token, {
    method: "PATCH",
    body: JSON.stringify({ permissions }),
  });

export const deletePortalRole = (token: string, id: string) =>
  request(`/api/portal/roles/${id}`, null, token, { method: "DELETE" });

export const getGlobalTheme = (token: string) =>
  request("/api/portal/theme", null, token).then((b) => b.theme as Record<string, string>);

export const putGlobalTheme = (token: string, settings: Record<string, string>) =>
  request("/api/portal/theme", null, token, { method: "PUT", body: JSON.stringify(settings) });

export const listPortalSharedContent = (token: string) =>
  request("/api/portal/shared-content", null, token).then((b) => b.items as Array<Record<string, unknown>>);
