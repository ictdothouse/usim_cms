import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { tenantPlugin } from "./plugins/tenant.js";
import { requireTenantAuth, verifySuperadmin, verifyAnyUser } from "./plugins/auth.js";
import { registerPublicCollectionRoutes, registerProtectedCollectionRoutes } from "./plugins/generic-crud.js";
import { cacheGet, cacheInvalidate, cacheSet } from "./cache.js";
import { getLivePreview, newLivePreviewId, setLivePreview } from "./live-preview-store.js";
import { recordRequest, renderMetrics } from "./metrics.js";
import type { AccessArgs, CollectionConfig } from "./collections/config-types.js";
import { validateLayout, validateOverrides, validateElement, isSafeUrl } from "./collections/validate-layout.js";
import { validateMenuItems } from "./collections/validate-menu.js";
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
  getTenantDbSizeBytes,
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
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  getTenantLanguageSelection,
  setTenantLanguageSelection,
  getMergedTheme,
  setTenantTheme,
  getGlobalStorageLimits,
  setGlobalStorageLimits,
  getTenantStorageLimits,
  setTenantStorageLimits,
  getMergedStorageLimits,
  getProxyAutomationEnabled,
  setProxyAutomationEnabled,
  setTenantCertInfo,
  getMfaEnabled,
  setMfaEnabled,
  getMfaRequired,
  setMfaRequired,
  getEntraSettings,
  setEntraSettings,
  getLanguageSwitcherDefaults,
  setLanguageSwitcherDefaults,
  findUserById,
  setUserTotpSecret,
  setUserTotpEnabled,
  recordLoginAttempt,
  isLoginRateLimited,
  insertAuditLog,
  listPageBlueprints,
  getPageBlueprint,
  createPageBlueprint,
  updatePageBlueprint,
  deletePageBlueprint,
  getTenantMaintenanceMode,
  setTenantMaintenanceMode,
} from "./db/tenant-pool.js";
import sanitizeHtml from "sanitize-html";
import {
  syncCaddy,
  pingCaddy,
  parseCertExpiry,
  loadCaddyCert,
  unloadCaddyCert,
  isValidDialTargets,
  type CaddyUpstreams,
} from "./proxy-sync.js";
import {
  verifyPassword,
  hashPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS,
  generateTotpSecret,
  verifyTotpCode,
  totpAuthUri,
  generateCsrfToken,
  isMfaSetupRequired,
} from "./db/auth.js";
import { setSessionCookie, clearSessionCookie, setEntraStateCookie, getEntraStateCookie, clearEntraStateCookie } from "./lib/cookies.js";
import { getEntraAuthorizeUrl, exchangeEntraCode, verifyEntraIdToken, isPasswordLoginAllowed, isEntraStateValid } from "./entra.js";
import {
  exportTenantBackup,
  importTenantBackup,
  exportStaticSite,
  exportTenantDesignClone,
  prepareClone,
  listClones,
  getClone,
  markCloneStaged,
  deleteClone,
  looksLikeDomain,
} from "./backup.js";
import { uploadFile, deleteFile, localUploadsDir, isLocalDriver, dirSizeBytes } from "./storage.js";
import { translatePlainText, translateHtmlBody } from "./translate.js";
import { generateImageVariants, deleteImageVariants } from "./image-variants.js";
import { PERMISSIONS, hasPermission, mergePermissions, validatePermissions } from "./routes/permissions.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPortalSettingsRoutes, validateThemeSettings } from "./routes/portal-settings.js";
import { registerThemePresetRoutes } from "./routes/theme-presets.js";
import { registerTenantRoutes, maybeSyncCaddy, maybeSyncCaddyAtBoot } from "./routes/tenants.js";
import { registerUsersRolesLanguagesRoutes } from "./routes/users-roles-languages.js";
import { registerImpersonationRoutes } from "./routes/impersonation.js";
import { registerBackupCloneRoutes } from "./routes/backup-clone.js";
import {
  pagesCollection,
  postsCollection,
  categoriesCollection,
  menusCollection,
  eventsCollection,
  siteChromeCollection,
  templatesCollection,
  symbolsCollection,
} from "./routes/collections.js";

