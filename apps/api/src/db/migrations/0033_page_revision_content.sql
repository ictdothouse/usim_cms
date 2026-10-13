-- New revisions capture every editable page field. Existing revisions keep
-- NULL here so restore leaves fields that were never snapshotted untouched.
ALTER TABLE "page_revisions" ADD COLUMN IF NOT EXISTS "seo" jsonb;
ALTER TABLE "page_revisions" ADD COLUMN IF NOT EXISTS "translations" jsonb;
ALTER TABLE "page_revisions" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "page_revisions" ADD COLUMN IF NOT EXISTS "multilang_enabled" boolean;
