---
name: deployment
description: Deployment, infra, and ops reference for usim_cms — docker-compose services (pgbouncer, redis, proxy/Caddy), backup/restore, install.sh (VPS/local-dev installers), blue-green zero-downtime deploys, nginx/certbot SSL, and the monitor dashboard. Use when working on deployment configs, docker-compose files, install scripts, the Caddyfile, scripts/deploy.sh, or monitor/server.js.
---

- `docker-compose.yml` runs the whole stack: `db` (Postgres, runs
  `scripts/setup-db-role.sql` once via `docker-entrypoint-initdb.d` to create the
  `usim_cms_app` role), `api`, `frontend`, `admin` (static SPA served by nginx inside its
  own image, see `apps/admin/Dockerfile`), and `proxy`. Each service has a healthcheck;
  `depends_on: condition: service_healthy` sequences the startup order.
- **`pgbouncer`** (`docker-compose.yml`, always-on alongside `db`/`proxy`) sits between every
  `api` replica and Postgres — architecture-review fix for connection-pool blowup: without it,
  total backend connections scale as `(control pool × replicas) + (tenant pool × tenants ×
  replicas)` (e.g. 3 replicas × 10 tenants ≈ 210 connections). Every replica's node-pg pool now
  talks to `pgbouncer:6432` instead of `db:5432` directly (`docker-compose.release.yml`'s `api`
  service `DATABASE_URL`; `tenant-pool.ts`'s `deriveTenantDbUrl` only swaps the dbname on top of
  that URL, so every tenant pool is routed through it too, no code change needed there) —
  replicas now share one backend pool per database instead of each keeping its own, removing the
  `× replicas` multiplier. Config: `./pgbouncer/pgbouncer.ini` + `./pgbouncer/userlist.txt`. A
  wildcard `* = host=db port=5432 ...` database entry forwards whatever dbname a client requests
  unchanged, so a newly-provisioned tenant database needs zero pgbouncer config changes.
  **`pool_mode = session`, deliberately not `transaction`**: `plugins/tenant.ts`/`plugins/auth.ts`
  issue `SET SESSION app.authenticated = ...` per request to drive the pages/posts RLS policies;
  transaction-mode pooling only resets session state between transactions when
  `server_reset_query_always` is on (off by default), so without session mode a `SET SESSION`
  value could leak onto a later, unrelated client's transaction sharing the same backend
  connection — a real cross-tenant RLS-bypass risk, not just a performance footgun. Session mode
  ties one backend connection to one client for its whole session, matching how `apps/api`
  already holds one pooled client per request. Caveat: PgBouncer's `max_db_connections`/
  `default_pool_size` cap applies **per distinct dbname**, even under one wildcard entry — it is
  not a single shared budget across every tenant, so the true global cap is still
  `default_pool_size × concurrent-active tenant databases`, which must stay under Postgres's own
  `max_connections` (tune both together; this is what Fasa 1's "document the connection budget"
  recommendation resolves to in practice). `scripts/deploy.sh`'s base-tier line
  (`docker compose up -d db pgbouncer redis proxy`) must keep listing `pgbouncer`/`redis`
  explicitly — an explicit service list doesn't pick up a newly added compose service on its own.
  **Real auth, not `auth_type = trust`** (a security-audit finding: the wildcard `[databases]`
  entry used to embed a literal hardcoded password and `auth_type = trust` meant PgBouncer never
  checked a connecting client's password at all). `POSTGRES_APP_PASSWORD` (`.env`) is the single
  source of truth: the `db` container's own `docker-entrypoint-initdb.d/02-rotate-db-role-
  password.sh` (runs right after `setup-db-role.sql`, same first-boot-only pass) forces
  `usim_cms_app`'s password into classic **md5** storage (`SET password_encryption = 'md5'`, not
  Postgres 16's `scram-sha-256` default) from that env var, and `db`'s own
  `POSTGRES_HOST_AUTH_METHOD=md5` makes Postgres demand md5 over the network to match. `install.sh`'s
  `write_pgbouncer_userlist()` independently computes the same `md5(password + role)` hash from the
  identical env var and writes it to `pgbouncer/userlist.txt` (git-ignored — see
  `pgbouncer/userlist.txt.example` — generated fresh on every production-mode install/re-run,
  before `pgbouncer` first starts). `pgbouncer.ini`'s `[databases]` line now has no `password=`
  field at all — PgBouncer falls back to this same `auth_file` entry to authenticate the *backend*
  leg to Postgres too, not just the incoming client (`auth_type = md5`) — verified locally by
  spinning up `db`+`pgbouncer` with a test password: correct password connects, a wrong one gets a
  real `FATAL: password authentication failed`. **This only rotates a FRESH install's role** —
  `docker-entrypoint-initdb.d` scripts never re-run against an existing data volume, so an
  already-deployed instance's live password rotation is still a supervised, by-hand step (rotate
  `.env`'s `POSTGRES_APP_PASSWORD`, `docker compose exec db psql -U postgres -c "SET
  password_encryption='md5'; ALTER ROLE usim_cms_app WITH PASSWORD '...';"`, re-run
  `write_pgbouncer_userlist` — or its one-liner equivalent — then restart `pgbouncer` and `api`).
  Two gotchas hit doing this live (both fixed, but worth knowing for the next already-deployed
  instance): (1) `userlist.txt` must be `chown 0:70` (edoburu/pgbouncer's container runs as uid:gid
  **70:70**, not root, not whatever host user wrote the file) + `chmod 640` — `600` alone gets
  `could not open auth_file ...: Permission denied` on pgbouncer boot, and plain `644` is
  needlessly world-readable for a credential file when the right gid is one `chown` away; (2) an
  already-initialized volume's `pg_hba.conf` was written at that instance's ORIGINAL first boot,
  before this fix existed — if its host rule still says `scram-sha-256` (Postgres 16's default)
  instead of `md5`, forcing the role's password into md5 storage while `pg_hba` demands SCRAM
  produces the exact same generic `FATAL: password authentication failed` as a wrong password.
  Check with `docker compose exec db grep -Ev '^\s*#|^\s*$' /var/lib/postgresql/data/pg_hba.conf`;
  fix live, no reinit/restart needed: `docker compose exec db sed -i 's/^host all all all
  scram-sha-256/host all all all md5/' /var/lib/postgresql/data/pg_hba.conf` then `docker compose
  exec db psql -U postgres -c "SELECT pg_reload_conf();"`.
- **Connection budget, with real numbers** (Fasa 1's "dokumentasikan max_connections dan resource
  requirement" — the one open item left in the architecture audit's phased roadmap). Nothing here
  overrides Postgres's own config, so today's actual ceiling is the stock `postgres:16-alpine`
  default: `max_connections = 100`, `superuser_reserved_connections = 3` → **97 usable backend
  slots**. PgBouncer's per-dbname cap is `default_pool_size (8) + reserve_pool_size (2) = 10`
  backend connections once a dbname is genuinely busy (reserve only kicks in after
  `reserve_pool_timeout`). The control-plane dbname (`usim_cms`) counts as one such dbname on its
  own, same as any tenant. Worst case — control plane plus every simultaneously-busy tenant dbname
  each pinned at their 10-connection ceiling — is `10 + 10×N ≤ 97`, i.e. **N ≈ 8 tenant databases
  can be fully saturated at once** before Postgres itself runs out of backend slots. Past that,
  PgBouncer does not error (`max_client_conn = 500` still accepts the client) — it queues the
  request until a backend connection frees up, so the real symptom is added latency on the 9th+
  simultaneously-hot tenant, not a hard failure. At the ~100-tenant scale this project is aiming
  for (see the multi-VPS/Compose-replica scaling notes), a rare all-tenants-busy-at-once spike
  queues; the common case (a handful of departments getting real traffic at the same moment) stays
  well under 8. **If a higher simultaneous-hot-tenant ceiling is ever needed**: raise Postgres's
  `max_connections` (e.g. a mounted `postgresql.conf` override or `command: postgres -c
  max_connections=200` on the `db` service) — check `DB_MEM_LIMIT` (default `1g`) has headroom
  first, each extra connection costs a small fixed amount of backend memory — and/or lower
  `default_pool_size` per tenant if most tenants are low-traffic and only a few need the full 8.
  Not changed here: this is a documented number and a one-line lever, not a "the current default is
  wrong" fix — nobody has reported it actually queuing in production yet.
- **`redis`** (`docker-compose.yml`, always-on alongside `db`/`pgbouncer`/`proxy`) is a shared
  cache for public (anonymous) GETs — `apps/api/src/cache.ts`'s `cacheGet`/`cacheSet`/
  `cacheInvalidate`, wired into `generic-crud.ts`'s public list/`:id` routes (pages/posts/
  categories/menus) and `GET`/`PUT /api/theme` in `index.ts`. Architecture-review fix, distinct
  from `apps/frontend`'s own `lib/api.ts` `Map`: that one is a per-process stale-while-revalidate
  FALLBACK (only consulted after a live fetch already threw) and shares nothing across
  replicas/blue-green colors, so it gives zero real load reduction under more than one instance.
  This one is read on every anonymous request and is a real Redis instance shared by every
  replica/color, so it actually cuts DB load as the api scales out. Cache key is
  `ucms:cache:{tenantHost}:{collectionSlug}:list:{querystring}` /
  `...:item:{id}` / `...:theme` (60s TTL); any request carrying an `Authorization` header
  (even an invalid one, since it may elevate draft/preview visibility — see
  `elevateIfAuthenticated`) skips the cache entirely on both read and write paths, same
  token-bearing exclusion `apps/frontend`'s own cache already uses. Invalidation is coarse —
  any create/update/delete on a collection (or `PUT /api/theme`) drops every cached key under
  that tenant+collection prefix via `KEYS`+`DEL`, not a single row, since a write can't cheaply
  know every cached query-string permutation (`?tag=`/`?from=`/`?status=`/etc) it might have
  affected; the 60s TTL is the backstop if an invalidation call is ever missed. `REDIS_URL`
  unset (default) makes every `cache.ts` function a no-op — a single-instance/local-dev deploy
  needs nothing, same opt-in shape as `pgbouncer`. No persisted volume — losing the cache on
  restart just means a cold refill, never data loss.
- **Frontend rendered-HTML cache** (`apps/frontend/src/lib/html-cache.ts` + `middleware.ts`) — the
  SAME `redis` instance, a sibling keyspace (`ucms:htmlcache:{tenantHost}:{pathname}{search}`),
  closing the gap the bullet above never covered: that cache only ever held JSON API responses,
  Astro's SSR render itself still ran on every request. `docker-compose.release.yml`'s `frontend`
  service needs its own `REDIS_URL: redis://redis:6379` line for this to activate (added alongside
  `api`'s existing one) — unset, same as `cache.ts`, is a silent no-op. Skipped entirely for a
  non-GET request, a maintenance-bypass admin, or any `token`/`themeToken`/`designerEdit` query
  param (preview/theme-preview/Live-Edit all ride one of those) — see `middleware.ts`'s
  `cacheEligible`. Invalidated by `apps/api` itself: every `generic-crud.ts` create/update/delete,
  `PUT /api/theme`, and `PUT /api/tenant-languages` additionally calls `cacheInvalidate` against
  this `ucms:htmlcache:` prefix (same function, different prefix, same Redis instance) — a whole
  tenant's cache drops on any of those writes rather than trying to compute which pages a menu/
  theme/header-footer change actually touched; 60s TTL is the same backstop as the JSON cache.
- `proxy` (`caddy:2-alpine`, config in `./Caddyfile`) is the public-facing reverse proxy
  and TLS terminator. Default behavior: automatic Let's Encrypt issuance/renewal for
  every domain in `ADMIN_DOMAIN`/`API_DOMAIN`/`TENANT_DOMAINS` (`.env.example`) — no
  manual cert steps. `TENANT_DOMAINS` needs a live tenant's host added to it (and the
  container restarted) before that department's site is reachable through the proxy —
  **unless** the superadmin has turned on the "Domain & SSL Automation" switch in the
  admin's Settings tab (off by default, see
  `docs/superpowers/specs/2026-08-12-tenant-domain-ssl-automation-design.md`), in which
  case every tenant create/delete automatically wires (or unwires) that host into Caddy's
  live config via its Admin API (`apps/api/src/proxy-sync.ts`) — no `.env` edit, no
  restart. That switch also accepts a paid/custom certificate per domain (USIM's ICT
  centre's own cert, uploaded through the same card) in place of Caddy's automatic Let's
  Encrypt for that host — the old manual "swap the `Caddyfile` site block to `tls <cert>
  <key>` and mount `./certs`" flow remains the documented path for anyone who leaves the
  switch off. This automation only ever applies to the docker-mode Caddy setup — bare-
  metal install mode has no reverse-proxy/TLS layer at all, and local dev has no proxy
  either; both are untouched by this switch.
- **Single-VPS proxy resilience** (no second node/floating IP — that's the next tier up,
  deliberately out of scope until a real multi-VPS/HA rollout is decided): three gaps
  closed together, since `restart: unless-stopped` alone only fires when a container
  actually **exits** — a Caddy process that's still running but wedged (deadlocked, config
  gone stale) never trips it and would sit reported "up" forever. (1) `proxy` now has a
  real healthcheck (`wget --spider` against Caddy's own admin API, `:2019/config/`) —
  `docker-compose.yml`. (2) `monitor/server.js`'s `pollForAlerts` (already polling every
  `ALERT_POLL_INTERVAL_MS`) now attempts one automatic `docker compose restart <service>`
  the moment any docker-mode service (not just `proxy`) is seen down/unhealthy, cleared the
  instant it's next seen up — one attempt per outage, not a retry loop, so a genuinely
  broken config (bad Caddyfile edit) doesn't get restarted forever; same one-shot
  philosophy as `install.sh`'s own `ensure_reachable_or_selfheal`. Fixed a real blind spot
  in the same pass: `docker compose ps` reports an unhealthy container's state as "running
  (**un**healthy)", which the old `/healthy/i` regex also matched as a substring — silently
  treating a failing healthcheck as "up". (3) `install.sh`'s `ensure_docker_live_restore`
  writes `/etc/docker/daemon.json` (`{"live-restore": true}`) so containers keep serving
  traffic across a dockerd restart/crash/package-upgrade instead of being killed and
  waiting for dockerd to come back — called from both docker-mode and production-mode
  install, idempotent, and leaves an existing non-empty `daemon.json` alone rather than
  risk clobbering an unrelated setting (e.g. a registry mirror) with a hand-rolled JSON
  merge. **Caveat for an already-deployed instance**: (1) and (2) ship as ordinary app code
  and reach a live box through "Pull latest & deploy" like anything else in `apps/api`/
  `monitor` — but (3) is host-level provisioning, and `scripts/deploy.sh`'s blue-green flow
  only ever touches the app tier (`api`/`frontend`/`admin`), never the base tier
  (`db`/`pgbouncer`/`redis`/`proxy`) or the Docker daemon itself — so an already-live VPS
  needs `docker compose up -d proxy` once (to pick up the new healthcheck) and either a
  re-run of `install.sh` (safe, idempotent) or the `daemon.json` + `systemctl restart
  docker` above done by hand, to actually get the live-restore hardening. None of this
  protects against the VPS itself (or its host/network) going down — that's the real
  single point of failure still open; closing it needs a second node (floating IP/
  keepalived, DNS multi-A-record failover, or a dedicated load balancer in front — see the
  paused multi-VPS/HA rollout brainstorm) and is a deliberate cost/complexity tradeoff, not
  an oversight.
- Tenant backup/restore/migration is `apps/api/src/backup.ts`, not `pg_dump`: JSON dump
  of a tenant's rows + its local uploads, zipped — restores across Postgres versions and
  onto a different server/host (rewrites `/uploads/<host>/` references on cross-host
  restore, which is how the admin's site-clone feature works). `exportStaticSite` renders
  every page/post through the real running frontend and bundles the HTML + assets for a
  static-host handover.
- `apps/api/scripts/backup.sh` is the instance-level counterpart: `pg_dump` (whole
  control-plane + tenant DBs, or a specific tenant's schema by host), meant to run on a
  cron job (`RETENTION_DAYS` prunes old dumps, defaults 14).
- **`apps/api/scripts/backup-media.sh`** — the filesystem-level counterpart, for the
  uploads themselves (large-media tenants where `backup.ts`'s in-memory zip export isn't
  practical — see `MAX_LOCAL_MEDIA_BACKUP_BYTES` in `backup.ts`). No object storage, no
  extra dependency: `rsync -a --delete --link-dest=<previous>` mirrors each tenant's
  `uploads/<tenantFolder>/` into `BACKUP_DIR/media/<tenantFolder>/<timestamp>/` — unchanged
  files are hardlinked against the prior snapshot (near-zero extra disk per run), a `latest`
  symlink always points at the newest one, and `RETENTION_DAYS` (same convention as
  `backup.sh`) prunes old snapshot dirs. Docker mode resolves the named `ucms-uploads`
  volume's real host path via `docker volume inspect` automatically; bare-metal/local-dev
  sets `UPLOADS_DIR=apps/api/uploads` directly. Restore is a plain `rsync -a --delete
  .../latest/ uploads/<tenantFolder>/`; migrating a tenant to a new server is the same
  `rsync` pointed at `newhost:` instead — no app code involved either way, meant for a cron
  job (`0 2 * * *`) same as `backup.sh`, not wired into `install.sh` (opt-in, same as
  `backup.sh` itself). **Multi-VPS fleet (one department's usim_cms per VPS, each with a
  small local disk)**: a backup written back onto the same disk it's protecting doesn't
  survive that disk filling up or the VPS dying — set `SOURCE_HOST=user@app-vps-ip` to run
  the script in pull mode from a separate backup box instead (plain SSH, no new
  dependency), an explicit tenant-host list required (no remote directory listing).
- `install.sh` (one-shot VPS installer, docker or bare-metal mode) prompts for a
  superadmin email/password up front and, once its mode's stack is verified reachable,
  POSTs them straight to the running API's own `POST /api/setup` (`apps/api/src/index.ts`'s
  self-disabling first-run route — refuses once any user row exists) via a `create_superadmin`
  helper — so the very first login works without depending on the admin UI ever reaching
  the API from a browser first. `--admin-only` skips the whole install and just re-runs
  this step against an already-installed stack (reads the API port back out of `.env`'s
  `API_PORT` for docker mode or `apps/api/.env`'s `PORT` for bare-metal, rather than
  re-picking a free one). `--admin-email=`/`--admin-password=` (or `SUPERADMIN_EMAIL`/
  `SUPERADMIN_PASSWORD` env vars) supply these non-interactively; a non-interactive run
  with neither set is a hard error, same as an unset `SESSION_SECRET` elsewhere in the
  script.
  **Multi-distro + reachability hardening** (see
  `docs/superpowers/specs/2026-08-12-installer-hardening-design.md`): `detect_os_family()`
  reads `/etc/os-release` and sets `PKG_MGR`/`FIREWALL_TOOL` (`apt`/`ufw` for Debian-family,
  `dnf`/`firewalld` for RHEL-family — AlmaLinux/Rocky/RHEL/CentOS Stream — hard error on
  anything else rather than silently guessing `apt`), used by `pkg_install()` and
  `open_firewall_ports()` (renamed from `open_ufw_ports`); `ensure_postgres` installs
  `postgresql-server` + runs `postgresql-setup --initdb` on RHEL-family, since unlike
  Debian's `postgresql` package it doesn't auto-initialize its data directory. Both modes
  now call `ensure_reachable_or_selfheal` right after starting the stack instead of a bare
  "poll /health, assume done" loop: `verify_external_reachability` hits the API/admin/
  frontend published ports the same way a real browser would (`wait_for_api_health` for
  the API's own 200, `curl_reachable`'s any-HTTP-response-means-reachable check for the
  other two) — this is the fix for two real bugs hit in the same live session that a purely
  in-container/in-process healthcheck can't see: an app bound to Fastify's default
  `127.0.0.1` (unreachable from the host's `docker-proxy`/NAT even though its own
  healthcheck, run from the same network namespace, looked fine) and Docker's own iptables
  chains resetting forwarded connections after `docker-proxy` already accepted them. On
  failure it runs `diagnose_reachability` (dumps `docker compose ps`/`ss -ltnp`/`iptables -L
  FORWARD` or the systemd unit status), tries exactly one self-heal (`systemctl restart
  docker` in docker mode, a service restart in bare-metal mode), re-verifies once, and on a
  second failure aborts **without** printing the "Done" success banner — the previous loop
  printed it unconditionally regardless of whether anything actually answered. `--diagnose`
  reruns just `verify_external_reachability`/`diagnose_reachability` (no self-heal, no
  credential prompt) against an already-running stack via the same `resolve_running_ports`
  helper `--admin-only` uses (extended to also resolve `ADMIN_PORT`/`FRONTEND_PORT`, from
  `.env` for docker mode or `/etc/ucms-monitor.env` for bare-metal) — meant to replace a
  manual `curl`/`ss`/`iptables` debugging session with one command.
- **`docker-compose.trial.yml`** — install.sh's docker-mode trial flow only. When
  `docker-compose.yml` was split for blue-green (below), `api`/`frontend`/`admin` moved out
  of it entirely, which silently broke install.sh's original `docker compose up -d --build
  db api frontend admin` (those services no longer exist in that file alone). Rather than
  rearchitect the proven, incident-hardened trial/reachability-check flow above to route
  through Caddy from install time, this file restores the original pre-split shape (one
  container each, host-published `API_PORT`/`FRONTEND_PORT`/`ADMIN_PORT`, no Caddy) as a
  second compose file merged in via `-f`: `docker compose -f docker-compose.yml -f
  docker-compose.trial.yml up -d --build db api frontend admin`. `ensure_reachable_or_
  selfheal`'s self-heal step and `diagnose_reachability`'s `docker compose ps` both branch
  on whether `.deploy-color` exists (a go-live box that's adopted `scripts/deploy.sh`) to
  avoid fighting the blue/green containers for the same host ports. Superseded the moment a
  box goes live (see "Blue-green zero-downtime deploys" below) — never touched again after
  that.
- `install-dev.mjs` is the LOCAL-DEV counterpart — `node install-dev.mjs`, same command on
  Mac/Windows/Linux, Docker-only (no bare-metal path: Docker Desktop is assumed, so there's
  no 3-different-OS systemd-equivalent to maintain). Mirrors `install.sh`'s docker mode
  (same `.env` keys, same `/api/setup` flow, same `--admin-only`/`--diagnose` flags, same
  "verify reachability before declaring success" philosophy via Node's global `fetch`
  instead of `curl`) but drops everything VPS-only: no public-IP detection (always
  `localhost`), no systemd/monitor/firewall/proxy/cert work, and no iptables diagnostics in
  `--diagnose` (Docker Desktop's own networking backend doesn't hit the iptables-FORWARD
  class of bug `install.sh` diagnoses — only `docker compose ps` output). Uses
  `execFileSync` with argv arrays (never a shell string) for every Docker CLI call.
- Basic alerting is implemented in `monitor/server.js`, opt-in via `ALERT_WEBHOOK_URL` (unset = no-op,
  same convention as `REDIS_URL`/PgBouncer): a `setInterval` poll (`ALERT_POLL_INTERVAL_MS`, default 60s)
  reads the same `getStatus()` the dashboard itself renders from and edge-triggers a plain JSON webhook
  POST (`{text, content}` — works unconfigured with a Slack/Discord/Teams incoming webhook, or a custom
  endpoint) whenever a monitored service (db/api/frontend/admin) flips up↔down, or disk usage (same `df`
  read `getHostStats` already does for the dashboard) crosses `ALERT_DISK_THRESHOLD_PCT` (default 85) —
  edge-triggered the same way, once on crossing, once again dropping back under, never on every poll
  while it stays over. `POST /api/alerts/test` (same basic-auth as every other monitor route) fires a
  one-off test message to verify wiring without waiting for a real outage. Deliberately no email/SMTP
  client — this file's whole point is staying dependency-free (`node monitor/server.js`, no `npm
  install`), and a webhook covers the same "someone gets pinged" need without one. Still a gap: no real
  metrics/dashboards (CPU/memory/request-rate time series) — this is up/down + disk-threshold alerting
  only, `restart: unless-stopped` + compose healthchecks still do the actual crash-recovery; revisit
  with a real metrics stack if/when the instance carries enough tenants that this coarse a signal stops
  being enough.
- **Update notifications** (`GET /api/update-check`, dashboard's yellow banner above the button row):
  a background `git fetch origin main` (`UPDATE_CHECK_INTERVAL_MS`, default 30 min) compares HEAD
  against `origin/main` — any green-CI'd merge to main (a Dependabot bump from `.github/
  dependabot.yml` included, once its PR is merged) shows up here the moment it lands, no GitHub
  token/API call needed. Edge-triggered on the remote SHA the same way the up/down and disk alerts
  above are (`pollForUpdateAlert`, fires once per new HEAD, not every poll) and piggybacks the same
  `ALERT_WEBHOOK_URL` — so a real push notification (Slack/Discord/etc) needs no separate wiring, just
  that webhook already being set. The dashboard banner itself needs no webhook — `GET /api/update-check`
  is called on load + every 5 min regardless. There is no separate "safe to update?"/"will this cause
  downtime?" check beyond what already exists: clicking "Pull latest & deploy" runs the exact same
  `git pull` → build → test-gate → health-check → promote (docker mode: `scripts/deploy.sh`) flow this
  file documents above, which already aborts before touching the live color on a failed build/test/
  health-check, and "Rollback" already flips back to the previously-live color with no rebuild — this
  feature only adds the "something changed, go look" signal, it doesn't change what clicking Update does.
  **Postgres is the one exception**: `.github/dependabot.yml`'s `docker-compose` ecosystem entry
  `ignore`s major-version bumps for the `postgres` image specifically — a major bump PR would look
  exactly as routine as any other image-tag bump here, but merging + redeploying it blind crash-loops
  `db` (the image refuses to start against an old-format data directory) since neither this update-
  check flow nor `scripts/deploy.sh` migrates the volume; a real major upgrade needs a deliberate
  backup (`apps/api/scripts/backup.sh`) + `pg_upgrade`/dump-restore pass first. Minor/patch Postgres
  bumps (same on-disk format) still show up and flow through normally — same base-tier caveat as
  below (needs `docker compose pull db && docker compose up -d db` by hand, "Pull latest & deploy"
  doesn't touch base tier).
- **`GET /api/sites`** (dashboard's "Sites" section) — per-tenant uploads folder size, one `du -sb` per
  top-level folder under the uploads dir (docker mode auto-resolves the named `ucms-uploads` volume's
  real host path via `docker volume inspect`; bare-metal defaults to `apps/api/uploads`; `UPLOADS_DIR`
  overrides either — same env var `apps/api/scripts/backup-media.sh` reads). Folder names are the
  `tenantFolder()` slug (`index.ts`'s `host.toLowerCase().replace(/[^a-z0-9]/g,"_")`), not the real
  hostname — this process has no DB access to translate it back, same trust boundary as the backup
  script.

### Blue-green zero-downtime deploys (docker mode only)

Built for the ~100-tenant department/faculty rollout: `docker-compose.yml` now holds only
`db`+`proxy` (the always-on "base"); `api`/`frontend`/`admin` moved to
`docker-compose.release.yml`, started under an explicit `-p ucms-blue`/`-p ucms-green`
project name so two colors can run side by side. `scripts/deploy.sh` drives the whole
cycle: reads `.deploy-color` (repo root) for the currently-live color, builds+starts the
OTHER one (`--scale api=$API_REPLICAS` etc, default 1 each — see `.env.example`), polls
each new container's real Docker healthcheck (`docker inspect`'s `.State.Health.Status`;
a service with no HEALTHCHECK, like `admin`, just needs `.State.Running`) up to 90s, and
only once every container is healthy does it POST to `POST /internal/deploy/promote` —
which flips Caddy's live routes to the new color, atomically, via the exact same
`syncCaddy`/`buildCaddyConfig` (`apps/api/src/proxy-sync.ts`) the tenant-domain-automation
feature already used. Only then is `.deploy-color` updated and the OLD color torn down.
Any failure before promote succeeds leaves the previously-live color completely untouched
(zero impact) and tears down just the failed new color — safe to re-run.
- `buildCaddyConfig(tenants, upstreams?)` gained an optional `CaddyUpstreams` param
  (`{admin?, api?, frontend?}`, each an array of `host:port` dial strings) — omitted, it
  falls back to the single-container dial targets (`ADMIN_UPSTREAM`/`API_UPSTREAM`/
  `FRONTEND_UPSTREAM` env vars, defaulting to the plain `admin:80`/`api:3000`/
  `frontend:4321` names) for anyone running the old-style single-stack setup without
  blue-green. A blue-green/scaled deploy instead passes every live replica's own
  Compose-generated container name (`ucms-green-api-1`, `-2`, ...) — Caddy fans out
  (round-robins) across all of them. Each `reverse_proxy` handler also carries a real
  active `health_checks` block (`/health` for api/frontend, `/` for admin's static SPA,
  10s interval) — added 2026-09-10, since Docker's own HEALTHCHECK only gates whether a
  replica is included at PROMOTE time; without Caddy's own active check, a replica that
  crashed mid-operation (between deploys) kept receiving live traffic until the next
  deploy overwrote the config. This is the actual "one replica crashing doesn't affect
  the others" fault isolation, now real at Caddy's live-serving layer too.
- **Branded uploads, no `api.<domain>` leak** (fix, not part of the original blue-green
  work above): `buildCaddyConfig` now emits TWO routes per tenant — a `{host, path:
  ["/uploads/*"]}` match to the api upstream, listed BEFORE the plain `{host}` match to
  the frontend upstream (Caddy evaluates routes in list order and `reverse_proxy` is
  terminal, so the more specific one must come first or it's dead code) — mirrored in
  the static `Caddyfile`'s tenant block as a `handle /uploads/*` / `handle {}` pair. Before
  this, an uploaded image's only reachable URL was `api.<domain>/uploads/...` — this
  instance's own internal api-container hostname, visible to every site visitor,
  reading as an infrastructure leak rather than the tenant's own branded site. Now a
  tenant's own domain serves its own uploads too (same api container, same files, just
  proxied under the hostname a visitor is actually looking at). The other half of this
  fix is client-side: `apps/admin/src/lib/api.ts`'s `publicMediaBase(tenantHost)` is what
  every media-persisting write path (Designer's image upload, MediaPickerModal, the
  post-body BlockNote image uploader, ThemeForm's per-site logo/favicon) now bakes into
  a SAVED url instead of `API_URL` — falls back to `API_URL` only in `import.meta.env.DEV`
  (`pnpm dev:admin` has no Caddy in front). Every on-screen ADMIN preview (MediaManager's
  grid, MediaPickerModal's grid, the "copy URL" clipboard action) is unaffected by this —
  those still fetch straight from `API_URL`, since that's the admin app's own internal
  concern, not something a site visitor ever sees. One accepted gap, not solved here: the
  instance-wide Global Theme default logo/favicon (no single tenant to derive a domain
  from) still bakes in `API_URL` — a real per-site Theme override always gets the
  branded URL, which is the common path. Existing already-uploaded media keeps its old
  `api.<domain>/...` URL (never rewritten retroactively) — only new uploads/saves after
  this fix get the branded URL. Local-disk storage is what this fixes; `STORAGE_DRIVER=s3`
  with `S3_PUBLIC_URL_BASE` pointed at a real CDN domain (see storage.ts) is still the
  advanced-tier upgrade path and is unaffected either way, since it already returns its
  own absolute URL.
- **This is a real, deliberate change to what the "Domain & SSL Automation" switch
  (`getProxyAutomationEnabled`) means.** That switch used to gate the ONLY way Caddy's
  config ever got pushed dynamically (tenant create/delete, `PUT /api/portal/proxy-
  settings`). `POST /internal/deploy/promote` bypasses it unconditionally — blue-green can
  only exist at all if Caddy's base admin/api/tenant routing is driven dynamically on
  every deploy, switch or no switch, since a color's own container name isn't known at
  Caddyfile-authoring time. The switch's remaining, narrower meaning: whether a newly
  created tenant's CUSTOM domain gets automatic DNS/cert provisioning — a separate
  concern it still fully controls. Guarded by a shared secret (`DEPLOY_SECRET`,
  `x-deploy-secret` header, `crypto.timingSafeEqual`), never a session token, since it's
  called container-to-container by `deploy.sh` (via `docker compose exec` running a small
  inline `node -e` using Node 22's built-in `fetch`, not the image's busybox `wget` —
  its `--post-data`/`--header` support isn't reliably consistent across busybox builds).
  `caddyRequest` (`proxy-sync.ts`) talks to Caddy's admin API via `node:http`, deliberately
  not the global `fetch()` — undici's `fetch` sends an empty `Origin` header on a plain
  server-to-server call, which Caddy's admin API treats as a present-but-unrecognized
  origin and 403s with "not allowed to access from origin ''", regardless of any
  `origins`/`enforce_origin` setting on the Caddy side (confirmed live: `node:http` to the
  same endpoint succeeds). Authenticating the promote caller isn't the same as authorizing
  what they can do with that call: the `admin`/`api`/`frontend` dial-target arrays in the
  request body land straight in Caddy's `reverse_proxy` config, so `proxy-sync.ts` exports
  `isValidDialTargets` (a strict `host:port`-only regex — no dot, scheme, path, or query,
  matching the exact shape `deploy.sh` ever constructs) and both the route (400 on a bad
  value) and `dials()` itself (throws, defense-in-depth for any other future caller)
  enforce it — otherwise anyone holding `DEPLOY_SECRET` could redirect all admin/api/tenant
  traffic to a host of their choosing instead of merely triggering a redeploy.
- `Caddyfile`'s own static `admin`/`api`/tenant routes are now only ever read ONCE — the
  very first time the `proxy` container starts, before `deploy.sh` has ever run — pointing
  at what a first-ever deploy always produces (`ucms-blue-{admin,api,frontend}-1`). Every
  deploy after that overwrites Caddy's live config entirely via the promote endpoint;
  editing `ADMIN_DOMAIN`/`API_DOMAIN`/`TENANT_DOMAINS` in `.env` after that point has no
  effect until the `proxy` container is fully recreated (its config now lives in Caddy's
  own autosave, not this file) — manage tenants/domains through the admin's Settings tab.
- `apps/frontend/server.mjs` gained a plain `GET /health` (before `serveStatic`/`handler`)
  — Docker's own healthcheck in `docker-compose.release.yml` and `deploy.sh`'s promotion
  gate both need a liveness probe that never depends on a tenant or the api being
  reachable, unlike every real page route.
- **`install.sh`'s existing docker-mode trial flow is deliberately untouched** — it still
  publishes `api`/`frontend`/`admin` straight to host ports and never starts `proxy`,
  exactly as before. That flow is proven across real incidents (multi-distro, iptables,
  port-conflict reachability hardening, all documented above) and doesn't need
  zero-downtime at all — nothing is depending on uptime before a site has ever gone live.
  Blue-green is a deliberately SEPARATE "go-live" step: once the trial install is
  confirmed reachable and a real domain is pointed at the box, bring up `proxy`
  (`docker compose up -d proxy`) and run `scripts/deploy.sh` once — this adopts the
  `ucms-blue` project as the live app tier and every subsequent update should go through
  `scripts/deploy.sh` (or the monitor's "Pull latest & deploy" button, below) instead of
  `install.sh`'s original `docker compose up -d --build db api frontend admin`. The
  original trial containers (if left running) should be stopped manually at that point —
  this transition is not yet automated by `install.sh` itself, by design (see the
  reasoning above: keeping the tested trial path untouched was judged lower-risk than
  rewriting its reachability/bootstrap assumptions to route through Caddy from the start).
- `monitor/server.js`'s "Pull latest & deploy" button (docker mode) now runs
  `bash scripts/deploy.sh` instead of `docker compose up -d db api frontend admin` — this
  is what makes routine updates zero-downtime. Its per-service status/restart/stop/start/
  logs actions also had to learn that `api`/`frontend`/`admin` live in
  `docker-compose.release.yml` under whichever color `.deploy-color` names
  (`composeArgsFor`), while `db`/`proxy` stay in the plain default-project
  `docker-compose.yml` — unaffected. A manual "Restart" on `api` restarts every replica of
  that service at once (coarser than `deploy.sh`'s health-checked one-color-at-a-time
  flip) — a quick fix-it action, not the zero-downtime deploy path.
- **Test gate + rollback** (architecture-review follow-up): each app's own Dockerfile now
  runs its typecheck/test step as a plain `RUN` line during the image build itself
  (`apps/api/Dockerfile` → `pnpm --filter @ucms/api test`; `apps/admin/Dockerfile` →
  `pnpm --filter @ucms/admin test`; `apps/frontend/Dockerfile` → `pnpm --filter
  @ucms/frontend typecheck`, since `astro build` alone doesn't type-check the way the
  other two's `tsc`-based builds already do) — a failing test/type error fails `docker
  compose build`, which aborts `scripts/deploy.sh` (`set -e`) before any live container is
  touched. No new host tooling, no separate CI step: the existing build IS the gate.
  `deploy.sh` also stopped deleting the color it just replaced — a successful promote now
  `docker compose ... stop`s the old color (kept, not removed) instead of `... down`, so
  `scripts/deploy.sh rollback` can start it back up in seconds with **no rebuild**,
  health-check it, and flip Caddy back — symmetric with a normal deploy (rolling back
  itself just stops the color being replaced, so a bad rollback can be rolled forward
  again the same way). The next normal deploy naturally overwrites that idle color's
  containers, so there's no separate TTL/cleanup job. Reachable from the dashboard as a
  "Rollback" button next to "Pull latest & deploy" (`monitor/server.js`'s
  `handleRollback` → `POST /api/rollback`, reusing the same `deployState`/`.deploy.log`
  polling `handlePull` already has) — refused with a clear message in systemd/bare-metal
  mode (blue-green doesn't exist there) and while still in trial mode (nothing promoted
  yet to roll back to).
- **Going live on a box that already runs other apps' nginx on 80/443**: `docker-compose.yml`'s
  `proxy` service ports are `${PROXY_BIND_HTTP:-80:80}`/`${PROXY_BIND_HTTPS:-443:443}` — unset
  in `.env`, Caddy still owns 80/443 directly (the default, single-purpose-box path above).
  Set `PROXY_BIND_HTTP=127.0.0.1:8090:80`/`PROXY_BIND_HTTPS=127.0.0.1:8091:443` instead when an
  existing nginx (shared with unrelated Node apps on the same VPS) already holds the real
  80/443 and terminates TLS for its own vhosts — Caddy then only listens on those loopback
  ports, uncomment `auto_https off` in `./Caddyfile`'s global block (ACME would just fail
  anyway, since Caddy no longer really owns port 80 to prove domain ownership on), and that
  outer nginx gets one more ordinary vhost per USIM domain
  (`proxy_pass http://127.0.0.1:8090; proxy_set_header Host $host;` — preserving Host is
  required, it's how `apps/frontend` resolves the tenant) added to **its own** config, which
  lives outside this repo. `scripts/deploy.sh`/`monitor/server.js` need no changes for this —
  both only ever talk to the `proxy` container by its Docker-internal name/port, never the
  host-published one.
- **nginx-as-edge is the recommended pattern for a real org deployment** (IT already owns
  cert lifecycle/domain governance), not just the shared-VPS workaround above — Caddy's
  built-in auto-HTTPS is the right default only for a dedicated/solo-dev box where nothing
  else claims 80/443. Two ways to get a cert onto that nginx: (1) a cert IT already issued —
  plain `ssl_certificate`/`ssl_certificate_key` lines in nginx's own vhost, outside this repo
  entirely; (2) **auto-SSL via certbot**, for whoever doesn't have (1) yet —
  `monitor/server.js`'s `POST /api/ssl/issue` (`{domain, email}`, same Basic-auth as every
  other monitor route) shells out to `certbot --nginx -d <domain> -m <email> --agree-tos -n
  --redirect`, exposed as a small form on the monitor dashboard itself (not
  `apps/admin`/`apps/api`) — deliberately, since nginx/certbot are host-level resources the
  monitor process already has shell access to (it's the same systemd-managed agent that
  already runs `docker compose`/`systemctl` actions), while `apps/api` runs inside a
  container with no route to the host's nginx at all. certbot's own package install wires
  its own renewal timer — this endpoint is a one-shot "issue", nothing here schedules
  renewal. Requires `certbot`+`python3-certbot-nginx` installed on the host first (not yet
  automated by `install.sh`, which has no nginx-setup path — nginx itself is still BYO/
  manual in this pattern, same as the shared-VPS bridge above). This is a genuinely separate
  concern from the "Domain & SSL Automation" Settings switch, which only ever talks to
  Caddy — a deployment running nginx-primary with Caddy stopped entirely should leave that
  switch off/ignored and use this certbot action instead.
- Multisite panel (`TenantsPanel`/`TenantCard`, `apps/admin/src/App.tsx`) gained a
  cPanel-quota-style resource-usage line per tenant card — `GET /api/portal/tenants/usage`
  (superadmin-only) returns `{host, dbSizeBytes, diskSizeBytes}[]`: `dbSizeBytes` via a new
  `getTenantDbSizeBytes` (`tenant-pool.ts`, `pg_database_size`, best-effort — `null` on any
  failure, e.g. a tenant whose database was never provisioned), `diskSizeBytes` via a
  recursive `dirSizeBytes` walk of that tenant's uploads folder (`null` when the folder
  doesn't exist yet, or always `null` when `STORAGE_DRIVER=s3` — summing an S3 bucket's
  objects isn't a cheap "folder size" the way local disk is). A glance metric for a
  superadmin managing ~100 sites, not billing-grade metering — fetched separately from the
  tenant list itself so one slow scan can't block the panel from rendering.
