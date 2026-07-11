import type { FastifyInstance } from "fastify";
import type { CollectionConfig } from "../collections/config-types.js";

// Registers generic CRUD routes for a collection under /api/:collectionSlug,
// so individual collections don't need hand-written route handlers.
// TODO: wire access() checks and beforeChange/afterChange hooks into each handler.
export function registerCollectionRoutes(app: FastifyInstance, config: CollectionConfig) {
  const base = `/api/${config.slug}`;

  app.get(base, async () => {
    return { collection: config.slug, items: [] };
  });

  app.get(`${base}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    return { collection: config.slug, id, item: null };
  });

  app.post(base, async (req, reply) => {
    reply.code(501);
    return { error: "not implemented" };
  });

  app.patch(`${base}/:id`, async (req, reply) => {
    reply.code(501);
    return { error: "not implemented" };
  });

  app.delete(`${base}/:id`, async (req, reply) => {
    reply.code(501);
    return { error: "not implemented" };
  });
}
