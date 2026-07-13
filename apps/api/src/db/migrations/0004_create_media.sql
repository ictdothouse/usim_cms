CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"url" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Media rows are only ever read/written from the protected (logged-in)
-- scope, so unlike pages/posts even SELECT requires app.authenticated
-- (set per request by plugins/auth.ts).
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_select" ON "media";
CREATE POLICY "media_select" ON "media" FOR SELECT
  USING (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "media_insert" ON "media";
CREATE POLICY "media_insert" ON "media" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "media_delete" ON "media";
CREATE POLICY "media_delete" ON "media" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
