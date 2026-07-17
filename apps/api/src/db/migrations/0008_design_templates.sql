CREATE TABLE IF NOT EXISTS "design_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Same reasoning as media (0004_create_media.sql): templates are only ever
-- read/written from the protected (logged-in) scope, so even SELECT
-- requires app.authenticated. No update policy — there's no PATCH route
-- (replacing a template is delete-and-recreate).
ALTER TABLE "design_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "design_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design_templates_select" ON "design_templates";
CREATE POLICY "design_templates_select" ON "design_templates" FOR SELECT
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "design_templates_insert" ON "design_templates";
CREATE POLICY "design_templates_insert" ON "design_templates" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "design_templates_delete" ON "design_templates";
CREATE POLICY "design_templates_delete" ON "design_templates" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
