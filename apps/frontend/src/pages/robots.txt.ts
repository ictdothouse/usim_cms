import type { APIRoute } from "astro";

// Native SEO + AEO: points crawlers at this tenant's own sitemap.xml. Per-page
// exclusion (seo.noindex) is a <meta name="robots"> tag instead (BaseLayout.astro) —
// robots.txt itself stays a flat allow-all + sitemap pointer.
export const GET: APIRoute = async ({ request }) => {
  const rawHost = request.headers.get("host") ?? "";
  const tenantHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;
  const body = `User-agent: *\nAllow: /\nSitemap: https://${tenantHost}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
