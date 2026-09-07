-- Responsive image pipeline: records a raster upload's real pixel width/
-- height (from sharp, index.ts's POST /api/media) so a served URL can carry
-- it as a `?w=&h=` query string -- apps/frontend's SectionBlock.astro
-- reconstructs a real <img srcset> from that alone, no DB lookup at render
-- time. Null for a pre-existing upload (before this pipeline existed) or a
-- non-raster file (e.g. an animated GIF, deliberately skipped) -- either
-- case just means no srcset for that image, never a broken one.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "width" integer;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "height" integer;
