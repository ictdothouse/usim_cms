-- Native SEO + AEO: per-page/per-post title/description/ogImage/noindex/canonicalUrl
-- override, consumed by apps/frontend's BaseLayout.astro + the new sitemap.xml route.
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;
