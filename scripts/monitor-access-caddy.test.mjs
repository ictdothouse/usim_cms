import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./monitor-access-caddy.mjs", import.meta.url));

test("monitor Caddy switch adds HTTPS-only routes and removes them without replacing app routes", async () => {
  const routes = new Map();
  const bootstrapRoutes = [{
    match: [{ host: ["monitor.example.org"] }],
    handle: [{ handler: "subroute", routes: [{ handle: [
      { handler: "reverse_proxy", upstreams: [{ dial: "172.17.0.1:5555" }] },
    ] }] }],
  }];
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      calls.push(`${req.method} ${req.url}`);
      const id = req.url.startsWith("/id/") ? req.url.slice(4) : "";
      if (req.method === "GET" && req.url === "/config/apps/http/servers/srv0/routes") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(bootstrapRoutes));
        return;
      }
      if (req.method === "GET" && id) {
        if (!routes.has(id)) { res.writeHead(404); res.end(); return; }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(routes.get(id)));
        return;
      }
      if (req.method === "POST" && req.url === "/config/apps/http/servers/srv0/routes") {
        const route = JSON.parse(body);
        routes.set(route["@id"], route);
      } else if (req.method === "PATCH" && id) {
        routes.set(id, JSON.parse(body));
      } else if (req.method === "DELETE" && id) {
        routes.delete(id);
      } else if (req.method === "DELETE" && req.url.startsWith("/config/apps/http/servers/srv0/routes/")) {
        bootstrapRoutes.splice(Number(req.url.split("/").at(-1)), 1);
      } else {
        res.writeHead(400); res.end("unexpected request"); return;
      }
      res.writeHead(200); res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const run = (mode) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        CADDY_ADMIN_URL: `http://127.0.0.1:${port}`,
        MONITOR_ACCESS_MODE: mode,
        MONITOR_PUBLIC_DOMAIN: "monitor.example.org",
        MONITOR_PREVIOUS_DOMAIN: "monitor.example.org",
        MONITOR_UPSTREAM: "172.17.0.1:5555",
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  try {
    await run("public");
    assert.equal(bootstrapRoutes.length, 0);
    assert.equal(routes.get("ucms-monitor-http-deny").match[0].protocol, "http");
    assert.equal(routes.get("ucms-monitor-http-deny").handle[0].status_code, 403);
    assert.equal(routes.get("ucms-monitor-route").match[0].protocol, "https");
    await run("public");
    assert.ok(calls.includes("PATCH /id/ucms-monitor-route"));
    await run("ssh");
    assert.equal(routes.size, 0);
    assert.ok(!calls.some((call) => call.includes("/load")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
