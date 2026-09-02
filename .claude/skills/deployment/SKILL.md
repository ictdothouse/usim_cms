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
- Tenant backup/restore/migration is `apps/api/src/backup.ts`, not `pg_dump`: JSON dump
  of a tenant's rows + its local uploads, zipped — restores across Postgres versions and
  onto a different server/host (rewrites `/uploads/<host>/` references on cross-host
  restore, which is how the admin's site-clone feature works). `exportStaticSite` renders
  every page/post through the real running frontend and bundles the HTML + assets for a
  static-host handover.
- `apps/api/scripts/backup.sh` is the instance-level counterpart: `pg_dump` (whole
  control-plane + tenant DBs, or a specific tenant's schema by host), meant to run on a
  cron job (`RETENTION_DAYS` prunes old dumps, defaults 14).
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
  endpoint) whenever a monitored service (db/api/frontend/admin) flips up↔down. `POST /api/alerts/test`
  (same basic-auth as every other monitor route) fires a one-off test message to verify wiring without
  waiting for a real outage. Deliberately no email/SMTP client — this file's whole point is staying
  dependency-free (`node monitor/server.js`, no `npm install`), and a webhook covers the same "someone
  gets pinged" need without one. Still a gap: no real metrics/dashboards (CPU/memory/request-rate time
  series) — this is service-up/down alerting only, `restart: unless-stopped` + compose healthchecks
  still do the actual crash-recovery; revisit with a real metrics stack if/when the instance carries
  enough tenants that this coarse a signal stops being enough.

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
  (round-robins + health-checks) across all of them.
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
