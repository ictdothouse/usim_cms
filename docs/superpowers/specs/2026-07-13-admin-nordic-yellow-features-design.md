# Design: Admin Nordic Yellow + Post / Media Features

**Tarikh:** 2026-07-13
**Skop:** `apps/admin` (restyle + panel baharu) + `apps/api` (collection `posts`, media library, generic PATCH/DELETE)

---

## 1. Tujuan

Terapkan design system **Nordic Yellow** (Scandinavian/IKEA-style, biru `#003399` + kuning `#FFDA1A`)
ke seluruh dashboard admin, dan tambah tiga keupayaan pengurusan kandungan yang berfungsi hujung-ke-hujung:

1. **Pengurusan Post** — collection `posts` baharu (berita/pengumuman), berasingan dari Pages, dengan
   editor rich-text.
2. **Media Manager** — library media penuh (galeri, cari, pilih semula, padam) — bukan sekadar upload.
3. **Pengurusan Page & User** — sudah wujud; di-restyle + edit/delete disempurnakan.

Kekangan projek yang dihormati: multi-tenancy via `x-tenant-host`, "no bloat", isolasi tenant + RLS.

---

## 2. Keadaan semasa (baseline)

- `apps/admin/src/App.tsx` — SPA satu fail (~525 baris): `LoginForm`, `WebmasterDashboard`,
  `SuperadminDashboard`, `PagesPanel`, `ThemePanel`, `BlockBuilder`, `TenantsPanel`, `UsersPanel`,
  `GlobalThemePanel`, `PortalFeedPanel`. Tailwind mentah, `cn()` di `src/lib/utils.ts`. Shadcn dikonfig
  tapi tiada komponen dijana. `tailwind.config.js` `theme.extend` kosong.
- Backend: sistem collection code-first (`CollectionConfig` → `registerPublicCollectionRoutes` /
  `registerProtectedCollectionRoutes` dalam `generic-crud.ts`). Hanya `pages` didaftar. **`PATCH` &
  `DELETE` masih 501 stub.** `/api/media` POST simpan fail tapi **tiada rekod DB, tiada senarai, tiada
  validasi MIME/saiz**.
- Isolasi: `search_path` per-tenant + RLS pada `pages` (`app.authenticated` flag, `0002_pages_rls.sql`).

---

## 3. Design system Nordic Yellow

**Token** → `apps/admin/tailwind.config.js` `theme.extend`:
- `colors`: `primary #003399`, `primary-hover #002B80`, `secondary #FFDA1A`, `neutral #767676`,
  `background #F5F5F5`, `surface #FFFFFF`, `text-primary #111111`, `text-secondary #484848`,
  `border #DFDFDF`, `success #0A8A00`, `warning #E87400`, `error #CC0008`.
- `fontFamily`: `sans → ["Noto Sans", system-ui, sans-serif]`, `mono → ["JetBrains Mono", monospace]`.
- `borderRadius`: `DEFAULT 4px`, `panel 8px`, `modal 12px`.
- Elevation via `boxShadow` (level 1–3 dari spec).

**Font** → `apps/admin/index.html`: `<link>` Google Fonts (Noto Sans 400/600/700 + JetBrains Mono).
Fallback system font dalam stack supaya UI tak pecah jika rangkaian menyekat Google Fonts.

**UI primitives** → folder baharu `apps/admin/src/components/ui/`:
- `Button.tsx` — variant `primary` (biru), `secondary` (outline biru), `cta` (kuning bg, teks hitam),
  `danger`; 44px tinggi, radius 4px, Noto Sans 700 15px. Disabled `#DFDFDF`.
- `Card.tsx` — surface putih, border `#DFDFDF`, radius 4px.
- `Input.tsx` — 44px, border `#DFDFDF`, focus border biru 2px, state error `#CC0008`.
- `Chip.tsx` / `Badge.tsx` — status (draft/published, active/suspended, sustainability, dll.).
- `Modal.tsx` — untuk confirm delete + media picker (level-3 shadow, radius 12px).

