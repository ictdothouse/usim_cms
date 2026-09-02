import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { rm, readdir, stat } from "node:fs/promises";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { tenantPlugin } from "./plugins/tenant.js";
import { requireTenantAuth, verifySuperadmin, verifyAnyUser } from "./plugins/auth.js";
import { registerPublicCollectionRoutes, registerProtectedCollectionRoutes } from "./plugins/generic-crud.js";
import { cacheGet, cacheInvalidate, cacheSet } from "./cache.js";
import type { AccessArgs, CollectionConfig } from "./collections/config-types.js";
import { validateLayout, isSafeUrl } from "./collections/validate-layout.js";
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
  getProxyAutomationEnabled,
  setProxyAutomationEnabled,
  setTenantCertInfo,
  getMfaEnabled,
  setMfaEnabled,
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
} from "./db/auth.js";
import { setSessionCookie, clearSessionCookie } from "./lib/cookies.js";
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
import { translatePlainText, translateHtmlBody } from "./translate.js";

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
  "languages.write",
  "menus.write",
  "blueprints.write",
  "events.write",
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
  const csrfToken = generateCsrfToken();
  const token = signSession({
    userId: (await findUserByEmail(email))!.id,
    email,
    role: "superadmin",
    tenantHost: null,
    permissions: [],
    csrfToken,
    exp: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  return { csrfToken, role: "superadmin", tenantHost: null };
});

app.post("/api/auth/login", async (req, reply) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    reply.code(400);
    return { error: "email and password required" };
  }
  // Checked BEFORE the password is even compared, so a locked-out caller
  // never gets a fresh timing oracle on top of the lockout itself.
  if (await isLoginRateLimited(email, req.ip)) {
    reply.code(429);
    return { error: "Too many failed attempts — try again later" };
  }
  const user = await findUserByEmail(email);
  const valid = !!user && verifyPassword(password, user.passwordHash);
  await recordLoginAttempt(email, req.ip, valid);
  if (!user || !valid) {
    reply.code(401);
    return { error: "invalid credentials" };
  }
  const basePayload = {
    userId: user.id,
    email: user.email,
    role: user.role as "superadmin" | "webmaster",
    tenantHost: user.tenantHost,
    tenantHosts: (user.tenantHosts as string[] | null) ?? [],
    permissions: mergePermissions(
      await getRolePermissions(user.roleId as string | null),
      user.extraPermissions as string[] | null,
    ),
  };
  // Second factor required — issue a short-lived pending token instead of a
  // real session; POST /api/auth/totp-verify exchanges it once the code
  // checks out. pendingMfa tokens are rejected by every other route (see
  // plugins/auth.ts).
  if (user.totpEnabled) {
    const pendingToken = signSession({ ...basePayload, pendingMfa: true, exp: Date.now() + 5 * 60 * 1000 });
    return { mfaRequired: true, pendingToken };
  }
  const csrfToken = generateCsrfToken();
  const token = signSession({ ...basePayload, csrfToken, exp: Date.now() + SESSION_TTL_MS });
  setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  return { csrfToken, role: user.role, tenantHost: user.tenantHost, tenantHosts: (user.tenantHosts as string[] | null) ?? [] };
});

