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
	"tenant_hosts" text[] DEFAULT '{}' NOT NULL,
	"extra_permissions" text[] DEFAULT '{}' NOT NULL,
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

-- Upgrade path for control-plane DBs bootstrapped before tenant_hosts/
-- extra_permissions existed (multi-site users + per-user extra grants).
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "tenant_hosts" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "extra_permissions" text[] DEFAULT '{}' NOT NULL;
UPDATE "public"."users" SET "tenant_hosts" = ARRAY["tenant_host"] WHERE "tenant_host" IS NOT NULL AND cardinality("tenant_hosts") = 0;

-- A user's personal saved theme presets ("my collection" in the Theme
-- panel) — must come after "users" exists (owner_user_id references it).
CREATE TABLE IF NOT EXISTS "public"."theme_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
