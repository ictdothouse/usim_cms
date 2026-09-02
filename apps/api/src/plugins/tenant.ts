import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { getTenantConnection, UnknownTenantError, type TenantDb } from "../db/tenant-pool.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantHost: string;
    db: TenantDb;
    releaseTenantConnection?: () => void;
  }
}

export async function tenantPlugin(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantHost = req.headers["x-tenant-host"];
    if (typeof tenantHost !== "string" || tenantHost.length === 0) {
      return reply.code(400).send({ error: "Missing x-tenant-host header" });
    }
    req.tenantHost = tenantHost;
    try {
      const { db, release } = await getTenantConnection(tenantHost);
      req.db = db;
      req.releaseTenantConnection = release;
      // Pooled connection: always reset this before use, since a prior
      // request may have left it "true" (requireTenantAuth sets it, this
      // scope's own hook runs first — see index.ts's public/protected
      // registration order). Backs the RLS write policies on pages
      // (migrations/0002_pages_rls.sql): defense-in-depth so a write can
      // never slip through on a connection that hasn't proven auth this
      // request, even if a future handler bug skips requireTenantAuth.
      await db.execute(sql`SET SESSION app.authenticated = 'false'`);
    } catch (err) {
      if (err instanceof UnknownTenantError) {
        // User-facing wording only — "tenant" stays the internal term
        // throughout the codebase (x-tenant-host, tenantHost, etc.), this is
        // the one place an unrecognized/inactive domain's visitor could see
        // the raw error text.
        return reply.code(404).send({ error: "Unknown site" });
      }
      throw err;
    }
  });

  // Always release the pool client back, even on error responses.
  app.addHook("onResponse", async (req: FastifyRequest) => {
    req.releaseTenantConnection?.();
  });
}
