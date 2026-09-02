import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handler } from "./dist/server/entry.mjs";

const port = process.env.PORT ? Number(process.env.PORT) : 4321;
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "client");

// The node adapter's "middleware" mode (astro.config.mjs) is the SSR request
// handler ONLY — unlike "standalone" mode, it never serves dist/client's own
// built assets (_astro/*.css, *.js), on the assumption something else in
// front of it will. Nothing did: every asset request fell through to the SSR
// handler, which tried to render it as a page and 500'd, so every published
// page loaded with zero CSS. This resolves a request against dist/client
// first; only a miss falls through to the real SSR handler.
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(clientDir, urlPath);
  // path.join already collapses ".." segments; the boundary check guards
  // against an encoded traversal escaping clientDir once decoded. A bare
  // filePath.startsWith(clientDir) is not enough - a sibling directory
  // like "dist/client-XXX" also starts with the "dist/client" string, so
  // it must match exactly or be followed by a path separator.
  if (filePath !== clientDir && !filePath.startsWith(clientDir + path.sep)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  res.setHeader("content-type", MIME[path.extname(filePath)] ?? "application/octet-stream");
  // Astro content-hashes every _astro/* filename, so caching forever is safe.
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  // Plain liveness probe for Docker's own healthcheck (docker-compose.
  // release.yml) and scripts/deploy.sh's blue-green promotion gate — must
  // never depend on a tenant or the api being reachable, unlike every real
  // page route.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  if (serveStatic(req, res)) return;
  handler(req, res);
});

server.listen(port, () => {
  console.log(`frontend listening on :${port}`);
});

// Native http.Server#close: stop accepting new connections, let in-flight
// ones finish, then callback — the graceful drain "standalone" mode lacked.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
