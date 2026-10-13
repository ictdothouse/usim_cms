import type { FastifyInstance } from "fastify";
import { and, eq, ne, sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { cacheInvalidate } from "../cache.js";
import { hasPermission } from "./permissions.js";

export function pageHasContent(layout: unknown): boolean {
  if (!Array.isArray(layout)) return false;
  return layout.some((block) => {
    if (!block || typeof block !== "object") return false;
    const section = block as { rows?: unknown; props?: { rows?: unknown } };
    const rows = section.props?.rows ?? section.rows;
    return Array.isArray(rows) && rows.some((row) => {
      const columns = (row as { columns?: unknown })?.columns;
      return Array.isArray(columns) && columns.some((column) => {
        const elements = (column as { elements?: unknown })?.elements;
        return Array.isArray(elements) && elements.length > 0;
      });
    });
  });
}

export function registerHomepageRoute(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/api/pages/:id/set-home", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const id = req.params.id;
    const item = await req.db.transaction(async (tx) => {
      // Serializes homepage changes within this tenant database. Both slug
      // writes and the revision commit or roll back together.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ucms:pages:set-home'))`);
      const [target] = await tx.select().from(schema.pages).where(eq(schema.pages.id, id));
      if (!target) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
      if (!pageHasContent(target.layout)) {
        throw Object.assign(new Error("Add content before making this the homepage"), { statusCode: 400 });
      }
      if (target.slug === "home") return target;
      const [previous] = await tx.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.slug, "home"), ne(schema.pages.id, id)));
      if (previous) {
        await tx.update(schema.pages)
          .set({ slug: `home-${previous.id}`, updatedAt: new Date() })
          .where(eq(schema.pages.id, previous.id));
      }
      const now = new Date();
      const [updated] = await tx.update(schema.pages)
        .set({ slug: "home", status: "published", publishedAt: now, updatedAt: now })
        .where(eq(schema.pages.id, id)).returning();
      await tx.insert(schema.pageRevisions).values({
        pageId: id, title: updated.title, layout: updated.layout,
        settings: updated.settings, bannerImageUrl: updated.bannerImageUrl,
        status: "published", publishedAt: now,
      });
      return updated;
    });
    await cacheInvalidate(`ucms:cache:${req.tenantHost}:pages:`);
    await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
    return { item };
  });
}
