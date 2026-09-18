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

// Language-switcher placement/style — shared enum for both the global
// (platform_settings) and per-site (tenant_languages) settings.
const SWITCHER_POSITIONS = ["header", "topbar", "float", "footer"] as const;
const SWITCHER_STYLES = ["text", "flag", "shortform"] as const;

// pages.settings.gap (and Row.gap inside pages.layout) is interpolated
// directly into a raw CSS string by SectionBlock.astro
// (`gap:${row.gap ?? pageGap ?? "2rem"}`), not set via a safe DOM style API —
// an unconstrained value could break out of that one declaration via `;` and
// inject arbitrary CSS (or worse) into every visitor's page for this tenant.
// Same "reject anything that isn't a bare number+unit" defense as the color/
// font checks above, expressed as a JSON-schema pattern so Fastify's AJV
// validation rejects a bad value before it ever reaches the DB.
const GAP_PATTERN = "^$|^[0-9]+(\\.[0-9]+)?(px|rem|em|%|vh|vw)?$";

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
  const csrfToken = generateCsrfToken();
  const token = signSession({
    userId: target.id as string,
    email: target.email as string,
    role: "webmaster",
    tenantHost: target.tenantHost as string | null,
    tenantHosts: (target.tenantHosts as string[] | null) ?? [],
    permissions,
    impersonatedBy: admin.email,
    csrfToken,
    exp: Date.now() + SESSION_TTL_MS,
  });
  // Overwrites the superadmin's own session cookie with the target's — see
  // exit-impersonation below for how the admin gets their own session back
  // (the old cookie's raw value is gone the moment this response lands, so
  // it can't just be restored client-side the way a bearer-token model
  // could).
  setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  return {
    csrfToken,
    role: "webmaster" as const,
    tenantHost: target.tenantHost as string | null,
    tenantHosts: (target.tenantHosts as string[] | null) ?? [],
  };
});

