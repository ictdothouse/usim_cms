-- Sprint 4 (docs/laporan-audit-ui-ux.md): media alt-text workflow. A
-- decorative image is exempt from the alt-text-required rule the admin UI
-- now enforces on upload/edit (MediaManager) -- without this flag there is
-- no way to distinguish "intentionally decorative, blank alt is correct"
-- from "author forgot alt text".
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "is_decorative" boolean DEFAULT false NOT NULL;