app.post("/api/auth/totp-verify", async (req, reply) => {
  const { pendingToken, code } = req.body as { pendingToken?: string; code?: string };
  if (!pendingToken || !code) {
    reply.code(400);
    return { error: "pendingToken and code required" };
  }
  const pending = verifySession(pendingToken);
  if (!pending || !pending.pendingMfa) {
    reply.code(401);
    return { error: "invalid or expired pending token" };
  }
  // A 6-digit code is only ~1M combinations — without a limit here, holding
  // a valid pendingToken (which already proves the password was correct)
  // would let an attacker brute-force the second factor away entirely.
  // Same table/keying as the password step (login route above).
  if (await isLoginRateLimited(pending.email, req.ip)) {
    reply.code(429);
    return { error: "Too many failed attempts — try again later" };
  }
  const user = await findUserById(pending.userId);
  const valid = !!user?.totpEnabled && !!user.totpSecret && verifyTotpCode(user.totpSecret, code);
  await recordLoginAttempt(pending.email, req.ip, valid);
  if (!user?.totpEnabled || !user.totpSecret) {
    reply.code(401);
    return { error: "MFA is not enabled for this account" };
  }
  if (!valid) {
    reply.code(401);
    return { error: "invalid code" };
  }
  const tenantHosts = pending.tenantHosts ?? [];
  const csrfToken = generateCsrfToken();
  const token = signSession({
    userId: pending.userId,
    email: pending.email,
    role: pending.role,
    tenantHost: pending.tenantHost,
    tenantHosts,
    permissions: pending.permissions,
    csrfToken,
    exp: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  return { csrfToken, role: pending.role, tenantHost: pending.tenantHost, tenantHosts };
});

app.post("/api/auth/logout", async (_req, reply) => {
  clearSessionCookie(reply);
  return { loggedOut: true };
});

// Personal MFA enrollment — any logged-in user, only reachable while the
// instance-wide switch (platformSettings.mfaEnabled) is on. Two-step
// (setup then confirm) so a secret is never trusted until the user has
// proven they can actually generate a matching code with it.
// Own-account status for the Security tab — whether TOTP is currently
// enrolled and confirmed, not the instance-wide switch (see
// GET /api/portal/login-settings for that, superadmin-only).
app.get("/api/auth/me", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const user = await findUserById(session.userId);
  return { totpEnabled: !!user?.totpEnabled };
});

app.post("/api/auth/totp-setup", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  if (!(await getMfaEnabled())) {
    reply.code(400);
    return { error: "MFA is not enabled for this instance" };
  }
  const user = await findUserById(session.userId);
  // Re-enrolling on an ALREADY-confirmed account must prove possession of
  // the current code first — otherwise a stolen bearer token alone (e.g.
  // via XSS, given the session's own localStorage exposure) would let an
  // attacker silently start overwriting a victim's real MFA secret before
  // it's ever confirmed, with no proof they still hold the original device.
  if (user?.totpEnabled) {
    const { code } = req.body as { code?: string };
    if (!user.totpSecret || !code || !verifyTotpCode(user.totpSecret, code)) {
      reply.code(401);
      return { error: "current MFA code required to re-enroll" };
    }
  }
  const secret = generateTotpSecret();
  await setUserTotpSecret(session.userId, secret);
  return { secret, otpauthUri: totpAuthUri(secret, session.email) };
});

app.post("/api/auth/totp-confirm", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const { code } = req.body as { code?: string };
  const user = await findUserById(session.userId);
  if (!user?.totpSecret) {
    reply.code(400);
    return { error: "call /api/auth/totp-setup first" };
  }
  if (!code || !verifyTotpCode(user.totpSecret, code)) {
    reply.code(401);
    return { error: "invalid code" };
  }
  await setUserTotpEnabled(session.userId, true);
  await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.enabled_self", ip: req.ip });
  return { enabled: true };
});

app.post("/api/auth/totp-disable", async (req, reply) => {
  const session = verifyAnyUser(req, reply);
  if (!session) return;
  const user = await findUserById(session.userId);
  if (!user?.totpEnabled) {
    return { disabled: true };
  }
  // Same reasoning as totp-setup's re-enroll guard: a stolen bearer token
  // alone must never be enough to strip a victim's MFA — the whole point of
  // a second factor is that possessing the token isn't sufficient by
  // itself, so removing it requires proving the second factor too.
  const { code } = req.body as { code?: string };
  if (!user.totpSecret || !code || !verifyTotpCode(user.totpSecret, code)) {
    reply.code(401);
    return { error: "current MFA code required to disable" };
  }
  await setUserTotpEnabled(session.userId, false);
  await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.disabled_self", ip: req.ip });
  return { disabled: true };
});

