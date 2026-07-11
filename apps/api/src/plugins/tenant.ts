import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getTenantDb } from "../db/tenant-pool.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantHost: string;
    db: ReturnType<typeof getTenantDb>;
  }
}

export async function tenantPlugin(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantHost = req.headers["x-tenant-host"];
    if (typeof tenantHost !== "string" || tenantHost.length === 0) {
      return reply.code(400).send({ error: "Missing x-tenant-host header" });
    }
    req.tenantHost = tenantHost;
    req.db = getTenantDb(tenantHost);
  });
}
