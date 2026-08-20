export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Base for the "View" link on a page/post. In production each tenant IS its
// own real domain (tenantHost), so no separate frontend URL is needed there.
// Locally there's one shared `astro dev` server, so this points at it with
// a `?__tenant=` override (see apps/frontend's [...slug].astro) letting the
// admin preview any local tenant, not just whichever one DEV_TENANT_HOST names.
const FRONTEND_DEV_URL = import.meta.env.VITE_FRONTEND_URL ?? "http://localhost:4321";
// previewToken is optional — a short-lived, read-only token minted by
// getPagePreviewToken() (never the admin's real session bearer, which
// doesn't expire — see apps/api's auth.ts) to preview a draft page before
// it's published. apps/frontend forwards it as a Bearer header to apps/api,
// whose public GET elevates to authenticated visibility for it (see
// generic-crud.ts's elevateIfAuthenticated); requireTenantAuth refuses it on
// every write route.
// themeToken is a separate, independent preview credential from
// previewToken (page-draft visibility vs not-yet-saved theme settings —
// see getThemePreviewToken) — both can be present at once, each forwarded
// by apps/frontend to the api route it actually applies to.
export const previewUrl = (tenantHost: string, slug: string, previewToken?: string, themeToken?: string) => {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(FRONTEND_DEV_URL);
  const query = new URLSearchParams({
    ...(isLocal ? { __tenant: tenantHost } : {}),
    ...(previewToken ? { token: previewToken } : {}),
    ...(themeToken ? { themeToken } : {}),
  }).toString();
  const base = isLocal ? `${FRONTEND_DEV_URL}/${slug}` : `https://${tenantHost}/${slug}`;
  return query ? `${base}?${query}` : base;
};

export interface Session {
  token: string;
  role: "superadmin" | "webmaster";
  tenantHost: string | null;
  tenantHosts: string[];
}

async function request(path: string, tenantHost: string | null, token: string | null, init?: RequestInit) {
  const headers: Record<string, string> = {};
  // Fastify's JSON body parser rejects an empty body when this header is
  // set (FST_ERR_CTP_EMPTY_JSON_BODY) — only send it when there's a body
  // (sharePage and any future bodyless call has none).
  if (init?.body) headers["Content-Type"] = "application/json";
  if (tenantHost) headers["x-tenant-host"] = tenantHost;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  // A 401 here always means the bearer we sent is missing/expired/signature-
  // mismatched (see requireTenantAuth/verifySuperadmin/verifyAnyUser in
  // apps/api) — never a permission problem (that's 403). Clearing the stored
  // session and reloading immediately avoids the confusing state of every
  // panel silently failing with "Invalid or expired token" while the UI
  // still looks logged in.
  if (token && res.status === 401) {
    localStorage.removeItem("usim_cms_session");
    window.location.reload();
    return new Promise(() => {});
  }
  const body = await res.json();
  // Hand-written routes return `{ error: "..." }` directly; a thrown Error
  // with `.statusCode` instead goes through Fastify's default error handler,
  // whose JSON body is `{ statusCode, error: "<generic reason phrase like
  // 'Bad Request'>", message: "<the actual thrown message>" }` — message
  // must win there, or every validateLayout/schema rejection just shows
  // "Bad Request" with the real reason silently discarded.
  if (!res.ok) throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
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
  return { token: body.token, role: body.role, tenantHost: body.tenantHost, tenantHosts: body.tenantHost ? [body.tenantHost] : [] };
}

