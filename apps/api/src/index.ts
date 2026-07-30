import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { tenantPlugin } from "./plugins/tenant.js";
import { requireTenantAuth, verifySuperadmin, verifyAnyUser } from "./plugins/auth.js";
import { registerPublicCollectionRoutes, registerProtectedCollectionRoutes } from "./plugins/generic-crud.js";
import type { AccessArgs, CollectionConfig } from "./collections/config-types.js";
import { validateLayout } from "./collections/validate-layout.js";
import * as schema from "./db/schema.js";
import {
  closePool,
  listSharedContent,
  getGlobalTheme,
  setGlobalTheme,
  listThemePresets,
  createThemePreset,
  deleteThemePreset,
  findUserByEmail,
  listTenants,
  createTenant,
  deleteTenant,
  listUsers,
  createUser,
  updateUserRole,
  updateUserPassword,
  updateUserTenantHosts,
  deleteUser,
  getRolePermissions,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getMergedTheme,
  setTenantTheme,
} from "./db/tenant-pool.js";
import sanitizeHtml from "sanitize-html";
import { verifyPassword, hashPassword, signSession, verifySession } from "./db/auth.js";
import {
  exportTenantBackup,
  importTenantBackup,
  exportStaticSite,
  exportTenantDesignClone,
  prepareClone,
  listClones,
  getClone,
  markCloneStaged,
  looksLikeDomain,
} from "./backup.js";
import { uploadFile, deleteFile, localUploadsDir, isLocalDriver } from "./storage.js";

// Fixed permission matrix (resource.action) a superadmin composes into named
// roles (schema.ts's roles.permissions) and assigns per webmaster user — see
// docs/superpowers/specs/2026-07-13-admin-branding-features-design.md §12,
// superseded 2026-07-14 from a per-user capability toggle to this full role
// system per user request. "users.manage" stays a stored-but-unenforced
// placeholder: no tenant-scoped multi-user endpoint exists yet to gate.
const PERMISSIONS = new Set([
  "pages.create",
  "pages.update",
  "pages.delete",
  "posts.create",
  "posts.update",
  "posts.delete",
  "media.upload",
  "media.delete",
  "theme.write",
  "users.manage",
  "sites.multi",
]);

// Superadmin bypasses every permission check — a role's permissions are only
// ever consulted for webmaster sessions.
function hasPermission(args: AccessArgs, permission: string): boolean {
  return args.role === "superadmin" || (args.permissions ?? []).includes(permission);
}

function mergePermissions(rolePermissions: string[], extraPermissions: string[] | null): string[] {
  return Array.from(new Set([...rolePermissions, ...(extraPermissions ?? [])]));
}

function validatePermissions(permissions: unknown): string | null {
  if (permissions === undefined) return null;
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
    return "permissions must be a string array";
  }
  const unknown = permissions.find((p) => !PERMISSIONS.has(p));
  return unknown ? `unknown permission: ${unknown}` : null;
}

const THEME_COLOR_KEYS = ["primaryColor", "secondaryColor", "backgroundColor", "textColor"] as const;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Letters/digits/space only — this string ends up inside a Google Fonts URL
// built by apps/frontend, so it must not carry `/`, `?`, `<`, etc.
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;
// pages.settings.gap (and Row.gap inside pages.layout) is interpolated
// directly into a raw CSS string by SectionBlock.astro
// (`gap:${row.gap ?? pageGap ?? "2rem"}`), not set via a safe DOM style API —
// an unconstrained value could break out of that one declaration via `;` and
// inject arbitrary CSS (or worse) into every visitor's page for this tenant.
// Same "reject anything that isn't a bare number+unit" defense as the color/
// font checks above, expressed as a JSON-schema pattern so Fastify's AJV
// validation rejects a bad value before it ever reaches the DB.
const GAP_PATTERN = "^$|^[0-9]+(\\.[0-9]+)?(px|rem|em|%|vh|vw)?$";

// fontFamily = body font; headingFont/postTitleFont are the other two roles
// in the type system (Header/Title, Blog/Post Title) — all three end up in
// the same Google Fonts URL, so all three validate the same way.
const FONT_KEYS = ["fontFamily", "headingFont", "subHeadingFont", "postTitleFont"] as const;

// Site-wide default for whether a post shows its tags/category/author/date —
// per-post can override this (posts.showTags etc., nullable booleans, null =
// inherit these). "true"/"false" strings, same wire convention as every
// other theme key (see postTitleFontSize below) — "" means unset/inherit.
const POST_DISPLAY_KEYS = ["showPostTags", "showPostCategory", "showPostAuthor", "showPostDate"] as const;
const POST_TITLE_FONT_SIZE_MIN = 12;
const POST_TITLE_FONT_SIZE_MAX = 96;