// Superadmin-only "Login Methods" master switch — same shape as
// proxy-settings above. Read is superadmin-only too (unlike proxy-settings'
// GET): whether MFA is required isn't public information the way proxy
// automation's on/off state is.
app.get("/api/portal/login-settings", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { mfaEnabled: await getMfaEnabled() };
});

app.put("/api/portal/login-settings", async (req, reply) => {
  const session = verifySuperadmin(req, reply);
  if (!session) return;
  const { mfaEnabled } = req.body as { mfaEnabled?: boolean };
  if (typeof mfaEnabled !== "boolean") {
    reply.code(400);
    return { error: "mfaEnabled must be a boolean" };
  }
  await setMfaEnabled(mfaEnabled);
  await insertAuditLog({
    actorUserId: session.userId,
    actorEmail: session.email,
    action: "platform.mfa_toggle",
    meta: { mfaEnabled },
    ip: req.ip,
  });
  return { mfaEnabled };
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

// Fires the Caddy resync after any tenant-table change, but only when the
// superadmin has opted in (getProxyAutomationEnabled) — and never lets a
// sync failure fail the request that triggered it; a tenant create/delete
// must always succeed at the DB level regardless of proxy state.
async function maybeSyncCaddy(): Promise<void> {
  try {
    if (!(await getProxyAutomationEnabled())) return;
    await syncCaddy(await listTenants());
  } catch (err) {
    app.log.warn({ err }, "Caddy proxy sync failed");
  }
}

// Boot-only variant: docker-compose starts `proxy` only after api/admin/
// frontend have merely STARTED (not become healthy), so on a fresh
// `docker compose up` this process's own boot can fire before Caddy inside
// the proxy container is actually accepting connections yet — a bare
// single-shot maybeSyncCaddy() would reliably fail here. Retries a few
// times with a short delay instead of giving up on the very first race.
async function maybeSyncCaddyAtBoot(): Promise<void> {
  if (!(await getProxyAutomationEnabled())) return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await syncCaddy(await listTenants());
      return;
    } catch (err) {
      if (attempt === 5) {
        app.log.warn({ err }, "Caddy proxy sync failed after retries");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

app.get("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { tenants: await listTenants() };
});

// Recursively sums file sizes under `dir` — used for a tenant's uploads
// folder. Returns null (not 0) when the folder doesn't exist at all yet
// (a tenant with no uploads), so the Multisite column can tell "empty" from
// "unmeasurable" apart from a real zero.
async function dirSizeBytes(dir: string): Promise<number | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += (await dirSizeBytes(full)) ?? 0;
    } else {
      try {
        total += (await stat(full)).size;
      } catch {
        // File removed mid-scan — ignore, not worth failing the whole sum.
      }
    }
  }
  return total;
}

// Multisite panel's resource-usage column (disk + DB size per tenant) — a
// glance metric, not billing-grade metering. Sequential, not Promise.all:
// this is a superadmin dashboard refresh, not a hot path, and running ~100
// tenants' worth of queries concurrently against the control-plane pool has
// no benefit worth the extra connection pressure.
app.get("/api/portal/tenants/usage", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const tenants = await listTenants();
  const usage = [];
  for (const t of tenants) {
    const dbSizeBytes = await getTenantDbSizeBytes(t.host);
    let diskSizeBytes: number | null = null;
    if (isLocalDriver) {
      const tenantFolder = t.host.toLowerCase().replace(/[^a-z0-9]/g, "_");
      diskSizeBytes = await dirSizeBytes(path.join(localUploadsDir, tenantFolder));
    }
    usage.push({ host: t.host, dbSizeBytes, diskSizeBytes });
  }
  return { usage };
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
  if (!looksLikeDomain(host)) {
    reply.code(400);
    return { error: "host must be a bare hostname (e.g. site.example.com), not a full URL" };
  }
  await createTenant(host, departmentName, dbUrl || null);
  await maybeSyncCaddy();
  return { created: true };
});

