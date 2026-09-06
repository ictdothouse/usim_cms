# Proxy & DB Single-Point-of-Failure Options

## Context

Current stack (`docker-compose.yml`): `db` (Postgres) and `proxy` (Caddy) are each a
single instance. `restart: unless-stopped` + Docker healthchecks already auto-recover a
*crashed container* within seconds — what they do NOT cover: the whole VPS host going
down, disk failure, or a stuck/OOM-looping process that keeps restarting into the same
failure. If `proxy` or `db` is unreachable for either of those reasons, the public
frontend goes down (every page render depends on both).

Three options below, saved for later decision — none implemented yet.

## Option A — Cloudflare in front (external dependency)

DNS switched to Cloudflare proxied (orange-cloud) mode, "Always Online" + page caching
turned on.

- Pro: zero extra resource on the VPS, zero code change, covers static/cached pages
  during an outage.
- Con: introduces a 3rd-party dependency (traffic routes through an external company —
  may not fit USIM's data-sovereignty/compliance posture as a government institution);
  does not help uncached/dynamic pages during the outage; does nothing for `db` data
  safety.

## Option B — Warm standby DB replica, manual promote (self-hosted, low resource)

Postgres streaming replication (`primary_conninfo`/`hot_standby`) to a second, small
VPS. On primary failure: run the promote step (`pg_ctl promote` or trigger-file,
depending on Postgres version), point `DATABASE_URL` at the replica, restart `api`.

- Pro: fully self-hosted, low resource (one extra Postgres instance, can run on a small
  spec VPS), preserves data, much faster recovery than restoring from
  `apps/api/scripts/backup.sh`'s `pg_dump`.
- Con: not automatic — needs a person to run the promote step (a few minutes of
  downtime); does not address `proxy` going down.

## Option C — Self-standing active-passive HA pair, no 3rd party (recommended long-term)

Covers both `proxy` and `db`, fully self-hosted, using 2 VPS instead of any external
service.

1. **Proxy/app layer**: run Caddy (+ the app stack) on both VPS. Install `keepalived`
   (VRRP) between them — one floating/virtual IP that DNS points at. Primary VPS down,
   VRRP moves the floating IP to the secondary in ~1-3s, no DNS propagation wait.
   `keepalived` footprint is tiny (a few MB RAM, negligible CPU) — the lightest way to
   get real proxy redundancy without a 3rd party.
   - Caveat: if only `proxy` is duplicated but `api`/`frontend`/`db` still live solely on
     the primary VPS, a floating-IP failover only helps when the *proxy* itself
     crashes but the host is still up — it does not help when the whole primary VPS
     dies, since the secondary proxy still can't reach a dead host's api/db. Getting
     real whole-VPS redundancy means running the app stack active-passive on both
     boxes, which in turn requires the `db` to be replicated too (see below).

2. **DB layer**: same streaming-replica approach as Option B for now. A true automatic
   failover (`repmgr`) needs a 3-node quorum (including a witness) to safely avoid
   split-brain — heavier than a 2-node pair. For a 2-VPS setup, manual-promote (Option B)
   stays the practical choice; `repmgr` automatic failover is a later upgrade once a
   cheap witness-only 3rd node is available (it doesn't need to run full Postgres, just
   participate in quorum).

**Recommended long-term shape**: 2 VPS, active-passive, `keepalived` floating IP for the
proxy/app layer + Postgres streaming replica with manual promote for the db layer. Fully
self-standing (no Cloudflare/managed-service dependency), resource overhead is small
(`keepalived` + one extra Postgres replica). Automatic DB failover via `repmgr`
(3-node) is a documented future upgrade, not part of this baseline.

**Storage cost, unlike `keepalived` itself (negligible)**: the DB replica is a full copy
of every tenant database, and an active-passive app layer needs the `uploads` media
mirrored too (`apps/api/scripts/backup-media.sh`'s rsync approach, or continuous
replication) — so VPS2's disk must be sized close to VPS1's current DB size + media size,
not a small fraction of it. Existing tools already report both: the monitor dashboard's
"Sites" section (`GET /api/sites`) gives per-tenant uploads folder size, and
`pg_database_size` gives each tenant DB's size — sum those across tenants to size VPS2
before provisioning it. This is the real cost of Option C (a second VPS with comparable
disk), separate from Option D's snapshot cache, which is much smaller (rendered HTML +
referenced assets only, not a full DB/media mirror).

## Option D — Self-hosted "Always Online" via static snapshot fallback

Same effect as Cloudflare's "Always Online" (Option A), but self-hosted — no 3rd party,
reuses code that already exists in this repo.

1. **Snapshot generation**: `apps/api/src/backup.ts`'s `exportStaticSite` already renders
   every page/post through the live frontend and bundles HTML + assets (built for the
   site-clone/static-host handover feature). A cron job runs this periodically (e.g. every
   15-30 min, only while services are healthy) per tenant, writing to
   `static-cache/<tenantHost>/`.
