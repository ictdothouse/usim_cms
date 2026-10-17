# Deploy ke Server Node.js — Env & Langkah

Panduan ini untuk pemasangan manual. Untuk deployment disyorkan, gunakan `install.sh` (VPS) atau
`install-dev.mjs` (dev Docker) kerana kedua-duanya mengurus role DB, rahsia, dan Compose.
Prasyarat semasa: **Node.js 22**, **pnpm 12** (`corepack enable`), **PostgreSQL 16+**.

## Docker: ralat `server login failed: wrong password type`

Ralat ini berasal daripada PgBouncer ketika ia cuba log masuk ke PostgreSQL.
Imej PgBouncer `1.25.2` yang dipakai sebelum ini mempunyai regresi SCRAM selepas
sambungan backend dibuka semula. Compose kini menggunakan Percona PgBouncer
`1.26.0-1`, yang mengandungi [pembaikan upstream](https://github.com/pgbouncer/pgbouncer/releases/tag/pgbouncer_1_26_0). `scripts/deploy.sh` mengesahkan
`SELECT 1` melalui PgBouncer sebelum membina warna baharu; healthcheck API pula
memanggil `/ready`, yang turut menjalankan query database.

Selepas `git pull`, jalankan semula `bash scripts/deploy.sh`. Skrip akan mencipta
semula servis PgBouncer bersama konfigurasi baharu. Jika semakan login masih
gagal, lihat `docker compose logs --tail 100 pgbouncer db` untuk mesej sebenar
daripada PgBouncer, kemudian semak bahawa `pgbouncer/userlist.txt` masih
`root:70` mod `640` dan verifiernya sama dengan role `usim_cms_app` di PostgreSQL.
Jangan tampal kandungan verifier atau `.env` ke dalam tiket/log awam. Jangan
matikan semakan halaman sebenar untuk memaksa promosi.

## 1. apps/api (port 3000)

Fail env: `apps/api/.env` (salin dari `.env.example`).

| Env | Wajib | Nilai |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgres://usim_cms_app:<katalaluan>@<host>:5432/usim_cms` — **mesti role `usim_cms_app`**, bukan superuser (RLS jadi no-op bawah superuser) |
| `DATABASE_PROVISIONER_URL` | ✅ untuk auto-create tenant | URL terus ke PostgreSQL sebagai `usim_cms_provisioner`; jangan halakan melalui PgBouncer. Role ini sahaja yang mempunyai `CREATEDB`. |
| `SESSION_SECRET` | ✅ | Rentetan rawak panjang, cth. `openssl rand -hex 32`. Tanpa ini token login guna default dev yang tidak selamat |
| `PORT` | ❌ | Default `3000` |
| `STORAGE_DRIVER` | ❌ | `local` (default, tulis ke `apps/api/uploads/`) atau `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL_BASE` | jika `s3` | Mana-mana storan serasi S3 (AWS/MinIO/Sangfor) |

Setup DB kali pertama (sekali sahaja, sambung sebagai administrator PostgreSQL). Gunakan rahsia hex
untuk elak aksara khas dalam URL dan tetapkan kedua-dua URL runtime selepas menukar kata laluan role:

```bash
# Jalankan setup role dengan DATABASE_URL menunjuk kepada administrator.
pnpm --filter @ucms/api db:setup-role
# Dalam sesi psql sebagai administrator, tukar kedua-dua kata laluan secara interaktif:
#   \password usim_cms_app
#   \password usim_cms_provisioner
# Gunakan rahsia rawak hex, kemudian tetapkan:
# DATABASE_URL=postgres://usim_cms_app:<app-password>@<host>:5432/usim_cms
# DATABASE_PROVISIONER_URL=postgres://usim_cms_provisioner:<provisioner-password>@<host>:5432/usim_cms
# DATABASE_PROVISIONER_URL mesti sambungan terus ke PostgreSQL.
pnpm --filter @ucms/api tenant:add   # daftar host jabatan
pnpm --filter @ucms/api user:add     # cipta superadmin/webmaster
```

Jalankan:

```bash
pnpm install
pnpm --filter @ucms/api build   # salin migrations .sql ke dist sekali
pnpm --filter @ucms/api start   # node --env-file=.env dist/index.js
```

Semasa request pertama tenant, API menyelaras proses melalui PostgreSQL advisory lock. Migrasi yang
belum tercatat dalam `public.ucms_schema_migrations` digunakan satu demi satu dalam transaksi dan
SHA-256 checksum mengesan fail migrasi yang diubah selepas digunakan. Database tenant sedia ada tanpa
ledger membina baseline sekali dengan memainkan sejarah migrasi yang idempoten; migrasi seterusnya hanya
fail baru. `db:migrate` Drizzle bukan runner migrasi tenant.

## 2. apps/frontend (Astro SSR, port 4321)

Env dibaca **semasa build** (`import.meta.env` di-inline oleh Vite) — set sebelum `astro build`:

| Env | Wajib | Nilai |
|---|---|---|
| `API_URL` | ✅ | URL dalaman API, cth. `http://127.0.0.1:3000` (server-side sahaja) |
| `DEV_TENANT_HOST` | ❌ | Dev sahaja; tiada kesan pada build/production |

Runtime (adapter `@astrojs/node` standalone):

| Env | Nilai |
|---|---|
| `HOST` | `0.0.0.0` supaya boleh diakses luar |
| `PORT` | Default `4321` |

```bash
API_URL=http://127.0.0.1:3000 pnpm --filter @ucms/frontend build
HOST=0.0.0.0 PORT=4321 node apps/frontend/dist/server/entry.mjs
```

**Penting:** identiti tenant datang dari header `Host` permintaan. Reverse proxy (nginx/Caddy) mesti
hala setiap domain jabatan (`dept-a.usim.edu.my`, …) ke proses frontend ini **tanpa** menulis ganti
header `Host` (`proxy_set_header Host $host;` dalam nginx).

## 3. apps/admin (SPA statik)

Bare-metal: env dibaca **semasa build**. Docker: dibaca semasa container admin bermula
(`apps/admin/runtime-config.sh`), jadi satu imej boleh digunakan oleh mana-mana organisasi/domain.

| Env | Wajib | Nilai |
|---|---|---|
| `VITE_API_URL` | ✅ | URL **awam** API yang boleh dicapai pelayar admin, cth. `https://api.usim.edu.my` |

```bash
VITE_API_URL=https://api.usim.edu.my pnpm --filter @ucms/admin build
# hidang apps/admin/dist dengan nginx/Caddy (fail statik, tiada proses Node)
```

## Nota production

- Jalankan API + frontend bawah pm2/systemd (API sengaja `process.exit(1)` pada ralat fatal — mesti auto-restart).
- Tetapkan `ADMIN_ORIGIN` kepada origin admin sebenar dan `NODE_ENV=production`; API memerlukan kedua-duanya untuk konfigurasi production.
- `STORAGE_DRIVER=local`: pastikan folder `apps/api/uploads/` wujud & boleh tulis; ia dihidang pada `/uploads/`.

## Imej Docker: bina di server atau tarik dari registry

Lalai: `scripts/deploy.sh` membina imej api/frontend/admin di server itu sendiri
(`scripts/build-images.sh`). Cache build dihadkan oleh `BUILD_CACHE_MAX` (lalai `5GB`); lapisan
yang paling lama tidak digunakan dibuang dahulu.

Amalan terbaik untuk production atau banyak server: bina **sekali** dalam CI, server hanya menarik
imej. Server tiada beban CPU build dan tiada cache build, dan imej yang lulus ujian ialah imej yang
dideploy. Ia tidak terikat kepada GitHub atau GitLab; mana-mana CI dan registry OCI boleh digunakan.

1. CI membina dan menolak imej, ditag dengan commit:
   - **GitHub**: tetapkan repository variable `UCMS_PUBLISH_IMAGES=true` (Settings > Secrets and
     variables > Actions > Variables). `.github/workflows/images.yml` menolak ke
     `ghcr.io/<owner>/<repo>`.
   - **GitLab**: tetapkan CI/CD variable `UCMS_PUBLISH_IMAGES=true`. `.gitlab-ci.yml` menolak ke
     registry projek (`$CI_REGISTRY_IMAGE`); perlukan runner Docker-in-Docker.
   - **CI atau mesin build lain** (Jenkins, Bitbucket, Azure DevOps, pelayan build): jalankan
     `docker login <registry>`, kemudian
     `UCMS_IMAGE_REPO=<registry>/<path> bash scripts/build-images.sh --push`.
2. Pemasangan baharu: `sudo ./install.sh --mode=production` bertanya **"Image registry path"**.
   Kosongkan untuk membina di server. Atau masukkan path registry, username dan token baca
   sahaja (GHCR: PAT classic dengan skop `read:packages`; GitLab: deploy token dengan skop
   `read_registry`). Installer akan `docker login`, menyemak imej untuk versi ini wujud, dan
   menyimpan `UCMS_IMAGE_REPO` dalam `.env`. Deploy pertama terus menarik imej tanpa membina.
3. Server sedia ada, atau pemasangan tanpa interaksi: jalankan `docker login <registry>` sekali
   sahaja, kemudian tetapkan `UCMS_IMAGE_REPO=<registry>/<path>` dalam `.env`, sama seperti di CI.
   `deploy.sh` kini menarik imej untuk commit semasa, dan menunggu sehingga `IMAGE_WAIT_SECONDS`
   (lalai 900) jika CI belum siap. Kosongkan nilai ini untuk kembali membina di server.
4. Tetapkan polisi simpanan registry: kekalkan tag `v*` (release) selama-lamanya, dan buang tag
   lain (imej setiap commit di `main`) selepas tempoh tertentu, contohnya 30 hari:
   - GitLab: Settings > Packages and registries > Cleanup policies.
   - GHCR: tiada polisi terbina; padam versi lama melalui halaman Packages atau action
     `actions/delete-package-versions`.
   - Harbor, Docker Hub atau registry lain: guna retention rule registry tersebut.

## Release: penerbit dan server organisasi

Penerbit (vendor) membina dan menerbitkan; server organisasi hanya menerima versi yang
diterbitkan, bukan setiap commit di `main`.

**Terbitkan patch (penerbit):**

1. Pastikan `main` lulus CI dan sudah diuji di server sendiri.
2. `git tag v1.2.3 && git push origin v1.2.3`, atau cipta Release di GitHub/GitLab dengan tag
   baharu. Guna format `vMAJOR.MINOR.PATCH`; tag pra-keluaran seperti `v1.3.0-rc1` tidak
   ditawarkan kepada server organisasi.
3. CI membina dan menolak imej bertag `v1.2.3`. Monitor setiap server organisasi akan memaparkan
   **"Release v1.2.3 available"**, dan pentadbir mereka klik **Pull latest & deploy**.

Jika release mengubah `scripts/deploy.sh`, supervisor monitor atau konfigurasi base tier
(compose, Caddyfile, PgBouncer), monitor menyekat kemaskini sekali klik. Organisasi perlu
memasangnya secara manual: `git fetch --tags && git checkout v1.2.3 && bash scripts/deploy.sh`.
Elakkan perubahan begitu dalam patch biasa, atau nyatakan langkah ini dalam nota release.

**Server organisasi baharu:**

```bash
git clone --branch v1.2.3 <url-repo> usim_cms   # klon penuh, jangan --depth 1
cd usim_cms
sudo ./install.sh --mode=production
```

Installer mengesan checkout pada tag release dan menetapkan `UPDATE_CHANNEL=release` dalam
`/etc/ucms-monitor.env`. Pada soalan "Image registry path", masukkan registry penerbit (contoh
`ghcr.io/ictdothouse/usim_cms`) dan token baca sahaja yang diberi oleh penerbit.

Server penerbit sendiri kekal pada `UPDATE_CHANNEL=main` (lalai). Untuk menukar saluran, ubah
nilai itu dalam `/etc/ucms-monitor.env`, kemudian `sudo systemctl restart ucms-monitor`.

Jika repo atau registry peribadi, setiap organisasi perlukan akses baca sahaja: deploy key untuk
git dan token registry dengan skop baca. Sebaiknya satu token bagi setiap organisasi, supaya akses
boleh ditarik balik secara berasingan.

## CDN / WAF pilihan

Sistem tidak mengikat organisasi kepada produk CDN atau WAF tertentu. Selepas penyedia yang mematuhi polisi organisasi dipilih, Superadmin boleh membuka **Settings > CDN / WAF edge protection** dan mengisi nama penyedia serta senarai CIDR egress/proxy rasminya.

Sebelum mengaktifkan mod ini, pasukan rangkaian perlu mengehadkan firewall origin pada port 80/443 kepada rangkaian penyedia tersebut. CMS menyimpan audit perubahan dan menolak CIDR kepada Caddy supaya hanya proxy yang diluluskan boleh membekalkan IP pelawat kepada rate limit dan audit log. Sistem tidak mengubah firewall hos secara automatik.

Jika tiada CDN/WAF dibenarkan, biarkan mod ini dimatikan dan Caddy menggunakan IP sambungan terus seperti biasa.