// Reverses /api/portal/impersonate: re-signs the original superadmin's own
// session from the impersonatedBy email the impersonation token carries, and
// overwrites the cookie back to it. Must be a real server round-trip, not a
// client-side restore — the superadmin's original cookie value was already
// overwritten by impersonate above and was never readable by JS anyway.
app.post("/api/portal/exit-impersonation", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  if (!session.impersonatedBy) {
    reply.code(400);
    return { error: "not currently impersonating" };
  }
  const admin = await findUserByEmail(session.impersonatedBy);
  if (!admin || admin.role !== "superadmin") {
    reply.code(404);
    return { error: "original superadmin account not found" };
  }
  const csrfToken = generateCsrfToken();
  const token = signSession({
    userId: admin.id,
    email: admin.email,
    role: "superadmin",
    tenantHost: null,
    permissions: [],
    csrfToken,
    exp: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  return { csrfToken, role: "superadmin" as const, tenantHost: null, tenantHosts: [] };
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

// Removes a clone box entry. If it was staged (has a real stagingHost —
// stageClone's own createTenant already made that a live tenant + Caddy
// route), that staging tenant is deleted too, since a staged preview only
// ever exists as a byproduct of this clone and shouldn't outlive it as an
// orphaned, no-longer-linked site.
app.delete("/api/portal/clones/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const entry = getClone(id);
  if (!entry) {
    reply.code(404);
    return { error: "clone not found" };
  }
  if (entry.meta.stagingHost) {
    await deleteTenant(entry.meta.stagingHost);
    await maybeSyncCaddy(app);
  }
  deleteClone(id);
  return { deleted: true, id };
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
  const usingCustomLabel = Boolean(entry.meta.label && looksLikeDomain(entry.meta.label));
  const stagingHost = usingCustomLabel ? (entry.meta.label as string) : `staging-${id.slice(0, 8)}.${entry.meta.sourceHost}`;
  if ((await listTenants()).some((t) => t.host === stagingHost)) {
    reply.code(409);
    return { error: `tenant ${stagingHost} already exists` };
  }
  const source = (await listTenants()).find((t) => t.host === entry.meta.sourceHost);
  await createTenant(stagingHost, `${(source?.departmentName as string) ?? entry.meta.sourceHost} (Staging)`, null, {
    // The auto-derived staging-<id>.<sourceHost> subdomain has no DNS record
    // of its own (relies on the parent domain's own wildcard/routing, if
    // any) — only require DNS when the operator typed a real custom label.
    skipDnsCheck: !usingCustomLabel,
  });
  await maybeSyncCaddy(app);
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
  await maybeSyncCaddy(app);
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
function findLockedSections(layout: unknown[]): unknown[] {
  return layout.filter((block) => {
    if (typeof block !== "object" || block === null) return false;
    const b = block as Record<string, unknown>;
    const props = b.props as Record<string, unknown> | undefined;
    return b.type === "section" && props?.locked === "true";
  });
}

function lockedSectionViolation(oldLayout: unknown[], newLayout: unknown[]): string | null {
  for (const oldBlock of findLockedSections(oldLayout)) {
    const stillPresent = newLayout.some((b) => JSON.stringify(b) === JSON.stringify(oldBlock));
    if (!stillPresent) return "a locked section was removed or modified — only a superadmin can change it";
  }
  return null;
}

// publishedAt arrives as an ISO string over JSON; Drizzle's timestamp column
// needs a Date. Same conversion as sanitizePostBody, plus the updatedAt bump
// posts already gets and pages never did.
const pagesBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  if (record.layout !== undefined) {
    const err = validateLayout(record.layout);
    // beforeChange has no `reply` in its signature (see config-types.ts) —
    // throwing here happens before generic-crud.ts's insert/update try block,
    // so it's never swallowed into a 23505 500; Fastify's default error
    // handler honors `.statusCode` on a thrown Error, giving a clean 400
    // instead of the 500 an unannotated throw would produce.
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    if (req.method === "PATCH" && req.user.role !== "superadmin") {
      const { id } = req.params as { id?: string };
      if (id) {
        const [existing] = await req.db.select({ layout: schema.pages.layout }).from(schema.pages).where(eq(schema.pages.id, id));
        if (existing) {
          const lockErr = lockedSectionViolation(existing.layout as unknown[], record.layout as unknown[]);
          if (lockErr) throw Object.assign(new Error(lockErr), { statusCode: 403 });
        }
      }
    }
  }
  // i18n Phase 5 — each translations[code].layout (the OLD, retired shape —
  // still accepted from an existing unmigrated row, or a raw API caller) is
  // just as much a raw layout tree as the top-level one above, and gets the
  // exact same check. translations[code].overrides (the CURRENT shape —
  // Designer.tsx's language-pill rework, see CLAUDE.md's i18n Phase 5 note)
  // is a sparse prop-key/value bag, not a layout tree, so it gets its own
  // matching validator instead — every value in it is exactly as much of a
  // CSS-injection/XSS surface as the same key would be on the base layout.
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, unknown>)) {
      const e = entry as Record<string, unknown> | null;
      if (e?.layout !== undefined) {
        const err = validateLayout(e.layout);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
      if (e?.overrides !== undefined) {
        const err = validateOverrides(e.overrides);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
    }
  }
  // Page settings — contentWidth/paddingX are page-wide defaults SectionBlock.astro
  // falls back to (mirrors the existing `gap` default); `theme` is a snapshot copy of
  // a saved theme preset, validated with the exact same rules `/api/theme` enforces on
  // site_theme itself, since it lands in the same CSS-custom-property pipeline.
  if (record.settings && typeof record.settings === "object") {
    const settings = record.settings as Record<string, unknown>;
    if (settings.contentWidth !== undefined && settings.contentWidth !== "contained" && settings.contentWidth !== "full") {
      throw Object.assign(new Error("settings.contentWidth must be \"contained\" or \"full\""), { statusCode: 400 });
    }
    if (settings.paddingX !== undefined && (typeof settings.paddingX !== "string" || !new RegExp(GAP_PATTERN).test(settings.paddingX))) {
      throw Object.assign(new Error("settings.paddingX must be a plain CSS length"), { statusCode: 400 });
    }
    if (settings.theme !== undefined) {
      if (typeof settings.theme !== "object" || settings.theme === null) {
        throw Object.assign(new Error("settings.theme must be an object"), { statusCode: 400 });
      }
      const err = validateThemeSettings(settings.theme as Record<string, unknown>);
      if (err) throw Object.assign(new Error(`settings.theme: ${err}`), { statusCode: 400 });
    }
  }
  // i18n Phase 4 — same validation/thrown-.statusCode convention as
  // postsBeforeChange's own language check.
  if (typeof record.language === "string") {
    const { allEnabled } = await getTenantLanguageSelection(req.tenantHost);
    if (!allEnabled.some((l) => l.code === record.language)) {
      throw Object.assign(new Error("language must be one of this site's enabled languages"), { statusCode: 400 });
    }
  }
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  return record;
};

// Upgrades any surviving legacy top-level "hero" block (the retired
// BlockBuilder shape — Designer.tsx has no edit UI for a non-"section"
// block at all) into an equivalent section on every read, for both
// Designer's own fetch and the public site's (same GET /api/pages route).
// In-memory only, never written back — a page carrying one silently
// upgrades for real the next time it's saved through Designer, same
// non-destructive convention as this codebase's other schema evolutions.
const pagesAfterRead = (items: unknown[]) =>
  (items as Record<string, unknown>[]).map((item) => {
    const layout = item.layout;
    if (!Array.isArray(layout) || !layout.some((b) => (b as { type?: string })?.type === "hero")) return item;
    return {
      ...item,
      layout: layout.map((b) => {
        const block = b as { type?: string; props?: Record<string, unknown> };
        if (block.type !== "hero") return b;
        const { title, subtitle, imageUrl } = block.props ?? {};
        const elements = [
          { type: "heading", props: { level: "1", text: title ?? "" } },
          { type: "text", props: { text: subtitle ?? "" } },
        ];
        return {
          type: "section",
          props: { rows: [{ columns: [{ span: 1, elements }] }], ...(imageUrl ? { bgImage: imageUrl } : {}) },
        };
      }),
    };
  });

// Snapshots the page into page_revisions whenever a request explicitly
// publishes it (req.body.status, the raw incoming payload — not just
// "happens to already be published", so a plain content edit via Designer's
// Save never re-snapshots). Mirrors postsAfterChange exactly, minus the
// "private" branch — pages have no equivalent status.
const pagesAfterChange = async (item: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const requested = (req.body as Record<string, unknown>)?.status;
  if (requested !== "published") return;
  const row = item as Record<string, unknown>;
  await req.db.insert(schema.pageRevisions).values({
    pageId: row.id as string,
    title: row.title as string,
    layout: (row.layout as unknown[]) ?? [],
    settings: (row.settings as Record<string, unknown>) ?? {},
    bannerImageUrl: row.bannerImageUrl as string | null,
    status: row.status as string,
    publishedAt: row.publishedAt as Date | null,
  });
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
        properties: {
          gap: { type: "string", pattern: GAP_PATTERN },
          contentWidth: { type: "string", enum: ["contained", "full"] },
          paddingX: { type: "string", pattern: GAP_PATTERN },
          theme: { type: "object" },
          themePresetName: { type: "string" },
        },
      },
      language: { type: ["string", "null"] },
      multilangEnabled: { type: "boolean" },
      translations: { type: "object" },
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
    afterChange: pagesAfterChange,
    afterRead: pagesAfterRead,
  },
};

