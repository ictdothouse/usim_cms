import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { CollectionConfig } from "../collections/config-types.js";
import { publishSharedContent } from "../db/tenant-pool.js";

// Registers generic CRUD routes for a collection under /api/:collectionSlug,
// so individual collections don't need hand-written route handlers.
// TODO: wire access() checks, beforeChange/afterChange hooks, and request-body
// validation into each handler (collections without a `table` stay stubbed).
//
// Split public (read, anonymous website visitors) from protected (write,
// logged-in webmaster/superadmin) — register each on the matching scope in
// index.ts. A public website has no login session, so GET must never sit
// behind requireTenantAuth.
export function registerPublicCollectionRoutes(app: FastifyInstance, config: CollectionConfig) {
  const base = `/api/${config.slug}`;
  const { table } = config;

  app.get(base, async (req) => {
    if (!table) return { collection: config.slug, items: [] };
    const items = await req.db.select().from(table);
    return { collection: config.slug, items };
  });

  app.get(`${base}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    if (!table) return { collection: config.slug, id, item: null };
    const [item] = await req.db.select().from(table).where(sql`id = ${id}`);
    return { collection: config.slug, id, item: item ?? null };
  });
}

export function registerProtectedCollectionRoutes(app: FastifyInstance, config: CollectionConfig) {
  const base = `/api/${config.slug}`;
  const { table } = config;

  app.post(
    base,
    { schema: { body: config.createSchema } },
    async (req, reply) => {
      if (!table) {
        reply.code(501);
        return { error: "not implemented" };
      }
      const [item] = await req.db.insert(table).values(req.body as never).returning();
      reply.code(201);
      return { collection: config.slug, item };
    },
  );

  app.post(`${base}/:id/publish`, async (req, reply) => {
    if (!table || !config.shareable) {
      reply.code(501);
      return { error: "not implemented" };
    }
    const { id } = req.params as { id: string };
    const [row] = await req.db.select().from(table).where(sql`id = ${id}`);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    const { title, excerpt, link } = config.shareable;
    await publishSharedContent({
      sourceHost: req.tenantHost,
      sourceCollection: config.slug,
      sourceId: id,
      title: title(row),
      excerpt: excerpt ? excerpt(row) : null,
      link: link(row, req.tenantHost),
      publishedAt: new Date(),
    });
    return { published: true };
  });

  app.patch(`${base}/:id`, async (req, reply) => {
    if (!table) {
      reply.code(501);
      return { error: "not implemented" };
    }
    const { id } = req.params as { id: string };
    const [item] = await req.db
      .update(table)
      .set(req.body as never)
      .where(sql`id = ${id}`)
      .returning();
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    return { collection: config.slug, item };
  });

  app.delete(`${base}/:id`, async (req, reply) => {
    reply.code(501);
    return { error: "not implemented" };
  });
}
