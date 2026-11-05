# Laporan Audit Menyeluruh — usim_cms

**Tarikh:** 4 November 2026 (dijalankan semalaman, 3–4 Nov)
**Skop:** seluruh repo — `apps/api`, `apps/admin`, `apps/frontend`, `packages/*`, `monitor/`, `scripts/`, CI, Docker, installer
**Fokus:** kekuatan sistem, dan memastikan tiada **placebo** — perkara yang nampak berfungsi tetapi sebenarnya tiada kesan.
**Cara:** semua check automatik dijalankan, 5 audit statik mendalam dibuat serentak, kemudian setiap temuan HIGH ke atas disemak semula terus pada code. Tiada code diubah semasa audit ini.

---

## 1. Ringkasan eksekutif

**Kesimpulan: sistem ini kukuh pada teras.** Keselamatan (auth, CSRF, MFA, Entra SSO, RLS, pengasingan tenant) benar-benar dikuatkuasa, bukan sekadar dokumen. Setiap panggilan admin → API, frontend → API, dashboard monitor → server dan Live Edit bridge sepadan dengan route sebenar. Setiap setting yang disimpan ada pembaca sebenar.

**Placebo sebenar wujud, tetapi di jaring keselamatan, bukan di ciri utama:**

| # | Placebo | Kesan sebenar |
|---|---|---|
| 1 | CI nampak ada lint/typecheck/test, tapi job `build` gagal di langkah lint sejak 13 Okt | typecheck, build dan unit test dalam CI tidak berjalan ~3 minggu |
| 2 | Cron backup harian "terpasang" | boleh gagal tanpa sesiapa tahu; skrip exit 0 walaupun semua dump tenant gagal |
| 3 | Butang Backup/Restore/Clone dalam admin | tak termasuk menus, events, symbols, templates; restore memadam semua sejarah revision |
| 4 | Pengerasan upload media (allowlist sambungan fail) | restore backup memintas kawalan ini sepenuhnya |
| 5 | Toggle per-breakpoint untuk hoverEffect/entrance/warna butang | berfungsi dalam canvas admin, tiada kesan pada laman sebenar |

> **Kemas kini 5 Nov — ujian live:** stack sebenar (Postgres + API + admin + frontend + Playwright) menemui **2 bug KRITIKAL** yang terlepas oleh analisis statik: pemasangan baharu rosak sepenuhnya sejak 17 Sep, dan kebocoran sambungan DB yang menggantung laman tenant. Kedua-duanya sudah dibaiki dan disahkan secara lokal — lihat **§8**.

### Skor (penilaian, bukan metrik automatik)

| Bidang | Skor | Sebab ringkas |
|---|---|---|
| Keselamatan aplikasi | 8.5/10 | Kawalan teras disahkan; satu jurang restore (§3.4) |
| Ketepatan fungsi (kontrak API, setting) | 9/10 | 115 panggilan admin, 32 panggilan monitor, 30 jenis mesej bridge, 23 setting — semua sepadan |
| Designer (UI jujur vs laman sebenar) | 8/10 | Hampir semua prop sampai ke laman; 3 jenis toggle per-breakpoint placebo |
| Deploy / ops | 8/10 | Blue-green, smoke gate, rollback, healthcheck semua sebenar |
| Integriti data (backup/restore) | 5/10 | Kegagalan senyap + backup dalam-app tak lengkap |
| Gate kualiti CI | 5/10 | Lint merah menyekat semua langkah lain; image publish tak bergantung pada CI |
| Liputan ujian | 6/10 | 470 unit test lulus, tetapi API hanya 72 ujian untuk ~140 route; e2e 2 smoke spec |
| **Keseluruhan** | **~7.5/10** | Naik dari 6/10 (audit 17 Sep 2026) |

---

## 2. Apa yang dijalankan (bukti)

