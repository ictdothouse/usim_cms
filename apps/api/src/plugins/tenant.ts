import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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
    } catch (err) {
      if (err instanceof UnknownTenantError) {
        return reply.code(404).send({ error: "Unknown tenant" });
      }
      throw err;
    }
  });

  // Always release the pool client back, even on error responses.
  app.addHook("onResponse", async (req: FastifyRequest) => {
    req.releaseTenantConnection?.();
  });
}