// Danger Zone: irreversible. Requires the caller to echo the host back
// exactly (the admin's type-to-confirm box) — a second, server-side check
// of the same confirmation, not just client-side UX.
app.delete("/api/portal/tenants/:host", async (req, reply) => {
  const session = verifySuperadmin(req, reply);
  if (!session) return;
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
  await maybeSyncCaddy();
  await insertAuditLog({
    actorUserId: session.userId,
    actorEmail: session.email,
    action: "tenant.delete",
    target: host,
    ip: req.ip,
  });
  return { deleted: true };
});

app.get("/api/portal/proxy-settings", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const enabled = await getProxyAutomationEnabled();
  const connected = enabled ? await pingCaddy() : false;
  return { enabled, connected };
});

app.put("/api/portal/proxy-settings", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    reply.code(400);
    return { error: "enabled must be a boolean" };
  }
  await setProxyAutomationEnabled(enabled);
  if (enabled) await maybeSyncCaddy();
  return { enabled };
});

app.post("/api/portal/proxy-settings/resync", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  if (!(await getProxyAutomationEnabled())) {
    reply.code(400);
    return { error: "proxy automation is not enabled" };
  }
  try {
    await syncCaddy(await listTenants());
    return { synced: true };
  } catch (err) {
    reply.code(502);
    return { synced: false, error: (err as Error).message };
  }
});