| Check | Keputusan | Nota |
|---|---|---|
| `pnpm build` (semua pakej) | ✅ Lulus (80s) | |
| `pnpm typecheck` | ✅ Lulus (26s) | |
| Unit test semua pakej | ✅ **464/464 lulus** | api 72 · admin 310 · frontend 47 · element-schema 15 · element-render 14 · element-style 6 |
| Ujian monitor + scripts | ✅ **6/6 lulus** | dashboard, security, monitor-access-caddy |
| `pnpm lint` | ❌ Gagal | **41 error dalam fail ter-commit** (lihat §3.1). 620 error lagi datang dari folder worktree lokal (`.worktrees/`, `.claude/worktrees/`) yang di-gitignore — tak dilihat CI tetapi merosakkan `pnpm lint` di mesin ini |
| `pnpm format:check` | ❌ 498 fail tak ikut Prettier | Tidak dikuatkuasa dalam CI — kosmetik |
| E2E Playwright | ✅ **5/5 lulus** (5 Nov) | Hanya selepas pembaikan §8.1–8.3. Sebelum itu: 0 test Designer boleh lulus pada DB baharu |
| `pnpm audit` | ❌ 2 moderate (5 Nov) | Lihat §8.7 — langkah pertama CI turut gagal kerana ini |
| Status run GitHub Actions | ⚠️ Tidak disemak | Perlu rangkaian. Kegagalan lint di §3.1 adalah deterministik (lockfile sama), tetapi sahkan di GitHub. |

---

## 3. Temuan — ikut keutamaan

### P1 — betulkan dahulu

#### 3.1 CI merah sejak 13 Okt: typecheck/build/test dalam CI tidak berjalan — HIGH, DISAHKAN

- `.github/workflows/ci.yml:19-25` menjalankan `pnpm audit` → `pnpm lint` → `typecheck` → `build` → unit test, berturutan. Langkah gagal = langkah seterusnya dilangkau.
- `pnpm lint` gagal dengan 41 error pada fail ter-commit:
  - `monitor/users.js` (14), `monitor/manage-users.js` (10), `scripts/monitor-access-caddy.mjs` (8), `scripts/monitor-access-caddy.test.mjs` (3) — `no-undef` untuk `process`/`Buffer`/`console`/`URL`/`structuredClone`. `eslint.config.mjs` tidak mengisytiharkan global Node untuk fail ini. (`monitor/server.js` lulus kerana ia `import process from "node:process"` secara eksplisit.)
  - `apps/api/src/routes/collections.ts:219,837` — `_draft` tak digunakan.
  - `apps/admin/src/Designer.tsx:121,128,182` — `hoverBand`, `draggingBand`, `setPageSettings` tak digunakan.
  - `apps/admin/public/config.js:3` — `window` tak diisytihar.
  - `monitor/users.js:93` — `no-unsafe-finally`.
- Fail punca masuk pada 2026-10-13 (`cf8233a`, `38d648a`). `eslint.config.mjs` tidak berubah sejak 2026-07-13.
- **Kesan:** 3 minggu perubahan tanpa typecheck/build/unit test di CI. Job e2e masih berjalan (job berasingan).
- **Baiki (~30 min):** tambah `languageOptions.globals` Node untuk `monitor/**/*.js` dan `scripts/**/*.mjs`; `argsIgnorePattern: "^_"` untuk `no-unused-vars`; buang 3 pembolehubah mati dalam Designer.tsx; tambah `.worktrees/**` dan `.claude/worktrees/**` ke `ignores` supaya lint lokal boleh guna.

#### 3.2 Backup harian boleh gagal tanpa sesiapa tahu — HIGH, DISAHKAN

`apps/api/scripts/backup.sh` (dijalankan cron 2 pagi oleh `install.sh:936`):

1. **Dump tenant gagal → skrip tetap exit 0.** `dump_tenant()` (baris 39-44) hanya cetak "FAILED ... skipped" ke stderr. Jika semua tenant gagal, cron tetap "berjaya".
2. **Pertanyaan senarai tenant gagal → 0 tenant di-backup, exit 0.** Gelung baris 68-72 membaca dari `< <(fetch_tenant_rows ...)`. `set -e` tidak menangkap kegagalan dalam process substitution — `psql` gagal = gelung kosong.
3. **Dump control-plane gagal → semua tenant dilangkau.** Baris 63 berjalan di bawah `set -e` tanpa pengendalian; skrip mati sebelum gelung tenant. `run.sh` turut berhenti, jadi backup media dan push off-site (rclone/S3/SSH/Drive) juga tak berjalan.
4. **Tiada pemantauan.** `monitor/server.js` hanya menyemak sama ada *template* skrip cron sudah lapuk (`getBackupCronStatus`, baris 2589). Tiada semakan umur dump terbaru, tiada alert. Kegagalan cuma masuk `/var/log/ucms-backup.log`.

