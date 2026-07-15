ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "uploaded_by" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "uploaded_by_email" text;
