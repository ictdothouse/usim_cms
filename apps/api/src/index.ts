import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { eq } from "drizzle-orm";
import { tenantPlugin } from "./plugins/tenant.js";
import { requireTenantAuth, verifySuperadmin } from "./plugins/auth.js";
import { registerPublicCollectionRoutes, registerProtectedCollectionRoutes } from "./plugins/generic-crud.js";
import type { CollectionConfig } from "./collections/config-types.js";
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
} from "./db/tenant-pool.js";
import { verifyPassword, hashPassword, signSession } from "./db/auth.js";
import { uploadFile, localUploadsDir, isLocalDriver } from "./storage.js";

const GLOBAL_THEME_HOST = "";

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
await app.register(multipart);
// Only serves files when STORAGE_DRIVER=local (default) — an S3-backed
// upload returns a full external URL and doesn't need this at all.
if (isLocalDriver) {
  await app.register(fastifyStatic, { root: localUploadsDir, prefix: "/uploads/" });
}

app.get("/health", async () => ({ status: "ok" }));

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
  await setGlobalTheme(req.body as Record<string, unknown>);
  return { saved: true };
});

app.get("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { tenants: await listTenants() };
});

app.post("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host, departmentName } = req.body as { host?: string; departmentName?: string };
  if (!host || !departmentName) {
    reply.code(400);
    return { error: "host and departmentName required" };
  }
  await createTenant(host, departmentName);
  return { created: true };
});

app.get("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { users: await listUsers() };
});

app.post("/api/portal/users", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { email, password, role, tenantHost } = req.body as {
    email?: string;
    password?: string;
    role?: string;
    tenantHost?: string;
  };
  if (!email || !password || !role || (role === "webmaster" && !tenantHost)) {
    reply.code(400);
    return { error: "email, password, role required (tenantHost required for webmaster)" };
  }
  await createUser(email, hashPassword(password), role, tenantHost ?? null);
  return { created: true };
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
  },
};

async function readMergedTheme(req: FastifyRequest) {
  const rows = await req.db
    .select()
    .from(schema.siteTheme)
    .where(eq(schema.siteTheme.tenantHost, GLOBAL_THEME_HOST));
  const global = (rows[0]?.settings as Record<string, unknown>) ?? {};
  const [tenantRow] = await req.db
    .select()
    .from(schema.siteTheme)
    .where(eq(schema.siteTheme.tenantHost, req.tenantHost));
  const tenant = (tenantRow?.settings as Record<string, unknown>) ?? {};
  return { ...global, ...tenant };
}

// Public scope: tenant resolution only, no login required — this is what
// anonymous website visitors (and the apps/frontend renderer) hit. Only GET
// routes live here; never put a write route in this scope.
await app.register(async (publicScope) => {
  await tenantPlugin(publicScope);
  registerPublicCollectionRoutes(publicScope, pagesCollection);
  publicScope.get("/api/theme", async (req) => ({ theme: await readMergedTheme(req) }));
});

// Protected scope: tenant resolution + login required — this is what the
// admin panel hits to create/edit content.
await app.register(async (protectedScope) => {
  await tenantPlugin(protectedScope);
  await requireTenantAuth(protectedScope);
  registerProtectedCollectionRoutes(protectedScope, pagesCollection);

  // Stores uploaded images (banners, etc.) on local disk under a per-tenant
  // folder. Served back publicly at the returned URL — that's expected for
  // site assets, not a tenant-isolation break (no read of any DB data here).
  protectedScope.post("/api/media", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "file required (multipart/form-data, field name 'file')" };
    }
    const safeTenant = req.tenantHost.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const filename = `${randomUUID()}${path.extname(file.filename)}`;
    const { url } = await uploadFile(safeTenant, filename, file.file);
    return { url };
  });

  // A dept admin can only ever write their own row here — the global row is
  // out of reach from this scope.
  protectedScope.put("/api/theme", async (req) => {
    const settings = req.body as Record<string, unknown>;
    await req.db
      .insert(schema.siteTheme)
      .values({ tenantHost: req.tenantHost, settings })
      .onConflictDoUpdate({
        target: schema.siteTheme.tenantHost,
        set: { settings, updatedAt: new Date() },
      });
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
