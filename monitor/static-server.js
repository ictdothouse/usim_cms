#!/usr/bin/env node
// Zero-dependency static file server for apps/admin/dist in bare-metal
// installs (Docker mode serves the same dist/ via nginx instead — see
// apps/admin/Dockerfile + nginx.conf, whose try_files fallback this mirrors:
// serve the file if it exists, else index.html, so the SPA's client-side
// router still works on a hard refresh of a deep link).
// Usage: node static-server.js <dist-dir> <port>
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST_DIR = path.resolve(process.argv[2] || "./dist");
const PORT = Number(process.argv[3] || 5173);

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
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.normalize(path.join(base, decoded));
  // Reject any resolved path that escapes DIST_DIR (e.g. "/../../etc/passwd").
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const target = safeJoin(DIST_DIR, req.url || "/");
  if (!target) {
    res.writeHead(400);
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
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`admin static server listening on :${PORT} (serving ${DIST_DIR})`);
});