// Language-switcher placement/style — shared enum for both the global
// (platform_settings) and per-site (tenant_languages) settings.
const SWITCHER_POSITIONS = ["header", "topbar", "float", "footer"] as const;
const SWITCHER_STYLES = ["text", "flag", "shortform"] as const;

// trustProxy: true — safe ONLY because this container publishes no host
// port (docker-compose.release.yml's api service has no `ports:`); the sole
// way anything reaches Fastify is through Caddy (or another same-network
// container) over ucms-net, so the immediate connecting peer can never be an
// external attacker forging X-Forwarded-For directly. Without this, req.ip
// (isLoginRateLimited/recordLoginAttempt/insertAuditLog's `ip` field) always
// resolved to Caddy's own docker-internal IP instead of the real visitor —
// silently defeating both the login rate limit and the audit log's "who did
// this" value for every deployment, with or without a CDN in front. Caddy
// itself is the other half of getting this right when a CDN (Cloudflare) is
// added later — see proxy-sync.ts's TRUSTED_PROXY_MODE.
const app = Fastify({ logger: true, trustProxy: true });

// Without this, one uncaught error anywhere takes down all 50 tenants at
// once. Log and exit fast instead of continuing in a possibly-corrupt
// state — a process manager (pm2/systemd) must restart it on exit.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (err) => {
    app.log.fatal({ err }, `${event}, shutting down`);
    process.exit(1);
  });
}

// Guards against a second SIGTERM/SIGINT (Docker's own stop-then-kill
// escalation, or two different signals arriving close together) re-entering
// this handler — pg's Pool#end() throws "Called end on pool more than once"
// on a second call, which without this guard became a second unhandled
// rejection and crashed the process a second time, right as it was trying to
// shut down cleanly.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    await closePool().catch((err) => app.log.error({ err }, "closePool failed during shutdown"));
    process.exit(0);
  });
}

// ADMIN_ORIGIN: comma-separated list of allowed admin origins in production
// (e.g. https://admin.usim.edu.my). Unset in dev only — falls back to
// origin:true so apps/admin's own dev-server port keeps working locally.
const adminOrigins = process.env.ADMIN_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && !adminOrigins?.length) {
  throw new Error("ADMIN_ORIGIN must be set in production — refusing to boot with CORS open to any origin.");
}
await app.register(cors, {
  origin: adminOrigins?.length ? adminOrigins : true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-tenant-host", "x-csrf-token"],
  // The session cookie (see lib/cookies.ts) needs the browser to actually
  // send/accept it cross-origin between the admin panel and this API.
  credentials: true,
});
// contentSecurityPolicy off: this API only ever returns JSON, never HTML it
// renders itself, so a CSP here has nothing to protect — apps/frontend's
// own response headers are the real CSP surface (out of scope for this
// change) and already need their own frame-ancestors allowance for Live
// Edit's iframe, which a generic CSP added here would have no bearing on
// anyway. crossOriginResourcePolicy off: media/uploads are deliberately
// fetched cross-origin (by the tenant frontend, by Live Edit's iframe).
await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
// Only serves files when STORAGE_DRIVER=local (default) — an S3-backed
// upload returns a full external URL and doesn't need this at all.
if (isLocalDriver) {
  // maxAge/immutable is safe here because every uploaded filename is a fresh
  // randomUUID() (see the upload routes below) — never reused/overwritten,
  // so a long-lived cache can never go stale.
  await app.register(fastifyStatic, { root: localUploadsDir, prefix: "/uploads/", maxAge: "1y", immutable: true });
}

app.get("/health", async () => ({ status: "ok" }));

// Records every request's status class + timing for GET /metrics below —
// reply.elapsedTime (Fastify's own ms-since-request-start) needs no extra
// timestamp bookkeeping of our own.
app.addHook("onResponse", (_req, reply, done) => {
  recordRequest(reply.statusCode, reply.elapsedTime);
  done();
});

