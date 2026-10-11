-- Media location phase 1: new uploads live at tenants/<tenantId>/<yyyy>/<mm>/<file>
-- in storage (local disk or S3) and are served publicly at
-- /uploads/<yyyy>/<mm>/<file> on the tenant's own domain (tenant resolved from
-- the Host header — see routes/media.ts's registerMediaServeRoutes). This column
-- holds the tenant-relative part ("2026/10/banner-utama-1a2b3c4d.png"); null for
-- a legacy row stored flat under uploads/<host_folder>/<filename>.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "storage_key" text;
