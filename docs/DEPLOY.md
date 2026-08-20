# Deploy ke Server Node.js — Env & Langkah

Prasyarat server: **Node.js 20.6+** (perlu `--env-file`), **pnpm** (`corepack enable`),
**PostgreSQL 14+**. Tiga proses berasingan: API (Fastify), Frontend (Astro SSR), Admin (fail statik).

## 1. apps/api (port 3000)

Fail env: `apps/api/.env` (salin dari `.env.example`).

| Env | Wajib | Nilai |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgres://usim_cms_app:<katalaluan>@<host>:5432/usim_cms` — **mesti role `usim_cms_app`**, bukan superuser (RLS jadi no-op bawah superuser) |
| `SESSION_SECRET` | ✅ | Rentetan rawak panjang, cth. `openssl rand -hex 32`. Tanpa ini token login guna default dev yang tidak selamat |
| `PORT` | ❌ | Default `3000` |
| `STORAGE_DRIVER` | ❌ | `local` (default, tulis ke `apps/api/uploads/`) atau `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL_BASE` | jika `s3` | Mana-mana storan serasi S3 (AWS/MinIO/Sangfor) |

Setup DB kali pertama (sekali sahaja, sambung sebagai superuser dulu):

```bash
# .env sementara guna DATABASE_URL superuser
pnpm --filter @ucms/api db:setup-role
# kemudian tukar DATABASE_URL ke role usim_cms_app yang dicipta
pnpm --filter @ucms/api tenant:add   # daftar host jabatan
pnpm --filter @ucms/api user:add     # cipta superadmin/webmaster
```

Jalankan:

```bash
pnpm install
pnpm --filter @ucms/api build   # salin migrations .sql ke dist sekali
pnpm --filter @ucms/api start   # node --env-file=.env dist/index.js
```

Migration tenant di-replay automatik pada permintaan pertama setiap tenant — tiada langkah migrate manual.

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
- CORS API masih `origin: true` (terbuka) — kunci ke domain admin sebenar dalam `apps/api/src/index.ts` sebelum production sebenar.
- `STORAGE_DRIVER=local`: pastikan folder `apps/api/uploads/` wujud & boleh tulis; ia dihidang pada `/uploads/`.
