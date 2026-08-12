import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production — refusing to boot with the insecure dev default.");
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

// Normal login sessions (setup/login/impersonate) get this TTL; preview/
// theme-preview tokens set their own, much shorter exp already.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface SessionPayload {
  userId: string;
  email: string;
  role: "superadmin" | "webmaster";
  tenantHost: string | null;
  // All sites this webmaster can switch into (superadmin ignores this,
  // already unrestricted). Optional for backward compat with tokens signed
  // before this field existed — callers must fall back to [tenantHost].
  tenantHosts?: string[];
  permissions: string[];
  // Set only on a superadmin's "view as" token (see /api/portal/impersonate)
  // — the superadmin's own email, for audit trails on actions taken while
  // impersonating.
  impersonatedBy?: string;
  // Set only on a page-preview token (see /api/pages/:id/preview-token) — a
  // short-lived, read-only credential so a "preview this draft" link never
  // carries the admin's real, non-expiring session bearer. requireTenantAuth
  // (plugins/auth.ts) refuses this on every write/protected route; only the
  // public scope's elevateIfAuthenticated (generic-crud.ts) accepts it.
  previewOnly?: true;
  // Set only on a theme-preview token (see POST /api/theme-preview-token) —
  // carries not-yet-saved site_theme.settings so GET /api/theme can render
  // them for this request only, without writing to site_theme. Same
  // previewOnly/exp gating as a page-preview token.
  themePreview?: Record<string, string>;
  // Unix ms expiry. Optional only because a token predating this field
  // (signed before SESSION_TTL_MS existed) must still verify — every
  // signSession call today sets it, whether SESSION_TTL_MS (login/setup/
  // impersonate) or a preview token's own short TTL.
  exp?: number;
}

// Simple HMAC-signed session token — no JWT library needed for a same-app
// local login. Entra ID SSO (later) issues its own token via a separate
// login route; both just need to end up producing a SessionPayload.
export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.exp !== undefined && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