// Shared by both theme write routes (per-tenant + global). site_theme.settings
// is an open JSONB bag but only these keys are ever read by apps/frontend
// (BaseLayout.astro, posts/[slug].astro) — reject anything else instead of
// silently storing it.
function validateThemeSettings(settings: Record<string, unknown>): string | null {
  const allowed = new Set([...THEME_COLOR_KEYS, ...FONT_KEYS, ...POST_DISPLAY_KEYS, "logoUrl", "postTitleFontSize"]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) return `unknown theme key: ${key}`;
  }
  for (const key of THEME_COLOR_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && !HEX_COLOR_RE.test(value as string)) {
      return `${key} must be a hex color like #003399`;
    }
  }
  for (const key of FONT_KEYS) {
    const value = settings[key];
    if (value !== undefined && !FONT_FAMILY_RE.test(value as string)) {
      return `${key} must contain only letters, digits, and spaces`;
    }
  }
  if (settings.logoUrl !== undefined && typeof settings.logoUrl !== "string") {
    return "logoUrl must be a string";
  }
  const fontSize = settings.postTitleFontSize;
  if (fontSize !== undefined && fontSize !== "") {
    const n = Number(fontSize);
    if (!Number.isFinite(n) || n < POST_TITLE_FONT_SIZE_MIN || n > POST_TITLE_FONT_SIZE_MAX) {
      return `postTitleFontSize must be a number between ${POST_TITLE_FONT_SIZE_MIN} and ${POST_TITLE_FONT_SIZE_MAX}`;
    }
  }
  for (const key of POST_DISPLAY_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && value !== "true" && value !== "false") {
      return `${key} must be "true" or "false"`;
    }
  }
  return null;
}

const app = Fastify({ logger: true });

// Without this, one uncaught error anywhere takes down all 50 tenants at
// once. Log and exit fast instead of continuing in a possibly-corrupt
// state — a process manager (pm2/systemd) must restart it on exit.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (err) => {
    app.log.fatal({ err }, `${event}, shutting down`);
    process.exit(1);
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await app.close();
    await closePool();
    process.exit(0);
  });
}

// Dev-open CORS so apps/admin (different port) can call this API. Lock
// `origin` down to the real admin domain before any real deployment.
await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-tenant-host"],
});
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
// Only serves files when STORAGE_DRIVER=local (default) — an S3-backed
// upload returns a full external URL and doesn't need this at all.
if (isLocalDriver) {
  await app.register(fastifyStatic, { root: localUploadsDir, prefix: "/uploads/" });
}

app.get("/health", async () => ({ status: "ok" }));

// First-run bootstrap: creates the very first superadmin (chicken-and-egg —
// every other user-management route requires an existing superadmin token).
// Self-disabling: once any user row exists, both routes permanently refuse,
// so this is only ever a live unauthenticated endpoint on a brand-new install.
app.get("/api/setup/status", async () => {
  const users = await listUsers();
  return { needsSetup: users.length === 0 };
});

app.post("/api/setup", async (req, reply) => {
  const users = await listUsers();
  if (users.length > 0) {
    reply.code(403);
    return { error: "Setup already completed" };
  }
  const { email, password, host, departmentName } = req.body as {
    email?: string;
    password?: string;
    host?: string;
    departmentName?: string;
  };
  if (!email || !password) {
    reply.code(400);
    return { error: "email and password required" };
  }
  if (host && !departmentName) {
    reply.code(400);
    return { error: "departmentName required when host is set" };
  }
  await createUser(email, hashPassword(password), "superadmin", null, null);
  if (host) {
    await createTenant(host, departmentName!, null);
  }
  const token = signSession({
    userId: (await findUserByEmail(email))!.id,
    email,
    role: "superadmin",
    tenantHost: null,
    permissions: [],
  });
  return { token, role: "superadmin", tenantHost: null };
});

app.post("/api/auth/login", async (req, reply) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    reply.code(400);
    return { error: "email and password required" };
  }
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    reply.code(401);
    return { error: "invalid credentials" };
  }
  const token = signSession({
    userId: user.id,
    email: user.email,
    role: user.role as "superadmin" | "webmaster",
    tenantHost: user.tenantHost,
    tenantHosts: (user.tenantHosts as string[] | null) ?? [],
    permissions: mergePermissions(
      await getRolePermissions(user.roleId as string | null),
      user.extraPermissions as string[] | null,
    ),
  });
  return { token, role: user.role, tenantHost: user.tenantHost, tenantHosts: (user.tenantHosts as string[] | null) ?? [] };
});

// Cross-department aggregator (portal), reads public.shared_content directly
// — not tenant-gated, since it's not any one tenant's data.
app.get("/api/portal/shared-content", async () => {
  const items = await listSharedContent();
  return { items };
});

// Read-only: what the superadmin has set globally.
app.get("/api/portal/theme", async () => {
  const theme = await getGlobalTheme();
  return { theme };
});

// Superadmin-only management routes — none of these are tenant-scoped, so
// they live at the root, gated by verifySuperadmin instead of tenantPlugin.
app.put("/api/portal/theme", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const settings = req.body as Record<string, unknown>;
  const error = validateThemeSettings(settings);
  if (error) {
    reply.code(400);
    return { error };
  }
  await setGlobalTheme(settings);
  return { saved: true };
});

// Personal "my collection" of saved theme presets (admin's Theme panel) —
// any logged-in user (superadmin or webmaster), scoped to their own userId,
// not tenant-gated at all (see verifyAnyUser's comment).
app.get("/api/theme-presets", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  return { items: await listThemePresets(session.userId) };
});

app.post("/api/theme-presets", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const { name, settings } = req.body as { name?: string; settings?: Record<string, unknown> };
  if (!name?.trim()) {
    reply.code(400);
    return { error: "name is required" };
  }
  const error = validateThemeSettings(settings ?? {});
  if (error) {
    reply.code(400);
    return { error };
  }
  const item = await createThemePreset(session.userId, name.trim(), settings ?? {});
  reply.code(201);
  return { item };
});

