import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { verifySuperadmin, verifyAnyUser } from "../plugins/auth.js";
import { signSession } from "../db/auth.js";
import { isSafeUrl } from "../collections/validate-layout.js";
import { uploadFile } from "../storage.js";
import {
  listSharedContent,
  getGlobalTheme,
  setGlobalTheme,
  getMfaEnabled,
  setMfaEnabled,
  getMfaRequired,
  setMfaRequired,
  getEntraSettings,
  setEntraSettings,
  getGlobalStorageLimits,
  setGlobalStorageLimits,
  getTenantStorageLimits,
  setTenantStorageLimits,
  setTenantMaintenanceMode,
  insertAuditLog,
} from "../db/tenant-pool.js";

// Language-switcher placement/style — shared enum for both the global
// (platform_settings) and per-site (tenant_languages) settings.
// NOTE: SWITCHER_POSITIONS/SWITCHER_STYLES stay defined in index.ts (unused
// by validateThemeSettings below, still used by the tenant-languages routes
// that remain there).

const THEME_COLOR_KEYS = ["primaryColor", "secondaryColor", "backgroundColor", "textColor"] as const;
// Semantic palette (design.md v2 / CorpScale-style role coverage) — same hex
// validation as the 4 original colors, no rendered consumer yet on
// apps/frontend beyond the CSS custom properties BaseLayout.astro emits
// (same "emit the var, wire a real consumer later" precedent secondaryColor
// itself already set).
const THEME_SEMANTIC_COLOR_KEYS = ["tertiaryColor", "successColor", "warningColor", "errorColor", "infoColor"] as const;
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Letters/digits/space only — this string ends up inside a Google Fonts URL
// built by apps/frontend, so it must not carry `/`, `?`, `<`, etc.
const FONT_FAMILY_RE = /^[A-Za-z0-9 ]*$/;

// fontFamily = body font; headingFont/postTitleFont are the other two roles
// in the type system (Header/Title, Blog/Post Title) — all three end up in
// the same Google Fonts URL, so all three validate the same way.
const FONT_KEYS = ["fontFamily", "headingFont", "subHeadingFont", "postTitleFont", "captionFont"] as const;

// Typography scale (design.md v2) — size/line-height per role, same numeric
// range/validation shape as postTitleFontSize/postTitleLineHeight below, just
// generalized to 3 more roles (heading, sub-heading, body) plus a brand new
// caption role. fontFamily itself is body's font (FONT_KEYS above already
// covers it), so no separate "bodyFont" key is needed.
const TYPOGRAPHY_SIZE_KEYS = ["headingFontSize", "subHeadingFontSize", "bodyFontSize", "captionFontSize"] as const;
const TYPOGRAPHY_LINE_HEIGHT_KEYS = ["headingLineHeight", "subHeadingLineHeight", "bodyLineHeight", "captionLineHeight"] as const;
const TYPOGRAPHY_SIZE_MIN = 8;
const TYPOGRAPHY_SIZE_MAX = 120;
const TYPOGRAPHY_LINE_HEIGHT_MIN = 1;
const TYPOGRAPHY_LINE_HEIGHT_MAX = 2.5;

// Site-wide default for whether a post shows its tags/category/author/date —
// per-post can override this (posts.showTags etc., nullable booleans, null =
// inherit these). "true"/"false" strings, same wire convention as every
// other theme key (see postTitleFontSize below) — "" means unset/inherit.
const POST_DISPLAY_KEYS = ["showPostTags", "showPostCategory", "showPostAuthor", "showPostDate"] as const;
const POST_TITLE_FONT_SIZE_MIN = 12;
const POST_TITLE_FONT_SIZE_MAX = 96;
// A big custom postTitleFontSize with no matching line-height wraps its lines
// tight enough to visually overlap the element above it — this is the actual
// fix for that, not just a cosmetic add.
const POST_TITLE_LINE_HEIGHT_MIN = 1;
const POST_TITLE_LINE_HEIGHT_MAX = 2.5;

