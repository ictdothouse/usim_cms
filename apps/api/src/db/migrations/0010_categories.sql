CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"slug" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Backfill: one category row per distinct existing posts.category value.
INSERT INTO "categories" ("name", "slug")
SELECT DISTINCT "category",
  trim(both '-' from regexp_replace(lower("category"), '[^a-z0-9]+', '-', 'g'))
FROM "posts"
WHERE "category" IS NOT NULL AND "category" != ''
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "categories"("id") ON DELETE RESTRICT;

UPDATE "posts" SET "category_id" = "categories"."id"
FROM "categories"
WHERE "posts"."category" = "categories"."name" AND "posts"."category_id" IS NULL;

ALTER TABLE "posts" DROP COLUMN IF EXISTS "category";

-- Public reference data — unrestricted SELECT; writes follow the same
-- defense-in-depth pattern as every other tenant table.
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select" ON "categories";
CREATE POLICY "categories_select" ON "categories" FOR SELECT USING (true);

DROP POLICY IF EXISTS "categories_insert" ON "categories";
CREATE POLICY "categories_insert" ON "categories" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "categories_update" ON "categories";
CREATE POLICY "categories_update" ON "categories" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "categories_delete" ON "categories";
CREATE POLICY "categories_delete" ON "categories" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
