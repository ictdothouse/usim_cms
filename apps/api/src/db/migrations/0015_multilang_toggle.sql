-- i18n Phase 5: per-post/per-page master switch, off by default. Gates
-- whether that row's Translations panel (auto-translate-to-language picker)
-- is offered at all — see schema.ts's multilangEnabled comment.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "multilang_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "multilang_enabled" boolean DEFAULT false NOT NULL;
