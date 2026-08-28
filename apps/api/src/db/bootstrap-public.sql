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

-- Upgrade path: paid/custom certificate tracking for the Domain & SSL
-- Automation card (see apps/api/src/proxy-sync.ts).
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "has_custom_cert" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "cert_expires_at" timestamp;

-- Single-row instance-wide switch: whether apps/api keeps the bundled
-- Caddy proxy's config in sync with the tenants table above. Off by
-- default — orgs using their own reverse proxy/ingress/cPanel never touch
-- this. "singleton" is the only id ever inserted.
CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"proxy_automation_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Upgrade path: instance-wide MFA master switch (Settings "Login Methods").
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean DEFAULT false NOT NULL;

-- Rate-limiting for POST /api/auth/login (see isLoginRateLimited,
-- tenant-pool.ts) — one row per attempt, pruned lazily, never a per-user
-- counter table.
CREATE TABLE IF NOT EXISTS "public"."login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Control-plane audit trail for superadmin-level mutations (tenant/role/
-- user changes, the mfa_enabled toggle itself) — see insertAuditLog.
CREATE TABLE IF NOT EXISTS "public"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
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
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false NOT NULL;
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

-- Superadmin-curated master language list (i18n Phase 1). Seeded ms/en.
CREATE TABLE IF NOT EXISTS "public"."languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "public"."languages" ("code", "label", "sort_order") VALUES
	('ms', 'Bahasa Melayu', 0),
	('en', 'English', 1)
ON CONFLICT ("code") DO NOTHING;

-- Per-tenant enabled-language subset (i18n Phase 2). No row = inherit all
-- globally-enabled languages.
CREATE TABLE IF NOT EXISTS "public"."tenant_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_host" text NOT NULL UNIQUE,
	"enabled_codes" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Upgrade path for control-plane DBs bootstrapped before show_header_switcher
-- existed (i18n Phase 3).
ALTER TABLE "public"."tenant_languages" ADD COLUMN IF NOT EXISTS "show_header_switcher" boolean DEFAULT false NOT NULL;

-- i18n Phase 5: site-wide multi-language master switch, off by default.
ALTER TABLE "public"."tenant_languages" ADD COLUMN IF NOT EXISTS "multilang_enabled" boolean DEFAULT false NOT NULL;

-- i18n Phase 5 follow-up: default language new posts/pages fall back to
-- when their own Language field is unset. Nullable — no default set yet.
ALTER TABLE "public"."tenant_languages" ADD COLUMN IF NOT EXISTS "default_language" text;

-- Page Blueprint (Sprint 5 sub-project 2). tenant_host NULL = system-wide.
CREATE TABLE IF NOT EXISTS "public"."page_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_host" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
	"created_by_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Seed system blueprints (docs/laporan-audit-ui-ux.md §5.6's practical
-- list), only ever using element types that already exist. Kept
-- deliberately small — hero/text/cardgrid/ctabanner/postlist cover every
-- seed without inventing new element types. Guard on name (no natural
-- unique key on this table) so re-running this file stays idempotent.
INSERT INTO "public"."page_blueprints" ("tenant_host", "name", "description", "category", "layout")
SELECT NULL, v.name, v.description, v.category, v.layout::jsonb
FROM (VALUES
	('Landing page jabatan', 'Hero, quick links, statistik, highlight berita, CTA', 'Landing',
		'[{"type":"section","props":{"paddingY":"4rem","rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Nama Jabatan"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"postlist","props":{"count":"3","columns":"3","postLayout":"grid"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"ctabanner","props":{"heading":"Hubungi Kami","button1Label":"Hubungi","button1Href":"/hubungi"}}]}]}]}}]'),
	('About / profil', 'Hero ringkas, pengenalan, visi/misi, CTA', 'About',
		'[{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Tentang Kami"}},{"type":"text","props":{"text":"Pengenalan ringkas organisasi."}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"2","text":"Visi"}},{"type":"text","props":{"text":""}}]},{"elements":[{"type":"heading","props":{"level":"2","text":"Misi"}},{"type":"text","props":{"text":""}}]}]}]}}]'),
	('Program / perkhidmatan', 'Hero, overview, feature cards, CTA', 'Program',
		'[{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Nama Program"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"cardgrid","props":{"cards":"[]","columns":"3"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"ctabanner","props":{"heading":"Mohon Sekarang","button1Label":"Mohon"}}]}]}]}}]'),
	('News hub', 'Heading, post grid, CTA subscribe', 'News',
		'[{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Berita & Pengumuman"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"postlist","props":{"count":"9","columns":"3","postLayout":"grid"}}]}]}]}}]'),
	('Contact', 'Contact info, operating hours, location', 'Contact',
		'[{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Hubungi Kami"}},{"type":"text","props":{"text":"Alamat, waktu operasi dan maklumat hubungan."}}]}]}]}}]'),
	('Simple content page', 'Page heading, rich text, related links', 'Content',
		'[{"type":"section","props":{"rows":[{"columns":[{"elements":[{"type":"heading","props":{"level":"1","text":"Tajuk Halaman"}},{"type":"text","props":{"text":""}}]}]}]}}]')
) AS v(name, description, category, layout)
WHERE NOT EXISTS (
	SELECT 1 FROM "public"."page_blueprints" pb WHERE pb.tenant_host IS NULL AND pb.name = v.name
);
