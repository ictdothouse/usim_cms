import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { verifySession, type SessionPayload } from "../db/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionPayload;
  }
}

// Runs after tenantPlugin (needs req.tenantHost already set): validates the
// bearer token, then locks a webmaster to exactly the tenant on their
// session — the actual enforcement of "webmaster hanya untuk web dia je".
export async function requireTenantAuth(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing bearer token" });
    }
    const session = verifySession(header.slice("Bearer ".length));
    if (!session) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
    // A preview token (see /api/pages/:id/preview-token) is read-only by
    // design — it must never reach a write/protected route, even though it
    // carries a real role/tenantHost that would otherwise pass every check
    // below.
    if (session.previewOnly) {
      return reply.code(403).send({ error: "Preview token cannot be used here" });
    }
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
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing bearer token" });
    return null;
  }
  const session = verifySession(header.slice("Bearer ".length));
  if (!session) {
    reply.code(401).send({ error: "Invalid or expired token" });
    return null;
  }
  if (session.previewOnly) {
    reply.code(403).send({ error: "Preview token cannot be used here" });
    return null;
  }
  if (session.role !== "superadmin") {
    reply.code(403).send({ error: "Superadmin only" });
    return null;
  }
  return session;
}