// Shared by both theme write routes (per-tenant + global). site_theme.settings
// is an open JSONB bag but only these keys are ever read by apps/frontend
// (BaseLayout.astro, posts/[slug].astro) — reject anything else instead of
// silently storing it.
// Exported: still called from index.ts (tenant-scoped PUT /api/theme) and
// from routes/theme-presets.ts and routes/collections.ts (pages settings).
export function validateThemeSettings(settings: Record<string, unknown>): string | null {
  const allowed = new Set([
    ...THEME_COLOR_KEYS,
    ...THEME_SEMANTIC_COLOR_KEYS,
    ...FONT_KEYS,
    ...POST_DISPLAY_KEYS,
    ...TYPOGRAPHY_SIZE_KEYS,
    ...TYPOGRAPHY_LINE_HEIGHT_KEYS,
    "logoUrl",
    "faviconUrl",
    "postTitleFontSize",
    "postTitleLineHeight",
  ]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) return `unknown theme key: ${key}`;
  }
  for (const key of [...THEME_COLOR_KEYS, ...THEME_SEMANTIC_COLOR_KEYS]) {
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
  if (settings.logoUrl !== undefined && settings.logoUrl !== "") {
    if (typeof settings.logoUrl !== "string") return "logoUrl must be a string";
    if (!isSafeUrl(settings.logoUrl)) return "logoUrl has an unsafe URL scheme";
  }
  if (settings.faviconUrl !== undefined && settings.faviconUrl !== "") {
    if (typeof settings.faviconUrl !== "string") return "faviconUrl must be a string";
    if (!isSafeUrl(settings.faviconUrl)) return "faviconUrl has an unsafe URL scheme";
  }
  const fontSize = settings.postTitleFontSize;
  if (fontSize !== undefined && fontSize !== "") {
    const n = Number(fontSize);
    if (!Number.isFinite(n) || n < POST_TITLE_FONT_SIZE_MIN || n > POST_TITLE_FONT_SIZE_MAX) {
      return `postTitleFontSize must be a number between ${POST_TITLE_FONT_SIZE_MIN} and ${POST_TITLE_FONT_SIZE_MAX}`;
    }
  }
  const lineHeight = settings.postTitleLineHeight;
  if (lineHeight !== undefined && lineHeight !== "") {
    const n = Number(lineHeight);
    if (!Number.isFinite(n) || n < POST_TITLE_LINE_HEIGHT_MIN || n > POST_TITLE_LINE_HEIGHT_MAX) {
      return `postTitleLineHeight must be a number between ${POST_TITLE_LINE_HEIGHT_MIN} and ${POST_TITLE_LINE_HEIGHT_MAX}`;
    }
  }
  for (const key of POST_DISPLAY_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== "" && value !== "true" && value !== "false") {
      return `${key} must be "true" or "false"`;
    }
  }
  for (const key of TYPOGRAPHY_SIZE_KEYS) {
    const value = settings[key];
    if (value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < TYPOGRAPHY_SIZE_MIN || n > TYPOGRAPHY_SIZE_MAX) {
      return `${key} must be a number between ${TYPOGRAPHY_SIZE_MIN} and ${TYPOGRAPHY_SIZE_MAX}`;
    }
  }
  for (const key of TYPOGRAPHY_LINE_HEIGHT_KEYS) {
    const value = settings[key];
    if (value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < TYPOGRAPHY_LINE_HEIGHT_MIN || n > TYPOGRAPHY_LINE_HEIGHT_MAX) {
      return `${key} must be a number between ${TYPOGRAPHY_LINE_HEIGHT_MIN} and ${TYPOGRAPHY_LINE_HEIGHT_MAX}`;
    }
  }
  return null;
}

