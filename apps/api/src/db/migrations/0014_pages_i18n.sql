-- i18n Phase 4: per-page language + translation group, same shape as
-- migration 0013's posts.language/translation_group_id. Nullable, no
-- backfill.
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "translation_group_id" uuid;
