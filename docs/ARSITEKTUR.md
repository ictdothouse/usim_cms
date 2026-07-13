# Arkitektur & Tech Stack — USIM CMS

> Dokumen ini menerangkan **keadaan sebenar sistem hari ini** (bukan spec/cita-cita), justifikasi setiap
> pilihan teknologi, penilaian sama ada ia best practice, dan senarai kelemahan + cadangan yang jujur.
> Untuk niat/skop produk penuh rujuk [`architecture.md`](../architecture.md) dan
> [`features-spec.md`](../features-spec.md). **Nota:** kedua-dua spec itu sudah agak lapuk — contohnya
> mereka tak sebut `apps/frontend` yang sebenarnya sudah wujud.

---

## 1. Ringkasan Sistem

USIM CMS ialah **headless multi-tenant CMS** — satu *engine* tunggal yang menyampaikan **~50 tapak web
jabatan** universiti. Ganti model lama (setiap jabatan ada cPanel + WordPress sendiri, terpisah
sepenuhnya) dengan **satu instance** yang dikongsi, tetapi setiap jabatan (tenant) kekal terasing di
peringkat pangkalan data.

Prinsip reka bentuk yang memandu setiap keputusan (dari spec): **stabil, selamat, laju, mudah untuk staf
bukan-teknikal**, dan **"no bloat"** — elak library berat, guna Tailwind + plugin Fastify ringan.

Sistem = **monorepo pnpm** dengan 3 aplikasi:

| App | Peranan | Stack teras |
|-----|---------|-------------|
| `apps/api` | *Engine* backend — API, multi-tenancy, auth, storage | Fastify 5 + Drizzle + Postgres |
| `apps/admin` | Dashboard pengurusan kandungan (untuk staf) | React 18 + Vite + Tailwind |
| `apps/frontend` | Tapak awam yang dilihat pelawat | Astro 4 (SSR) |

Identiti tenant **sentiasa** datang dari header `x-tenant-host` setiap request — tidak pernah dari
subdomain parsing atau config semasa boot. Ini yang membolehkan satu deployment melayani semua 50 tapak.

---

## 2. Tech Stack & Justifikasi

### 2.1 Backend (`apps/api`)

| Teknologi | Versi | Kegunaan | Kenapa dipilih |
|-----------|-------|----------|----------------|
| **Fastify** | ^5.1 | HTTP server / routing | Lebih laju & ringan dari Express; **JSON-schema validation built-in** (tak perlu library asing); sistem plugin/encapsulation sesuai untuk pemisahan scope tenant. |
| **Drizzle ORM** | ^0.36 | Query builder + definisi schema | Type-safe, *thin* (bukan ORM berat macam Prisma yang ada engine binari + generate step). Sejajar "no bloat". SQL tetap dekat. |
| **pg** | ^8.13 | Driver Postgres mentah | Untuk operasi yang Drizzle tak liputi: `SET search_path`, provisioning schema, SQL mentah. |
| **TypeScript (ESM, NodeNext)** | ^5.7 | Bahasa + jenis | `strict: true`. Modul ESM sebenar (`"type": "module"`). |
| **tsx** | ^4.19 | Jalankan TS terus | Dev watch mode + semua CLI scripts tanpa build step. |
| **@aws-sdk/client-s3 + lib-storage** | ^3.10 | Klien S3 (pilihan) | Untuk driver storage S3-compatible (AWS/MinIO/Sangfor). Hanya dimuat bila `STORAGE_DRIVER=s3`. |
| **drizzle-kit** | ^0.28 | Jana migration dari schema | `db:generate` / `db:migrate`. |

**Keputusan menarik — crypto ditulis sendiri.** Tiada `bcrypt`, `argon2`, atau library JWT. Sebaliknya
guna `node:crypto` sahaja: `scrypt` untuk hash kata laluan, HMAC-SHA256 untuk token sesi. Ini pilihan
"no bloat" yang munasabah untuk login dalam-app yang mudah (lihat §5 untuk penilaian).

### 2.2 Admin (`apps/admin`)

| Teknologi | Versi | Kenapa |
|-----------|-------|--------|
| **React** | ^18.3 | UI. Plain SPA — **tiada React Router**; view ditukar ikut state (role + tab) dalam `App.tsx`. |
| **Vite** | ^5.4 | Dev server + bundler. Config minimal (plugin React + alias `@`). |
| **Tailwind CSS** | ^3.4 | Styling utiliti — elak CSS framework berat. |
| **clsx + tailwind-merge** | — | Convention Shadcn: helper `cn()` di `src/lib/utils.ts`. |

