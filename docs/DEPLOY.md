# Deploy ke Server Node.js — Env & Langkah

Panduan ini untuk pemasangan manual. Untuk deployment disyorkan, gunakan `install.sh` (VPS) atau
`install-dev.mjs` (dev Docker) kerana kedua-duanya mengurus role DB, rahsia, dan Compose.
Prasyarat semasa: **Node.js 22**, **pnpm 12** (`corepack enable`), **PostgreSQL 16+**.

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

Env dibaca **semasa build** sahaja:

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

## CDN / WAF pilihan

Sistem tidak mengikat organisasi kepada produk CDN atau WAF tertentu. Selepas penyedia yang mematuhi polisi organisasi dipilih, Superadmin boleh membuka **Settings > CDN / WAF edge protection** dan mengisi nama penyedia serta senarai CIDR egress/proxy rasminya.

Sebelum mengaktifkan mod ini, pasukan rangkaian perlu mengehadkan firewall origin pada port 80/443 kepada rangkaian penyedia tersebut. CMS menyimpan audit perubahan dan menolak CIDR kepada Caddy supaya hanya proxy yang diluluskan boleh membekalkan IP pelawat kepada rate limit dan audit log. Sistem tidak mengubah firewall hos secara automatik.

Jika tiada CDN/WAF dibenarkan, biarkan mod ini dimatikan dan Caddy menggunakan IP sambungan terus seperti biasa.