// Upload quota — global default and per-site override, both superadmin-only
// (unlike theme.write, no webmaster permission raises this: the whole point
// is a central cap a site owner can't lift on themselves). null in either
// field means "unset" (inherit); see getMergedStorageLimits for the actual
// resolution POST /api/media enforces.
function validateStorageLimits(body: unknown): string | null {
  const b = body as Record<string, unknown>;
  for (const key of ["maxUploadFileSizeMb", "maxTotalStorageMb"] as const) {
    const v = b[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return `${key} must be a positive number or null`;
  }
  // 500 MB matches this codebase's own known-safe streaming ceiling (the
  // backup-restore upload's own per-call override, index.ts ~line 1207).
  if (typeof b.maxUploadFileSizeMb === "number" && b.maxUploadFileSizeMb > 500) return "maxUploadFileSizeMb cannot exceed 500";
  return null;
}

// Superadmin-only "Login Methods"/theme/branding/storage-limits/maintenance
// portal settings routes — moved out of index.ts verbatim (god-file breakup,
// part 3/9).
export function registerPortalSettingsRoutes(app: FastifyInstance) {
  // Superadmin-only "Login Methods" master switch — same shape as
  // proxy-settings above. Read is superadmin-only too (unlike proxy-settings'
  // GET): whether MFA is required isn't public information the way proxy
  // automation's on/off state is.
  app.get("/api/portal/login-settings", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const entra = await getEntraSettings();
    return { mfaEnabled: await getMfaEnabled(), mfaRequired: await getMfaRequired(), ...entra };
  });

  app.put("/api/portal/login-settings", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const { mfaEnabled, mfaRequired, entraEnabled, entraOnly, entraTenantId, entraClientId } = req.body as {
      mfaEnabled?: boolean;
      mfaRequired?: boolean;
      entraEnabled?: boolean;
      entraOnly?: boolean;
      entraTenantId?: string | null;
      entraClientId?: string | null;
    };
    if (mfaEnabled !== undefined) {
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
    }
    if (mfaRequired !== undefined) {
      if (typeof mfaRequired !== "boolean") {
        reply.code(400);
        return { error: "mfaRequired must be a boolean" };
      }
      await setMfaRequired(mfaRequired);
      await insertAuditLog({
        actorUserId: session.userId,
        actorEmail: session.email,
        action: "platform.mfa_toggle",
        meta: { mfaRequired },
        ip: req.ip,
      });
    }
    const entraPatch: { entraEnabled?: boolean; entraOnly?: boolean; entraTenantId?: string | null; entraClientId?: string | null } = {};
    if (entraEnabled !== undefined) entraPatch.entraEnabled = entraEnabled;
    if (entraOnly !== undefined) entraPatch.entraOnly = entraOnly;
    if (entraTenantId !== undefined) entraPatch.entraTenantId = entraTenantId;
    if (entraClientId !== undefined) entraPatch.entraClientId = entraClientId;
    if (Object.keys(entraPatch).length > 0) {
      await setEntraSettings(entraPatch);
      await insertAuditLog({
        actorUserId: session.userId,
        actorEmail: session.email,
        action: "platform.entra_config",
        meta: entraPatch,
        ip: req.ip,
      });
    }
    return { mfaEnabled: await getMfaEnabled(), mfaRequired: await getMfaRequired(), ...(await getEntraSettings()) };
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

  // Global branding (logo/favicon) upload — this is control-plane data, no
  // tenant DB involved, so it can't go through the tenant-scoped POST /api/media
  // (which requires req.db). Stored under a fixed "_global" folder, no media
  // library row since there's no tenant media table to attach one to.
  app.post("/api/portal/branding-upload", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "file required (multipart/form-data, field name 'file')" };
    }
    // svg deliberately excluded — an SVG can embed <script>, making it a
    // stored-XSS vector when served back and opened directly; the extension
    // also comes from this map (server-controlled), not the client's own
    // filename, so a mismatched-extension file can't be smuggled in.
    const extByMime: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/x-icon": ".ico",
      "image/vnd.microsoft.icon": ".ico",
    };
    const ext = extByMime[file.mimetype];
    if (!ext) {
      reply.code(415);
      return { error: `unsupported file type ${file.mimetype}` };
    }
    const filename = `${randomUUID()}${ext}`;
    const { url } = await uploadFile("_global", filename, file.file);
    return { url };
  });

  app.get("/api/portal/storage-limits", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return { limits: await getGlobalStorageLimits() };
  });

  app.put("/api/portal/storage-limits", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const error = validateStorageLimits(req.body);
    if (error) {
      reply.code(400);
      return { error };
    }
    const { maxUploadFileSizeMb = null, maxTotalStorageMb = null } = req.body as Record<string, number | null>;
    await setGlobalStorageLimits({ maxUploadFileSizeMb, maxTotalStorageMb });
    return { saved: true };
  });

  app.get("/api/portal/tenants/:host/storage-limits", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    return { limits: await getTenantStorageLimits(host) };
  });

  app.put("/api/portal/tenants/:host/storage-limits", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    const error = validateStorageLimits(req.body);
    if (error) {
      reply.code(400);
      return { error };
    }
    const { maxUploadFileSizeMb = null, maxTotalStorageMb = null } = req.body as Record<string, number | null>;
    await setTenantStorageLimits(host, { maxUploadFileSizeMb, maxTotalStorageMb });
    return { saved: true };
  });

  // Manage Site's maintenance-mode toggle — separate from suspend/delete, see
  // schema.ts's own comment on tenants.maintenanceMode.
  app.patch("/api/portal/tenants/:host/maintenance", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    const { maintenanceMode } = req.body as { maintenanceMode?: boolean };
    if (typeof maintenanceMode !== "boolean") {
      reply.code(400);
      return { error: "maintenanceMode must be a boolean" };
    }
    await setTenantMaintenanceMode(host, maintenanceMode);
    return { host, maintenanceMode };
  });

  // Mints a short-lived credential for Manage Site's "View" link so an admin
  // can keep browsing a tenant's real site while maintenanceMode is on —
  // apps/frontend's middleware.ts still shows every other visitor the
  // maintenance page. Any logged-in user may mint one for a host they're
  // actually scoped to (superadmin: any host; webmaster: their own
  // tenantHosts) — same authorization shape as the maintenance PATCH above,
  // just not superadmin-only, since a webmaster is exactly who'd want to keep
  // working on their own site during its maintenance window.
  app.post("/api/portal/tenants/:host/maintenance-bypass-token", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const { host } = req.params as { host: string };
    const allowedHosts = session.tenantHosts ?? (session.tenantHost ? [session.tenantHost] : []);
    if (session.role !== "superadmin" && !allowedHosts.includes(host)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const token = signSession({ ...session, tenantHost: host, previewOnly: true, maintenanceBypass: true, exp: Date.now() + 30 * 60 * 1000 });
    return { token };
  });
}
