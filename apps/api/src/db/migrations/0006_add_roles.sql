CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_id" uuid REFERENCES "roles"("id") ON DELETE SET NULL;
ALTER TABLE "users" DROP COLUMN IF EXISTS "capabilities";