// Sibling of the Caddy-based automation above, for the nginx-as-edge
// enterprise pattern instead (see CLAUDE.md's "nginx-as-edge" section) —
// forwards to the monitor process's own POST /api/ssl/issue, which is the
// one that actually has host-level shell access to run certbot against
// nginx. MONITOR_URL is only set by install.sh's install_monitor when it
// wrote MONITOR_USER/MONITOR_PASSWORD alongside it, so an unconfigured
// deployment (Caddy-only, or nginx set up by hand before this feature
// existed) gets a clear 501 instead of a confusing network error.
app.post("/api/portal/ssl/issue", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { domain, email } = req.body as { domain?: string; email?: string };
  if (typeof domain !== "string" || !domain || typeof email !== "string" || !email) {
    reply.code(400);
    return { error: "domain and email are required" };
  }
  const monitorUrl = process.env.MONITOR_URL;
  if (!monitorUrl) {
    reply.code(501);
    return { error: "MONITOR_URL is not configured — this deployment has no monitor to run certbot on" };
  }
  const auth = Buffer.from(`${process.env.MONITOR_USER ?? "admin"}:${process.env.MONITOR_PASSWORD ?? ""}`).toString(
    "base64",
  );
  try {
    const res = await fetch(`${monitorUrl}/api/ssl/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ domain, email }),
    });
    const body = (await res.json()) as { error?: string; stdout?: string; stderr?: string };
    if (!res.ok) {
      reply.code(502);
      return { error: body.error ?? "certbot request failed", stderr: body.stderr };
    }
    return body;
  } catch (err) {
    reply.code(502);
    return { error: (err as Error).message };
  }
});

// Blue-green deploy promotion (scripts/deploy.sh): once the just-started
// color's own containers report healthy, the deploy script calls this on
// one of them, telling Caddy to route admin/api/tenant traffic at THIS
// color's containers instead of whichever was live before. Deliberately
// bypasses getProxyAutomationEnabled() — that switch only ever gated
// automatic DNS/cert provisioning for a tenant's own CUSTOM domain, a
// separate concern from which color of container is currently live. A
// blue-green deploy only works at all if Caddy's base routing is driven
// dynamically on every deploy, switch or no switch — see CLAUDE.md. Guarded
// by a shared secret rather than a session token, since this is called
// container-to-container over the docker-internal network by deploy
// tooling, never by a browser.
const DEPLOY_SECRET = process.env.DEPLOY_SECRET;

app.post("/internal/deploy/promote", async (req, reply) => {
  if (!DEPLOY_SECRET) {
    reply.code(503);
    return { error: "DEPLOY_SECRET not configured — blue-green promote is disabled" };
  }
  const provided = Buffer.from((req.headers["x-deploy-secret"] as string | undefined) ?? "");
  const expected = Buffer.from(DEPLOY_SECRET);
  // Compare against a length that's always the same regardless of `provided`
  // so a mismatched length doesn't short-circuit the timing check faster
  // than a near-miss of the right length.
  const matches = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!matches) {
    reply.code(401);
    return { error: "invalid deploy secret" };
  }
  const { admin, api, frontend } = (req.body as CaddyUpstreams) ?? {};
  for (const [name, value] of [
    ["admin", admin],
    ["api", api],
    ["frontend", frontend],
  ] as const) {
    if (value !== undefined && !isValidDialTargets(value)) {
      reply.code(400);
      return { error: `invalid ${name} dial target(s) — expected host:port strings` };
    }
  }
  try {
    await syncCaddy(await listTenants(), { admin, api, frontend });
    return { promoted: true };
  } catch (err) {
    reply.code(502);
    return { promoted: false, error: (err as Error).message };
  }
});

// Uploads USIM's own paid certificate for `host`, forwarded straight to
// Caddy — never written to this API's own disk or DB (see proxy-sync.ts's
// loadCaddyCert). Caddy is the one real validator of the cert/key pair.
app.post("/api/portal/tenants/:host/cert", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  if (!(await getProxyAutomationEnabled())) {
    reply.code(400);
    return { error: "proxy automation is not enabled" };
  }
  const { host } = req.params as { host: string };
  if (!(await listTenants()).some((t) => t.host === host)) {
    reply.code(404);
    return { error: "tenant not found" };
  }
  let certPem: string | null = null;
  let keyPem: string | null = null;
  for await (const part of req.parts()) {
    if (part.type !== "file") continue;
    const buf = await part.toBuffer();
    if (part.fieldname === "cert") certPem = buf.toString("utf8");
    if (part.fieldname === "key") keyPem = buf.toString("utf8");
  }
  if (!certPem || !keyPem) {
    reply.code(400);
    return { error: "cert and key files required (multipart/form-data, fields 'cert' and 'key')" };
  }
  let expiresAt: Date;
  try {
    expiresAt = parseCertExpiry(certPem);
  } catch {
    reply.code(400);
    return { error: "certificate could not be parsed (expected PEM)" };
  }
  try {
    await loadCaddyCert(host, certPem, keyPem);
  } catch (err) {
    reply.code(400);
    return { error: (err as Error).message };
  }
  await setTenantCertInfo(host, expiresAt);
  await maybeSyncCaddy();
  return { hasCustomCert: true, certExpiresAt: expiresAt.toISOString() };
});

// Reverts `host` to Caddy's automatic Let's Encrypt HTTPS.
app.delete("/api/portal/tenants/:host/cert", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  if (!(await getProxyAutomationEnabled())) {
    reply.code(400);
    return { error: "proxy automation is not enabled" };
  }
  const { host } = req.params as { host: string };
  if (!(await listTenants()).some((t) => t.host === host)) {
    reply.code(404);
    return { error: "tenant not found" };
  }
  try {
    await unloadCaddyCert(host);
  } catch (err) {
    reply.code(502);
    return { error: (err as Error).message };
  }
  await setTenantCertInfo(host, null);
  await maybeSyncCaddy();
  return { hasCustomCert: false };
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
  await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "user.delete", target: id, ip: req.ip });
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

// Superadmin-curated master language list (i18n Phase 1 — see
// docs/superpowers/specs/2026-08-06-global-language-registry-design.md).
// `code` is immutable once created: PATCH silently ignores it, matching how
// roles' own PATCH treats `name` vs `permissions` distinctly above.
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

app.get("/api/portal/languages", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  return { languages: await listLanguages() };
});

app.post("/api/portal/languages", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { code, label } = req.body as { code?: string; label?: string };
  if (!code || !LANGUAGE_CODE_RE.test(code)) {
    reply.code(400);
    return { error: "code must look like a language code, e.g. \"en\" or \"zh-cn\"" };
  }
  if (!label?.trim()) {
    reply.code(400);
    return { error: "label required" };
  }
  try {
    await createLanguage(code, label);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      reply.code(400);
      return { error: "code already exists" };
    }
    throw err;
  }
  return { created: true };
});

app.patch("/api/portal/languages/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const { label, enabled, sortOrder } = req.body as { label?: string; enabled?: boolean; sortOrder?: number };
  if (label !== undefined && !label.trim()) {
    reply.code(400);
    return { error: "label cannot be empty" };
  }
  const patch: { label?: string; enabled?: boolean; sortOrder?: number } = {};
  if (label !== undefined) patch.label = label;
  if (enabled !== undefined) patch.enabled = enabled;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  const { error } = await updateLanguage(id, patch);
  if (error) {
    reply.code(400);
    return { error };
  }
  return { saved: true };
});

app.delete("/api/portal/languages/:id", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { id } = req.params as { id: string };
  const { error } = await deleteLanguage(id);
  if (error) {
    reply.code(400);
    return { error };
  }
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
  await maybeSyncCaddy();
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
  await maybeSyncCaddy();
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
  // i18n Phase 5 — each translations[code].layout is just as much a raw
  // layout tree as the top-level one above, and gets the exact same check.
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, unknown>)) {
      const layout = (entry as Record<string, unknown> | null)?.layout;
      if (layout === undefined) continue;
      const err = validateLayout(layout);
      if (err) throw Object.assign(new Error(err), { statusCode: 400 });
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
  registerPublicCollectionRoutes(publicScope, menusCollection);
  registerPublicCollectionRoutes(publicScope, eventsCollection);
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
    const { allEnabled, showHeaderSwitcher } = await getTenantLanguageSelection(req.tenantHost);
    return { enabled: allEnabled.map((l) => ({ code: l.code, label: l.label })), showHeaderSwitcher };
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
  registerProtectedCollectionRoutes(protectedScope, menusCollection);
  registerProtectedCollectionRoutes(protectedScope, eventsCollection);

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
    await cacheInvalidate(`ucms:cache:${req.tenantHost}:theme`);
    return { saved: true };
  });

  // i18n Phase 2 — any authenticated user of this tenant can view the
  // current selection; only languages.write can change it (superadmin
  // always bypasses, per hasPermission).
  protectedScope.get("/api/tenant-languages", async (req) => {
    const { allEnabled, selectedCodes, showHeaderSwitcher, multilangEnabled, defaultLanguage } = await getTenantLanguageSelection(req.tenantHost);
    return { allEnabled, selectedCodes, showHeaderSwitcher, multilangEnabled, defaultLanguage };
  });

  protectedScope.put("/api/tenant-languages", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "languages.write")) {
      reply.code(403);
      return { error: "missing languages.write permission" };
    }
    const { codes, showHeaderSwitcher, multilangEnabled, defaultLanguage } = req.body as {
      codes?: string[];
      showHeaderSwitcher?: boolean;
      multilangEnabled?: boolean;
      defaultLanguage?: string | null;
    };
    if (!Array.isArray(codes)) {
      reply.code(400);
      return { error: "codes must be an array" };
    }
    const { allEnabled } = await getTenantLanguageSelection(req.tenantHost);
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
    await setTenantLanguageSelection(req.tenantHost, codes, Boolean(showHeaderSwitcher), Boolean(multilangEnabled), defaultLanguage ?? null);
    return { saved: true };
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
  void maybeSyncCaddyAtBoot();
});
