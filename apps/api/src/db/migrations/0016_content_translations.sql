-- i18n Phase 5 correction: replace the separate-row translation model with
-- one row per post/page holding every language's content. The
-- translation_group_id columns from the earlier cut are left in place
-- (unused, harmless) rather than dropped — no code reads/writes them anymore.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;