// Superadmin "view as" — swaps in the target webmaster's real session
// (their own permissions/tenant), not a synthetic all-access preview.
export async function impersonateUser(token: string, userId: string): Promise<Session> {
  const body = await request("/api/portal/impersonate", null, token, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  return { token: body.token, role: body.role, tenantHost: body.tenantHost, tenantHosts: body.tenantHosts ?? [] };
}

export interface LoginResult {
  session?: Session;
  // Present instead of `session` when the account has TOTP enabled —
  // exchange this for a real session via verifyTotp() below.
  mfaRequired?: boolean;
  pendingToken?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const body = await request("/api/auth/login", null, null, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (body.mfaRequired) return { mfaRequired: true, pendingToken: body.pendingToken };
  return { session: { token: body.token, role: body.role, tenantHost: body.tenantHost, tenantHosts: body.tenantHosts ?? [] } };
}

export async function verifyTotp(pendingToken: string, code: string): Promise<Session> {
  const body = await request("/api/auth/totp-verify", null, null, {
    method: "POST",
    body: JSON.stringify({ pendingToken, code }),
  });
  return { token: body.token, role: body.role, tenantHost: body.tenantHost, tenantHosts: body.tenantHosts ?? [] };
}

export interface LoginSettings {
  mfaEnabled: boolean;
}

export const getLoginSettings = (token: string) =>
  request("/api/portal/login-settings", null, token).then((b) => ({ mfaEnabled: b.mfaEnabled as boolean }));

export const setLoginSettings = (token: string, mfaEnabled: boolean) =>
  request("/api/portal/login-settings", null, token, { method: "PUT", body: JSON.stringify({ mfaEnabled }) }).then(
    (b) => ({ mfaEnabled: b.mfaEnabled as boolean }),
  );

export const totpSetup = (token: string) =>
  request("/api/auth/totp-setup", null, token, { method: "POST" }).then((b) => ({
    secret: b.secret as string,
    otpauthUri: b.otpauthUri as string,
  }));

export const totpConfirm = (token: string, code: string) =>
  request("/api/auth/totp-confirm", null, token, { method: "POST", body: JSON.stringify({ code }) });

export const totpDisable = (token: string, code: string) =>
  request("/api/auth/totp-disable", null, token, { method: "POST", body: JSON.stringify({ code }) });

export const getMe = (token: string) =>
  request("/api/auth/me", null, token).then((b) => ({ totpEnabled: b.totpEnabled as boolean }));

export const getPages = (tenantHost: string, token: string) =>
  request("/api/pages", tenantHost, token).then((b) => b.items as Array<Record<string, unknown>>);

export const createPage = (tenantHost: string, token: string, data: { slug: string; title: string }) =>
  request("/api/pages", tenantHost, token, { method: "POST", body: JSON.stringify(data) }).then(
    (b) => b.item as Record<string, unknown>,
  );

// Mints a short-lived, read-only token for previewUrl() — see its comment.
export const getPagePreviewToken = (tenantHost: string, token: string, id: string) =>
  request(`/api/pages/${id}/preview-token`, tenantHost, token, { method: "POST" }).then((b) => b.token as string);

export const getPostPreviewToken = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}/preview-token`, tenantHost, token, { method: "POST" }).then((b) => b.token as string);

export const sharePage = (tenantHost: string, token: string, id: string) =>
  request(`/api/pages/${id}/publish`, tenantHost, token, { method: "POST" });

export const updatePage = (tenantHost: string, token: string, id: string, data: Record<string, unknown>) =>
  request(`/api/pages/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(data) });

export const deletePage = (tenantHost: string, token: string, id: string) =>
  request(`/api/pages/${id}`, tenantHost, token, { method: "DELETE" });

export const getPosts = (tenantHost: string, token: string) =>
  request("/api/posts", tenantHost, token).then((b) => b.items as Array<Record<string, unknown>>);

// Returns the created row (unlike before) so the quick-create flow can jump
// straight into the writing view for it, same pattern as createPage.
export const createPost = (tenantHost: string, token: string, data: { slug: string; title: string }) =>
  request("/api/posts", tenantHost, token, { method: "POST", body: JSON.stringify(data) }).then(
    (b) => b.item as Record<string, unknown>,
  );

