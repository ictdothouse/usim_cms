import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// Server output, not static: tenant identity comes from the request's Host
// header at runtime (single instance serves ~50 real department domains),
// so pages can't be pre-built per-tenant at build time. See CLAUDE.md.
//
// mode: "middleware" (not "standalone") so server.mjs owns the http.Server
// and can close() it gracefully on SIGTERM/SIGINT — "standalone" mode starts
// its own server with no shutdown hook, so a K8s rolling deploy would just
// hard-kill in-flight requests.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "middleware" }),
  // Dev-only (astro dev = Vite; the production node server has no host
  // check): the API's static-export renders pages by requesting this server
  // with Host: <tenant>, which Vite's DNS-rebinding protection would 403.
  // Dev binds to localhost, so accepting any Host name here is fine.
  vite: { plugins: [tailwindcss()], server: { allowedHosts: true } },
});
