import type { MiddlewareHandler } from "astro";
import { getTenantStatus } from "./lib/api";

// Per-tenant maintenance-mode gate (Manage Site's toggle, apps/admin) — one
// central check instead of repeating it in every page under src/pages/,
// which already each duplicate their own Host-header tenantHost resolution.
// Deliberately NOT an Astro `rewrite()` to a /maintenance page: rewriting
// re-runs this same middleware against the new path, so returning the
// response directly here is the simplest way to avoid a self-rewrite loop.
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
// Manage Site's "View" link mints a maintenance-bypass token (apps/admin,
// apps/api's POST .../maintenance-bypass-token) and appends it as this query
// param; once verified, it's stashed in this cookie so it survives normal
// in-site navigation instead of only the one URL it arrived on.
const BYPASS_PARAM = "_mbypass";
const BYPASS_COOKIE = "mbypass";

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

// Shown to a bypassed admin instead of the real header while maintenanceMode
// is on — a plain inline-styled string injected into another page's own
// markup (below), so it can't assume this tenant's stylesheet/classes have
// loaded by this point in <body>.
const BYPASS_BANNER = `<div style="background:#b45309;color:#fff;font:600 13px system-ui,sans-serif;text-align:center;padding:.5rem 1rem;">Laman ini dalam mod penyelenggaraan &mdash; hanya admin nampak laman sebenar. / This site is in maintenance mode &mdash; only admins see the real site.</div>`;

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

  // A fresh link's query token always wins over a stale cookie from an
  // earlier session.
  const queryToken = context.url.searchParams.get(BYPASS_PARAM);
  const bypassToken = queryToken ?? context.cookies.get(BYPASS_COOKIE)?.value;

  // Fail open: an apps/api blip must never take a healthy tenant's whole
  // site down just because this one status check couldn't complete.
  const status = await getTenantStatus(tenantHost, bypassToken).catch(() => null);

  // First hit off the "View" link: stash the now-verified token as a cookie
  // and redirect to the clean URL, so it isn't left sitting in the address
  // bar (copy-pasted link would otherwise leak a live bypass credential) or
  // repeated on every subsequent request.
  if (queryToken && status?.bypass) {
    context.cookies.set(BYPASS_COOKIE, queryToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: context.url.protocol === "https:",
      maxAge: 30 * 60,
    });
    const clean = new URL(context.url);
    clean.searchParams.delete(BYPASS_PARAM);
    return context.redirect(clean.pathname + clean.search, 302);
  }

  if (status?.maintenanceMode && !status.bypass) {
    return new Response(MAINTENANCE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const response = await next();
  if (status?.maintenanceMode && status.bypass && response.headers.get("content-type")?.includes("text/html")) {
    const html = await response.text();
    return new Response(html.replace(/<body[^>]*>/, (tag) => `${tag}${BYPASS_BANNER}`), {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
};
