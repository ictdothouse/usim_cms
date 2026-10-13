// Run inside a live API container by scripts/monitor-access.sh. Update only
// the named monitor route; preserve the current blue/green and tenant routes.
import http from "node:http";

const base = new URL(process.env.CADDY_ADMIN_URL || "http://proxy:2019");
const mode = process.env.MONITOR_ACCESS_MODE;
const domain = process.env.MONITOR_PUBLIC_DOMAIN;
const previousDomain = process.env.MONITOR_PREVIOUS_DOMAIN || "";
const upstream = process.env.MONITOR_UPSTREAM;

function request(method, path, body, allowNotFound = false) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: base.hostname,
      port: base.port || 80,
      path,
      method,
      timeout: 15000,
      headers: payload === undefined ? {} : {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        if (allowNotFound && res.statusCode === 404) {
          resolve(null);
        } else if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Caddy ${method} failed (${res.statusCode}): ${text.slice(0, 300)}`));
        } else {
          resolve(text ? JSON.parse(text) : null);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Caddy admin request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

const routePath = "/config/apps/http/servers/srv0/routes";
const denyPath = "/id/ucms-monitor-http-deny";
const idPath = "/id/ucms-monitor-route";
const current = await request("GET", idPath, undefined, true);
const currentDeny = await request("GET", denyPath, undefined, true);
// A proxy-only restart loads Caddyfile's optional monitor vhost, which has no
// @id. Remove that bootstrap route before installing/removing the named live
// routes, so switching back to SSH does not leave a stale public vhost.
if (/^[a-z0-9.-]+$/.test(previousDomain)) {
  const routes = await request("GET", routePath, undefined, true);
  if (Array.isArray(routes)) {
    const hasMonitorProxy = (handlers) => Array.isArray(handlers) && handlers.some((handler) =>
      (handler.handler === "reverse_proxy" && handler.upstreams?.some((item) =>
        /^(?:host\.docker\.internal|10\.|172\.|192\.168\.)/.test(item.dial || ""))) ||
      (handler.handler === "subroute" && handler.routes?.some((route) => hasMonitorProxy(route.handle))));
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i];
      if (!route["@id"] && route.match?.some((matcher) => matcher.host?.includes(previousDomain)) &&
          hasMonitorProxy(route.handle)) {
        await request("DELETE", `${routePath}/${i}`);
      }
    }
  }
}
if (mode === "public") {
  const deny = {
    "@id": "ucms-monitor-http-deny",
    match: [{ host: [domain], protocol: "http" }],
    handle: [{ handler: "static_response", status_code: 403, body: "HTTPS required" }],
  };
  await request(currentDeny ? "PATCH" : "POST", currentDeny ? denyPath : routePath, deny);
  const route = {
    "@id": "ucms-monitor-route",
    match: [{ host: [domain], protocol: "https" }],
    handle: [
      { handler: "headers", response: { set: { "Strict-Transport-Security": ["max-age=31536000"] } } },
      { handler: "reverse_proxy", upstreams: [{ dial: upstream }] },
    ],
  };
  await request(current ? "PATCH" : "POST", current ? idPath : routePath, route);
} else if (mode !== "ssh" && mode !== "cloud") {
  throw new Error("Invalid monitor access mode");
} else {
  if (current) await request("DELETE", idPath);
  if (currentDeny) await request("DELETE", denyPath);
}
console.log(mode === "public" ? `Monitor HTTPS route active for ${domain}` : "Monitor HTTPS route removed");
