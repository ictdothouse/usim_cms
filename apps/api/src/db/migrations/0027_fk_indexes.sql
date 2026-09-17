-- Architecture audit finding: these FK columns had no supporting index — a
-- query that filters/joins on them (category-delete restrict check, page
-- header/footer resolution, revision-history lookups, media-folder listing)
-- sequential-scans the table once a tenant's row count grows. Tenant-scoped
-- tables only (this file is replayed into every tenant database, same as
-- every other file here) — see bootstrap-public.sql's companion fix for the
-- control-plane-only FK columns (users.role_id, theme_presets.owner_user_id).
CREATE INDEX IF NOT EXISTS "posts_category_id_idx" ON "posts" ("category_id");
CREATE INDEX IF NOT EXISTS "pages_header_id_idx" ON "pages" ("header_id");
CREATE INDEX IF NOT EXISTS "pages_footer_id_idx" ON "pages" ("footer_id");
CREATE INDEX IF NOT EXISTS "post_revisions_post_id_idx" ON "post_revisions" ("post_id");
CREATE INDEX IF NOT EXISTS "page_revisions_page_id_idx" ON "page_revisions" ("page_id");
CREATE INDEX IF NOT EXISTS "media_folder_id_idx" ON "media" ("folder_id");
