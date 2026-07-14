CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"excerpt" text,
	"banner_image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Same defense-in-depth pattern as 0002_pages_rls.sql, plus a visibility
-- rule: anonymous (public scope) SELECT only sees published posts; an
-- authenticated admin request (app.authenticated = 'true', set by
-- plugins/auth.ts) sees drafts too.
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_select" ON "posts";
CREATE POLICY "posts_select" ON "posts" FOR SELECT
  USING ("status" = 'published' OR current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "posts_insert" ON "posts";
CREATE POLICY "posts_insert" ON "posts" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "posts_update" ON "posts";
CREATE POLICY "posts_update" ON "posts" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "posts_delete" ON "posts";
CREATE POLICY "posts_delete" ON "posts" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