- **Senario:** gangguan DB sementara pukul 2 pagi → tiada backup untuk mana-mana tenant malam itu, tiada alert. Berulang tanpa disedari sehingga backup diperlukan.
- **Baiki:** kira kegagalan tenant dan `exit 1` di hujung; semak exit `psql` secara eksplisit; jangan biar kegagalan control-plane menghentikan dump tenant; tambah semakan "dump terbaru lebih tua dari 26 jam" dalam `pollForAlerts` monitor guna `sendAlert` sedia ada.

#### 3.3 Backup/Restore/Clone dalam admin tidak lengkap, dan restore memadam sejarah — HIGH, DISAHKAN

- `apps/api/src/backup.ts:23-30` (`BackupTables`) hanya meliputi **6 daripada 12** jadual tenant: pages, posts, media, media_folders, site_chrome, categories.
- **Tidak termasuk:** `menus`, `events`, `symbols`, `design_templates`, `page_revisions`, `post_revisions`.
- `importTenantBackup` (baris 307-312) memadam pages/posts. `page_revisions.pageId` dan `post_revisions.postId` adalah `onDelete: "cascade"` (`schema.ts:226,249`) → **setiap restore memadam semua sejarah revision**, dan revision tiada dalam fail backup untuk dipulihkan.
- **Kesan:**
  - Restore ke tenant **lain/baharu** (laluan "migrasi mudah" yang diniatkan, `backup.ts:11-14`) dan promote clone: elemen Menu, Symbol dan Event List merujuk ID yang tiada → render kosong tanpa ralat.
  - Restore ke tenant **sama**: menus/symbols/events tidak dikembalikan ke keadaan backup, dan semua revision (jaring "restore to last known good") hilang kekal.
  - `backup-manifest.test.ts` hanya menguji bentuk manifest, tiada ujian round-trip.
- **Nota:** pg_dump harian (`backup.sh`) meliputi semua jadual — ini isu backup/restore/clone **dalam aplikasi**, bukan pemulihan bencana.
- **Baiki:** tambah 6 jadual ke export/import (susunan FK: categories → site_chrome → menus/symbols → pages/posts → revisions); tambah satu ujian round-trip.

#### 3.4 Restore backup memintas allowlist jenis fail → stored XSS — MEDIUM-HIGH, DISAHKAN (code), tidak dieksploit

- Upload biasa (`routes/media.ts:95-143`) sengaja menetapkan sambungan fail dari peta MIME pelayan — komen di situ menerangkan rantaian sebenar yang ditutup: `.html` dihidang dari origin API → stored XSS → rampas sesi.
- Restore (`backup.ts:332-347`) menulis fail dari zip **tanpa semakan sambungan**:
  - `media/2026/01/x.html` lulus `isValidMediaKey` (regex `[a-z0-9][a-z0-9._-]*`, `storage.ts:113`).
  - Cawangan legacy `uploads/` menerima sebarang `path.basename`.
- `@fastify/static` (`index.ts:130`) menghidang ikut sambungan (`.html` → `text/html`, `.svg` → `image/svg+xml`), dan CSP API dimatikan (helmet `contentSecurityPolicy: false`).
- **Senario:** superadmin me-restore zip yang diubah (dari pihak luar, atau storan backup yang terjejas) → `/uploads/.../x.html` di origin API → skrip baca `GET /api/auth/session` (cookie dihantar automatik, same-origin) → dapat CSRF token → tindakan superadmin penuh.
- **Prasyarat:** superadmin mesti me-restore fail berniat jahat. Path traversal **tidak** berlaku (`isValidMediaKey` dan `path.basename` menghalang).
- **Baiki:** pada restore, terima hanya sambungan dalam set nilai `MEDIA_EXT_BY_MIME`; sebagai lapisan kedua, tambah `Content-Security-Policy: sandbox` atau `Content-Disposition: attachment` untuk sambungan bukan media pada laluan `/uploads`.

