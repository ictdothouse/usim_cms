import type { FastifyRequest, FastifyReply } from "fastify";

// Minimal cookie read/write — no @fastify/cookie dependency needed for the
// one cookie this app sets (session). Avoids a new package + regenerating
// pnpm-lock.yaml, per this project's "avoid heavy dependencies" constraint.

export const SESSION_COOKIE_NAME = "ucms_session";
export const ENTRA_STATE_COOKIE_NAME = "ucms_entra_state";

function getCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const partName = part.slice(0, eq).trim();
    if (partName === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function getSessionCookie(req: FastifyRequest): string | undefined {
  return getCookie(req, SESSION_COOKIE_NAME);
}

export function getEntraStateCookie(req: FastifyRequest): string | undefined {
  return getCookie(req, ENTRA_STATE_COOKIE_NAME);
}

// A response can need to set/clear more than one cookie at once (the entra
// callback clears the oauth-state cookie AND sets the session cookie in the
// same redirect) — reply.header("set-cookie", ...) overwrites on a second
// call, so every setter below appends onto whatever's already queued rather
// than assuming it's the only cookie this response will ever send.
function appendSetCookie(reply: FastifyReply, cookieString: string): void {
  const existing = reply.getHeader("set-cookie");
  const cookies = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  reply.header("set-cookie", [...cookies, cookieString]);
}

// SameSite=Lax is enough here: the admin panel and API are always deployed
// as subdomains of one shared parent domain (see CLAUDE.md's ADMIN_DOMAIN/
// API_DOMAIN convention), which browsers treat as "same-site" regardless of
// subdomain or port — Lax cookies are sent on those requests unconditionally,
// the Strict/Lax/None distinction only bites on genuinely cross-site
// requests. Overridable via env for a deployment that genuinely splits
// admin/api across unrelated domains (needs SameSite=None, which browsers
// additionally require Secure for).
const SAMESITE = process.env.SESSION_COOKIE_SAMESITE ?? "Lax";

function baseAttrs(maxAgeSeconds: number): string[] {
  const attrs = ["Path=/", "HttpOnly", `SameSite=${SAMESITE}`, `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  appendSetCookie(reply, [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, ...baseAttrs(maxAgeSeconds)].join("; "));
}

export function clearSessionCookie(reply: FastifyReply): void {
  appendSetCookie(reply, [`${SESSION_COOKIE_NAME}=`, ...baseAttrs(0)].join("; "));
}

// Short-lived (10min, matching the entraState token's own TTL), HttpOnly —
// binds the OAuth round trip to the browser that started it. Set in
// entra/login, checked+cleared (one-time use, success or failure) in
// entra/callback. See entra.ts's isEntraStateValid for why this exists.
export function setEntraStateCookie(reply: FastifyReply, nonce: string): void {
  appendSetCookie(reply, [`${ENTRA_STATE_COOKIE_NAME}=${encodeURIComponent(nonce)}`, ...baseAttrs(600)].join("; "));
}

export function clearEntraStateCookie(reply: FastifyReply): void {
  appendSetCookie(reply, [`${ENTRA_STATE_COOKIE_NAME}=`, ...baseAttrs(0)].join("; "));
}
