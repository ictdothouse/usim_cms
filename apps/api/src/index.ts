import Fastify from "fastify";
import { tenantPlugin } from "./plugins/tenant.js";
import { registerCollectionRoutes } from "./plugins/generic-crud.js";
import type { CollectionConfig } from "./collections/config-types.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

await app.register(tenantPlugin);

const pagesCollection: CollectionConfig = {
  slug: "pages",
  access: {
    read: () => true,
  },
};

registerCollectionRoutes(app, pagesCollection);

const port = Number(process.env.PORT ?? 3000);
app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