### P2 — penting, tidak mendesak

#### 3.5 Toggle per-breakpoint yang placebo di Designer — MEDIUM, DISAHKAN

- `InspectorElementPanel.tsx:367` menunjukkan BpToggle untuk semua field kecuali `slides`/`image`, termasuk `hoverEffect`, `entrance` dan `color`.
- Canvas admin (`ElPreview.tsx`, `mergeElBp`) menggabungkan override dan menunjukkan kesannya. Validator API menerimanya.
- Laman sebenar (`ElementBlock.astro:65`) membaca `el.props` desktop sahaja untuk hoverEffect/entrance; `bpStyleRules` untuk button/badge/icon tiada `color`. Komen `ElementBlock.astro:77-79` sendiri mengaku: "hoverEffect/entrance/color stay admin-canvas-preview-only".

| Elemen | Prop override tablet/mobile | Canvas admin | Laman sebenar |
|---|---|---|---|
| heading, text, image, button | `hoverEffect` | ✅ | ❌ |
| heading, text, image, button | `entrance` | ❌ | ❌ |
| button, badge, icon | `color` | ✅ | ❌ |
| heading, text, list | `color` | ✅ | ✅ (melalui `typoStyle`) |

- **Kesan:** editor set "mobile: lift" atau warna butang khusus tablet, nampak betul dalam Designer, simpan berjaya — pelawat sebenar sentiasa nampak nilai desktop.
- **Baiki pantas:** sembunyikan BpToggle untuk 3 field ini (button/badge/icon `color`, `hoverEffect`, `entrance`). **Baiki penuh:** emit kelas per-breakpoint melalui `@media`.

#### 3.6 Image dipublish tanpa gate CI; GitLab tiada ujian langsung — MEDIUM, DISAHKAN

- `.github/workflows/images.yml` dicetuskan sendiri pada push ke `main`, tanpa `needs`/`workflow_run` ke `ci.yml`. Commit yang gagal lint/typecheck/e2e masih boleh menerbitkan image (apabila `UCMS_PUBLISH_IMAGES=true`).
- Gate sebenar hanyalah langkah ujian dalam Dockerfile:
  - api: `test` ✅
  - admin: `test` ✅
  - frontend: `typecheck` sahaja. Komen `apps/frontend/Dockerfile:27` "no test files here" sudah lapuk — 47 ujian frontend (termasuk `sanitize-custom-html.test.ts`, kawalan XSS) tidak berjalan semasa build image.
- `.gitlab-ci.yml` hanya ada job `publish-images` — **tiada lint, typecheck, unit test atau e2e**. Organisasi yang guna GitLab hanya dilindungi oleh langkah ujian Dockerfile.
- **Baiki:** `images.yml` → `workflow_run` selepas CI berjaya; tambah `RUN pnpm --filter @ucms/frontend test` dalam Dockerfile frontend; tambah job ujian dalam `.gitlab-ci.yml`.

#### 3.7 Dokumentasi tidak sepadan dengan code — MEDIUM, DISAHKAN

Pembaca (termasuk Claude) akan membuat keputusan salah berdasarkan ini:

| Lokasi | Kata dokumen | Realiti |
|---|---|---|
| `apps/api/CLAUDE.md:437` | `Fastify()` sets `trustProxy: true` | Bergantung pada env `TRUST_PROXY === "true"` (`index.ts:67`) |
| `apps/api/CLAUDE.md` (bahagian `validate-layout`), `apps/frontend/CLAUDE.md` (CSP) | Custom HTML ialah "raw HTML/CSS/JS embed", sempadan amanah yang disengajakan | Disanitasi ketat semasa render (`sanitize-custom-html.ts`): tiada `script`, `style`, `iframe` atau atribut `style` |
| `apps/admin/src/designer/hooks/useBpStyle.ts:96` | "apps/frontend never reads `bp`" | Margin/padding/border/shadow/align/typography/span/flexDirection semuanya sampai ke laman |
| `apps/frontend/src/components/ElementBlock.astro:77-79` | "color stays admin-canvas-preview-only" | Betul untuk button/badge/icon sahaja; heading/text/list `color` sampai ke laman |
| `docs/ARSITEKTUR.md:251` | Slider guna Embla Carousel | Swiper (`SliderBlock.astro`, `swiper ^12.2.0`); tiada dependensi Embla |
| `apps/frontend/Dockerfile:27` | "no test files here" | 4 fail ujian, 47 ujian |

