CREATE TABLE IF NOT EXISTS "public"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL UNIQUE,
	"department_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"db_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Upgrade path for control-plane DBs bootstrapped before db_url existed.
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "db_url" text;

CREATE TABLE IF NOT EXISTS "public"."shared_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_host" text NOT NULL,
	"source_collection" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"link" text NOT NULL,
	"published_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	UNIQUE("source_collection", "source_id")
);

CREATE TABLE IF NOT EXISTS "public"."site_theme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_host" text NOT NULL UNIQUE,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"tenant_host" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Upgrade path for control-plane DBs bootstrapped before role_id existed
-- (users/roles moved here from migrations/0005+0006, which now only ever
-- replay into tenant databases where these tables don't belong).
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "role_id" uuid REFERENCES "public"."roles"("id") ON DELETE SET NULL;
