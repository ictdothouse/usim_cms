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

-- Upgrade path: per-tenant maintenance-mode flag (Manage Site's toggle) —
-- separate from `active`, see schema.ts's own comment on this column.
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "maintenance_mode" boolean DEFAULT false NOT NULL;

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

-- Off by default. While on, forces enrollment (not just the challenge) for
-- any non-superadmin account without TOTP yet, at login itself — see
-- schema.ts's platformSettings.mfaRequired comment and db/auth.ts's
-- isMfaSetupRequired.
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "mfa_required" boolean DEFAULT false NOT NULL;

-- Instance-wide default language-switcher placement/style (Settings
-- "Language Switcher" card) — the seed a tenant with no override resolves to.
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "switcher_position" text DEFAULT 'header' NOT NULL;
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "switcher_style" text DEFAULT 'text' NOT NULL;

-- Entra ID SSO (Settings "Login Methods" card, extension point mfa_enabled's
-- own comment already flagged) — see schema.ts's platformSettings comment
-- for what each column means.
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "entra_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "entra_only" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "entra_tenant_id" text;
ALTER TABLE "public"."platform_settings" ADD COLUMN IF NOT EXISTS "entra_client_id" text;

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

-- Per-tenant upload quota override, same global("")+override shape as
-- site_theme above. Null column = not set at this level (see
-- getMergedStorageLimits, tenant-pool.ts).
CREATE TABLE IF NOT EXISTS "public"."storage_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_host" text NOT NULL UNIQUE,
	"max_upload_file_size_mb" integer,
	"max_total_storage_mb" integer,
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

-- Architecture audit finding: "superadmin" | "webmaster" was only ever a
-- comment on schema.ts's role column, never enforced by Postgres itself —
-- and plugins/auth.ts's tenant-host check keys off the literal string
-- "webmaster" (now fixed to a deny-list on "superadmin" instead, see that
-- file), so a typo'd or future third role value would have silently meant
-- "unrestricted, no host check applies". CHECK closes the DB half of that.
DO $$ BEGIN
  ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('superadmin', 'webmaster'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- FK columns with no supporting index (control-plane tables only — see
-- migrations/0027_fk_indexes.sql for the tenant-DB equivalents).
CREATE INDEX IF NOT EXISTS "users_role_id_idx" ON "public"."users" ("role_id");
CREATE INDEX IF NOT EXISTS "theme_presets_owner_user_id_idx" ON "public"."theme_presets" ("owner_user_id");

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

-- Language-switcher placement/style, per-site override of the global
-- default (platform_settings.switcher_position/switcher_style above).
-- Nullable — null means "inherit the global default".
ALTER TABLE "public"."tenant_languages" ADD COLUMN IF NOT EXISTS "switcher_position" text;
ALTER TABLE "public"."tenant_languages" ADD COLUMN IF NOT EXISTS "switcher_style" text;

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
		'[{"type":"section","props":{"paddingY":"4rem","rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Nama Jabatan"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"postlist","props":{"count":"3","columns":"3","postLayout":"grid"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"ctabanner","props":{"heading":"Hubungi Kami","button1Label":"Hubungi","button1Href":"/hubungi"}}]}]}]}}]'),
	('About / profil', 'Hero ringkas, pengenalan, visi/misi, CTA', 'About',
		'[{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Tentang Kami"}},{"type":"text","props":{"text":"Pengenalan ringkas organisasi."}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"2","text":"Visi"}},{"type":"text","props":{"text":""}}]},{"span":1,"elements":[{"type":"heading","props":{"level":"2","text":"Misi"}},{"type":"text","props":{"text":""}}]}]}]}}]'),
	('Program / perkhidmatan', 'Hero, overview, feature cards, CTA', 'Program',
		'[{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Nama Program"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"cardgrid","props":{"cards":"[]","columns":"3"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"ctabanner","props":{"heading":"Mohon Sekarang","button1Label":"Mohon"}}]}]}]}}]'),
	('News hub', 'Heading, post grid, CTA subscribe', 'News',
		'[{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Berita & Pengumuman"}}]}]}]}},{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"postlist","props":{"count":"9","columns":"3","postLayout":"grid"}}]}]}]}}]'),
	('Contact', 'Contact info, operating hours, location', 'Contact',
		'[{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Hubungi Kami"}},{"type":"text","props":{"text":"Alamat, waktu operasi dan maklumat hubungan."}}]}]}]}}]'),
	('Simple content page', 'Page heading, rich text, related links', 'Content',
		'[{"type":"section","props":{"rows":[{"columns":[{"span":1,"elements":[{"type":"heading","props":{"level":"1","text":"Tajuk Halaman"}},{"type":"text","props":{"text":""}}]}]}]}}]'),
	-- Hero templates (2026-09-23) — real implementations of the 5 static
	-- design mockups in docs/*.html (SliderProblem.pdf's slider bugs are
	-- unrelated, only these hero references applied), each a single Section
	-- built from existing element types only (heading/text/button/icon/
	-- container) so it drops into any page and is fully editable in Designer
	-- afterward, not a screenshot to copy by hand. Split-with-Mockup's hand-
	-- drawn browser-chrome illustration has no equivalent in the element
	-- registry, approximated with an icon in a bordered container; the
	-- floating-shapes CSS animation in the video-loop mockup is decorative
	-- only and dropped. Button colors intentionally omitted (variant
	-- primary/outline) so every hero follows the site's own theme instead of
	-- the mockup's one-off hex.
	('Hero — Animated Headline', 'Dark hero with an eyebrow tag, big serif headline and outline CTA', 'Hero',
		'[{"type":"section","props":{"bg":"#0d0d0d","textColor":"#fdf3e0","paddingY":"6rem","rows":[{"columns":[{"span":1,"elements":[{"type":"text","props":{"text":"— OPEN 24 HRS —","align":"center","fontFamily":"Courier New","textTransform":"uppercase","color":"#ff7461","fontWeight":"700"}},{"type":"heading","props":{"level":"1","text":"Late night tunes, made for cruising.","align":"center","fontFamily":"Playfair Display","color":"#fdf3e0","fontWeight":"700"}},{"type":"text","props":{"text":"A radio station that never sleeps and never sells you anything.","align":"center","fontFamily":"Inter","color":"#b8a890"}},{"type":"button","props":{"label":"Tune in","href":"#tune","variant":"outline","align":"center","color":"#ff7461"}}]}]}]}}]'),
	('Hero — Brutalist Text-Only', 'High-contrast all-type hero with an accent tag and two CTA buttons', 'Hero',
		'[{"type":"section","props":{"bg":"#0a0a0a","textColor":"#ffffff","paddingY":"6rem","rows":[{"columns":[{"span":1,"elements":[{"type":"container","props":{"flexDirection":"row","justifyContent":"flex-start","alignItems":"center","flexWrap":"nowrap","gap":"0","bg":"#ff5e1a","padding":"0.5rem"},"children":[{"type":"text","props":{"text":"001 / 042","fontFamily":"JetBrains Mono","fontWeight":"700","color":"#0a0a0a"}}]},{"type":"heading","props":{"level":"1","text":"THE WEB WAS NEVER MEANT TO LOOK SAFE.","align":"left","fontFamily":"Inter","fontWeight":"800","textTransform":"uppercase","color":"#ffffff"}},{"type":"text","props":{"text":"A design studio for brands that would rather be remembered than liked.","fontFamily":"JetBrains Mono","color":"#a8a8a8"}},{"type":"container","props":{"flexDirection":"row","justifyContent":"flex-start","alignItems":"center","flexWrap":"wrap","gap":"0.875rem"},"children":[{"type":"button","props":{"label":"[ WORK ]","href":"#work","variant":"primary","color":"#0a0a0a"}},{"type":"button","props":{"label":"[ EMAIL ]","href":"#talk","variant":"outline","color":"#ffffff"}}]}]}]}]}}]'),
	('Hero — Centered Classic', 'Warm editorial centered hero with a serif headline and two CTA buttons', 'Hero',
		'[{"type":"section","props":{"bg":"#f5f1e6","textColor":"#2d3a2e","paddingY":"6rem","rows":[{"columns":[{"span":1,"elements":[{"type":"text","props":{"text":"— A new kind of workspace","align":"center","fontFamily":"JetBrains Mono","color":"#6b7d5a"}},{"type":"heading","props":{"level":"1","text":"Make small things that matter.","align":"center","fontFamily":"Cormorant Garamond","fontWeight":"600","color":"#1a2418"}},{"type":"text","props":{"text":"The toolkit for craftspeople who treat the work, the customer, and the calendar with the same care.","align":"center","fontFamily":"Inter","color":"#4a5447"}},{"type":"container","props":{"flexDirection":"row","justifyContent":"center","alignItems":"center","flexWrap":"wrap","gap":"0.75rem"},"children":[{"type":"button","props":{"label":"Start free trial →","href":"#start","variant":"primary","color":"#fff8ed"}},{"type":"button","props":{"label":"Watch the tour","href":"#tour","variant":"outline","color":"#2d3a2e"}}]},{"type":"text","props":{"text":"Free for 14 days · no card · cancel any time","align":"center","fontFamily":"JetBrains Mono","color":"#8a9080"}}]}]}]}}]'),
	('Hero — Split with Mockup', 'Two-column hero: copy on one side, a placeholder illustration card on the other', 'Hero',
		'[{"type":"section","props":{"bg":"#2c1f15","textColor":"#f5e6d3","paddingY":"4rem","rows":[{"columns":[{"span":1,"elements":[{"type":"container","props":{"flexDirection":"row","justifyContent":"flex-start","alignItems":"center","borderWidth":"1px","borderColor":"#d97742","borderStyle":"solid","padding":"0.35rem"},"children":[{"type":"text","props":{"text":"EST. 2024","fontWeight":"700","color":"#d97742"}}]},{"type":"heading","props":{"level":"1","text":"Inventory that actually adds up.","fontFamily":"Playfair Display","fontWeight":"800","color":"#fff8ed"}},{"type":"text","props":{"text":"Stock, batches, suppliers — one ledger, no spreadsheets, no Sundays at the laptop.","color":"#c9b5a0"}},{"type":"button","props":{"label":"Get started →","href":"#start","variant":"primary"}}]},{"span":1,"elements":[{"type":"container","props":{"flexDirection":"column","justifyContent":"center","alignItems":"center","bg":"#1a120a","borderWidth":"2px","borderColor":"#6b4427","borderStyle":"solid","shadow":"lg","padding":"1rem","gap":"0.75rem"},"children":[{"type":"icon","props":{"name":"bar-chart-3","size":"4rem","color":"#d97742","align":"center"}}]}]}]}]}}]'),
	('Hero — Animated Portfolio', 'Bold playful hero with a dark eyebrow tag and a bright CTA button', 'Hero',
		'[{"type":"section","props":{"bg":"#f4f1ea","textColor":"#0b1f4a","paddingY":"6rem","rows":[{"columns":[{"span":1,"elements":[{"type":"container","props":{"flexDirection":"row","justifyContent":"center","alignItems":"center","bg":"#0b1f4a","padding":"0.4rem"},"children":[{"type":"text","props":{"text":"▸ NOW PLAYING","fontFamily":"JetBrains Mono","fontWeight":"700","color":"#f5d028"}}]},{"type":"heading","props":{"level":"1","text":"Your portfolio, animated.","align":"center","fontFamily":"Inter","fontWeight":"800","color":"#0b1f4a"}},{"type":"text","props":{"text":"Drop in your projects. We turn them into the kind of motion reel that gets the call back.","align":"center","color":"#4a5878"}},{"type":"button","props":{"label":"Play with it","href":"#start","variant":"primary","align":"center"}}]}]}]}}]')
) AS v(name, description, category, layout)
WHERE NOT EXISTS (
	SELECT 1 FROM "public"."page_blueprints" pb WHERE pb.tenant_host IS NULL AND pb.name = v.name
);
