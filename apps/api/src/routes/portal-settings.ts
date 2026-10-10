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
  getBackupDestination,
  setBackupDestination,
  maskBackupDestination,
} from "../db/tenant-pool.js";
import type { BackupDestinationConfig } from "../db/tenant-pool.js";

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

// Leading char must be alnum — not just "no weird charset" but specifically
// no leading `-`: rsync parses ANY argv token starting with `-` as an
// option regardless of quoting, so a target like `--rsync-path=...` would
// run as root once a day via run.sh's `rsync -a --delete -- "$src" "$target"`
// (that trailing `--` is belt-and-suspenders on top of this, not a
// substitute for it — caught by an automated security review).
const SSH_TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9_.@:/-]*$/;
const GDRIVE_FOLDER_ID_RE = /^[A-Za-z0-9_-]+$/;

// Where the nightly backup cron pushes a copy after its local dump — see
// schema.ts's platformSettings.backupDestination comment and install.sh's
// install_backup_cron/run.sh (the actual consumer; it reads this same row
// straight via psql, not through this API). `existing` lets a blank
// secret/JSON field on an edit mean "keep what's already stored" instead of
// forcing a re-paste or silently wiping it — same convention the masked GET
// response already implies by never sending the secret back.
function validateBackupDestination(body: unknown, existing: BackupDestinationConfig): string | BackupDestinationConfig {
  const b = (body as Record<string, unknown>) || {};
  const type = b.type;
  if (type === "local") return { type };
  if (type === "ssh") {
    const ssh = (b.ssh as Record<string, unknown>) || {};
    const target = String(ssh.target || "").trim();
    // Same shape install.sh's own off-site prompt validates — this still
    // ends up driving a root cron job's rsync target, not just a UI string.
    if (!target || !SSH_TARGET_RE.test(target)) return "ssh.target must look like user@host:/path";
    return { type, ssh: { target } };
  }
  if (type === "s3") {
    const s3 = (b.s3 as Record<string, unknown>) || {};
    const endpoint = String(s3.endpoint || "").trim();
    const bucket = String(s3.bucket || "").trim();
    const region = String(s3.region || "").trim();
    const accessKeyId = String(s3.accessKeyId || "").trim();
    const secretAccessKey = String(s3.secretAccessKey || "");
    if (!endpoint || !bucket || !accessKeyId) return "s3 endpoint/bucket/accessKeyId are required";
    // These land in a generated rclone.conf (ini format) on the VPS — a
    // stray newline would let one field inject a whole extra config line.
    for (const v of [endpoint, bucket, region, accessKeyId, secretAccessKey]) {
      if (/[\r\n]/.test(v)) return "s3 fields cannot contain newlines";
    }
    const keptSecret = secretAccessKey || existing.s3?.secretAccessKey || "";
    if (!keptSecret) return "s3.secretAccessKey is required";
    return { type, s3: { endpoint, bucket, region, accessKeyId, secretAccessKey: keptSecret } };
  }
  if (type === "gdrive") {
    const gdrive = (b.gdrive as Record<string, unknown>) || {};
    const folderId = String(gdrive.folderId || "").trim();
    const serviceAccountJson = String(gdrive.serviceAccountJson || "");
    if (!folderId || !GDRIVE_FOLDER_ID_RE.test(folderId)) return "gdrive.folderId must be a plain Google Drive folder ID";
    const keptJson = serviceAccountJson || existing.gdrive?.serviceAccountJson || "";
    if (!keptJson) return "gdrive.serviceAccountJson is required";
    if (keptJson.length > 20_000) return "gdrive.serviceAccountJson is too large";
    try {
      JSON.parse(keptJson);
    } catch {
      return "gdrive.serviceAccountJson must be valid JSON";
    }
    return { type, gdrive: { folderId, serviceAccountJson: keptJson } };
  }
  return "type must be one of local/ssh/s3/gdrive";
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

  app.get("/api/portal/backup-destination", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return maskBackupDestination(await getBackupDestination());
  });

  app.put("/api/portal/backup-destination", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const existing = await getBackupDestination();
    const result = validateBackupDestination(req.body, existing);
    if (typeof result === "string") {
      reply.code(400);
      return { error: result };
    }
    await setBackupDestination(result);
    await insertAuditLog({
      actorUserId: session.userId,
      actorEmail: session.email,
      action: "platform.backup_destination",
      meta: { type: result.type },
      ip: req.ip,
    });
    return maskBackupDestination(result);
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
