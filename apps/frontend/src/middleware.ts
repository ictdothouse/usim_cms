import type { MiddlewareHandler } from "astro";
import { getTenantStatus } from "./lib/api";

// Per-tenant maintenance-mode gate (Manage Site's toggle, apps/admin) — one
// central check instead of repeating it in every page under src/pages/,
// which already each duplicate their own Host-header tenantHost resolution.
// Deliberately NOT an Astro `rewrite()` to a /maintenance page: rewriting
// re-runs this same middleware against the new path, so returning the
// response directly here is the simplest way to avoid a self-rewrite loop.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAINTENANCE_HTML = `<!doctype html>
<html lang="ms">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sedang Diselenggara</title>
<style>
  body { margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center;
    background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; text-align: center; padding: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { color: #94a3b8; margin: 0; }
</style>
</head>
<body>
<div>
  <h1>Laman Sedang Diselenggara</h1>
  <p>Sila cuba lagi sebentar. / This site is under maintenance — please check back shortly.</p>
</div>
</body>
</html>`;

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { pathname } = context.url;
  // Astro build assets and uploaded media must load even while gated —
  // otherwise the maintenance page itself (and any admin preview iframe
  // pointed at this host) breaks. Astro's own internal routes (image
  // endpoint, etc.) live under /_astro and /_image, same prefix convention.
  if (pathname.startsWith("/_astro/") || pathname.startsWith("/_image") || pathname.startsWith("/uploads/")) {
    return next();
  }

  const rawHost = context.request.headers.get("host") ?? "";
  const tenantHost = DEV_HOST_RE.test(rawHost)
    ? (context.url.searchParams.get("__tenant") ?? import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;

  // Fail open: an apps/api blip must never take a healthy tenant's whole
  // site down just because this one status check couldn't complete.
  const status = await getTenantStatus(tenantHost).catch(() => null);
  if (status?.maintenanceMode) {
    return new Response(MAINTENANCE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return next();
};
