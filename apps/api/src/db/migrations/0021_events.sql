CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"location" text,
	"image_url" text,
	"registration_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Same visibility rule as posts (0003_create_posts.sql): anonymous SELECT
-- only sees published events, an authenticated admin request sees drafts too.
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON "events";
CREATE POLICY "events_select" ON "events" FOR SELECT
  USING ("status" = 'published' OR current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "events_insert" ON "events";
CREATE POLICY "events_insert" ON "events" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "events_update" ON "events";
CREATE POLICY "events_update" ON "events" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "events_delete" ON "events";
CREATE POLICY "events_delete" ON "events" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
