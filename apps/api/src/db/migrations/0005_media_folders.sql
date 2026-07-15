CREATE TABLE IF NOT EXISTS "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "folder_id" uuid REFERENCES "media_folders"("id") ON DELETE SET NULL;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "alt_text" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

-- Same rule as media: only the logged-in admin scope ever reads/writes folders.
ALTER TABLE "media_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_folders" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_folders_select" ON "media_folders";
CREATE POLICY "media_folders_select" ON "media_folders" FOR SELECT
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "media_folders_insert" ON "media_folders";
CREATE POLICY "media_folders_insert" ON "media_folders" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "media_folders_update" ON "media_folders";
CREATE POLICY "media_folders_update" ON "media_folders" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "media_folders_delete" ON "media_folders";
CREATE POLICY "media_folders_delete" ON "media_folders" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