Semua UI seterusnya guna primitives ini — sumber kebenaran tunggal untuk gaya.

> Nota: Nordic Yellow ialah gaya **chrome admin**, berasingan daripada `site_theme` per-tenant (yang
> menetapkan warna **tapak awam** pelawat). Jangan campur aduk keduanya.

---

## 4. Pecahan `App.tsx`

Fail tunggal akan meletup dengan 2 feature + restyle. Pecah kepada `apps/admin/src/components/`:

- `AppShell.tsx` — top bar biru 60px (logo kuning, tajuk, lencana role, logout) + navigasi tab.
- `LoginForm.tsx`
- `panels/PagesPanel.tsx`, `panels/PostsPanel.tsx`, `panels/MediaManager.tsx`,
  `panels/UsersPanel.tsx`, `panels/TenantsPanel.tsx`, `panels/ThemePanel.tsx`,
  `panels/GlobalThemePanel.tsx`, `panels/PortalFeedPanel.tsx`, `panels/BlockBuilder.tsx`.
- `App.tsx` kekal sebagai orkestra sesi + routing role/tab sahaja.

Improvement bersasar (bukan refactor liar) — dibenarkan kerana kita memang menyentuh fail ini.

---

## 5. Backend

### 5.1 Generic PATCH + DELETE (`apps/api/src/plugins/generic-crud.ts`)
Ganti dua stub 501 dengan implementasi sebenar (update sebahagian + delete by id), route melalui
`req.db` sedia ada. **Membuka edit/delete untuk `pages` DAN `posts` sekali gus** (fix di tempat semua
collection lalu). Kekal dalam protected scope (perlu auth).

### 5.2 Collection `posts`
- Jadual tenant-schema baharu dalam `apps/api/src/db/schema.ts`:
  `id uuid PK · slug text · title text · body text (HTML rich-text tersanitize) · excerpt text nullable ·
  bannerImageUrl text nullable · status text ('draft'|'published') default 'draft' · publishedAt timestamp
  nullable · createdAt · updatedAt`.
- Migration `apps/api/src/db/migrations/0003_create_posts.sql` — CREATE TABLE + **ENABLE/FORCE RLS +
  polisi** sama corak `0002_pages_rls.sql` (replay per-schema semasa runtime).
- Daftar `postsCollection: CollectionConfig` dalam `index.ts`: public GET (senarai + by-id, hanya
  `status='published'` untuk awam), protected write, `createSchema` (validasi JSON-schema,
  `additionalProperties:false`), `shareable` (publish ke portal).
- **Sanitasi rich-text:** `body` disanitize semasa **write** (POST/PATCH) sebelum simpan — guna
  `sanitize-html` (whitelist tag/atribut selamat). Ini sempadan keselamatan (XSS), tidak dipermudah.

### 5.3 Media library
- Jadual tenant-schema `media` dalam `schema.ts`:
  `id uuid PK · url text · filename text · mimeType text · size integer · createdAt`.
- Migration `0004_create_media.sql` (+ RLS).
- `POST /api/media` (sedia ada) — tambah: **validasi MIME (imej + PDF/doc) & saiz maks** (tolak jika
  gagal), kemudian **rekod baris `media`** selepas upload berjaya.
- `GET /api/media` baharu (protected) — senarai media tenant, terkini dahulu.
- `DELETE /api/media/:id` baharu (protected) — padam rekod + fail (local) / objek (S3).

---

## 6. Panel UI baharu

### PostsPanel
- Senarai post (kad Nordic Yellow: tajuk, excerpt, lencana status draft/published, tarikh).
- Cipta/edit: `Input` tajuk + slug (auto dari tajuk), **editor Tiptap** (StarterKit: bold/italic/heading/
  list/link) distyle Nordic Yellow, pilih banner (buka Media Manager sebagai picker), toggle status.
