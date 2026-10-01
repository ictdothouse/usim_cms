import type { APIRoute } from "astro";
import { listPages, listPosts } from "../lib/api";

// Native SEO + AEO: lists every published, non-noindex page/post for this tenant.
// Same Host-header tenant resolution every other page file in this app already
// duplicates (see apps/frontend/CLAUDE.md's src/middleware.ts paragraph for why this
// stays per-file rather than a shared helper).
export const GET: APIRoute = async ({ request }) => {
  const rawHost = request.headers.get("host") ?? "";
  const tenantHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;
  const base = `https://${tenantHost}`;

  const [pages, posts] = await Promise.all([
    listPages(tenantHost, { status: "published" }),
    listPosts(tenantHost, { status: "published" }),
  ]);

  const urls = [
    ...pages.filter((p) => !p.seo?.noindex).map((p) => ({ loc: `${base}/${p.slug}`, lastmod: null as string | null })),
    ...posts.filter((p) => !p.seo?.noindex).map((p) => ({ loc: `${base}/posts/${p.slug}`, lastmod: p.publishedAt })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
