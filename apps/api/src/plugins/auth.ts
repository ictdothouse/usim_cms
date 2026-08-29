import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { verifySession, type SessionPayload } from "../db/auth.js";
import { getSessionCookie } from "../lib/cookies.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionPayload;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The session itself lives in an httpOnly cookie (unreadable by JS, so an
// XSS bug can't exfiltrate it) — but that means the browser now attaches it
// automatically to ANY request to this origin, cross-site included, which is
// exactly the CSRF threat model. session.csrfToken (echoed by the admin as
// an x-csrf-token header on every mutating request, see lib/api.ts's
// request()) proves the request was actually built by JS running on the
// admin's own origin, not just riding the ambient cookie from somewhere
// else. GET/HEAD are exempt — they don't change state.
function checkCsrf(req: FastifyRequest, reply: FastifyReply, session: SessionPayload): boolean {
  if (!MUTATING_METHODS.has(req.method)) return true;
  const header = req.headers["x-csrf-token"];
  if (!session.csrfToken || header !== session.csrfToken) {
    reply.code(403).send({ error: "Missing or invalid CSRF token" });
    return false;
  }
  return true;
}

// Runs after tenantPlugin (needs req.tenantHost already set): validates the
// session cookie, then locks a webmaster to exactly the tenant on their
// session — the actual enforcement of "webmaster hanya untuk web dia je".
export async function requireTenantAuth(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const cookie = getSessionCookie(req);
    if (!cookie) {
      return reply.code(401).send({ error: "Missing session" });
    }
    const session = verifySession(cookie);
    if (!session) {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
    // A preview token (see /api/pages/:id/preview-token) is read-only by
    // design — it must never reach a write/protected route, even though it
    // carries a real role/tenantHost that would otherwise pass every check
    // below.
    if (session.previewOnly) {
      return reply.code(403).send({ error: "Preview token cannot be used here" });
    }
    if (session.pendingMfa) {
      return reply.code(403).send({ error: "Complete MFA verification first" });
    }
    if (!checkCsrf(req, reply, session)) return;
    const allowedHosts = session.tenantHosts ?? (session.tenantHost ? [session.tenantHost] : []);
    if (session.role === "webmaster" && !allowedHosts.includes(req.tenantHost)) {
      return reply.code(403).send({ error: "Not authorized for this tenant" });
    }
    req.user = session;
    // Flips the RLS write policies open for this request's pooled
    // connection (see tenant.ts's reset + migrations/0002_pages_rls.sql).
    await req.db.execute(sql`SET SESSION app.authenticated = 'true'`);
  });
}

// For root-level (non-tenant-scoped) superadmin-only routes: manage
// tenants/users/global theme. No x-tenant-host involved here at all.
export function verifySuperadmin(req: FastifyRequest, reply: FastifyReply): SessionPayload | null {
  const cookie = getSessionCookie(req);
  if (!cookie) {
    reply.code(401).send({ error: "Missing session" });
    return null;
  }
  const session = verifySession(cookie);
  if (!session) {
    reply.code(401).send({ error: "Invalid or expired session" });
    return null;
  }
  if (session.previewOnly) {
    reply.code(403).send({ error: "Preview token cannot be used here" });
    return null;
  }
  if (session.pendingMfa) {
    reply.code(403).send({ error: "Complete MFA verification first" });
    return null;
  }
  if (session.role !== "superadmin") {
    reply.code(403).send({ error: "Superadmin only" });
    return null;
  }
  if (!checkCsrf(req, reply, session)) return null;
  return session;
}

// For root-level routes any logged-in user (superadmin or webmaster) may
// call, keyed by their own userId — theme-preset favourites, not
// tenant-scoped content, so no x-tenant-host/tenantPlugin involved.
export function verifyAnyUser(req: FastifyRequest, reply: FastifyReply): SessionPayload | null {
  const cookie = getSessionCookie(req);
  if (!cookie) {
    reply.code(401).send({ error: "Missing session" });
    return null;
  }
  const session = verifySession(cookie);
  if (!session) {
    reply.code(401).send({ error: "Invalid or expired session" });
    return null;
  }
  if (session.previewOnly) {
    reply.code(403).send({ error: "Preview token cannot be used here" });
    return null;
  }
  if (session.pendingMfa) {
    reply.code(403).send({ error: "Complete MFA verification first" });
    return null;
  }
  if (!checkCsrf(req, reply, session)) return null;
  return session;
}
