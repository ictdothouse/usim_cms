import { randomBytes, scrypt, timingSafeEqual, createHmac } from "node:crypto";

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

// Non-superadmin roles may use the platform's mandatory-MFA switch. The
// password-login route always requires TOTP enrollment for superadmins.
export function isMfaSetupRequired(totpEnabled: boolean, mfaRequired: boolean): boolean {
  return mfaRequired && !totpEnabled;
}

if (process.env.NODE_ENV === "production" && Buffer.byteLength(process.env.SESSION_SECRET ?? "") < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 bytes in production — refusing to boot with an insecure secret.");
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

// Normal login sessions (setup/login/impersonate) get this TTL; preview/
// theme-preview tokens set their own, much shorter exp already.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SCRYPT_KEY_LENGTH = 64;
type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
const SCRYPT_CURRENT: ScryptOptions = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SCRYPT_LEGACY: ScryptOptions = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_ACTIVE_SCRYPT_JOBS = 1;
const MAX_QUEUED_SCRYPT_JOBS = 64;
let activeScryptJobs = 0;
const queuedScryptJobs: Array<() => void> = [];

async function acquireScryptSlot(): Promise<void> {
  if (activeScryptJobs < MAX_ACTIVE_SCRYPT_JOBS) {
    activeScryptJobs++;
    return;
  }
  if (queuedScryptJobs.length >= MAX_QUEUED_SCRYPT_JOBS) {
    throw new Error("password verification capacity reached");
  }
  await new Promise<void>((resolve) => queuedScryptJobs.push(resolve));
}

function releaseScryptSlot(): void {
  const next = queuedScryptJobs.shift();
  if (next) next();
  else activeScryptJobs--;
}

async function derivePasswordKey(password: string, salt: string, options: ScryptOptions): Promise<Buffer> {
  await acquireScryptSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, SCRYPT_KEY_LENGTH, options, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  } finally {
    releaseScryptSlot();
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await derivePasswordKey(password, salt, SCRYPT_CURRENT);
  return `scrypt$${SCRYPT_CURRENT.N}$${SCRYPT_CURRENT.r}$${SCRYPT_CURRENT.p}$${salt}$${hash.toString("hex")}`;
}

async function hashLegacyPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await derivePasswordKey(password, salt, SCRYPT_LEGACY);
  return `${salt}:${hash.toString("hex")}`;
}

// Keep the password-check cost similar for known and unknown emails so the
// login endpoint does not expose an account-existence timing oracle.
const DUMMY_PASSWORD = randomBytes(32).toString("hex");
const DUMMY_PASSWORD_HASH_CURRENT = hashPassword(DUMMY_PASSWORD);
const DUMMY_PASSWORD_HASH_LEGACY = hashLegacyPassword(DUMMY_PASSWORD);

