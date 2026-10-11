-- 0004 gave "media" FORCE RLS with select/insert/delete policies but no
-- UPDATE one, so every UPDATE silently matched 0 rows: PATCH /api/media/:id
-- (rename, alt text, decorative flag, folder move) 404'd on every row, and
-- the media-location normalize job couldn't set storage_key/url. Same rule
-- as the other three — only the logged-in admin scope.
DROP POLICY IF EXISTS "media_update" ON "media";
CREATE POLICY "media_update" ON "media" FOR UPDATE
  USING (current_setting('app.authenticated', true) = 'true');
