CREATE TABLE IF NOT EXISTS "public"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL UNIQUE,
	"department_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

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
