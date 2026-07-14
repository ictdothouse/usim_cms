-- Defense-in-depth under CollectionConfig.access (see architecture recommendation
-- #3): even if a future generic-crud handler forgets to enforce auth/access(),
-- Postgres itself refuses writes unless the connection has proven it passed
-- requireTenantAuth this request (see plugins/tenant.ts + plugins/auth.ts,
-- which set/reset the app.authenticated session var on every request).
-- FORCE is required so this also applies when the app's DB role happens to
-- own the table — it does NOT apply to a superuser/BYPASSRLS role, so the
-- app must connect as a plain role in any environment where this matters
-- (see scripts/setup-db-role.sql).
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pages_select" ON "pages";
CREATE POLICY "pages_select" ON "pages" FOR SELECT USING (true);

DROP POLICY IF EXISTS "pages_insert" ON "pages";
CREATE POLICY "pages_insert" ON "pages" FOR INSERT
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "pages_update" ON "pages";
CREATE POLICY "pages_update" ON "pages" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true')
  WITH CHECK (current_setting('app.authenticated', true) = 'true');

DROP POLICY IF EXISTS "pages_delete" ON "pages";
CREATE POLICY "pages_delete" ON "pages" FOR DELETE
  USING (current_setting('app.authenticated', true) = 'true');
