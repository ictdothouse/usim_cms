import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import Fastify from "fastify";
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
import { validateOverrides, validateElement, isSafeUrl } from "./collections/validate-layout.js";
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
import { localUploadsDir, isLocalDriver, dirSizeBytes } from "./storage.js";
import { translatePlainText, translateHtmlBody } from "./translate.js";
import { PERMISSIONS, hasPermission, mergePermissions, validatePermissions } from "./routes/permissions.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPortalSettingsRoutes, validateThemeSettings } from "./routes/portal-settings.js";
import { registerThemePresetRoutes } from "./routes/theme-presets.js";
import { registerTenantRoutes, maybeSyncCaddy, maybeSyncCaddyAtBoot } from "./routes/tenants.js";
import { registerUsersRolesLanguagesRoutes } from "./routes/users-roles-languages.js";
import { registerImpersonationRoutes } from "./routes/impersonation.js";
import { registerBackupCloneRoutes } from "./routes/backup-clone.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerPublicBlueprintRoutes, registerBlueprintRoutes } from "./routes/blueprints.js";
import { registerRevisionsRoutes } from "./routes/revisions.js";
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

  registerPublicBlueprintRoutes(publicScope);
});

// Protected scope: tenant resolution + login required — this is what the
// admin panel hits to create/edit content.
await app.register(async (protectedScope) => {
  await tenantPlugin(protectedScope);
  await requireTenantAuth(protectedScope);
  registerProtectedCollectionRoutes(protectedScope, pagesCollection);

  registerRevisionsRoutes(protectedScope);
  registerProtectedCollectionRoutes(protectedScope, postsCollection);
  registerProtectedCollectionRoutes(protectedScope, categoriesCollection);
  registerProtectedCollectionRoutes(protectedScope, menusCollection);
  registerProtectedCollectionRoutes(protectedScope, symbolsCollection);
  registerProtectedCollectionRoutes(protectedScope, eventsCollection);
  registerProtectedCollectionRoutes(protectedScope, siteChromeCollection);

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

  registerMediaRoutes(protectedScope);

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

  registerBlueprintRoutes(protectedScope);
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