export async function verifyPasswordOrDummy(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) {
    await verifyPassword(password, await DUMMY_PASSWORD_HASH_CURRENT);
    await verifyPassword(password, await DUMMY_PASSWORD_HASH_LEGACY);
    return false;
  }
  const valid = await verifyPassword(password, stored);
  // Every attempt performs one current-cost and one legacy-cost KDF, whether
  // the record is absent or uses either supported hash format.
  if (stored.startsWith("scrypt$")) await verifyPassword(password, await DUMMY_PASSWORD_HASH_LEGACY);
  else await verifyPassword(password, await DUMMY_PASSWORD_HASH_CURRENT);
  return valid;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let salt: string;
  let hash: string;
  let options: typeof SCRYPT_CURRENT;
  const parts = stored.split("$");
  if (parts.length === 6 && parts[0] === "scrypt") {
    if (parts[1] !== String(SCRYPT_CURRENT.N) || parts[2] !== String(SCRYPT_CURRENT.r) || parts[3] !== String(SCRYPT_CURRENT.p)) return false;
    [, , , , salt, hash] = parts;
    options = SCRYPT_CURRENT;
  } else {
    const legacyParts = stored.split(":");
    if (legacyParts.length !== 2) return false;
    [salt, hash] = legacyParts;
    options = SCRYPT_LEGACY;
  }
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash)) return false;
  const candidate = await derivePasswordKey(password, salt, options);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function validatePasswordInput(password: unknown): string | null {
  if (typeof password !== "string") return "password is required";
  const byteLength = Buffer.byteLength(password, "utf8");
  if (Array.from(password).length < 15) return "password must be at least 15 characters";
  if (byteLength > 1024) return "password must be no more than 1024 bytes";
  return null;
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
  // Set only on a page/blueprint/siteChrome preview token that was minted
  // alongside not-yet-saved canvas content (Designer's Preview/Live Edit,
  // used with no prior Save — see live-preview-store.ts) — points at that
  // draft's entry in the ephemeral store, never the content itself (a full
  // layout tree is too large to embed in a token that ends up in a URL query
  // string, unlike themePreview's small flat settings map above). GET
  // /api/live-preview is the only route that reads this claim.
  livePreviewId?: string;
  // Set only on a maintenance-bypass token (see POST
  // /api/portal/tenants/:host/maintenance-bypass-token) — lets Manage Site's
  // "View" link keep browsing a tenant's real site while maintenanceMode is
  // on; apps/frontend's middleware.ts checks this alongside tenantHost
  // (below) matching the requested host, so a token minted for one tenant
  // can't bypass another's gate. Same previewOnly/exp shape as every other
  // short-lived credential here.
  maintenanceBypass?: true;
  // Set only on the short-lived token POST /api/auth/login returns when the
  // user has TOTP enabled — proves the password check passed, but is
  // rejected everywhere else (verifySuperadmin/verifyAnyUser/
  // requireTenantAuth, same treatment as previewOnly) until POST
  // /api/auth/totp-verify exchanges it for a real session.
  pendingMfa?: true;
  // Set only on the short-lived state token GET /api/auth/entra/login mints
  // before redirecting to Microsoft — verified by GET /api/auth/entra/
  // callback as CSRF/replay protection on the OAuth round trip (rejected
  // everywhere else, same treatment as previewOnly/pendingMfa above).
  entraState?: true;
  // The random nonce bound into the entraState token above — matched against
  // the entra_oauth_state cookie (lib/cookies.ts) in the callback, so a
  // replayed state+code pair minted for one browser can't complete the login
  // in a different one (login-CSRF). See entra.ts's isEntraStateValid.
  entraNonce?: string;
  // Unix ms expiry. Optional only because a token predating this field
  // (signed before SESSION_TTL_MS existed) must still verify — every
  // signSession call today sets it, whether SESSION_TTL_MS (login/setup/
  // impersonate) or a preview token's own short TTL.
  exp?: number;
  // Set only on a real login session (never on a preview/pendingMfa token,
  // which can't reach a write route anyway). The session itself now travels
  // as an httpOnly cookie, unreadable by JS — this is the one piece the
  // client CAN read/hold and must echo back as an `x-csrf-token` header on
  // every mutating request, since a cookie alone is sent automatically by
  // the browser and proves nothing about which site's JS actually initiated
  // the request. See plugins/auth.ts's CSRF check.
  csrfToken?: string;
  // HMAC fingerprint of the user's password and MFA state. It lets each
  // authenticated request revoke old sessions immediately after either
  // changes without storing bearer tokens in a session table.
  authStamp?: string;
  // Only set after app TOTP or an Entra token whose signed amr claim proves
  // MFA. Production middleware rejects sessions without this claim.
  mfaVerified?: true;
}

export function createAuthStamp(user: { passwordHash: string; totpSecret: string | null; totpEnabled: boolean; authVersion: number }): string {
  return createHmac("sha256", SESSION_SECRET)
    .update(JSON.stringify([user.passwordHash, user.totpEnabled ? user.totpSecret : null, user.totpEnabled, user.authVersion]))
    .digest("base64url");
}

export function matchesAuthStamp(
  stamp: string | undefined,
  user: { passwordHash: string; totpSecret: string | null; totpEnabled: boolean; authVersion: number },
): boolean {
  if (!stamp) return false;
  const expected = Buffer.from(createAuthStamp(user));
  const actual = Buffer.from(stamp);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateCsrfToken(): string {
  return randomBytes(24).toString("base64url");
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
    // Every app, preview, Entra-state and pending-MFA token is short lived.
    // Reject old non-expiring tokens rather than keeping an unsafe legacy path.
    if (!Number.isSafeInteger(payload.exp) || Date.now() > payload.exp!) return null;
    return payload;
  } catch {
    return null;
  }
}
