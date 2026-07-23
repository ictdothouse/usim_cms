ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_tags" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_category" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_author" boolean;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "show_published_date" boolean;