// Opt-in observability endpoint (architecture-audit gap: no request/error/
// pool/cache metrics existed). Gated by a shared secret rather than a
// session cookie — a Prometheus scraper has no browser session to send —
// same timingSafeEqual pattern as /internal/deploy/promote's DEPLOY_SECRET
// below. Unset METRICS_SECRET (default) disables the route entirely rather
// than silently exposing it, matching this file's other opt-in-secret routes.
const METRICS_SECRET = process.env.METRICS_SECRET;

app.get("/metrics", async (req, reply) => {
  if (!METRICS_SECRET) {
    reply.code(503);
    return { error: "METRICS_SECRET not configured — metrics endpoint is disabled" };
  }
  const provided = Buffer.from((req.headers["x-metrics-secret"] as string | undefined) ?? "");
  const expected = Buffer.from(METRICS_SECRET);
  const matches = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!matches) {
    reply.code(401);
    return { error: "invalid metrics secret" };
  }
  reply.header("Content-Type", "text/plain; version=0.0.4");
  return renderMetrics();
});

registerAuthRoutes(app, adminOrigins);

registerPortalSettingsRoutes(app);
registerThemePresetRoutes(app);
registerTenantRoutes(app);

registerUsersRolesLanguagesRoutes(app);

registerImpersonationRoutes(app);
registerBackupCloneRoutes(app);

