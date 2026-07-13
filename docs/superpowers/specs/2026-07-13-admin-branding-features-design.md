# Design: Admin Restyle + Branding Kustomisasi + Post / Media Features

**Tarikh:** 2026-07-13
**Skop:** `apps/admin` (restyle + panel baharu) · `apps/api` (collection `posts`, media library, generic
PATCH/DELETE, branding settings) · `apps/frontend` (guna branding tenant)

---

## 1. Tujuan

1. **Branding kustomisasi (ciri utama)** — setiap jabatan boleh kustomkan rupa **tapak awam** mereka:
   **warna, font (mana-mana Google Font), dan logo**. Superadmin set default global; setiap webmaster
   boleh override untuk tenant sendiri (merge: tenant menang). Ini memanjangkan `site_theme` sedia ada.
2. **Pengurusan Post** — collection `posts` baharu (berita/pengumuman) dengan editor rich-text.
3. **Media Manager** — library media penuh (galeri, cari, pilih semula, padam).
4. **Pengurusan Page & User** — sudah wujud; di-restyle + edit/delete disempurnakan.
5. **Restyle dashboard admin** — guna satu set token reka bentuk yang kemas & konsisten (palet biru/kuning
   sebagai **default**, tanpa sebarang jenama pihak ketiga).

Kekangan dihormati: multi-tenancy via `x-tenant-host`, "no bloat", isolasi tenant + RLS.

---

## 2. Keadaan semasa (baseline)

- `apps/admin/src/App.tsx` — SPA satu fail (~525 baris): `LoginForm`, dashboard webmaster/superadmin,
  `PagesPanel`, `ThemePanel`, `BlockBuilder`, `TenantsPanel`, `UsersPanel`, `GlobalThemePanel`,
  `PortalFeedPanel`. Tailwind mentah, `cn()` di `src/lib/utils.ts`. `tailwind.config.js` kosong.
- Backend collection code-first (`generic-crud.ts`). Hanya `pages` didaftar. **`PATCH`/`DELETE` masih 501
  stub.** `/api/media` simpan fail tapi **tiada rekod DB, tiada senarai, tiada validasi MIME/saiz**.
- **Branding sedia ada:** jadual `public.site_theme` (`tenant_host` `""` = global, selainnya = override
  tenant; `settings` JSONB). Endpoint `GET/PUT /api/theme` (per-tenant) + `GET/PUT /api/portal/theme`
  (global). `apps/frontend` `BaseLayout.astro` sudah petakan `--color-primary` + `--font-family` dari
  settings. `settings` kini cuma pegang `primaryColor` + `logoUrl` secara ad-hoc (tiada skema).
- Isolasi: `search_path` per-tenant + RLS pada `pages` (`0002_pages_rls.sql`).

---

## 3. Branding kustomisasi (ciri utama)

### 3.1 Bentuk `site_theme.settings` (skema tetap)
```jsonc
{
  "primaryColor":    "#003399",   // warna utama (butang, pautan, header)
  "secondaryColor":  "#FFDA1A",   // aksen / CTA
  "backgroundColor": "#F5F5F5",
  "textColor":       "#111111",
  "fontFamily":      "Noto Sans", // nama mana-mana Google Font
  "logoUrl":         ""           // URL dari Media Manager
}
```
- **Default global** (baris `tenant_host=""`) di-*seed* dengan nilai di atas (palet biru/kuning = default,
  tanpa nama jenama). Superadmin boleh ubah.
- Override tenant: mana-mana kunci yang di-set menang atas global (shallow merge, seperti sekarang).
- Validasi (backend): warna mesti hex sah; `fontFamily` string ringkas (huruf/nombor/ruang sahaja —
  elak suntikan bila dibina jadi URL Google Fonts); `logoUrl` string.

### 3.2 Backend
- `GET/PUT /api/theme` + `GET/PUT /api/portal/theme` sudah wujud — tambah **validasi bentuk settings**
  (tolak kunci/nilai tak sah) semasa PUT. Tiada endpoint baharu diperlukan.