export const updatePost = (tenantHost: string, token: string, id: string, data: Record<string, unknown>) =>
  request(`/api/posts/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(data) });

export const deletePost = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}`, tenantHost, token, { method: "DELETE" });

export const sharePost = (tenantHost: string, token: string, id: string) =>
  request(`/api/posts/${id}/publish`, tenantHost, token, { method: "POST" });

export interface PostRevision {
  id: string;
  postId: string;
  title: string;
  body: string;
  excerpt: string | null;
  bannerImageUrl: string | null;
  category: string | null;
  tags: string[];
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

export const listPostRevisions = (tenantHost: string, token: string, postId: string) =>
  request(`/api/posts/${postId}/revisions`, tenantHost, token).then((b) => b.items as PostRevision[]);

export const restorePostRevision = (tenantHost: string, token: string, postId: string, revisionId: string) =>
  request(`/api/posts/${postId}/revisions/${revisionId}/restore`, tenantHost, token, { method: "POST" }).then(
    (b) => b.item as Record<string, unknown>,
  );

export interface ContentSearchResult {
  type: "post" | "page";
  id: string;
  title: string;
  excerpt: string | null;
  bannerImageUrl: string | null;
  url: string;
}

export const searchContent = (tenantHost: string, token: string, q: string) =>
  request(`/api/content-search?q=${encodeURIComponent(q)}`, tenantHost, token).then((b) => b.items as ContentSearchResult[]);

export interface Category {
  id: string;
  name: string;
  slug: string;
  // i18n follow-up — off (default): `name` shown everywhere, unchanged.
  // On: translations[code].name is auto-translated from `name` then
  // freely editable per language (CategoriesPanel's language pills).
  translations: Record<string, { name: string }>;
  multilangEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const listCategories = (tenantHost: string, token: string) =>
  request("/api/categories", tenantHost, token).then((b) => b.items as Category[]);

export const createCategory = (tenantHost: string, token: string, name: string, slug: string) =>
  request("/api/categories", tenantHost, token, { method: "POST", body: JSON.stringify({ name, slug }) }).then((b) => b.item as Category);

export const updateCategory = (
  tenantHost: string,
  token: string,
  id: string,
  patch: Partial<Pick<Category, "name" | "translations" | "multilangEnabled">>,
) => request(`/api/categories/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(patch) });

export const deleteCategory = (tenantHost: string, token: string, id: string) =>
  request(`/api/categories/${id}`, tenantHost, token, { method: "DELETE" });

export interface MenuLinkFields {
  linkType: "page" | "post" | "category" | "custom";
  refId?: string;
  url?: string;
  target?: "_self" | "_blank";
}

export interface MenuMegaColumnItem extends MenuLinkFields {
  label: string;
  translations?: Record<string, { label: string }>;
  icon?: string;
  image?: string;
}

export interface MenuMegaColumn {
  heading?: string;
  items: MenuMegaColumnItem[];
}

export interface MenuItem extends MenuLinkFields {
  id: string;
  label: string;
  translations?: Record<string, { label: string }>;
  children?: MenuItem[];
  megaMenu?: { columns: MenuMegaColumn[] };
}

export interface Menu {
  id: string;
  name: string;
  items: MenuItem[];
  createdAt: string;
  updatedAt: string;
}

export const listMenus = (tenantHost: string, token: string) =>
  request("/api/menus", tenantHost, token).then((b) => b.items as Menu[]);

export const createMenu = (tenantHost: string, token: string, name: string) =>
  request("/api/menus", tenantHost, token, { method: "POST", body: JSON.stringify({ name }) }).then((b) => b.item as Menu);

export const updateMenu = (tenantHost: string, token: string, id: string, patch: Partial<Pick<Menu, "name" | "items">>) =>
  request(`/api/menus/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify(patch) }).then((b) => b.item as Menu);

export const deleteMenu = (tenantHost: string, token: string, id: string) =>
  request(`/api/menus/${id}`, tenantHost, token, { method: "DELETE" });

export interface DesignTemplate {
  id: string;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export const listTemplates = (tenantHost: string, token: string) =>
  request("/api/templates", tenantHost, token).then((b) => b.items as DesignTemplate[]);

export const createTemplate = (tenantHost: string, token: string, name: string, data: Record<string, unknown>) =>
  request("/api/templates", tenantHost, token, { method: "POST", body: JSON.stringify({ name, data }) });

export const deleteTemplate = (tenantHost: string, token: string, id: string) =>
  request(`/api/templates/${id}`, tenantHost, token, { method: "DELETE" });

export const getTheme = (tenantHost: string, token: string) =>
  request("/api/theme", tenantHost, token).then((b) => b.theme as Record<string, string>);

export const putTheme = (tenantHost: string, token: string, settings: Record<string, string>) =>
  request("/api/theme", tenantHost, token, { method: "PUT", body: JSON.stringify(settings) });

// i18n Phase 2 — per-tenant enabled-language subset.
export interface TenantLanguageSelection {
  allEnabled: SiteLanguage[];
  selectedCodes: string[] | null; // null = inherit all of allEnabled
  showHeaderSwitcher: boolean;
  // i18n Phase 5 — site-wide master switch; a post/page's own multilangEnabled
  // is inert while this is false (see index.ts's translation-create routes).
  multilangEnabled: boolean;
  // The language a post/page's own Language field defaults to when unset —
  // null = no default (falls back to the old "None" behavior).
  defaultLanguage: string | null;
}

export const getTenantLanguages = (tenantHost: string, token: string) =>
  request("/api/tenant-languages", tenantHost, token) as Promise<TenantLanguageSelection>;

export const putTenantLanguages = (tenantHost: string, token: string, codes: string[], showHeaderSwitcher: boolean, multilangEnabled: boolean, defaultLanguage: string | null) =>
  request("/api/tenant-languages", tenantHost, token, { method: "PUT", body: JSON.stringify({ codes, showHeaderSwitcher, multilangEnabled, defaultLanguage }) });

// i18n Phase 5 — a translation is content living on the SAME post/page row
// (see PostTranslations below), not a separate row — so there is no
// per-language fetch/create route to call here anymore.
export interface PostTranslations {
  [languageCode: string]: { title: string; excerpt: string; body: string };
}

export interface PageTranslations {
  [languageCode: string]: { layout: Array<{ type: string; props?: Record<string, unknown> }> };
}

// Real auto-translate (i18n Phase 5) — see apps/api/src/translate.ts.
// html:true runs the text through the HTML-stripping body translator;
// otherwise it's treated as a plain string (title/excerpt).
export const translateText = (tenantHost: string, token: string, text: string, target: string, opts?: { source?: string; html?: boolean }) =>
  request("/api/translate", tenantHost, token, {
    method: "POST",
    body: JSON.stringify({ text, target, source: opts?.source, html: opts?.html }),
  }).then((b) => b.translated as string);

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

export const renameMediaFolder = (tenantHost: string, token: string, id: string, name: string) =>
  request(`/api/media/folders/${id}`, tenantHost, token, { method: "PATCH", body: JSON.stringify({ name }) });

export const deleteMediaFolder = (tenantHost: string, token: string, id: string) =>
  request(`/api/media/folders/${id}`, tenantHost, token, { method: "DELETE" });

// Superadmin-only portal management (no x-tenant-host — these aren't scoped
// to one tenant).
export const listPortalTenants = (token: string) =>
  request("/api/portal/tenants", null, token).then((b) => b.tenants as Array<Record<string, unknown>>);

export interface TenantUsage {
  host: string;
  dbSizeBytes: number | null;
  diskSizeBytes: number | null;
}

export const getTenantsUsage = (token: string) =>
  request("/api/portal/tenants/usage", null, token).then((b) => b.usage as TenantUsage[]);

export const createPortalTenant = (token: string, host: string, departmentName: string) =>
  request("/api/portal/tenants", null, token, {
    method: "POST",
    body: JSON.stringify({ host, departmentName }),
  });

// Danger Zone: irreversible. confirm must equal host exactly (server
// re-checks the same thing — see index.ts's DELETE route).
export const deletePortalTenant = (token: string, host: string, confirm: string) =>
  request(`/api/portal/tenants/${host}`, null, token, {
    method: "DELETE",
    body: JSON.stringify({ confirm }),
  }) as Promise<{ deleted: boolean }>;

export interface ProxySettings {
  enabled: boolean;
  connected: boolean;
}

// Superadmin-only "Domain & SSL Automation" switch in the Settings tab —
// off by default (see CLAUDE.md's Deployment section). All of the below
// are no-ops on the server unless that switch is on.
export const getProxySettings = (token: string) =>
  request("/api/portal/proxy-settings", null, token) as Promise<ProxySettings>;

export const setProxyAutomationEnabled = (token: string, enabled: boolean) =>
  request("/api/portal/proxy-settings", null, token, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }) as Promise<{ enabled: boolean }>;

export const resyncProxy = (token: string) =>
  request("/api/portal/proxy-settings/resync", null, token, { method: "POST" }) as Promise<{
    synced: boolean;
    error?: string;
  }>;

// cert/key are PEM files (USIM's paid certificate) — forwarded to apps/api,
// which forwards them straight to Caddy without ever writing the key to
// its own disk or DB (see apps/api/src/proxy-sync.ts).
export async function uploadTenantCert(token: string, host: string, cert: File, key: File): Promise<{ certExpiresAt: string }> {
  const form = new FormData();
  form.append("cert", cert);
  form.append("key", key);
  const res = await fetch(`${API_URL}/api/portal/tenants/${host}/cert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  return body;
}

export const revertTenantCert = (token: string, host: string) =>
  request(`/api/portal/tenants/${host}/cert`, null, token, { method: "DELETE" });

export const listPortalUsers = (token: string) =>
  request("/api/portal/users", null, token).then((b) => b.users as Array<Record<string, unknown>>);

export const createPortalUser = (
  token: string,
  data: {
    email: string;
    password: string;
    role: string;
    tenantHosts?: string[];
    roleId?: string | null;
    extraPermissions?: string[];
  },
) => request("/api/portal/users", null, token, { method: "POST", body: JSON.stringify(data) });

export const updatePortalUserRole = (
  token: string,
  id: string,
  roleId: string | null,
  extraPermissions?: string[],
) =>
  request(`/api/portal/users/${id}`, null, token, {
    method: "PATCH",
    body: JSON.stringify({ roleId, extraPermissions }),
  });

export const updatePortalUserPassword = (token: string, id: string, password: string) =>
  request(`/api/portal/users/${id}`, null, token, { method: "PATCH", body: JSON.stringify({ password }) });

export const updatePortalUserTenantHosts = (token: string, id: string, tenantHosts: string[]) =>
  request(`/api/portal/users/${id}`, null, token, { method: "PATCH", body: JSON.stringify({ tenantHosts }) });

export const deletePortalUser = (token: string, id: string) =>
  request(`/api/portal/users/${id}`, null, token, { method: "DELETE" });

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

export interface CloneMeta {
  id: string;
  sourceHost: string;
  type: "full" | "design";
  createdAt: string;
  label?: string;
  stagingHost?: string;
}

export const prepareClone = (token: string, host: string, type: "full" | "design", label?: string) =>
  request(`/api/portal/tenants/${host}/clone-prepare`, null, token, {
    method: "POST",
    body: JSON.stringify({ type, label }),
  }) as Promise<CloneMeta>;

export const listClones = (token: string, host: string) =>
  request(`/api/portal/tenants/${host}/clones`, null, token).then((res) => (res as { clones: CloneMeta[] }).clones);

export const downloadClone = (token: string, id: string) =>
  downloadZip(`/api/portal/clones/${id}/download`, token, `clone-${id}.zip`);

export const stageClone = (token: string, id: string) =>
  request(`/api/portal/clones/${id}/stage`, null, token, { method: "POST" }) as Promise<{
    staged: boolean;
    stagingHost: string;
  }>;

export const promoteClone = (token: string, id: string, newHost: string, departmentName: string) =>
  request(`/api/portal/clones/${id}/promote`, null, token, {
    method: "POST",
    body: JSON.stringify({ newHost, departmentName }),
  }) as Promise<{ promoted: boolean; host: string }>;

export const replaceFromStaging = (token: string, host: string, stagingHost: string) =>
  request(`/api/portal/tenants/${host}/replace-from-staging`, null, token, {
    method: "POST",
    body: JSON.stringify({ stagingHost }),
  }) as Promise<{ replaced: boolean }>;

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

export const updatePortalRole = (token: string, id: string, permissions: string[], name?: string) =>
  request(`/api/portal/roles/${id}`, null, token, {
    method: "PATCH",
    body: JSON.stringify({ permissions, name }),
  });

export const deletePortalRole = (token: string, id: string) =>
  request(`/api/portal/roles/${id}`, null, token, { method: "DELETE" });

// Superadmin-curated master language list (i18n Phase 1).
export interface SiteLanguage {
  id: string;
  code: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
}

export const listPortalLanguages = (token: string) =>
  request("/api/portal/languages", null, token).then((b) => b.languages as SiteLanguage[]);

export const createPortalLanguage = (token: string, code: string, label: string) =>
  request("/api/portal/languages", null, token, { method: "POST", body: JSON.stringify({ code, label }) });

export const updatePortalLanguage = (
  token: string,
  id: string,
  patch: { label?: string; enabled?: boolean },
) => request(`/api/portal/languages/${id}`, null, token, { method: "PATCH", body: JSON.stringify(patch) });

export const deletePortalLanguage = (token: string, id: string) =>
  request(`/api/portal/languages/${id}`, null, token, { method: "DELETE" });

export const getGlobalTheme = (token: string) =>
  request("/api/portal/theme", null, token).then((b) => b.theme as Record<string, string>);

export const putGlobalTheme = (token: string, settings: Record<string, string>) =>
  request("/api/portal/theme", null, token, { method: "PUT", body: JSON.stringify(settings) });

// Personal "my collection" of saved theme presets — root-level, not
// tenant-scoped (see apps/api's verifyAnyUser), same shape either way
// regardless of whether the caller is on the Global or per-site Theme form.
export interface ThemePreset {
  id: string;
  name: string;
  settings: Record<string, string>;
  createdAt: string;
}

export const listThemePresets = (token: string) =>
  request("/api/theme-presets", null, token).then((b) => b.items as ThemePreset[]);

export const createThemePreset = (token: string, name: string, settings: Record<string, string>) =>
  request("/api/theme-presets", null, token, { method: "POST", body: JSON.stringify({ name, settings }) }).then(
    (b) => b.item as ThemePreset,
  );

export const deleteThemePreset = (token: string, id: string) =>
  request(`/api/theme-presets/${id}`, null, token, { method: "DELETE" });

// Mints a short-lived, read-only token so ThemeForm's "Test" button can open
// the real frontend with not-yet-saved settings applied — see previewUrl's
// comment for the same pattern used by page drafts.
export const getThemePreviewToken = (token: string, settings: Record<string, string>) =>
  request("/api/theme-preview-token", null, token, { method: "POST", body: JSON.stringify({ settings }) }).then(
    (b) => b.token as string,
  );

export const listPortalSharedContent = (token: string) =>
  request("/api/portal/shared-content", null, token).then((b) => b.items as Array<Record<string, unknown>>);
