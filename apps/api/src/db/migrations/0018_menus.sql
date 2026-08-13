CREATE TABLE IF NOT EXISTS "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Public reference data (apps/frontend needs to read a menu with no admin
-- session) — same defense-in-depth pattern as every other tenant table:
-- RLS still requires app.authenticated for any write.
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menus" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menus_select" ON "menus";
CREATE POLICY "menus_select" ON "menus" FOR SELECT USING (true);

DROP POLICY IF EXISTS "menus_insert" ON "menus";
CREATE POLICY "menus_insert" ON "menus" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "menus_update" ON "menus";
CREATE POLICY "menus_update" ON "menus" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "menus_delete" ON "menus";
CREATE POLICY "menus_delete" ON "menus" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