app.delete("/api/theme-presets/:id", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const { id } = req.params as { id: string };
  const deleted = await deleteThemePreset(session.userId, id);
  if (!deleted) {
    reply.code(404);
    return { error: "not found" };
  }
  return { deleted: true, id };
});

// Mints a short-lived, read-only token that lets GET /api/theme render
// not-yet-saved settings (ThemeForm's "Test" button, either a saved preset
// or whatever's currently in the form) for one request, without writing to
// site_theme — same previewOnly/exp pattern as a page's preview-token.
app.post("/api/theme-preview-token", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const settings = (req.body as { settings?: Record<string, unknown> })?.settings ?? {};
  const error = validateThemeSettings(settings);
  if (error) {
    reply.code(400);
    return { error };
  }
  const token = signSession({
    ...session,
    previewOnly: true,
    exp: Date.now() + 5 * 60 * 1000,
    themePreview: settings as Record<string, string>,
  });
  return { token };
});

app.get("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { tenants: await listTenants() };
});

app.post("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host, departmentName, dbUrl } = req.body as {
    host?: string;
    departmentName?: string;
    dbUrl?: string;
  };
  if (!host || !departmentName) {
    reply.code(400);
    return { error: "host and departmentName required" };
  }
  await createTenant(host, departmentName, dbUrl || null);
  return { created: true };
});

// Danger Zone: irreversible. Requires the caller to echo the host back
// exactly (the admin's type-to-confirm box) — a second, server-side check
// of the same confirmation, not just client-side UX.
app.delete("/api/portal/tenants/:host", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  const { confirm } = req.body as { confirm?: string };
  if (confirm !== host) {
    reply.code(400);
    return { error: "confirm must match the site's host exactly" };
  }
  await deleteTenant(host);
  if (isLocalDriver) {
    const tenantFolder = host.toLowerCase().replace(/[^a-z0-9]/g, "_");
    await rm(path.join(localUploadsDir, tenantFolder), { recursive: true, force: true });
  }
  return { deleted: true };
});

app.get("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { users: await listUsers() };
});

app.post("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { email, password, role, tenantHost, tenantHosts, roleId, extraPermissions } = req.body as {
    email?: string;
    password?: string;
    role?: string;
    tenantHost?: string;
    tenantHosts?: string[];
    roleId?: string | null;
    extraPermissions?: string[];
  };
  const hosts = tenantHosts?.length ? tenantHosts : tenantHost ? [tenantHost] : [];
  if (!email || !password || !role || (role === "webmaster" && hosts.length === 0)) {
    reply.code(400);
    return { error: "email, password, role required (at least one site required for webmaster)" };
  }
  const permError = validatePermissions(extraPermissions);
  if (permError) {
    reply.code(400);
    return { error: permError };
  }
  if (hosts.length > 1) {
    const effective = mergePermissions(await getRolePermissions(roleId ?? null), extraPermissions ?? []);
    if (!effective.includes("sites.multi")) {
      reply.code(400);
      return { error: "role/permissions don't allow multiple sites" };
    }
  }
  await createUser(email, hashPassword(password), role, hosts[0] ?? null, roleId ?? null, hosts, extraPermissions ?? []);
  return { created: true };
});

app.patch("/api/portal/users/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const { roleId, extraPermissions, password, tenantHosts } = req.body as {
    roleId?: string | null;
    extraPermissions?: string[];
    password?: string;
    tenantHosts?: string[];
  };
  // Each field only touches its own column when present — omitting roleId
  // (e.g. a password-only edit) must never fall through to `?? null` and
  // wipe an existing role assignment.
  if (roleId !== undefined || extraPermissions !== undefined) {
    const permError = validatePermissions(extraPermissions);
    if (permError) {
      reply.code(400);
      return { error: permError };
    }
    await updateUserRole(id, roleId ?? null, extraPermissions);
  }
  if (password) {
    await updateUserPassword(id, hashPassword(password));
  }
  if (tenantHosts) {
    if (tenantHosts.length === 0) {
      reply.code(400);
      return { error: "at least one site required" };
    }
    await updateUserTenantHosts(id, tenantHosts);
  }
  return { saved: true };
});

// Danger Zone-adjacent: irreversible, so refuse deleting the account making
// the request (a superadmin locking themselves out would have no other way
// back in).
app.delete("/api/portal/users/:id", async (req, reply) => {
  const session = verifySuperadmin(req, reply);
  if (!session) return;
  const { id } = req.params as { id: string };
  if (id === session.userId) {
    reply.code(400);
    return { error: "cannot delete your own account" };
  }
  await deleteUser(id);
  return { deleted: true };
});

app.get("/api/portal/roles", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { roles: await listRoles() };
});

app.post("/api/portal/roles", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { name, permissions } = req.body as { name?: string; permissions?: string[] };
  if (!name) {
    reply.code(400);
    return { error: "name required" };
  }
  const permError = validatePermissions(permissions);
  if (permError) {
    reply.code(400);
    return { error: permError };
  }
  await createRole(name, permissions ?? []);
  return { created: true };
});

app.patch("/api/portal/roles/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const { permissions, name } = req.body as { permissions?: string[]; name?: string };
  if (name !== undefined && !name.trim()) {
    reply.code(400);
    return { error: "name cannot be empty" };
  }
  const permError = validatePermissions(permissions);
  if (permError) {
    reply.code(400);
    return { error: permError };
  }
  await updateRole(id, permissions ?? [], name);
  return { saved: true };
});

