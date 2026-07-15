import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

// ponytail: dev fallback secret. Must be set to a real random value via
// SESSION_SECRET before any real deployment.
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

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
  permissions: string[];
  // Set only on a superadmin's "view as" token (see /api/portal/impersonate)
  // — the superadmin's own email, for audit trails on actions taken while
  // impersonating.
  impersonatedBy?: string;
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
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}
