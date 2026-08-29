import type { FastifyRequest, FastifyReply } from "fastify";

// Minimal cookie read/write — no @fastify/cookie dependency needed for the
// one cookie this app sets (session). Avoids a new package + regenerating
// pnpm-lock.yaml, per this project's "avoid heavy dependencies" constraint.

export const SESSION_COOKIE_NAME = "ucms_session";

export function getSessionCookie(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
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
  reply.header("set-cookie", [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, ...baseAttrs(maxAgeSeconds)].join("; "));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", [`${SESSION_COOKIE_NAME}=`, ...baseAttrs(0)].join("; "));
}
