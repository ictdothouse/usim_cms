CREATE TABLE IF NOT EXISTS "symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"node" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Public reference data (apps/frontend must resolve a "symbol" element's
-- node with no admin session, same as menus) — same defense-in-depth
-- pattern as every other tenant table: RLS still requires
-- app.authenticated for any write.
ALTER TABLE "symbols" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "symbols" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "symbols_select" ON "symbols";
CREATE POLICY "symbols_select" ON "symbols" FOR SELECT USING (true);

DROP POLICY IF EXISTS "symbols_insert" ON "symbols";
CREATE POLICY "symbols_insert" ON "symbols" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "symbols_update" ON "symbols";
CREATE POLICY "symbols_update" ON "symbols" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "symbols_delete" ON "symbols";
CREATE POLICY "symbols_delete" ON "symbols" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