// body is author-written HTML rendered raw on the public site — sanitize at
// this trust boundary on every write, whatever the client sent. Author is
// stamped once, on create only (req.method — PATCH never overwrites it), so
// editing someone else's post never reassigns authorship.
//
// bookmarkCard's toExternalHTML (blocknote/bookmarkCard.tsx) encodes the
// block as data-bookmark-* attrs + a fixed, hardcoded inline style on the
// a/img/div/span it renders — both are needed for parse() to reconstitute
// the block on reopen and for the public frontend to render the card's
// layout, so they must survive this trust-boundary sanitize on every save.
// `style` isn't allowed unrestricted (that would let arbitrary saved HTML
// carry CSS-injection payloads, e.g. url()-based exfiltration) —
// allowedStyles below whitelists only the exact property/value shapes
// BOOKMARK_CARD_STYLE ever emits. Shared by the top-level `body` and every
// i18n Phase 5 `translations[code].body` — a translation's body is exactly
// as much of a trust boundary as the base one.
function sanitizePostBodyHtml(html: string): string {
  const bookmarkCardStyleValue = [/^inherit$|^none$|^flex$|^inline-block$|^cover$|^uppercase$/, /^-?\d+(\.\d+)?(px|%)?$/, /^#[0-9a-fA-F]{3,8}$/, /^\d+px solid #[0-9a-fA-F]{3,8}$/];
  return sanitizeHtml(html, {
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

const postsBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  // i18n Phase 3 — same thrown-.statusCode convention as pagesBeforeChange's
  // validateLayout check above: reject before generic-crud's insert/update
  // try block runs, so this is a clean 400, never a raw 500.
  if (typeof record.language === "string") {
    const { allEnabled } = await getTenantLanguageSelection(req.tenantHost);
    if (!allEnabled.some((l) => l.code === record.language)) {
      throw Object.assign(new Error("language must be one of this site's enabled languages"), { statusCode: 400 });
    }
  }
  // JSON gives an ISO string; Drizzle timestamp columns need a Date.
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  if (typeof record.body === "string") record.body = sanitizePostBodyHtml(record.body);
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, Record<string, unknown>>)) {
      if (entry && typeof entry.body === "string") entry.body = sanitizePostBodyHtml(entry.body);
    }
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
  const byId = new Map<string, { name: string; slug: string; translations: unknown; multilangEnabled: boolean }>();
  if (categoryIds.length > 0) {
    const cats = await req.db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds));
    for (const cat of cats) byId.set(cat.id, { name: cat.name, slug: cat.slug, translations: cat.translations, multilangEnabled: cat.multilangEnabled });
  }
  return rows.map((r) => {
    const cat = r.categoryId ? byId.get(r.categoryId as string) : undefined;
    return {
      ...r,
      category: cat?.name ?? null,
      categorySlug: cat?.slug ?? null,
      // i18n follow-up — resolvePostContent's sibling for the category name:
      // the frontend picks translations[lang].name when the category opted
      // into multilangEnabled, otherwise `category` (above) is always shown
      // as-is regardless of viewed language ("keep original name").
      categoryTranslations: cat?.multilangEnabled ? cat.translations : {},
    };
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
      language: { type: ["string", "null"] },
      multilangEnabled: { type: "boolean" },
      translations: { type: "object" },
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
  if (record.translations && typeof record.translations === "object") {
    for (const [code, entry] of Object.entries(record.translations as Record<string, unknown>)) {
      const name = (entry as Record<string, unknown> | null)?.name;
      if (typeof name !== "string") {
        const err = new Error(`translations.${code}.name must be a string`) as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }
    }
  }
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
      translations: { type: "object" },
      multilangEnabled: { type: "boolean" },
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

// Site navigation menus. `items` is a nested tree (see validate-menu.ts) —
// no separate menu-items table, the whole structure lives in one jsonb
// column, same "one row holds the whole tree" shape templates.data already
// uses. Gated on its own menus.write permission (not pages.*/posts.*) since
// managing site navigation is its own concern, not a sub-concern of either.
const menusBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  const err = validateMenuItems(record.items ?? []);
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  record.updatedAt = new Date();
  return record;
};

const menusCollection: CollectionConfig = {
  slug: "menus",
  table: schema.menus,
  createSchema: {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      items: { type: "array" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "menus.write"),
    update: (a) => hasPermission(a, "menus.write"),
    delete: (a) => hasPermission(a, "menus.write"),
  },
  hooks: { beforeChange: menusBeforeChange },
};

// Events calendar. Own events.write permission (not posts.*/pages.*, same
// reasoning as menus.write) — managing the events calendar is its own
// concern. registrationUrl/imageUrl are scheme-checked the same way any
// other author-supplied URL in this codebase is (isSafeUrl) since both
// render as a real href/src, not sanitized HTML.
const eventsBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  if (typeof record.registrationUrl === "string" && record.registrationUrl !== "" && !isSafeUrl(record.registrationUrl)) {
    throw Object.assign(new Error("registrationUrl has an unsafe URL scheme"), { statusCode: 400 });
  }
  if (typeof record.imageUrl === "string" && record.imageUrl !== "" && !isSafeUrl(record.imageUrl)) {
    throw Object.assign(new Error("imageUrl has an unsafe URL scheme"), { statusCode: 400 });
  }
  if (typeof record.startDate === "string") record.startDate = new Date(record.startDate);
  if (typeof record.endDate === "string") record.endDate = new Date(record.endDate);
  record.updatedAt = new Date();
  return record;
};

