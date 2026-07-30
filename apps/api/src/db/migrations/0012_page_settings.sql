-- Page-wide Designer defaults (apps/api/src/db/schema.ts's pages.settings) —
-- currently just { gap?: string }, the default column gap for a row that
-- doesn't set its own (Designer.tsx's Inspector "nothing selected" panel).
--
-- Guarded like 0007_pages_status.sql: tenant-pool.ts's ensureTenantDatabase
-- replays every migration file into a tenant DB on every process restart,
-- not just once — a bare ADD COLUMN would error on the 2nd replay.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pages' AND column_name = 'settings'
  ) THEN
    ALTER TABLE "pages" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
  END IF;
END $$;
