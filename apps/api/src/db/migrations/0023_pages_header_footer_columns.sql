ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "header_id" uuid;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "footer_id" uuid;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "hide_header" boolean DEFAULT false NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "hide_footer" boolean DEFAULT false NOT NULL;

DO $$ BEGIN
	ALTER TABLE "pages" ADD CONSTRAINT "pages_header_id_site_chrome_id_fk"
		FOREIGN KEY ("header_id") REFERENCES "site_chrome"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "pages" ADD CONSTRAINT "pages_footer_id_site_chrome_id_fk"
		FOREIGN KEY ("footer_id") REFERENCES "site_chrome"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