2. **Automatic fallback**: `Caddyfile` gets a `handle_errors` block matching 502/503/504
   from the `reverse_proxy` to `frontend`/`api` — on error, Caddy serves the matching file
   from `static-cache/<host>/` via `file_server` (falls back to `index.html` if the exact
   path isn't cached). No app code runs to decide this — it's Caddy's own per-request
   error handling, so there's no "mode" to flip back: the next request that succeeds
   against `reverse_proxy` just goes live again automatically.
3. **Manual override (for incident response, e.g. defamatory content live)**: in addition
   to the automatic error-triggered fallback, add a switch on the monitor dashboard
   (`monitor/server.js`) — "Force static mode" — that rewrites/reloads Caddy to route a
   tenant (or all tenants) straight to `static-cache/` regardless of backend health. Use
   case: something defamatory or otherwise legally risky gets published live and needs to
   go dark on the PUBLIC site immediately while it's investigated/removed from the DB,
   without shutting down `admin`/`api` entirely (staff still need to log in and fix it).
   Same basic-auth gate as every other monitor route; toggling off returns to normal
   live-first-then-fallback behavior.

Covers the `db`-down and `api`-down fears directly: if `db` dies, `frontend`'s SSR fetch to
`api` fails, Caddy's `handle_errors` catches it, public still sees the last-known-good
snapshot. Does not help if `proxy` (Caddy) itself is down (still needs Option C for that
layer). Content is only as fresh as the last successful snapshot — acceptable for
"public can still read something" during an outage, not a substitute for real data
durability.

## Option E — Single-VPS hardening (applied 2026-09-06)

No 2nd VPS, no new dependency — just harden the existing single-instance `db`/`proxy`
against the most common real-world down-causes, so the container-level self-heal
(`restart: unless-stopped` + healthcheck) actually gets to do its job instead of the
whole host destabilizing first.

- **OOM protection, every service**: every container across `docker-compose.yml`
  (`db`, `proxy`, `pgbouncer`, `redis`) and `docker-compose.release.yml`
  (`api`, `frontend`, `admin`) now carries a `mem_limit: ${..._MEM_LIMIT:-default}`.
  Without a limit, a memory spike anywhere on the box lets Linux's OOM-killer pick any
  process at random. A bounded container instead hits its own ceiling and gets a clean,
  predictable restart (already auto-recovered by `restart: unless-stopped` + each
  service's healthcheck). Defaults (`DB_MEM_LIMIT=1g`, `PROXY_MEM_LIMIT=256m`,
  `PGBOUNCER_MEM_LIMIT=128m`, `REDIS_MEM_LIMIT=256m`, `API_MEM_LIMIT=512m`,
  `FRONTEND_MEM_LIMIT=512m`, `ADMIN_MEM_LIMIT=128m`) are conservative for a small/trial
  box — raise whichever one in `.env` once real tenant count/traffic needs more.
- **Survives a host reboot**: already covered — `install.sh` runs
  `systemctl enable --now docker` in both docker-mode and bare-metal-mode install paths,
  so a power blip/reboot brings Docker back up on its own and every `unless-stopped`
  container restarts with it. No change needed here, just confirmed.
- **Disk-full protection**: already covered by `monitor/server.js`'s
  `ALERT_DISK_THRESHOLD_PCT` webhook alert (Option list above) — disk filling up (WAL
  growth, uploads) is a common real cause of Postgres/Caddy refusing to start.
- **Monitor dashboard button**: `monitor/server.js` gained "Apply base-tier config
  (db/proxy/pgbouncer/redis)" — `POST /api/base/apply`, docker-mode only, same
  job-runner convention as the existing Rollback button (`deployState`/`DEPLOY_LOG`,
  detached + pollable). Runs `git fetch origin && git reset --hard origin/main` then
  `docker compose up -d db proxy pgbouncer redis` — `up -d` only recreates a container
  whose own config actually drifted, so this is safe to click any time, not just right
  after a base-tier compose change. Deliberately a SEPARATE button from "Pull latest &
  deploy", not folded into it: that button (`handlePull`/`scripts/deploy.sh`) must stay
  zero-downtime for ordinary api/frontend/admin-only changes, so it never touches base
  tier — this new button is the one-off, deliberate action for when
  `docker-compose.yml` itself changed.
- Deliberately NOT covered here (still needs Option C): the VPS host itself dying
  (hardware/power/network at the provider level) — no amount of single-box hardening
  answers that, it always needs a second machine.

## Status

Option E applied (`docker-compose.yml` mem limits + `.env.example` docs, 2026-09-06).
Options A-D remain saved for later decision — none implemented. Revisit C/D once a
choice is confirmed (with the boss) or resourcing (2nd/3rd VPS) is available.