### 3.3 `apps/frontend` guna branding
`BaseLayout.astro`:
- Suntik CSS vars: `--color-primary`, `--color-secondary`, `--color-bg`, `--color-text`.
- **Load font dinamik:** bina `<link href="https://fonts.googleapis.com/css2?family=<encoded fontFamily>&display=swap">`
  dari `fontFamily` (encode nama; fallback ke system font jika kosong/tak sah). Set `--font-family`.
- Render `logoUrl` dalam header jika ada.
- Risiko diterima pengguna: nama Google Font salah taip → font tak muat, fallback system font (UI tak pecah).

### 3.4 Panel admin: `BrandingPanel`
Gantikan `ThemePanel` + `GlobalThemePanel` dengan satu `BrandingPanel` (skop ikut role):
- Pemilih warna (`<input type="color">` native — tiada library) untuk 4 warna.
- Input nama font (Google Font) + pratonton teks langsung guna font itu.
- Pilih logo → buka **Media Manager** sebagai picker.
- Pratonton kad ringkas menunjukkan warna + font + logo digabung.
- **Webmaster:** edit branding tenant sendiri (`/api/theme`). **Superadmin:** edit default global
  (`/api/portal/theme`) + boleh edit mana-mana tenant dari tab "Manage a site".

---

## 4. Design tokens dashboard admin (default tetap, tanpa jenama)

**Token** → `apps/admin/tailwind.config.js` `theme.extend`:
- `colors`: `primary #003399`, `primary-hover #002B80`, `secondary #FFDA1A`, `neutral #767676`,
  `background #F5F5F5`, `surface #FFFFFF`, `text-primary #111111`, `text-secondary #484848`,
  `border #DFDFDF`, `success #0A8A00`, `warning #E87400`, `error #CC0008`.
- `fontFamily`: `sans → ["Noto Sans", system-ui, sans-serif]`, `mono → ["JetBrains Mono", monospace]`.
- `borderRadius`: `DEFAULT 4px`, `panel 8px`, `modal 12px`. Elevation via `boxShadow` (3 aras halus).

> Ini gaya **chrome admin** yang tetap — berbeza daripada branding tapak awam (§3) yang boleh diubah.

**Font admin** → `apps/admin/index.html`: `<link>` Google Fonts (Noto Sans + JetBrains Mono) + fallback.

**UI primitives** → `apps/admin/src/components/ui/`: `Button` (variant primary/secondary/cta/danger, 44px,
radius 4px), `Card`, `Input`, `Chip`/`Badge` (status), `Modal` (confirm delete + media picker). Semua UI
guna primitives ini — sumber gaya tunggal.

---

## 5. Pecahan `App.tsx`

Pecah ke `apps/admin/src/components/`: `AppShell` (top bar 60px + nav tab), `LoginForm`, dan
`panels/`: `PagesPanel`, `PostsPanel`, `MediaManager`, `BrandingPanel`, `UsersPanel`, `TenantsPanel`,
`PortalFeedPanel`, `BlockBuilder`. `App.tsx` kekal orkestra sesi + routing role/tab sahaja.

---

## 6. Backend: Posts + Media + generic CRUD

### 6.1 Generic PATCH + DELETE (`generic-crud.ts`)
Ganti dua stub 501 dengan implementasi sebenar (update sebahagian + delete by id) via `req.db`. Membuka
edit/delete untuk `pages` DAN `posts` sekali gus. Kekal protected scope (perlu auth).

### 6.2 Collection `posts`
- Jadual tenant-schema (`schema.ts`): `id · slug · title · body (HTML tersanitize) · excerpt? ·
  bannerImageUrl? · status('draft'|'published') default 'draft' · publishedAt? · createdAt · updatedAt`.
- Migration `0003_create_posts.sql` — CREATE TABLE + ENABLE/FORCE RLS + polisi (corak `0002`).
- Daftar `postsCollection` di `index.ts`: public GET (awam nampak `published` sahaja), protected write,
  `createSchema` (validasi JSON-schema), `shareable` (publish ke portal).
