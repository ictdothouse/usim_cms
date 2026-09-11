CREATE TABLE IF NOT EXISTS "page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
	"title" text NOT NULL,
	"layout" jsonb DEFAULT '[]' NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"banner_image_url" text,
	"status" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Admin-only history: never publicly readable, no update/delete policy (a
-- snapshot is never edited in place; cascade from pages handles cleanup when
-- a page itself is deleted) — same reasoning as post_revisions
-- (0009_posts_taxonomy_author_revisions.sql).
ALTER TABLE "page_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "page_revisions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_revisions_select" ON "page_revisions";
CREATE POLICY "page_revisions_select" ON "page_revisions" FOR SELECT
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "page_revisions_insert" ON "page_revisions";
CREATE POLICY "page_revisions_insert" ON "page_revisions" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');