app.delete("/api/portal/roles/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  await deleteRole(id);
  return { deleted: true, id };
});

// "View as" — issues a token that IS the target webmaster's real session
// (their userId/permissions), so the superadmin sees exactly what that
// person sees (their own media, their own role's tab visibility), not a
// synthetic all-access preview. impersonatedBy rides along in the token for
// audit; nothing today reads it back out, but every mutating route already
// takes req.user.userId off the token, so it lands in the DB for free the
// moment something needs it.
app.post("/api/portal/impersonate", async (req, reply) => {
  const admin = verifySuperadmin(req, reply);
  if (!admin) return;
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    reply.code(400);
    return { error: "userId required" };
  }
  const target = (await listUsers()).find((u) => u.id === userId);
  if (!target) {
    reply.code(404);
    return { error: "user not found" };
  }
  if (target.role !== "webmaster") {
    reply.code(400);
    return { error: "can only impersonate a webmaster" };
  }
  const permissions = mergePermissions(
    await getRolePermissions(target.roleId as string | null),
    target.extraPermissions as string[] | null,
  );
  const token = signSession({
    userId: target.id as string,
    email: target.email as string,
    role: "webmaster",
    tenantHost: target.tenantHost as string | null,
    tenantHosts: (target.tenantHosts as string[] | null) ?? [],
    permissions,
    impersonatedBy: admin.email,
  });
  return {
    token,
    role: "webmaster" as const,
    tenantHost: target.tenantHost as string | null,
    tenantHosts: (target.tenantHosts as string[] | null) ?? [],
  };
});

// Backup / restore / static export — superadmin-only, root scope like the
// rest of /api/portal (tenant comes from the URL, not x-tenant-host).
app.get("/api/portal/tenants/:host/backup", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  const zip = await exportTenantBackup(host);
  reply
    .type("application/zip")
    .header("Content-Disposition", `attachment; filename="backup-${host}-${new Date().toISOString().slice(0, 10)}.zip"`);
  return reply.send(Buffer.from(zip));
});

app.post("/api/portal/tenants/:host/restore", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  // Per-call limit override: backups carry a tenant's whole media library,
  // so the global 5 MB multipart cap is far too small here.
  const file = await req.file({ limits: { fileSize: 500 * 1024 * 1024 } });
  if (!file) {
    reply.code(400);
    return { error: "backup zip required (multipart/form-data, field name 'file')" };
  }
  const buf = await file.toBuffer();
  try {
    const { restored } = await importTenantBackup(host, new Uint8Array(buf));
    return { restored: restored.length, host };
  } catch (err) {
    reply.code(400);
    return { error: (err as Error).message };
  }
});

// Clone flow: "prepare" snapshots the source tenant into an in-memory box
// (full copy or design/skeleton-only per exportTenantDesignClone), then the
// admin picks what to do with that snapshot — download it, stage it as a
// preview tenant, or promote it straight into a new live site.
app.post("/api/portal/tenants/:host/clone-prepare", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  const { type, label } = req.body as { type?: "full" | "design"; label?: string };
  if (type !== "full" && type !== "design") {
    reply.code(400);
    return { error: "type must be 'full' or 'design'" };
  }
  const zip = type === "design" ? await exportTenantDesignClone(host) : await exportTenantBackup(host);
  return prepareClone(host, type, zip, label);
});

app.get("/api/portal/tenants/:host/clones", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  return { clones: listClones(host) };
});

app.get("/api/portal/clones/:id/download", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const entry = getClone(id);
  if (!entry) {
    reply.code(404);
    return { error: "clone not found" };
  }
  reply
    .type("application/zip")
    .header("Content-Disposition", `attachment; filename="clone-${entry.meta.sourceHost}-${entry.meta.type}.zip"`);
  return reply.send(Buffer.from(entry.zip));
});

// Staging host uses the clone's label when it looks like a real domain;
// otherwise it's derived so a one-click preview never needs a domain typed in.
app.post("/api/portal/clones/:id/stage", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const entry = getClone(id);
  if (!entry) {
    reply.code(404);
    return { error: "clone not found" };
  }
  const stagingHost =
    entry.meta.label && looksLikeDomain(entry.meta.label) ? entry.meta.label : `staging-${id.slice(0, 8)}.${entry.meta.sourceHost}`;
  if ((await listTenants()).some((t) => t.host === stagingHost)) {
    reply.code(409);
    return { error: `tenant ${stagingHost} already exists` };
  }
  const source = (await listTenants()).find((t) => t.host === entry.meta.sourceHost);
  await createTenant(stagingHost, `${(source?.departmentName as string) ?? entry.meta.sourceHost} (Staging)`, null);
  await importTenantBackup(stagingHost, entry.zip);
  markCloneStaged(id, stagingHost);
  return { staged: true, stagingHost };
});

app.post("/api/portal/clones/:id/promote", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const entry = getClone(id);
  if (!entry) {
    reply.code(404);
    return { error: "clone not found" };
  }
  const { newHost, departmentName } = req.body as { newHost?: string; departmentName?: string };
  if (!newHost || !departmentName) {
    reply.code(400);
    return { error: "newHost and departmentName required" };
  }
  if ((await listTenants()).some((t) => t.host === newHost)) {
    reply.code(409);
    return { error: `tenant ${newHost} already exists — use restore instead` };
  }
  await createTenant(newHost, departmentName, null);
  await importTenantBackup(newHost, entry.zip);
  return { promoted: true, host: newHost };
});

