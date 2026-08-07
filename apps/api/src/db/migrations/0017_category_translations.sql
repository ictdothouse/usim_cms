-- Category i18n follow-up: per-category opt-in translation, same shape as
-- posts/pages' translations jsonb column (see CLAUDE.md i18n Phase 5).
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "multilang_enabled" boolean DEFAULT false NOT NULL;