**Nota:** Shadcn *dikonfig* (`components.json`) tetapi **tiada komponen dijana** — semua UI ditulis
tangan guna Tailwind mentah. Ini scaffolding sahaja buat masa ini.

### 2.3 Frontend awam (`apps/frontend`)

| Teknologi | Versi | Kenapa |
|-----------|-------|--------|
| **Astro** | ^4.16 | Rendering tapak awam — hantar hampir-sifar JS secara default (island architecture), padan matlamat laju. |
| **@astrojs/node** (standalone) | ^8.3 | Adapter **SSR** (`output: "server"`). |

**Kenapa SSR, bukan SSG penuh?** Identiti tenant diselesaikan dari **Host header semasa runtime** — satu
instance melayani ~50 domain. Pra-render statik penuh tak sesuai kerana kandungan bergantung pada tenant
mana yang meminta. (Spec sebut SSG/hybrid + cache invalidation; ini belum dilaksana — lihat §9.)

### 2.4 Monorepo & tooling

- **pnpm workspace** (`pnpm@11.11`) — `packages: ["apps/*"]`. `allowBuilds`: `esbuild` dibenarkan,
  `sharp` **disekat** (konsisten dengan menangguhkan pemampatan imej).
- **`tsconfig.base.json`** — `strict: true`, `target: ES2022`. Setiap app override module-resolution
  ikut runtime (api = NodeNext; admin = Bundler + JSX; frontend = extend `astro/tsconfigs/strict`).
- Scripts root nipis sahaja: `dev:api`/`dev:admin`/`dev:frontend` (filter), `build`/`typecheck` (`-r`
  recursive).

---

## 3. Struktur Monorepo