#### 3.8 Elemen Custom HTML membuang kandungan tanpa amaran — LOW-MEDIUM (UX), DISAHKAN

- Editor menampal kod embed (iframe YouTube, skrip, HTML dengan `style=""`) → admin hanya tunjuk placeholder (jujur) → laman sebenar membuang semuanya tanpa sebarang mesej.
- Sanitasi ini **betul dari segi keselamatan**. Masalahnya cuma tiada petunjuk kepada editor.
- **Baiki:** teks bantuan di bawah field: "Skrip, iframe dan style dibuang — guna elemen Embed untuk iframe."

### P3 — kecil

| # | Temuan | Bukti | Cadangan |
|---|---|---|---|
| 3.9 | `TRUST_PROXY` tiada dalam mana-mana `.env.example`; hanya ditetapkan dalam `docker-compose.release.yml:72` | `index.ts:67` | Dokumenkan. Pemasangan bare-metal di belakang reverse proxy operator sendiri akan nampak semua IP sebagai 127.0.0.1 → had cubaan login per-IP dikongsi semua pengguna |
| 3.10 | Endpoint monitor tanpa butang: `POST /api/alerts/test` (berfungsi), `POST /api/base/apply` (stub sentiasa 409) | `server.js` baris 1307, 1547 | Tambah butang "Test alert" di dashboard (berguna); buang stub |
| 3.11 | 498 fail tidak ikut Prettier; `format:check` tiada dalam CI | `pnpm format:check` | Pilih: kuatkuasa dalam CI, atau buang skrip |
| 3.12 | `.docx/.xlsx/.pptx/.zip` berkongsi magic byte ZIP — zip biasa boleh disimpan sebagai `.docx` | `routes/media.ts:172` | Integriti kandungan sahaja; tiada XSS/RCE |
| 3.13 | Penguatkuasaan MFA bergantung pada `NODE_ENV === "production"` | `plugins/auth.ts:27` | Selamat dalam semua laluan yang dihantar (Dockerfile + kedua-dua compose menetapkannya). Dokumenkan risiko jika NODE_ENV diubah. |

---

## 4. Kekuatan yang disahkan — bukan placebo

Setiap item di bawah dikesan dari titik tulis hingga titik baca/penguatkuasaan dalam code.

