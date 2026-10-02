-- Canva-style autosave for an already-published page: Designer autosaves the
-- in-progress edit here (never into the live `layout`/`settings`/`seo`/
-- `translations` columns real visitors read), Preview renders it via a
-- preview token, and Update copies it onto the live columns and clears it.
-- NULL = no pending unpublished edit. Shape: { layout, settings, seo,
-- translations, language, multilangEnabled } — same validation as the live
-- columns (pagesBeforeChange), stripped from every anonymous read
-- (pagesAfterRead).
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "draft" jsonb;
