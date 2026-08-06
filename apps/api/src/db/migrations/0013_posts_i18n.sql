-- i18n Phase 3: per-post language + translation group (see schema.ts's
-- posts.language/translationGroupId comment). Nullable, no backfill —
-- existing posts simply have no language set until an author picks one.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "translation_group_id" uuid;