- **Sanitasi rich-text:** `body` disanitize semasa write (POST/PATCH) dengan `sanitize-html` (whitelist).
  Sempadan keselamatan (XSS) — tidak dipermudah.

### 6.3 Media library
- Jadual tenant-schema `media`: `id · url · filename · mimeType · size · createdAt`.
- Migration `0004_create_media.sql` (+ RLS).
- `POST /api/media` — tambah **validasi MIME (imej + PDF/doc) & saiz maks**, kemudian rekod baris `media`.
- `GET /api/media` (protected) — senarai media tenant. `DELETE /api/media/:id` (protected) — padam rekod
  + fail (local) / objek (S3).

---

## 7. Panel UI

### PostsPanel
Senarai post (kad: tajuk, excerpt, lencana status, tarikh). Cipta/edit: input tajuk + slug (auto),
**editor Tiptap** (StarterKit: bold/italic/heading/list/link, output HTML) distyle token admin, pilih
banner (Media Manager picker), toggle draft/published. Butang: Simpan, Padam (confirm), Publish-to-portal.

### MediaManager
Galeri grid (aspek 1:1), upload (pilih fail, preview, progress), cari/tapis nama, klik → salin URL / pilih
(mod picker), padam (confirm).

### Penempatan tab
- **Webmaster:** `Pages · Posts · Media · Branding`.
- **Superadmin:** `Manage a site` (Pages/Posts/Media/Branding untuk host dipilih) · `Tenants` · `Users` ·
  `Global Branding` · `Portal Feed`.

---

## 8. Build order (satu spec, berfasa)

1. **Foundation admin** — token Tailwind + font + UI primitives + `AppShell`/`LoginForm` + pecah `App.tsx`.
2. **Backend** — generic PATCH/DELETE → `posts` (schema/migration/RLS/config/sanitize) → `media`
   (schema/migration/endpoints/validasi) → validasi bentuk `site_theme.settings`.
3. **BrandingPanel** (admin) + **branding di `apps/frontend`** (CSS vars + font dinamik + logo).
4. **PostsPanel** (Tiptap).
5. **MediaManager** (mod picker).
6. **Restyle panel sedia ada** — Pages, Users, Tenants, PortalFeed.

---

## 9. Luar skop (YAGNI / ditangguh)

- Kustomisasi rupa **chrome admin** oleh pengguna (admin kekal token tetap §4).
- Fine-grained `access()` / department checks (isolasi tenant + RLS sudah lindungi).
- Muat naik font sendiri / senarai font preset (guna nama Google Font terus, seperti dipilih).
- Live preview iframe, drag-and-drop block builder, pemampatan imej, penjadualan terbit.
- Session token expiry, CORS lockdown — dijejak dalam `docs/ARSITEKTUR.md`, bukan kerja ini.

---

## 10. Dependency baharu

| Pakej | App | Sebab |
|-------|-----|-------|
| `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` | admin | Editor rich-text (diminta). |
| `sanitize-html` (+ `@types/sanitize-html`) | api | Sanitasi HTML rich-text semasa write (XSS). |

Font Google via `<link>` (admin: tetap; frontend: dinamik ikut branding), bukan pakej npm. Pemilih warna
guna `<input type="color">` native (tiada library).

---

## 11. Verifikasi (hujung-ke-hujung)

- `pnpm typecheck` + `pnpm build` hijau (semua app).
- **Branding:** superadmin set warna+font+logo global → tenant-a warisi → tenant-a override warna →
  `apps/frontend` tenant-a papar warna override + font Google dimuat + logo; tenant-b (tiada override)
  papar default global. Nama font tak sah → fallback system font, tiada pecah.
- **Posts:** CRUD penuh (create/list/patch/delete/publish); awam nampak `published` sahaja; `<script>`
  dalam body dibuang oleh sanitizer.
- **Media:** upload → senarai → padam; validasi MIME tolak fail salah; pilih dari picker isi banner post.
- **Isolasi:** data tenant-a tak nampak dari tenant-b; RLS tolak write tanpa auth.
- **Admin:** login + semua tab render dengan token reka bentuk konsisten.