```text
usim_cms/
├── apps/
│   ├── api/         # Fastify engine — semua logik server, DB, auth, storage
│   ├── admin/       # React SPA — dashboard staf
│   └── frontend/    # Astro SSR — tapak awam pelawat
├── architecture.md  # spec produk (agak lapuk)
├── features-spec.md # senarai ciri penuh (agak lapuk)
├── docs/ARSITEKTUR.md  # dokumen ini
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## 4. Arkitektur Multi-Tenancy (inti sistem)

Model: **satu schema Postgres setiap tenant**, atas **satu connection pool dikongsi**. Bukan
database-per-tenant, bukan row-based (`tenant_id` pada setiap baris).

### Aliran setiap request (tenant-scoped)

1. Request **wajib** hantar header `x-tenant-host` (cth `dept-a.usim.edu.my`). Kosong → **400**.
   — `apps/api/src/plugins/tenant.ts`
2. `getTenantConnection(host)` ambil satu client dari pool dikongsi.
   — `apps/api/src/db/tenant-pool.ts`
3. **Registry gate:** cari `host` dalam jadual `public.tenants`. Kalau tiada / `active=false` →
   **404 "Unknown tenant"**. **Ini sempadan kepercayaan (trust boundary):** header sembarangan tak boleh
   cipta schema baru — hanya host yang sudah didaftar boleh diselesaikan.
4. Nama schema = `tenant_` + host (huruf kecil, aksara bukan-alfanumerik → `_`).
   Cth `dept-a.usim.edu.my` → `tenant_dept_a_usim_edu_my`.
5. Kali pertama schema itu dijumpai (per proses): `CREATE SCHEMA IF NOT EXISTS`, kemudian **replay semua
   fail `migrations/*.sql`** ke dalam schema itu, dan cache dalam satu `Set`.
6. **`SET search_path TO "<schema>", public`** pada client itu. Inilah tuas isolasi: nama jadual tak
   berlayak (`pages`) menyelesai ke schema tenant; jadual registry (`public.*`) kekal dicapai melalui
   fallback `public`.
7. `req.db` (Drizzle terikat pada client itu) + `req.tenantHost` dilampir. Hook `onResponse`
   **sentiasa** lepaskan client balik ke pool (walaupun ada ralat).

### Kenapa schema-per-tenant = pilihan terbaik di sini

- **vs database-per-tenant:** 50 pangkalan data = 50 pool, 50 set connection, kos sumber tinggi & sukar
  urus. Schema-per-tenant kongsi satu pool → jimat.
- **vs row-based (`tenant_id` column):** row-based mudah tersilap bocor (terlupa `WHERE tenant_id=`).
  Schema berasingan + `search_path` beri isolasi lebih kuat secara default, dan RLS (§5) jadi *backstop*.
- **Registry gate** tutup lubang header-spoofing / resource-exhaustion (tak auto-provision schema untuk
  sebarang host).

### Pengehadan yang perlu diketahui

Isolasi bergantung pada `search_path` yang di-*set* per request kekal untuk hayat client itu, **dan** pada
`pages` sebagai satu-satunya jadual dalam schema tenant hari ini. RLS Postgres (§5) ialah lapisan
pertahanan kedua sekiranya handler terlupa. Ada juga **dua mekanisme migration** wujud serentak (replay
mentah semasa runtime vs `drizzle-kit migrate`) — lihat §9.

---

## 5. Auth & Keselamatan

**Model peranan:**
- **superadmin** — `tenant_host` null. Urus tenant, pengguna, tema global. Guna route root `/api/portal/*`
  yang dijaga `verifySuperadmin`. Tidak tenant-scoped.
- **webmaster** — dikunci ke **satu** tenant. Kalau `session.tenantHost !== req.tenantHost` → **403**.
  — `apps/api/src/plugins/auth.ts`

**Kata laluan** (`apps/api/src/db/auth.ts`):
- `scryptSync(password, salt, 64)` dengan salt 16-byte rawak setiap kata laluan; disimpan `"<salt>:<hash>"`.
- Sahkan guna `timingSafeEqual` (elak timing attack).

**Token sesi** (stateless, tulis sendiri):
- `base64url(payload JSON) + "." + base64url(HMAC-SHA256(body, SESSION_SECRET))`.
- Payload = `{userId, email, role, tenantHost}`. Sahkan dengan kira semula HMAC + `timingSafeEqual`.

**RLS (Row-Level Security) — pertahanan berlapis:**
- Migration `0002_pages_rls.sql` **ENABLE + FORCE RLS** pada `pages`, dengan polisi berpaksi pada flag
  sesi `app.authenticated`.
- `requireTenantAuth` set `app.authenticated = 'true'` hanya selepas token sah; `tenant.ts` **reset ke
  false setiap request** (client dari pool boleh bawa state lama).
- Script `db:setup-role` cipta role `usim_cms_app` yang **NOBYPASSRLS** dan pindah pemilikan jadual —
  sebab RLS diabaikan senyap kalau app connect sebagai superuser Postgres.
- Kesannya: walaupun handler terlupa auth, Postgres tolak *write* ke `pages` melainkan flag itu di-set.

---

## 6. Aliran Data & Pemisahan Scope

`apps/api/src/index.ts` daftar **dua scope tenant berasingan**:

- **Public scope** — `tenantPlugin` sahaja, **tanpa auth**. Hanya route **GET**
  (`/api/pages`, `/api/pages/:id`, `/api/theme`). Inilah yang dihubungi pelawat awam + `apps/frontend`
  (yang tiada sesi login).
- **Protected scope** — `tenantPlugin` + `requireTenantAuth` (perlu bearer token). Semua *write*
  (POST/PATCH/DELETE), `/api/:slug/:id/publish`, `/api/media`, dan `PUT /api/theme`.

> Pemisahan ini penting: dulu `requireTenantAuth` dikenakan pada **seluruh** scope tenant, jadi GET pun
> minta token — tapi pelawat awam tiada token. Bug itu **sudah dibetulkan** dengan pecahan scope ini
> (`registerPublicCollectionRoutes` / `registerProtectedCollectionRoutes` dalam `generic-crud.ts`).

**Ciri cross-tenant** (satu-satunya jalan keluar isolasi yang **disengajakan**):
- `public.shared_content` — "publish to portal". Webmaster tekan publish → baris dimasukkan ke pool
  kongsi; superadmin baca semua via `GET /api/portal/shared-content`. Tiada query merentas dua schema
  tenant.
- `public.site_theme` — baris `tenant_host=""` = tema **global** (superadmin); mana-mana host lain =
  *override* tenant. Dibaca dengan **shallow merge** (tenant menang per-key).

---

## 7. Media Storage

`apps/api/src/storage.ts` — driver boleh tukar via `STORAGE_DRIVER`:
- **`local`** (default) — tulis ke `apps/api/uploads/<tenant>/`, dihidang di `/uploads/` guna
  `@fastify/static`. Sesuai dev / deployment kecil.
- **`s3`** — mana-mana endpoint S3-compatible (AWS S3, MinIO, atau storage objek on-prem seperti
  Sangfor). `forcePathStyle` untuk provider bukan-AWS. Return URL luar penuh.

Fungsi `uploadFile(tenantFolder, filename, stream)` menyembunyikan pilihan driver dari route.

---

## 8. Penilaian Best-Practice — Apa yang Betul

Sistem ini **jauh lebih matang dari kebanyakan projek peringkat ini** dari segi asas stabil/selamat:

- ✅ **Schema-per-tenant + registry gate** — imbangan tepat antara isolasi dan kos; tutup header-spoofing.
- ✅ **Pertahanan berlapis** — RLS Postgres *di bawah* auth peringkat-app, bukan bergantung satu lapisan.
- ✅ **Had pool** — `max: 20`, `statement_timeout: 10s`, `idleTimeout: 30s`. Satu query tenant tersekat
  tak boleh lapar-kan 49 tenant lain.
- ✅ **Ketahanan proses** — handler `uncaughtException`/`unhandledRejection` (keluar bersih daripada
  teruskan dalam keadaan mungkin-rosak) + graceful shutdown `SIGTERM`/`SIGINT`.
- ✅ **Pelepasan connection dijamin** — `onResponse` lepaskan client walaupun pada laluan ralat.
- ✅ **Validation input** — Fastify JSON-schema + `additionalProperties: false` pada `pages` POST.
- ✅ **Timing-safe compare** untuk kata laluan & token.
- ✅ **Storage abstraction** — tukar local↔S3 tanpa sentuh kod route.
- ✅ **Falsafah no-bloat dipatuhi** — tiada dependency berat yang tak perlu.

---

## 9. Kelemahan & Cadangan

Disusun ikut keutamaan (paling kritikal dahulu).

### Keselamatan (buat sebelum production)

1. **Token sesi tiada tempoh luput.** `SessionPayload` tiada `exp`/`iat`; `verifySession` hanya semak
   HMAC — mesej "invalid or expired" mengelirukan (tiada logik expired sebenar). Token yang bocor sah
   selamanya. **Cadang:** tambah `exp` ke payload + semak semasa verify (TTL cth 8 jam).
2. **`SESSION_SECRET` ada fallback hardcoded dev.** Kalau env tak di-set, guna string tetap tak selamat.
   **Cadang:** gagal-boot (throw) kalau `SESSION_SECRET` kosong dalam mod production.
3. **CORS `origin: true` terbuka.** **Cadang:** kunci ke domain admin sebenar sebelum deploy.
4. **`/api/media` tiada validasi MIME/saiz** — terima sebarang jenis fail (ada `.txt` dalam uploads).
   **Cadang:** hadkan jenis MIME + saiz maksimum; pertimbang nyah-cemar nama fail.

### Kelengkapan (ciri belum siap)

5. **Hooks & access control tak di-wire.** `access()`, `beforeChange`, `afterChange` **didefinisi** dalam
   `config-types.ts` tapi **tak pernah dipanggil** dalam `generic-crud.ts` (ada TODO). `pagesCollection.
   access.read` wujud tapi tak diguna. **Cadang:** sambungkan sebelum tambah collection kedua.
6. **`DELETE` + `PATCH` masih 501 stub** untuk `pages` — belum dilaksana.
7. **Dua mekanisme migration.** Runtime replay `migrations/*.sql` mentah per schema; `drizzle-kit
   migrate` pula ada tapi tak diguna semasa runtime. Boleh mengelirukan. **Cadang:** dokumen dengan jelas
   yang mana kanun, atau satukan.

### Tooling & operasi (tiada langsung)

8. **Tiada tests, tiada CI (`.github/`), tiada Dockerfile / config deployment, tiada README.** Untuk
   sistem yang bercita-cita jadi "CMS terbaik" dan melayani 50 tapak sebenar, ini jurang paling besar.
   **Cadang keutamaan:** (a) README + panduan setup; (b) beberapa test untuk penjana CRUD generik &
   isolasi tenant; (c) Dockerfile + manifes deploy; (d) CI typecheck/build.

### Berbanding spec (`features-spec.md`)

9. Belum ada / MVP sahaja: **block builder** (MVP — 3 jenis blok, tiada drag-and-drop, guna butang
   Up/Down), **live preview iframe** (tiada), **media library UI** (hanya upload satu fail, tiada galeri),
   **komponen Shadcn** (dikonfig, tiada dijana), **GraphQL** (REST sahaja — keputusan sedar), **local API
   SDK** (tiada), **cache invalidation / SSG** frontend (tiada), **Postgres RLS penuh untuk semua
   collection** (hanya `pages`).
10. **Spec doc lapuk** — `architecture.md` & `features-spec.md` masih tak sebut `apps/frontend` (Astro)
    yang sudah wujud. **Cadang:** kemas kini spec, atau jadikan dokumen ini sumber kebenaran.

---

## Ringkasan

Asas **stabil & selamat sudah kukuh** (multi-tenancy, RLS berlapis, ketahanan proses, no-bloat).
Jurang utama sebelum production ialah **keselamatan sesi (expiry + secret), validasi upload, dan
ketiadaan tests/CI/Docker/README** — bukan reka bentuk teras, yang sudah baik.
