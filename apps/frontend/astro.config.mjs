import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Server output, not static: tenant identity comes from the request's Host
// header at runtime (single instance serves ~50 real department domains),
// so pages can't be pre-built per-tenant at build time. See CLAUDE.md.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
});
