import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

// --- TOTP (RFC 6238), stdlib-only — no otplib/speakeasy dependency needed
// for a standard 6-digit/30s HMAC-SHA1 code. ---
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function totpCodeAt(secretBase32: string, timeStepCounter: number): string {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(timeStepCounter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

// Accepts the current 30s step and one step either side (±30s clock drift
// tolerance) — a real authenticator app and this server's clock are rarely
// perfectly in sync.
export function verifyTotpCode(secretBase32: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 1000 / 30);
  for (const delta of [0, -1, 1]) {
    if (timingSafeEqual(Buffer.from(totpCodeAt(secretBase32, counter + delta)), Buffer.from(code))) return true;
  }
  return false;
}

export function totpAuthUri(secretBase32: string, email: string): string {
  const label = encodeURIComponent(`UCMS:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=UCMS&algorithm=SHA1&digits=6&period=30`;
}

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
  // Set only on the short-lived token POST /api/auth/login returns when the
  // user has TOTP enabled — proves the password check passed, but is
  // rejected everywhere else (verifySuperadmin/verifyAnyUser/
  // requireTenantAuth, same treatment as previewOnly) until POST
  // /api/auth/totp-verify exchanges it for a real session.
  pendingMfa?: true;
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