// Replace = copy a staged preview tenant's current content back into the
// original tenant it was staged from — the "preview before replace" step.
app.post("/api/portal/tenants/:host/replace-from-staging", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  const { stagingHost } = req.body as { stagingHost?: string };
  if (!stagingHost) {
    reply.code(400);
    return { error: "stagingHost required" };
  }
  const zip = await exportTenantBackup(stagingHost);
  await importTenantBackup(host, zip);
  return { replaced: true };
});

app.get("/api/portal/tenants/:host/static-export", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  try {
    const zip = await exportStaticSite(host);
    reply
      .type("application/zip")
      .header("Content-Disposition", `attachment; filename="static-${host}-${new Date().toISOString().slice(0, 10)}.zip"`);
    return reply.send(Buffer.from(zip));
  } catch (err) {
    reply.code(502);
    return { error: (err as Error).message };
  }
});

// publishedAt arrives as an ISO string over JSON; Drizzle's timestamp column
// needs a Date. Same conversion as sanitizePostBody, plus the updatedAt bump
// posts already gets and pages never did.
const pagesBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  if (record.layout !== undefined) {
    const err = validateLayout(record.layout);
    // beforeChange has no `reply` in its signature (see config-types.ts) —
    // throwing here happens before generic-crud.ts's insert/update try block,
    // so it's never swallowed into a 23505 500; Fastify's default error
    // handler honors `.statusCode` on a thrown Error, giving a clean 400
    // instead of the 500 an unannotated throw would produce.
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  }
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  return record;
};

const pagesCollection: CollectionConfig = {
  slug: "pages",
  table: schema.pages,
  createSchema: {
    type: "object",
    required: ["slug", "title"],
    additionalProperties: false,
    properties: {
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      layout: { type: "array" },
      bannerImageUrl: { type: "string" },
      status: { type: "string", enum: ["draft", "published"] },
      settings: {
        type: "object",
        additionalProperties: false,
        properties: { gap: { type: "string", pattern: GAP_PATTERN } },
      },
    },
  },
  shareable: {
    title: (row) => row.title as string,
    link: (row, tenantHost) => `https://${tenantHost}/${row.slug as string}`,
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "pages.create"),
    update: (a) => hasPermission(a, "pages.update"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
  hooks: {
    beforeChange: pagesBeforeChange,
  },
};

// body is author-written HTML rendered raw on the public site — sanitize at
// this trust boundary on every write, whatever the client sent. Author is
// stamped once, on create only (req.method — PATCH never overwrites it), so
// editing someone else's post never reassigns authorship.
const postsBeforeChange = (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  // JSON gives an ISO string; Drizzle timestamp columns need a Date.
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  if (typeof record.body === "string") {
    // bookmarkCard's toExternalHTML (blocknote/bookmarkCard.tsx) encodes the
    // block as data-bookmark-* attrs + a fixed, hardcoded inline style on the
    // a/img/div/span it renders — both are needed for parse() to reconstitute
    // the block on reopen and for the public frontend to render the card's
    // layout, so they must survive this trust-boundary sanitize on every
    // save. `style` isn't allowed unrestricted (that would let arbitrary
    // saved HTML carry CSS-injection payloads, e.g. url()-based
    // exfiltration) — allowedStyles below whitelists only the exact
    // property/value shapes BOOKMARK_CARD_STYLE ever emits.
    const bookmarkCardStyleValue = [/^inherit$|^none$|^flex$|^inline-block$|^cover$|^uppercase$/, /^-?\d+(\.\d+)?(px|%)?$/, /^#[0-9a-fA-F]{3,8}$/, /^\d+px solid #[0-9a-fA-F]{3,8}$/];
    record.body = sanitizeHtml(record.body, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: [
          ...sanitizeHtml.defaults.allowedAttributes.a,
          "style",
          "data-bookmark-type",
          "data-bookmark-id",
          "data-bookmark-title",
          "data-bookmark-excerpt",
          "data-bookmark-image",
          "data-bookmark-url",
        ],
        img: ["src", "alt", "style"],
        div: ["style"],
        span: ["style"],
      },
      allowedStyles: {
        "*": {
          display: bookmarkCardStyleValue,
          gap: bookmarkCardStyleValue,
          border: bookmarkCardStyleValue,
          "border-radius": bookmarkCardStyleValue,
          padding: bookmarkCardStyleValue,
          "text-decoration": bookmarkCardStyleValue,
          color: bookmarkCardStyleValue,
          width: bookmarkCardStyleValue,
          height: bookmarkCardStyleValue,
          "object-fit": bookmarkCardStyleValue,
          "flex-shrink": bookmarkCardStyleValue,
          "min-width": bookmarkCardStyleValue,
          flex: bookmarkCardStyleValue,
          "font-size": bookmarkCardStyleValue,
          "font-weight": bookmarkCardStyleValue,
          "text-transform": bookmarkCardStyleValue,
          "margin-bottom": bookmarkCardStyleValue,
          "margin-top": bookmarkCardStyleValue,
        },
      },
    });
  }
  if (req.method === "POST" && req.user) {
    record.authorId = req.user.userId;
    record.authorEmail = req.user.email;
  }
  return record;
};

