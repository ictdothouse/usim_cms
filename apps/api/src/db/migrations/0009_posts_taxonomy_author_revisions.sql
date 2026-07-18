ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "author_id" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "author_email" text;

-- "private" reuses posts_select's existing non-published branch (0003/0007)
-- as-is: anonymous SELECT only ever sees status='published', so a private
-- post is already hidden from the public the same way a draft is, without
-- any policy change here.

CREATE TABLE IF NOT EXISTS "post_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"excerpt" text,
	"banner_image_url" text,
	"category" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Admin-only history: never publicly readable, no update/delete policy (a
-- snapshot is never edited in place; cascade from posts handles cleanup when
-- a post itself is deleted) — same reasoning as design_templates
-- (0008_design_templates.sql).
ALTER TABLE "post_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_revisions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_revisions_select" ON "post_revisions";
CREATE POLICY "post_revisions_select" ON "post_revisions" FOR SELECT
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "post_revisions_insert" ON "post_revisions";
CREATE POLICY "post_revisions_insert" ON "post_revisions" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');