const eventsCollection: CollectionConfig = {
  slug: "events",
  table: schema.events,
  createSchema: {
    type: "object",
    required: ["title", "startDate"],
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
      startDate: { type: "string" },
      endDate: { type: ["string", "null"] },
      location: { type: ["string", "null"] },
      imageUrl: { type: ["string", "null"] },
      registrationUrl: { type: ["string", "null"] },
      status: { type: "string", enum: ["draft", "published"] },
    },
  },
  // No `shareable` — events have no dedicated public detail page to link to
  // (unlike posts/pages), so "Share to portal" wouldn't have a real URL.
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "events.write"),
    update: (a) => hasPermission(a, "events.write"),
    delete: (a) => hasPermission(a, "events.write"),
  },
  hooks: { beforeChange: eventsBeforeChange },
};

// Header/Footer designer (see docs/superpowers/specs/2026-09-04-header-footer-designer-design.md).
// Own headerFooter.write permission, same reasoning as menus.write/events.write
// — managing site chrome is its own concern, not a sub-concern of pages.*.
// `layout`/`translations[code].layout` get the exact same validateLayout()
// pass pagesBeforeChange runs, since a header/footer canvas is built from the
// same Section/Row/Column/Element tree a page is. The one-default-per-kind
// invariant is enforced here (not a DB constraint) by flipping every OTHER
// row of the same kind to isDefault=false whenever this write sets it true —
// "exactly one," flip-based rather than reject-based, since there's no
// equivalent of tenant_languages' guardLastEnabled "can't go below zero" (a
// tenant is allowed to have zero defaults, e.g. before the first header is
// ever published).
const siteChromeBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  if (record.kind !== undefined && record.kind !== "header" && record.kind !== "footer") {
    throw Object.assign(new Error('kind must be "header" or "footer"'), { statusCode: 400 });
  }
  if (record.layout !== undefined) {
    const err = validateLayout(record.layout);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  }
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, unknown>)) {
      const e = entry as Record<string, unknown> | null;
      if (e?.layout !== undefined) {
        const err = validateLayout(e.layout);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
      if (e?.overrides !== undefined) {
        const err = validateOverrides(e.overrides);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
    }
  }
  if (record.isDefault === true) {
    const { id } = req.params as { id?: string };
    let kind = record.kind as string | undefined;
    if (!kind && id) {
      const [existing] = await req.db.select({ kind: schema.siteChrome.kind }).from(schema.siteChrome).where(eq(schema.siteChrome.id, id));
      kind = existing?.kind as string | undefined;
    }
    if (kind) {
      await req.db
        .update(schema.siteChrome)
        .set({ isDefault: false })
        .where(id ? and(eq(schema.siteChrome.kind, kind), ne(schema.siteChrome.id, id)) : eq(schema.siteChrome.kind, kind));
    }
  }
  record.updatedAt = new Date();
  return record;
};

