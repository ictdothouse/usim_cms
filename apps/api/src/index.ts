import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { desc, eq } from "drizzle-orm";
import { tenantPlugin } from "./plugins/tenant.js";
import { requireTenantAuth, verifySuperadmin } from "./plugins/auth.js";
import { registerPublicCollectionRoutes, registerProtectedCollectionRoutes } from "./plugins/generic-crud.js";
import type { AccessArgs, CollectionConfig } from "./collections/config-types.js";
import * as schema from "./db/schema.js";
import {
  closePool,
  listSharedContent,
  getGlobalTheme,
  setGlobalTheme,
  findUserByEmail,
  listTenants,
  createTenant,
  listUsers,
  createUser,
  updateUserRole,
  getRolePermissions,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getMergedTheme,
  setTenantTheme,
} from "./db/tenant-pool.js";
import sanitizeHtml from "sanitize-html";
import { verifyPassword, hashPassword, signSession } from "./db/auth.js";
import { exportTenantBackup, importTenantBackup, exportStaticSite } from "./backup.js";
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
]);

// Superadmin bypasses every permission check — a role's permissions are only
// ever consulted for webmaster sessions.
function hasPermission(args: AccessArgs, permission: string): boolean {
  return args.role === "superadmin" || (args.permissions ?? []).includes(permission);
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

// Shared by both theme write routes (per-tenant + global). site_theme.settings
// is an open JSONB bag but only these 6 keys are ever read by apps/frontend
// (BaseLayout.astro) — reject anything else instead of silently storing it.
function validateThemeSettings(settings: Record<string, unknown>): string | null {
  const allowed = new Set([...THEME_COLOR_KEYS, "fontFamily", "logoUrl"]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) return `unknown theme key: ${key}`;
  }
  for (const key of THEME_COLOR_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && !HEX_COLOR_RE.test(value as string)) {
      return `${key} must be a hex color like #003399`;
    }
  }
  if (settings.fontFamily !== undefined && !FONT_FAMILY_RE.test(settings.fontFamily as string)) {
    return "fontFamily must contain only letters, digits, and spaces";
  }
  if (settings.logoUrl !== undefined && typeof settings.logoUrl !== "string") {
    return "logoUrl must be a string";
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
    permissions: await getRolePermissions(user.roleId as string | null),
  });
  return { token, role: user.role, tenantHost: user.tenantHost };
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

app.get("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { users: await listUsers() };
});

app.post("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { email, password, role, tenantHost, roleId } = req.body as {
    email?: string;
    password?: string;
    role?: string;
    tenantHost?: string;
    roleId?: string | null;
  };
  if (!email || !password || !role || (role === "webmaster" && !tenantHost)) {
    reply.code(400);
    return { error: "email, password, role required (tenantHost required for webmaster)" };
  }
  await createUser(email, hashPassword(password), role, tenantHost ?? null, roleId ?? null);
  return { created: true };
});

app.patch("/api/portal/users/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const { roleId } = req.body as { roleId?: string | null };
  await updateUserRole(id, roleId ?? null);
  return { saved: true };
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
  const { permissions } = req.body as { permissions?: string[] };
  const permError = validatePermissions(permissions);
  if (permError) {
    reply.code(400);
    return { error: permError };
  }
  await updateRole(id, permissions ?? []);
  return { saved: true };
});

app.delete("/api/portal/roles/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  await deleteRole(id);
  return { deleted: true, id };
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
};

// body is author-written HTML rendered raw on the public site — sanitize at
// this trust boundary on every write, whatever the client sent.
const sanitizePostBody = (data: unknown) => {
  const record = data as Record<string, unknown>;
  // JSON gives an ISO string; Drizzle timestamp columns need a Date.
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  if (typeof record.body === "string") {
    record.body = sanitizeHtml(record.body, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt"] },
    });
  }
  return record;
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
      status: { type: "string", enum: ["draft", "published"] },
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
    beforeChange: sanitizePostBody,
  },
};

// Public scope: tenant resolution only, no login required — this is what
// anonymous website visitors (and the apps/frontend renderer) hit. Only GET
// routes live here; never put a write route in this scope.
await app.register(async (publicScope) => {
  await tenantPlugin(publicScope);
  registerPublicCollectionRoutes(publicScope, pagesCollection);
  registerPublicCollectionRoutes(publicScope, postsCollection);
  // Theme lives in the control-plane DB, not the tenant DB — req.db's own
  // site_theme copy is always empty under DB-per-tenant.
  publicScope.get("/api/theme", async (req) => ({ theme: await getMergedTheme(req.tenantHost) }));
});

// Protected scope: tenant resolution + login required — this is what the
// admin panel hits to create/edit content.
await app.register(async (protectedScope) => {
  await tenantPlugin(protectedScope);
  await requireTenantAuth(protectedScope);
  registerProtectedCollectionRoutes(protectedScope, pagesCollection);
  registerProtectedCollectionRoutes(protectedScope, postsCollection);

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
      })
      .returning();
    return { url, item };
  });

  protectedScope.get("/api/media", async (req) => ({
    items: await req.db.select().from(schema.media).orderBy(desc(schema.media.createdAt)),
  }));

  protectedScope.delete("/api/media/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.delete")) {
      reply.code(403);
      return { error: "missing media.delete permission" };
    }
    const { id } = req.params as { id: string };
    const [row] = await req.db.delete(schema.media).where(eq(schema.media.id, id)).returning();
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteFile(tenantFolder(req.tenantHost), row.filename);
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
