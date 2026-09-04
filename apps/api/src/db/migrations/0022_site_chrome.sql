CREATE TABLE IF NOT EXISTS "site_chrome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Same visibility rule as events (0021_events.sql): anonymous SELECT only
-- sees published header/footer rows, an authenticated admin request sees
-- drafts too (the Designer canvas needs to read its own draft before Publish).
ALTER TABLE "site_chrome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_chrome" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_chrome_select" ON "site_chrome";
CREATE POLICY "site_chrome_select" ON "site_chrome" FOR SELECT
  USING ("status" = 'published' OR current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "site_chrome_insert" ON "site_chrome";
CREATE POLICY "site_chrome_insert" ON "site_chrome" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "site_chrome_update" ON "site_chrome";
CREATE POLICY "site_chrome_update" ON "site_chrome" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "site_chrome_delete" ON "site_chrome";
CREATE POLICY "site_chrome_delete" ON "site_chrome" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