const siteChromeCollection: CollectionConfig = {
  slug: "siteChrome",
  table: schema.siteChrome,
  createSchema: {
    type: "object",
    required: ["kind", "name"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["header", "footer"] },
      name: { type: "string", minLength: 1 },
      layout: { type: "array" },
      translations: { type: "object" },
      settings: { type: "object" },
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["draft", "published"] },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "headerFooter.write"),
    update: (a) => hasPermission(a, "headerFooter.write"),
    delete: (a) => hasPermission(a, "headerFooter.write"),
  },
  hooks: { beforeChange: siteChromeBeforeChange },
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

// Live-linked reusable component. Unlike templates above, this DOES need
// read+update: a page's "symbol" element resolves `node` at render time (both
// admin canvas and the public site, hence the public registration below —
// same reasoning as menus), and "Edit Master" PATCHes `node` in place rather
// than delete-and-recreate. Reuses pages.* permissions, same precedent as
// templates above (no new symbols.* permission category).
const symbolsBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  const err = validateElement(record.node, "node");
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  record.updatedAt = new Date();
  return record;
};

const symbolsCollection: CollectionConfig = {
  slug: "symbols",
  table: schema.symbols,
  createSchema: {
    type: "object",
    required: ["name", "node"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      node: { type: "object" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "pages.create"),
    update: (a) => hasPermission(a, "pages.update"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
  hooks: { beforeChange: symbolsBeforeChange },
};

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