- Butang: Simpan, Padam (confirm modal), Publish-to-portal.
- **Tiptap** = pilihan editor paling ringan yang mampu (headless, tree-shakeable). Output HTML.

### MediaManager
- Galeri grid (aspek 1:1, gaya kad produk Nordic Yellow), upload (drag/pilih fail, preview, progress).
- Cari/tapis ikut nama fail. Klik item → salin URL / pilih (bila dibuka sebagai picker dari PostsPanel/
  PagesPanel). Padam (confirm modal).

### Penempatan
- **Webmaster dashboard**: tab `Pages · Posts · Media · Theme` (skop tenant sendiri).
- **Superadmin "Manage a site"**: tambah Posts + Media selepas pilih `x-tenant-host`. Tab superadmin lain
  (Tenants, Users, Global Design, Portal Feed) kekal, cuma di-restyle.

---

## 7. Aliran data (contoh: cipta post)

1. Webmaster login → token + tenantHost dalam `localStorage`.
2. PostsPanel → `POST /api/posts` (header `x-tenant-host` + `Authorization: Bearer`).
3. Protected scope: `requireTenantAuth` sahkan token, kunci webmaster ke tenantnya, buka gate RLS.
4. Handler: sanitize `body`, validasi schema, insert ke `posts` schema tenant.
5. Pelawat awam di `apps/frontend` → `GET /api/posts` (public scope, tanpa auth) → hanya `published`.

---

## 8. Build order (satu spec, berfasa)

1. **Foundation** — token Tailwind + font + UI primitives + `AppShell`/`LoginForm` restyle + pecah `App.tsx`.
2. **Backend** — generic PATCH/DELETE → `posts` (schema/migration/RLS/config/sanitize) → `media`
   (schema/migration/endpoints/validasi).
3. **PostsPanel** (termasuk integrasi Tiptap).
4. **MediaManager** (termasuk mod picker).
5. **Restyle panel sedia ada** — Pages, Users, Theme, Tenants, GlobalTheme, PortalFeed.

---

## 9. Luar skop (YAGNI / ditangguh)

- Fine-grained `access()` / semakan department (isolasi tenant + RLS sudah lindungi keperluan sebenar).
- `beforeChange`/`afterChange` hooks umum (kecuali sanitasi inline pada posts write).
- Live preview iframe, drag-and-drop block builder (kekal butang Up/Down sedia ada), pemampatan imej
  latar (`sharp` disekat), penjadualan terbit (publishedAt di-set semasa toggle published sahaja).
- Session token expiry, lockdown CORS — jurang keselamatan sedia ada, dijejak dalam `docs/ARSITEKTUR.md`,
  bukan sebahagian kerja ini.

---

## 10. Dependency baharu

| Pakej | App | Sebab |
|-------|-----|-------|
| `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` | admin | Editor rich-text (diminta pengguna). |
| `sanitize-html` (+ `@types/sanitize-html`) | api | Sanitasi HTML rich-text semasa write (XSS). |

Font Google (Noto Sans, JetBrains Mono) via `<link>`, bukan pakej npm.

---

## 11. Verifikasi (hujung-ke-hujung)

- `pnpm typecheck` + `pnpm build` hijau untuk kedua-dua app.
- Backend hidup (`pnpm dev:api`) + DB: daftar tenant, tambah user, jalankan CRUD posts penuh
  (create/list/patch/delete/publish), muat naik + senarai + padam media, sahkan validasi MIME menolak
  fail salah, sahkan `body` tersanitize (cuba suntik `<script>` → dibuang).
- Isolasi: post tenant-a tak nampak dari tenant-b; RLS tolak write tanpa auth.
- Admin (`pnpm dev:admin`): login, semua tab render dengan gaya Nordic Yellow, cipta post dengan editor
  rich-text + banner dari Media Manager, padam media.
- Frontend awam: `GET /api/posts` pulangkan hanya `published`.
