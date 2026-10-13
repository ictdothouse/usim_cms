#!/usr/bin/env node
// Zero-dependency static file server for apps/admin/dist in bare-metal
// installs (Docker mode serves the same dist/ via nginx instead — see
// apps/admin/Dockerfile + nginx.conf, whose try_files fallback this mirrors:
// serve the file if it exists, else index.html, so the SPA's client-side
// router still works on a hard refresh of a deep link).
// Usage: node static-server.js <dist-dir> <port> <api-origin>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";

const DIST_DIR = path.resolve(process.argv[2] || "./dist");
const PORT = Number(process.argv[3] || 5173);
const HOST = process.env.HOST ?? "127.0.0.1";
let API_ORIGIN = "'self'";
try {
  const parsed = new URL(process.argv[4] || "http://localhost:3000");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid scheme");
  API_ORIGIN = parsed.origin;
} catch {
  console.error("Admin API origin must be a valid HTTP(S) URL.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function safeJoin(base, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split("?")[0]);
  } catch {
    return null;
  }
  const resolved = path.normalize(path.join(base, decoded));
  // A string-prefix check also accepts sibling paths such as dist-secret.
  const relative = path.relative(base, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ${API_ORIGIN}; frame-src 'self' https:`,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD", "Cache-Control": "no-store" });
    res.end("Method not allowed");
    return;
  }
  const target = safeJoin(DIST_DIR, req.url || "/");
  if (!target) {
    res.writeHead(400, { ...securityHeaders, "Cache-Control": "no-store" });
    res.end("Bad request");
    return;
  }

  fs.stat(target, (err, stat) => {
    let filePath = target;
    if (err || stat.isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const cacheControl = req.url.split("?")[0].startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-store";
      res.writeHead(200, { ...securityHeaders, "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cacheControl });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`admin static server listening on ${HOST}:${PORT} (serving ${DIST_DIR})`);
});
