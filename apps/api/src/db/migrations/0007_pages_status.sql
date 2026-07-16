-- Adds draft/published status to pages, same shape as posts
-- (0003_create_posts.sql). Column default is 'draft' so newly created pages
-- start hidden from the public site until explicitly published — but every
-- row that already existed before this migration was, under the old
-- always-visible RLS policy, effectively live. Backfill them to 'published'
-- so this migration doesn't silently 404 every existing page.
--
-- Guarded by an existence check (unlike this repo's usual bare
-- IF NOT EXISTS) because tenant-pool.ts's ensureTenantDatabase replays every
-- migration file into a tenant DB on every process restart, not just once —
-- a bare ADD COLUMN would error on the 2nd replay, and worse, the backfill
-- UPDATE would silently re-run on every restart, force-publishing every page
-- an admin had deliberately drafted since.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pages' AND column_name = 'status'
  ) THEN
    ALTER TABLE "pages" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;
    ALTER TABLE "pages" ADD COLUMN "published_at" timestamp;
    UPDATE "pages" SET "status" = 'published', "published_at" = "updated_at";
  END IF;
END $$;

-- Same visibility rule as posts_select: anonymous (public scope) SELECT only
-- sees published pages; an authenticated admin request (app.authenticated =
-- 'true', set by plugins/auth.ts) sees drafts too — this is what makes the
-- admin's page preview link work before a page is published.
DROP POLICY IF EXISTS "pages_select" ON "pages";
CREATE POLICY "pages_select" ON "pages" FOR SELECT
  USING ("status" = 'published' OR current_setting('app.authenticated', true) = 'true');