// Section lock (Page Blueprint deferred item): a superadmin can mark a
// section `locked` (props.locked === "true", Designer.tsx's Section
// Inspector) so it survives edits by a non-superadmin unchanged — e.g. a
// blueprint's mandated footer/CTA section that shouldn't be removable once
// cloned into a real page. Sections have no stable id of their own (only
// rows/columns/elements do, see designer/types.ts), so a locked section is
// matched by an exact deep-equal copy existing SOMEWHERE in the new layout,
// not by array position — this still blocks every real edit (delete,
// content change, style change) while tolerating reordering/insertion of
// unrelated sections around it. This is the real enforcement point;
// Designer.tsx's own disabled buttons/read-only Inspector notice are UX only.
// Public scope: tenant resolution only, no login required — this is what
// anonymous website visitors (and the apps/frontend renderer) hit. Only GET
// routes live here; never put a write route in this scope.
await app.register(async (publicScope) => {
  await tenantPlugin(publicScope);
  registerPublicCollectionRoutes(publicScope, pagesCollection);
  registerPublicCollectionRoutes(publicScope, postsCollection);
  registerPublicCollectionRoutes(publicScope, categoriesCollection);
  registerPublicCollectionRoutes(publicScope, menusCollection);
  registerPublicCollectionRoutes(publicScope, symbolsCollection);
  registerPublicCollectionRoutes(publicScope, eventsCollection);
  registerPublicCollectionRoutes(publicScope, siteChromeCollection);
  // Theme lives in the control-plane DB, not the tenant DB — req.db's own
  // site_theme copy is always empty under DB-per-tenant. A theme-preview
  // Bearer token (ThemeForm's "Test" button) overlays its not-yet-saved
  // settings on top of the real merged theme for this response only —
  // empty-string fields are skipped so a partially-filled test still falls
  // back to whatever's actually persisted, instead of blanking it.
  publicScope.get("/api/theme", async (req) => {
    const auth = req.headers.authorization;
    const cacheKey = auth ? undefined : `ucms:cache:${req.tenantHost}:theme`;
    if (cacheKey) {
      const cached = await cacheGet<{ theme: Record<string, unknown> }>(cacheKey);
      if (cached) return cached;
    }
    const merged = await getMergedTheme(req.tenantHost);
    if (auth?.startsWith("Bearer ")) {
      const session = verifySession(auth.slice("Bearer ".length));
      if (session?.previewOnly && session.themePreview) {
        const overrides = Object.fromEntries(Object.entries(session.themePreview).filter(([, v]) => v !== ""));
        return { theme: { ...merged, ...overrides } };
      }
    }
    const result = { theme: merged };
    if (cacheKey) await cacheSet(cacheKey, result);
    return result;
  });

  // i18n Phase 3 — anonymous visitor's view: is the switcher even on, and
  // what does each enabled code display as.
  publicScope.get("/api/languages", async (req) => {
    const { allEnabled, showHeaderSwitcher, switcherPosition, switcherStyle } = await getTenantLanguageSelection(req.tenantHost);
    return { enabled: allEnabled.map((l) => ({ code: l.code, label: l.label })), showHeaderSwitcher, switcherPosition, switcherStyle };
  });

  // apps/frontend's own middleware (src/middleware.ts) calls this on every
  // request to decide whether to show the maintenance page instead of real
  // content — deliberately its own tiny public route rather than folded
  // into /api/languages or /api/theme, so a maintenance check never depends
  // on either of those growing/changing shape.
  publicScope.get("/api/tenant-status", async (req) => {
    const maintenanceMode = await getTenantMaintenanceMode(req.tenantHost);
    // A valid maintenance-bypass token (see the mint route above) forwarded
    // as a Bearer header, bound to THIS tenant — never accepted for a
    // different host, so a token minted for one tenant can't bypass another.
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const payload = token ? verifySession(token) : null;
    const bypass = Boolean(payload?.maintenanceBypass && payload.tenantHost === req.tenantHost);
    return { maintenanceMode, bypass };
  });

  // Backs apps/frontend's blueprint-preview.astro (Designer's blueprint
  // Live Edit iframe) — a blueprint has no real slug/route, so unlike
  // pages/posts there is no underlying public row this could "elevate"
  // visibility on; the previewOnly token IS the entire access check. Never
  // linked from anywhere a real visitor could reach.
  publicScope.get("/api/blueprints/:id/preview", async (req, reply) => {
    const auth = req.headers.authorization;
    const session = auth?.startsWith("Bearer ") ? verifySession(auth.slice("Bearer ".length)) : null;
    if (!session || !session.previewOnly || session.pendingMfa) {
      reply.code(401);
      return { error: "preview token required" };
    }
    const { id } = req.params as { id: string };
    const bp = await getPageBlueprint(id);
    if (!bp) {
      reply.code(404);
      return { error: "not found" };
    }
    // A tenant-scoped blueprint is only previewable by a token minted for
    // that same tenant; a system-wide one (tenantHost null) has no tenant to
    // check against, so any valid previewOnly token may render it.
    if (bp.tenantHost !== null && bp.tenantHost !== session.tenantHost) {
      reply.code(403);
      return { error: "forbidden" };
    }
    return { item: bp };
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
  // Optional body: { layout?, settings?, translations? } — Designer's
  // Preview/Live Edit now sends the canvas's current in-memory state
  // directly, with no prior Save, mirroring Elementor/Avada's own "preview
  // shows what's on screen, not what's persisted" behavior. Stored in the
  // ephemeral live-preview-store (never pages.layout/settings/translations),
  // referenced from the signed token by id only — see GET /api/live-preview.
  // Omitting the body (or sending {}) keeps the old behavior: a plain
  // draft-visibility token with nothing to override.
  protectedScope.post("/api/pages/:id/preview-token", async (req) => {
    const draft = req.body as { layout?: unknown; settings?: unknown; translations?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && (draft.layout !== undefined || draft.settings !== undefined || draft.translations !== undefined)) {
      livePreviewId = newLivePreviewId();
      await setLivePreview(livePreviewId, draft);
    }
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
      ...(livePreviewId ? { livePreviewId } : {}),
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
  registerProtectedCollectionRoutes(protectedScope, menusCollection);
  registerProtectedCollectionRoutes(protectedScope, symbolsCollection);
  registerProtectedCollectionRoutes(protectedScope, eventsCollection);
  registerProtectedCollectionRoutes(protectedScope, siteChromeCollection);

  // siteChrome's own GET is already publicly readable regardless of draft/
  // published status (see chrome-preview.astro's own comment), so unlike the
  // pages/blueprints preview-token routes above, this one exists purely to
  // carry not-yet-saved canvas content for Designer's Header/Footer device
  // preview — same ephemeral-store/livePreviewId mechanism, no draft-
  // visibility elevation needed.
  protectedScope.post("/api/siteChrome/:id/preview-token", async (req) => {
    const draft = req.body as { layout?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && draft.layout !== undefined) {
      livePreviewId = newLivePreviewId();
      await setLivePreview(livePreviewId, draft);
    }
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
      ...(livePreviewId ? { livePreviewId } : {}),
    });
    return { token };
  });

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

  // History/restore for pages — same reasoning as the posts revision routes
  // above (a page-specific feature the generic CRUD mechanism doesn't cover),
  // mirrored exactly minus the category-name resolution posts' restore does
  // (pages have no category concept).
  protectedScope.get("/api/pages/:id/revisions", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id } = req.params as { id: string };
    const items = await req.db
      .select()
      .from(schema.pageRevisions)
      .where(eq(schema.pageRevisions.pageId, id))
      .orderBy(desc(schema.pageRevisions.createdAt));
    return { items };
  });

  // Copies a snapshot's content fields back onto the live page as a new
  // draft — never auto-republishes it, so restoring an old version always
  // goes through a deliberate re-publish click, same as any other edit.
  protectedScope.post("/api/pages/:id/revisions/:revisionId/restore", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const [revision] = await req.db
      .select()
      .from(schema.pageRevisions)
      .where(and(eq(schema.pageRevisions.id, revisionId), eq(schema.pageRevisions.pageId, id)));
    if (!revision) {
      reply.code(404);
      return { error: "not found" };
    }
    const [item] = await req.db
      .update(schema.pages)
      .set({
        title: revision.title,
        layout: revision.layout,
        settings: revision.settings,
        bannerImageUrl: revision.bannerImageUrl,
        status: "draft",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, id))
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

  // i18n Phase 5 — real auto-translate for a post's own text fields
  // (PostEditorPage's switchLanguage). No permission gate beyond a valid
  // tenant session — this is a stateless utility call, it never reads/
  // writes any row. `html: true` runs the body through translateHtmlBody
  // (strips tags to plain text first, MyMemory has no HTML mode); anything
  // else is treated as a plain string (title/excerpt).
  protectedScope.post("/api/translate", async (req, reply) => {
    const { text, target, source, html } = req.body as { text?: string; target?: string; source?: string; html?: boolean };
    if (!text || !target) {
      reply.code(400);
      return { error: "text and target required" };
    }
    try {
      const translated = html ? await translateHtmlBody(text, target, source || "auto") : await translatePlainText(text, target, source || "auto");
      return { translated };
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
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
  // No svg in the allowlist on purpose: svg can carry scripts. Extension is
  // derived from THIS map (server-controlled), never the client's own
  // filename — same fix as the branding-upload route above (~line 923)
  // already applies: without it, a part declaring e.g. `Content-Type:
  // video/mp4` with `filename: x.html` got stored and served back with a
  // `.html` extension, executing as a page on this API's own origin (a
  // stored-XSS → session-hijack chain, since GET /api/auth/session — same
  // origin — returns the caller's csrfToken).
  const MEDIA_EXT_BY_MIME: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  const tenantFolder = (host: string) => host.toLowerCase().replace(/[^a-z0-9]/g, "_");

  protectedScope.post("/api/media", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const limits = await getMergedStorageLimits(req.tenantHost);
    // Per-call override, not the plugin's registration-time default — same
    // pattern the backup-restore upload already uses (~line 1207) to raise
    // its own ceiling. This is what actually enforces a site-specific cap:
    // busboy stops reading and truncates the stream once this many bytes
    // are seen, rather than us buffering an oversized file just to reject it.
    const file = await req.file({ limits: { fileSize: limits.maxUploadFileSizeMb * 1024 * 1024 } });
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
    const ext = MEDIA_EXT_BY_MIME[file.mimetype];
    if (!ext) {
      reply.code(415);
      return { error: `unsupported file type ${file.mimetype} (jpeg/png/gif/webp/mp4/webm only)` };
    }
    const safeTenant = tenantFolder(req.tenantHost);
    const stem = randomUUID();
    const filename = `${stem}${ext}`;
    // Buffered (not streamed straight to storage) so the same bytes can also
    // feed sharp for the responsive-variant pipeline below — bounded by
    // limits.maxUploadFileSizeMb, already enforced on the multipart parser
    // above, so this never buffers more than a site's own configured cap.
    const fileBuffer = await streamToBuffer(file.file);
    // Busboy truncates the stream at the multipart fileSize limit rather
    // than erroring — detect it once the stream is fully drained (buffer()
    // just did that) and refuse the partial file before anything is
    // uploaded, rather than uploading then deleting.
    if (file.file.truncated) {
      reply.code(413);
      return { error: `file too large (max ${limits.maxUploadFileSizeMb} MB)` };
    }
    if (limits.maxTotalStorageMb !== null) {
      const [{ total }] = await req.db.select({ total: sql<string>`coalesce(sum(${schema.media.sizeBytes}), 0)` }).from(schema.media);
      if (Number(total) + fileBuffer.byteLength > limits.maxTotalStorageMb * 1024 * 1024) {
        reply.code(413);
        return { error: `storage limit reached (${limits.maxTotalStorageMb} MB max for this site)` };
      }
    }
    const { url: rawUrl } = await uploadFile(safeTenant, filename, Readable.from(fileBuffer));
    // Responsive image pipeline: gif is skipped (animated — sharp would only
    // read its first frame, silently breaking the animation in every
    // generated variant). jpeg/png/webp get downsized WebP siblings plus
    // their real pixel size embedded in the URL as `?w=&h=` — see
    // image-variants.ts and SectionBlock.astro's buildSrcset for how the
    // frontend reconstructs a real <img srcset> from that alone, no DB
    // lookup needed at render time.
    const meta =
      file.mimetype.startsWith("image/") && file.mimetype !== "image/gif"
        ? await generateImageVariants(safeTenant, stem, fileBuffer)
        : null;
    const url = meta ? `${rawUrl}?w=${meta.width}&h=${meta.height}` : rawUrl;
    const [item] = await req.db
      .insert(schema.media)
      .values({
        filename,
        originalName: file.filename,
        url,
        mimeType: file.mimetype,
        sizeBytes: fileBuffer.byteLength,
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        folderId,
        uploadedBy: req.user.userId,
        uploadedByEmail: req.user.email,
      })
      .returning();
    return { url, item };
  });

  // Tenant-facing, read-only: what the merged limit resolves to for THIS
  // site, plus current usage — any authenticated user, not gated behind
  // media.upload (a webmaster who can't upload should still be able to see
  // WHY, and the Content Manager's media library page needs this even for
  // someone who only browses, not uploads).
  protectedScope.get("/api/storage-limits", async (req) => {
    const limits = await getMergedStorageLimits(req.tenantHost);
    const [{ total }] = await req.db.select({ total: sql<string>`coalesce(sum(${schema.media.sizeBytes}), 0)` }).from(schema.media);
    return { limits, usageBytes: Number(total) };
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
      isDecorative?: boolean;
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
    if (body.isDecorative !== undefined) updates.isDecorative = body.isDecorative;
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
    const safeTenant = tenantFolder(req.tenantHost);
    await deleteFile(safeTenant, row.filename);
    await deleteImageVariants(safeTenant, path.parse(row.filename).name, row.width);
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
    await cacheInvalidate(`ucms:cache:${req.tenantHost}:theme`);
    // Sibling prefix, same Redis instance — see generic-crud.ts's own comment
    // on this same pairing. Theme affects every page's rendered CSS/colors.
    await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
    return { saved: true };
  });

  // i18n Phase 2 — any authenticated user of this tenant can view the
  // current selection; only languages.write can change it (superadmin
  // always bypasses, per hasPermission).
  protectedScope.get("/api/tenant-languages", async (req) => {
    const { allEnabled, selectedCodes, showHeaderSwitcher, multilangEnabled, defaultLanguage, switcherPosition, switcherStyle } =
      await getTenantLanguageSelection(req.tenantHost);
    return { allEnabled, selectedCodes, showHeaderSwitcher, multilangEnabled, defaultLanguage, switcherPosition, switcherStyle };
  });

  protectedScope.put("/api/tenant-languages", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "languages.write")) {
      reply.code(403);
      return { error: "missing languages.write permission" };
    }
    const { codes, showHeaderSwitcher, multilangEnabled, defaultLanguage, switcherPosition, switcherStyle } = req.body as {
      codes?: string[];
      showHeaderSwitcher?: boolean;
      multilangEnabled?: boolean;
      defaultLanguage?: string | null;
      switcherPosition?: string;
      switcherStyle?: string;
    };
    if (!Array.isArray(codes)) {
      reply.code(400);
      return { error: "codes must be an array" };
    }
    const { allEnabled, switcherPosition: currentPosition, switcherStyle: currentStyle } = await getTenantLanguageSelection(req.tenantHost);
    if (codes.length > 0) {
      const validCodes = new Set(allEnabled.map((l) => l.code));
      if (codes.some((c) => !validCodes.has(c))) {
        reply.code(400);
        return { error: "codes must be a subset of the globally-enabled languages" };
      }
    }
    if (defaultLanguage != null) {
      const selectable = codes.length > 0 ? codes : allEnabled.map((l) => l.code);
      if (!selectable.includes(defaultLanguage)) {
        reply.code(400);
        return { error: "defaultLanguage must be one of this site's selected languages" };
      }
    }
    const resolvedPosition = switcherPosition ?? currentPosition;
    const resolvedStyle = switcherStyle ?? currentStyle;
    if (!SWITCHER_POSITIONS.includes(resolvedPosition as (typeof SWITCHER_POSITIONS)[number])) {
      reply.code(400);
      return { error: `switcherPosition must be one of: ${SWITCHER_POSITIONS.join(", ")}` };
    }
    if (!SWITCHER_STYLES.includes(resolvedStyle as (typeof SWITCHER_STYLES)[number])) {
      reply.code(400);
      return { error: `switcherStyle must be one of: ${SWITCHER_STYLES.join(", ")}` };
    }
    await setTenantLanguageSelection(
      req.tenantHost,
      codes,
      Boolean(showHeaderSwitcher),
      Boolean(multilangEnabled),
      defaultLanguage ?? null,
      resolvedPosition,
      resolvedStyle,
    );
    // Switcher visibility/position/style renders on every page's header/
    // footer/topbar — same sibling-prefix invalidation as theme/collections.
    await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
    return { saved: true };
  });

  // Instance-wide default for the language switcher's placement/style —
  // same shape/gating as /api/portal/login-settings above (superadmin-only
  // read too, since a webmaster reads their own effective value already
  // resolved through GET /api/tenant-languages, not this raw default).
  app.get("/api/portal/language-switcher-settings", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return await getLanguageSwitcherDefaults();
  });

  app.put("/api/portal/language-switcher-settings", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const body = req.body as { switcherPosition?: string; switcherStyle?: string };
    if (!SWITCHER_POSITIONS.includes(body.switcherPosition as (typeof SWITCHER_POSITIONS)[number])) {
      reply.code(400);
      return { error: `switcherPosition must be one of: ${SWITCHER_POSITIONS.join(", ")}` };
    }
    if (!SWITCHER_STYLES.includes(body.switcherStyle as (typeof SWITCHER_STYLES)[number])) {
      reply.code(400);
      return { error: `switcherStyle must be one of: ${SWITCHER_STYLES.join(", ")}` };
    }
    const switcherPosition = body.switcherPosition as (typeof SWITCHER_POSITIONS)[number];
    const switcherStyle = body.switcherStyle as (typeof SWITCHER_STYLES)[number];
    await setLanguageSwitcherDefaults(switcherPosition, switcherStyle);
    await insertAuditLog({
      actorUserId: session.userId,
      actorEmail: session.email,
      action: "platform.language_switcher_settings",
      meta: { switcherPosition, switcherStyle },
      ip: req.ip,
    });
    return { switcherPosition, switcherStyle };
  });

  // Page Blueprint (Sprint 5 sub-project 2) — control-plane CRUD, hand-
  // written for the same reason /api/tenant-languages is (control-plane
  // data via tenant-pool.ts, not req.db — generic-crud.ts only ever
  // operates on a tenant's own database connection).
  function canWriteBlueprint(req: FastifyRequest, targetTenantHost: string | null): boolean {
    if (req.user.role === "superadmin") return true;
    if (targetTenantHost === null) return false; // only superadmin may touch a system blueprint
    return targetTenantHost === req.tenantHost && hasPermission({ role: req.user.role, permissions: req.user.permissions }, "blueprints.write");
  }

  protectedScope.get("/api/blueprints", async (req) => {
    const { category } = req.query as { category?: string };
    const items = await listPageBlueprints(req.tenantHost, category || undefined);
    return { items };
  });

  protectedScope.post("/api/blueprints", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string | null;
      category?: string | null;
      layout?: unknown;
      settings?: unknown;
      scope?: "system" | "tenant";
    };
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    const targetTenantHost = body.scope === "system" ? null : req.tenantHost;
    if (!canWriteBlueprint(req, targetTenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const layoutErr = validateLayout(body.layout ?? []);
    if (layoutErr) {
      reply.code(400);
      return { error: layoutErr };
    }
    const row = await createPageBlueprint({
      tenantHost: targetTenantHost,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      layout: body.layout ?? [],
      settings: body.settings ?? {},
      createdBy: req.user.userId,
      createdByEmail: req.user.email,
    });
    return { item: row };
  });

  protectedScope.patch("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const body = req.body as { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown };
    if (body.layout !== undefined) {
      const layoutErr = validateLayout(body.layout);
      if (layoutErr) {
        reply.code(400);
        return { error: layoutErr };
      }
    }
    // Allowlist fields explicitly — body is only TS-cast, not runtime
    // validated, so passing it straight through would let a caller overwrite
    // any column (tenantHost, createdBy, createdByEmail, id, ...) via extra
    // JSON fields, e.g. escalating a tenant-scoped blueprint to system-wide.
    const updates: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.layout !== undefined) updates.layout = body.layout;
    if (body.settings !== undefined) updates.settings = body.settings;
    await updatePageBlueprint(id, updates);
    return { saved: true };
  });

  protectedScope.delete("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    await deletePageBlueprint(id);
    return { deleted: true };
  });

  // Mints a preview credential for Designer's blueprint "Live Edit" iframe —
  // same previewOnly/exp shape as the pages preview-token route above. A
  // blueprint has no live route of its own (no slug), so the counterpart
  // read route below is public (never behind requireTenantAuth) and instead
  // gates purely on this token, mirroring how [...slug].astro's own
  // designerEdit bridge only ever activates alongside a valid previewToken.
  protectedScope.post("/api/blueprints/:id/preview-token", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    // Same not-yet-saved-content override as the pages preview-token route
    // above — see its comment.
    const draft = req.body as { layout?: unknown; settings?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && (draft.layout !== undefined || draft.settings !== undefined)) {
      livePreviewId = newLivePreviewId();
      await setLivePreview(livePreviewId, draft);
    }
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
      ...(livePreviewId ? { livePreviewId } : {}),
    });
    return { token };
  });
});

const port = Number(process.env.PORT ?? 3000);
// Fastify defaults to binding 127.0.0.1 — inside a container that's the
// container's OWN loopback, unreachable from the host's docker-proxy/NAT
// even though an in-container healthcheck hitting 127.0.0.1 looks healthy.
app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // Self-heal: if the proxy container was recreated or lost its volume
  // since this process last ran, resync it from the tenants table now
  // rather than waiting for the next tenant create/delete. No-op when the
  // switch is off (maybeSyncCaddyAtBoot checks getProxyAutomationEnabled
  // itself); see maybeSyncCaddyAtBoot for why this retries.
  void maybeSyncCaddyAtBoot(app);
});