**Keselamatan**
- Kata laluan: scrypt dengan kos boleh laras, perbandingan timing-safe, dan laluan dummy untuk akaun tak wujud (tiada oracle timing). Had cubaan diperiksa **sebelum** pengesahan kata laluan.
- CSRF dikuatkuasa secara struktur: hook `preHandler` pada keseluruhan `protectedScope`, bukan dekorator per-route yang boleh terlupa. Route superadmin disampel satu persatu — tiada route mutasi tanpa guard.
- MFA/TOTP: RFC 6238, ±30s, timing-safe, had cubaan pada setiap endpoint. Menukar/mematikan MFA memerlukan kod semasa — cookie curi sahaja tak cukup.
- Entra ID: OIDC penuh — tandatangan RS256 dari JWKS, `iss`/`aud`/`tid`/`exp`/`iat`/`nonce` disemak, nonce terikat cookie (anti login-CSRF). **Tiada auto-provision** (`identity_not_linked` jika tiada akaun).
- RLS **ENABLE + FORCE** pada semua 12 jadual kandungan tenant.
- Tenant: akses dihadkan oleh `tenantHosts` dari sesi (DB), bukan dari header `x-tenant-host` klien.
- Upload media: sambungan dari peta MIME pelayan, semakan magic byte, tiada SVG.
- Monitor: hampir semua shell-out guna `execFile` dengan argv tatasusunan; dua `sh -c` dibina dari pemalar pelayan; satu-satunya SQL interpolasi guna `sqlStringLiteral`.
- `static-server.js` `safeJoin` guna `path.relative` (menghalang laluan adik-beradik seperti `dist-secret`).
- Header admin: CSP ketat, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`. Caddy: HSTS.
- Tiada rahsia (kunci AWS/GitHub/Slack/Google/PEM) ditemui dalam repo.

**Ketepatan fungsi**
- ~115 panggilan `apps/admin/src/lib/api.ts` → route sebenar dengan method dan path betul, termasuk route koleksi generik.
- 20 panggilan frontend → route awam API.
- 32 panggilan `api()` dashboard monitor → 32 cawangan router `server.js`.
- 30 jenis mesej `designer:*` Live Edit — dihantar dan dikendalikan di kedua-dua belah, tiada yatim.
- Medan rahsia (S3, backup destination) tulis-sahaja; bacaan hanya pulangkan `*Set: boolean`.

**Setting & konfigurasi** (23 setting dikesan)
- Backup destination dibaca **segar setiap kali** oleh skrip cron (`psql` setiap run).
- Had storan dikuatkuasa semasa strim (had `fileSize` busboy + SUM sebenar).
- Mod penyelenggaraan, SEO default, penempatan language switcher, edge protection (CIDR sampai ke `trusted_proxies` Caddy), mod login Entra + break-glass — semua berwayar penuh.
- Pengawal "MFA tak boleh dimatikan dalam production" konsisten di sisi baca dan tulis.

**Designer**
- Override per-breakpoint untuk margin/padding/border/shadow/radius/align/typography/span/flexDirection — benar di laman sebenar melalui `@media`.
- Slider: Swiper sebenar dengan autoplay/loop/speed/effect/direction/grid dari atribut `data-*`.
- Free-position: `computeFreePositionStyle` dikongsi antara admin dan frontend.
- Symbol live-linked (`getSymbol` setiap request); template salinan sekali.
- Alt text gambar sampai ke `<img alt>`.

**Operasi**
- Deploy: polling healthcheck sebenar, smoke test halaman sebenar (gagal keras jika `SMOKE_TEST_HOST` tiada selepas release pertama — **bukan placebo**), warna lama tidak disentuh jika gagal.
- Migrasi: satu transaksi per tenant, fail yang diubah selepas diguna **gagal dengan kuat**, advisory lock merentas replika.
- Tenant pool: eviction memeriksa `waitingCount` dan `idleCount === totalCount` sebelum menutup.
- Cache Redis: gagal → cache miss, tidak gagalkan request; TTL 60s sebagai sandaran invalidasi.
- Monitor: alert edge-triggered (tiada spam), self-heal hantar alert berjaya/gagal.
- docker-compose: healthcheck, `restart: unless-stopped`, `mem_limit` pada setiap service; pgbouncer tunggu db `service_healthy`.

---

## 5. Apa yang TIDAK dapat disahkan malam ini

- ~~Stack hidup + e2e~~ — **siap 5 Nov**, lihat §8.
- **Sejarah run GitHub Actions** — tidak disemak (gh hanya dalam WSL). Berdasarkan §3.1, §8.3 dan §8.7, kedua-dua job CI dijangka merah; sahkan di GitHub.
- **VPS demo / production** — tidak disentuh.
- Round-trip setiap medan untuk ~40 body PATCH (hanya kewujudan route + method disemak; login/session disemak mendalam).
- Override per-bahasa × per-breakpoint, preset header/footer sticky/transparent (tidak dibuka).
- IDOR per-baris di luar semakan tenant + RLS.
- Pemacu S3 terhadap bucket sebenar.
- Semakan keselamatan penuh setiap route monitor (deploy/backup/SSL/pgquery disampel).

---

## 6. Kerja tergantung

- **Phase 1 god-file `monitor/server.js` — siap, belum commit.**
  - `DASHBOARD_HTML` dipindah ke `monitor/dashboard-html.js` (1513 baris, sama byte kecuali `export`).
  - `server.js` 4331 → 2817 baris.
  - `node --check` lulus, `dashboard.test.js` 2/2, `security.test.js` 3/3.
  - Deploy: muat semula biasa memadai — monitor hanya menyekat jika `deploy.sh`, `supervisor.js` atau template service berubah.
  - Selepas deploy, buka dashboard sekali dan pastikan semua tab bertukar.
- **Phase 2** (pecah logik server ikut concern) — ditangguhkan atas permintaan.
- Perubahan `graphify-out/` daripada `/graphify --update` belum commit.

---

## 7. Cadangan urutan kerja

| Urutan | Kerja | Anggaran |
|---|---|---|
| 0 | §8.1 + §8.2 + §8.3 — commit & deploy pembaikan yang sudah siap lokal | ~10 min |
| 1 | §3.1 + §8.7 — baiki lint dan `pnpm audit`, CI hijau semula | ~30 min |
| 2 | §3.2 — exit code `backup.sh` + alert kesegaran backup dalam monitor | ~1-2 jam |
| 3 | §3.3 + §3.4 — lengkapkan jadual backup, allowlist sambungan semasa restore, ujian round-trip | ~2-3 jam |
| 4 | §3.5 — sembunyikan BpToggle untuk 3 field placebo | ~20 min |
| 5 | §3.6 — gate `images.yml` pada CI, ujian frontend dalam Dockerfile, job ujian GitLab | ~1 jam |
| 6 | §3.7 + §3.8 — kemas kini dokumen, teks bantuan Custom HTML | ~30 min |
| 7 | P3 mengikut kelapangan | — |

---

## 8. Ujian live (5 November 2026)

**Persekitaran:** Postgres 16 pakai-buang (Docker), API (`tsx src/index.ts`, env sama seperti job e2e CI), admin (Vite dev), frontend (build production `server.mjs`), Playwright 1.64 + Chromium, Node 25.8 (lihat §8.6). Stack lain yang sedang berjalan pada mesin ini tidak disentuh.

**Keputusan akhir (selepas pembaikan):**
- e2e **5/5 lulus**, 3 larian, termasuk satu pada DB yang benar-benar baharu (persis CI).
- API unit 72/72, typecheck dan build lulus.

### 8.1 KRITIKAL — pemasangan baharu rosak sepenuhnya sejak 17 Sep (diperbaiki, belum commit)
- `apps/api/src/db/bootstrap-public.sql:175` mencipta index pada `theme_presets` **sebelum** `CREATE TABLE theme_presets` (baris 190).
- Seluruh skrip dijalankan sebagai satu transaksi tersirat. Pada DB baharu ralat itu membatalkan semuanya: **0 jadual control-plane**, dan `/api/setup` serta login pulang 500 (`relation "public.theme_presets" does not exist`).
- `ensurePublicSchema` (`tenant-pool/internal.ts:51`) menyimpan promise yang gagal (`??=`), jadi proses API tidak akan cuba lagi sehingga di-restart.
- Masuk melalui `3732de6` (17 Sep). DB sedia ada tidak terjejas kerana jadualnya sudah wujud.
- **Kesan:** setiap pemasangan baharu sejak 17 Sep (organisasi pelanggan baharu, VPS baharu) tidak boleh digunakan langsung, dan job e2e CI merah sejak itu.
- **Pembaikan:** index dipindah ke selepas jadual. Disahkan: DB kosong → 13 jadual; dijalankan dua kali → idempotent.

### 8.2 KRITIKAL — sambungan DB bocor bila klien putus; laman tenant tergantung (diperbaiki, belum commit)
- `plugins/tenant.ts` hanya melepaskan sambungan dalam hook `onResponse`. Fastify 5 menjalankannya hanya pada event `finish` respons (`fastify/lib/reply.js:1014`). Jika klien putus sebelum respons dihantar, sambungan tidak pernah dilepaskan.
- Pool tenant `max: 5` (`tenant-pool/connection.ts:102`), tanpa `connectionTimeoutMillis`. Selepas 5 request terputus, **setiap request seterusnya untuk tenant itu tergantung selama-lamanya**. Idle eviction juga tidak membantu kerana sambungan dikira masih "dipinjam".
- **Repro:**
  - Sebelum pembaikan: baseline 117ms. Selepas 6 request diputus, tiada respons dalam 5s. Postgres menunjukkan 5 sesi idle dipegang.
  - Selepas pembaikan: selepas 30 request diputus, 200 dalam 22ms.
- **Dunia sebenar:** pelawat menutup tab, rangkaian mudah alih terputus, bot dengan timeout pendek, timeout proksi, reload iframe Live Edit. Ia berlaku per replika, dan restart menyembunyikannya — juga satu DoS yang sangat mudah.
- **Pembaikan:** lepaskan sekali sahaja dalam `onSend` (berjalan selepas handler siap walaupun soket sudah putus), dengan `onResponse` sebagai sandaran. Tiada ralat double-release dalam log.
- **Cadangan tambahan:** set `connectionTimeoutMillis` pada pool tenant supaya pool penuh gagal cepat (503) dan tidak tergantung.

### 8.3 HIGH — job e2e CI memang tidak boleh lulus (diperbaiki)
1. §8.1 (bootstrap).
2. Kata laluan fixture `e2e/seed.ts` 13 aksara; polisi kini minimum 15 (`db/auth.ts:171`).
3. Fallback login dalam fixture tidak tahu tentang MFA. Login kata laluan superadmin **sentiasa** memerlukan TOTP (`routes/auth.ts:183`), jadi panggilan seed kedua gagal. Fixture kini menjawab cabaran TOTP dan berkongsi satu sesi bagi setiap worker.
4. Race dalam ujian Live Edit: ujian membaca `data-live-active` sekali sahaja serta-merta selepas drop, sedangkan iframe bertukar slot ~1s kemudian. Diagnostik membuktikan produk betul — iframe buffer aktif dan memaparkan heading dari t+1s.

Bersama §3.1, **kedua-dua job CI tidak memberi isyarat bermakna** — gate placebo.

### 8.4 MEDIUM — kod TOTP boleh diguna semula (tiada perlindungan replay)
- Tiada rekod langkah masa terakhir yang diterima (grep: tiada).
- Kod yang dicuri (phishing proxy, intai bahu) bersama kata laluan sah berulang kali dalam tetingkap ±1 langkah (~90s). ASVS 2.8.4 mahu OTP sekali guna.
- **Baiki:** simpan counter terakhir yang diterima bagi setiap pengguna, dan tolak kod yang ≤ counter itu.

### 8.5 MEDIUM — dokumen kata superadmin dikecualikan daripada MFA wajib; code sentiasa memaksanya
- `apps/api/CLAUDE.md` (perenggan Mandatory MFA) bercanggah dengan `routes/auth.ts:183` dan `db/auth.ts:60-61`.
- Code adalah tingkah laku yang lebih ketat dan selamat. Dokumen yang lapuk inilah yang mengelirukan fixture e2e. Kemas kini dokumen.

### 8.6 MEDIUM — versi Node tidak sepadan selepas bump dependency dari VPS
- `c03faf7` (dari monitor VPS, 27 Okt) menaikkan Astro 7.4.0 → 7.4.2, yang memerlukan **Node ≥22.23.4**.
- Kedudukan semasa:
  - `engines` root masih `"22.x"`.
  - Image Docker guna `node:24-alpine` (OK).
  - CI guna Node 22 terkini (OK).
  - Dev lokal Node 22.22.3: `astro build`/`astro check` gagal ("Node.js v22.22.3 is not supported by Astro").
- **Baiki:** tetapkan `engines` kepada minimum sebenar (atau naik ke 24 supaya sama dengan Docker), dan biar kemas kini dependency dalam monitor menyemak `engines` sebelum bump.

### 8.7 LOW — `pnpm audit`: 2 advisory moderate
- Salah satunya `glob` ≤14.0.1 melalui `@fastify/static` (GHSA-3g3m-2fjr-6pw4). Tidak boleh dieksploit dalam penggunaan kita (root statik tetap).
- Tetapi langkah pertama CI ialah `pnpm audit`, yang gagal pada sebarang advisory — satu lagi sebab CI merah.
- **Baiki:** naikkan `@fastify/static` apabila ada versi yang patched, atau `pnpm.overrides` `glob` ≥14.0.2.

### Kesan pada skor
Dengan §8.1 dan §8.2, keadaan **sebelum** pembaikan ialah ~6.5/10: ketersediaan dan pemasangan baharu kedua-duanya kritikal. Selepas pembaikan dideploy, kembali ~7.5/10.