// Snapshots the post into post_revisions whenever a request explicitly
// publishes or makes it private (req.body.status, the raw incoming payload —
// not just "happens to already be published", so a plain content edit via
// PostEditor's Save never re-snapshots). "private" gets a real history entry
// too, same as "published" — both are "this went live" events, just with
// different public visibility (see 0009's migration comment).
const postsAfterChange = async (item: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const requested = (req.body as Record<string, unknown>)?.status;
  if (requested !== "published" && requested !== "private") return;
  const row = item as Record<string, unknown>;
  let categoryName: string | null = null;
  if (row.categoryId) {
    const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.id, row.categoryId as string));
    categoryName = cat?.name ?? null;
  }
  await req.db.insert(schema.postRevisions).values({
    postId: row.id as string,
    title: row.title as string,
    body: row.body as string,
    excerpt: row.excerpt as string | null,
    bannerImageUrl: row.bannerImageUrl as string | null,
    category: categoryName,
    tags: (row.tags as string[]) ?? [],
    status: row.status as string,
    publishedAt: row.publishedAt as Date | null,
  });
};

// The public posts list/get returns the raw row, which only has categoryId
// (uuid) — categories.name text column was dropped in migration 0010. The
// frontend's Post.category: string | null contract (apps/frontend/src/lib/
// api.ts, rendered by posts/[slug].astro) expects a resolved name, so add it
// here rather than pushing the join onto every frontend consumer.
const postsAfterRead = async (items: unknown[], req: FastifyRequest) => {
  const rows = items as Record<string, unknown>[];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId as string | null).filter((v): v is string => Boolean(v)))];
  const byId = new Map<string, { name: string; slug: string }>();
  if (categoryIds.length > 0) {
    const cats = await req.db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds));
    for (const cat of cats) byId.set(cat.id, { name: cat.name, slug: cat.slug });
  }
  return rows.map((r) => {
    const cat = r.categoryId ? byId.get(r.categoryId as string) : undefined;
    return { ...r, category: cat?.name ?? null, categorySlug: cat?.slug ?? null };
  });
};

const postsCollection: CollectionConfig = {
  slug: "posts",
  table: schema.posts,
  createSchema: {
    type: "object",
    required: ["slug", "title"],
    additionalProperties: false,
    properties: {
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      body: { type: "string" },
      excerpt: { type: "string" },
      bannerImageUrl: { type: "string" },
      status: { type: "string", enum: ["draft", "published", "private"] },
      categoryId: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  shareable: {
    title: (row) => row.title as string,
    excerpt: (row) => (row.excerpt as string | null) ?? "",
    link: (row, tenantHost) => `https://${tenantHost}/posts/${row.slug as string}`,
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "posts.create"),
    update: (a) => hasPermission(a, "posts.update"),
    delete: (a) => hasPermission(a, "posts.delete"),
  },
  hooks: {
    beforeChange: postsBeforeChange,
    afterChange: postsAfterChange,
    afterRead: postsAfterRead,
  },
};

const categoriesBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  record.updatedAt = new Date();
  return record;
};

// Gated on posts.* permissions (not a new categories.* resource) — managing
// categories is a sub-concern of managing posts.
const categoriesCollection: CollectionConfig = {
  slug: "categories",
  table: schema.categories,
  createSchema: {
    type: "object",
    required: ["name", "slug"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      slug: { type: "string", minLength: 1 },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "posts.update"),
    update: (a) => hasPermission(a, "posts.update"),
    delete: (a) => hasPermission(a, "posts.update"),
  },
  hooks: { beforeChange: categoriesBeforeChange },
};

