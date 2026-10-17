-- Autosave for an already-published header/footer, same idea as pages.draft
-- (0029): Designer autosaves the in-progress edit here, never into the live
-- `layout` every page renders, and Save/Update copies it onto `layout` and
-- clears it. NULL = no pending edit. Shape: { layout } — validated like the
-- live layout (siteChromeBeforeChange), stripped from every anonymous read
-- (siteChromeAfterRead).
ALTER TABLE "site_chrome" ADD COLUMN IF NOT EXISTS "draft" jsonb;
