-- Architecture review finding: pages.slug/posts.slug had no uniqueness
-- constraint or index at all — two rows could share a slug in the same
-- tenant, and getPageBySlug/getPostBySlug's ?slug= filter (apps/frontend's
-- lib/api.ts) would silently return whichever row Postgres happened to list
-- first. Dedupe first (a duplicate found here predates this constraint and
-- was never rejected on write), then enforce uniqueness going forward.
--
-- ponytail: dedup renames a losing duplicate to "<slug>-<n>", not
-- guaranteed collision-free against an existing "<slug>-<n>" row (a rare
-- double-duplicate). Good enough to unblock the unique index; if the
-- CREATE UNIQUE INDEX below ever fails on a specific tenant, resolve that
-- tenant's remaining collision by hand and rerun.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at, id) AS rn
    FROM pages
  LOOP
    IF r.rn > 1 THEN
      UPDATE pages SET slug = r.slug || '-' || r.rn WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at, id) AS rn
    FROM posts
  LOOP
    IF r.rn > 1 THEN
      UPDATE posts SET slug = r.slug || '-' || r.rn WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pages_slug_unique_idx ON pages(slug);
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_unique_idx ON posts(slug);

-- Supports RLS-filtered public list scans (status = 'published') and the
-- ?from=/?to= published_at range filter (generic-crud.ts's buildListFilters).
CREATE INDEX IF NOT EXISTS pages_status_idx ON pages(status);
CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
CREATE INDEX IF NOT EXISTS posts_published_at_idx ON posts(published_at);