// Reusable Designer section blocks. Protected-scope only (see registration
// below) — no `access.update` since there's no PATCH route (replacing a
// template is delete-and-recreate), and no `shareable` since these aren't
// site content. Gated on the existing pages.* permissions rather than a new
// templates.* category — a webmaster who can edit pages can manage these.
const templatesCollection: CollectionConfig = {
  slug: "templates",
  table: schema.designTemplates,
  createSchema: {
    type: "object",
    required: ["name", "data"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      data: { type: "object" },
    },
  },
  // No `read` here — registerProtectedCollectionRoutes has no GET of its own
  // (see the hand-rolled /api/templates GET below, since this collection
  // deliberately has no public route to pair with, unlike pages/posts).
  access: {
    create: (a) => hasPermission(a, "pages.create"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
};

// Public scope: tenant resolution only, no login required — this is what
// anonymous website visitors (and the apps/frontend renderer) hit. Only GET
// routes live here; never put a write route in this scope.
await app.register(async (publicScope) => {
  await tenantPlugin(publicScope);
  registerPublicCollectionRoutes(publicScope, pagesCollection);
  registerPublicCollectionRoutes(publicScope, postsCollection);
  registerPublicCollectionRoutes(publicScope, categoriesCollection);
  // Theme lives in the control-plane DB, not the tenant DB — req.db's own
  // site_theme copy is always empty under DB-per-tenant. A theme-preview
  // Bearer token (ThemeForm's "Test" button) overlays its not-yet-saved
  // settings on top of the real merged theme for this response only —
  // empty-string fields are skipped so a partially-filled test still falls
  // back to whatever's actually persisted, instead of blanking it.
  publicScope.get("/api/theme", async (req) => {
    const merged = await getMergedTheme(req.tenantHost);
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      const session = verifySession(auth.slice("Bearer ".length));
      if (session?.previewOnly && session.themePreview) {
        const overrides = Object.fromEntries(Object.entries(session.themePreview).filter(([, v]) => v !== ""));
        return { theme: { ...merged, ...overrides } };
      }
    }
    return { theme: merged };
  });
});

// Protected scope: tenant resolution + login required — this is what the
// admin panel hits to create/edit content.
await app.register(async (protectedScope) => {
  await tenantPlugin(protectedScope);
  await requireTenantAuth(protectedScope);
  registerProtectedCollectionRoutes(protectedScope, pagesCollection);

  // Mints a short-lived, read-only token for the admin's page "View" link —
  // never the real session bearer (see auth.ts's previewOnly/exp and
  // requireTenantAuth's rejection of it). Scoped to this tenant only, same
  // granularity as every other read check here (no per-row ACL exists).
  const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
  protectedScope.post("/api/pages/:id/preview-token", async (req) => {
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
    });
    return { token };
  });

  // Same shape as the pages preview-token route above — posts had none,
  // which made a Preview button dead for Draft/Private posts.
  protectedScope.post("/api/posts/:id/preview-token", async (req) => {
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
    });
    return { token };
  });
  registerProtectedCollectionRoutes(protectedScope, postsCollection);
  registerProtectedCollectionRoutes(protectedScope, categoriesCollection);

  // History/restore — a post-specific feature the generic CRUD mechanism
  // doesn't cover (same reasoning as the preview-token route above), so
  // hand-rolled rather than forced into registerProtectedCollectionRoutes.
  protectedScope.get("/api/posts/:id/revisions", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "posts.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id } = req.params as { id: string };
    const items = await req.db
      .select()
      .from(schema.postRevisions)
      .where(eq(schema.postRevisions.postId, id))
      .orderBy(desc(schema.postRevisions.createdAt));
    return { items };
  });

  // Copies a snapshot's content fields back onto the live post as a new
  // draft — never auto-republishes it, so restoring an old version always
  // goes through a deliberate re-publish click, same as any other edit.
  protectedScope.post("/api/posts/:id/revisions/:revisionId/restore", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "posts.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const [revision] = await req.db
      .select()
      .from(schema.postRevisions)
      .where(and(eq(schema.postRevisions.id, revisionId), eq(schema.postRevisions.postId, id)));
    if (!revision) {
      reply.code(404);
      return { error: "not found" };
    }
    // Revision's category is a name snapshot — if a category with that exact
    // name still exists, restore points at it; if renamed/deleted since,
    // this goes to uncategorized rather than guessing (same known-ceiling
    // tradeoff as the bookmark card snapshot in Phase 4).
    let categoryId: string | null = null;
    if (revision.category) {
      const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.name, revision.category));
      categoryId = cat?.id ?? null;
    }
    const [item] = await req.db
      .update(schema.posts)
      .set({
        title: revision.title,
        body: revision.body,
        excerpt: revision.excerpt,
        bannerImageUrl: revision.bannerImageUrl,
        categoryId,
        tags: revision.tags,
        status: "draft",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.posts.id, id))
      .returning();
    return { item };
  });

  // Cross-collection search for the admin's @-mention bookmark-card feature —
  // spans posts+pages, which generic-crud's per-table routes can't do. Own
  // tenant only, no shared_content.
  protectedScope.get("/api/content-search", async (req) => {
    const { q } = req.query as { q?: string };
    const query = (q ?? "").trim();
    if (!query) return { items: [] };
    const like = `%${query}%`;
    const matchedPosts = await req.db.select().from(schema.posts).where(sql`${schema.posts.title} ILIKE ${like}`).limit(10);
    const matchedPages = await req.db.select().from(schema.pages).where(sql`${schema.pages.title} ILIKE ${like}`).limit(10);
    const items = [
      ...matchedPosts.map((p) => ({ type: "post" as const, id: p.id, title: p.title, excerpt: p.excerpt, bannerImageUrl: p.bannerImageUrl, url: `https://${req.tenantHost}/posts/${p.slug}` })),
      ...matchedPages.map((p) => ({ type: "page" as const, id: p.id, title: p.title, excerpt: null, bannerImageUrl: p.bannerImageUrl, url: `https://${req.tenantHost}/${p.slug}` })),
    ];
    return { items };
  });

  // Hand-rolled GET, not registerPublicCollectionRoutes — templates have no
  // public route at all (protectedScope already requires a valid session,
  // so this is a genuine "auth required even to list" route, matching
  // design_templates' RLS which has no policy for an unauthenticated read).
  protectedScope.get("/api/templates", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const items = await req.db.select().from(schema.designTemplates);
    return { collection: "templates", items };
  });
  registerProtectedCollectionRoutes(protectedScope, templatesCollection);

  // Stores uploaded images (banners, etc.) on local disk under a per-tenant
  // folder. Served back publicly at the returned URL — that's expected for
  // site assets, not a tenant-isolation break (no read of any DB data here).
  // No svg in the allowlist on purpose: svg can carry scripts.
  const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const tenantFolder = (host: string) => host.toLowerCase().replace(/[^a-z0-9]/g, "_");

  protectedScope.post("/api/media", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "file required (multipart/form-data, field name 'file')" };
    }
    // folderId must be appended to the FormData BEFORE the file field —
    // busboy only exposes fields that arrived ahead of the file stream here.
    let folderId: string | null = null;
    const folderField = file.fields.folderId;
    if (folderField && !Array.isArray(folderField) && folderField.type === "field") {
      folderId = (folderField.value as string) || null;
    }
    if (!ALLOWED_MEDIA_TYPES.has(file.mimetype)) {
      reply.code(415);
      return { error: `unsupported file type ${file.mimetype} (jpeg/png/gif/webp only)` };
    }
    const safeTenant = tenantFolder(req.tenantHost);
    const filename = `${randomUUID()}${path.extname(file.filename)}`;
    const { url } = await uploadFile(safeTenant, filename, file.file);
    // Busboy truncates the stream at the multipart fileSize limit rather
    // than erroring — detect it after the fact and refuse the partial file.
    if (file.file.truncated) {
      await deleteFile(safeTenant, filename);
      reply.code(413);
      return { error: "file too large (max 5 MB)" };
    }
    const [item] = await req.db
      .insert(schema.media)
      .values({
        filename,
        originalName: file.filename,
        url,
        mimeType: file.mimetype,
        sizeBytes: file.file.bytesRead,
        folderId,
        uploadedBy: req.user.userId,
        uploadedByEmail: req.user.email,
      })
      .returning();
    return { url, item };
  });

  // A webmaster only ever sees/edits/deletes files they personally uploaded
  // — other webmasters on the same tenant are invisible to each other here.
  // Superadmin (browsing via the content-manager site picker, or a portal
  // tool) is the one role that still sees the whole tenant's library.
  const ownershipFilter = (req: { user: { role: string; userId: string } }) =>
    req.user.role === "superadmin" ? undefined : eq(schema.media.uploadedBy, req.user.userId);

  protectedScope.get("/api/media", async (req) => {
    const { folderId } = req.query as { folderId?: string };
    const conditions = [ownershipFilter(req), folderId ? eq(schema.media.folderId, folderId) : undefined].filter(
      (c): c is Exclude<typeof c, undefined> => c !== undefined,
    );
    const query = req.db.select().from(schema.media).orderBy(desc(schema.media.createdAt));
    const items = conditions.length ? await query.where(and(...conditions)) : await query;
    return { items };
  });

  protectedScope.patch("/api/media/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { id } = req.params as { id: string };
    const body = req.body as {
      originalName?: string;
      altText?: string | null;
      description?: string | null;
      folderId?: string | null;
    };
    const idFilter = ownershipFilter(req);
    // Allowlist fields explicitly — body is only TS-cast, not runtime
    // validated, so spreading it into .set() would let a caller overwrite
    // any column (uploadedBy, url, mimeType, ...) via extra JSON fields.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.originalName !== undefined) updates.originalName = body.originalName;
    if (body.altText !== undefined) updates.altText = body.altText;
    if (body.description !== undefined) updates.description = body.description;
    if (body.folderId !== undefined) updates.folderId = body.folderId;
    const [item] = await req.db
      .update(schema.media)
      .set(updates)
      .where(idFilter ? and(eq(schema.media.id, id), idFilter) : eq(schema.media.id, id))
      .returning();
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    return { item };
  });

  protectedScope.delete("/api/media/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.delete")) {
      reply.code(403);
      return { error: "missing media.delete permission" };
    }
    const { id } = req.params as { id: string };
    const idFilter = ownershipFilter(req);
    const [row] = await req.db
      .delete(schema.media)
      .where(idFilter ? and(eq(schema.media.id, id), idFilter) : eq(schema.media.id, id))
      .returning();
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteFile(tenantFolder(req.tenantHost), row.filename);
    return { deleted: true, id };
  });

  protectedScope.get("/api/media/folders", async (req) => ({
    items: await req.db.select().from(schema.mediaFolders).orderBy(schema.mediaFolders.name),
  }));

  protectedScope.post("/api/media/folders", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { error: "name required" };
    }
    const [item] = await req.db.insert(schema.mediaFolders).values({ name: name.trim() }).returning();
    return { item };
  });

  protectedScope.patch("/api/media/folders/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { error: "name required" };
    }
    const [item] = await req.db
      .update(schema.mediaFolders)
      .set({ name: name.trim() })
      .where(eq(schema.mediaFolders.id, id))
      .returning();
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    return { item };
  });

  protectedScope.delete("/api/media/folders/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.delete")) {
      reply.code(403);
      return { error: "missing media.delete permission" };
    }
    const { id } = req.params as { id: string };
    // Files inside fall back to "no folder" (folder_id ON DELETE SET NULL) —
    // deleting a folder organizes, never bulk-deletes files.
    const [row] = await req.db.delete(schema.mediaFolders).where(eq(schema.mediaFolders.id, id)).returning();
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    return { deleted: true, id };
  });

  // A dept admin can only ever write their own row here — the global row is
  // out of reach from this scope. Writes to the control-plane site_theme
  // table (never req.db — see the public GET above).
  protectedScope.put("/api/theme", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "theme.write")) {
      reply.code(403);
      return { error: "missing theme.write permission" };
    }
    const settings = req.body as Record<string, unknown>;
    const error = validateThemeSettings(settings);
    if (error) {
      reply.code(400);
      return { error };
    }
    await setTenantTheme(req.tenantHost, settings);
    return { saved: true };
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
