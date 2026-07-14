ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "capabilities" text[] DEFAULT '{}' NOT NULL;
