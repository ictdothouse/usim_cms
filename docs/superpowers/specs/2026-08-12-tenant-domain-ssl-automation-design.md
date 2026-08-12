# Tenant domain + SSL automation — design

**Date:** 2026-08-12
**Status:** Approved

## Problem

Registering a tenant (department site) today is two disconnected manual
steps: (1) the admin's Multisite panel `POST /api/portal/tenants` registers
the host in the control-plane `tenants` table and provisions its database —
this part already works; (2) making that host actually reachable through the
public reverse proxy (`docker-compose.yml`'s `proxy` service, Caddy) requires
hand-editing `.env`'s `TENANT_DOMAINS` and restarting the `proxy` container,
and if USIM's ICT centre issues its own paid certificate for a department
domain (rather than Caddy's automatic Let's Encrypt), that requires further
hand-editing the `Caddyfile` and mounting cert files. Nothing in the admin UI
surfaces any of this — a superadmin registering a new tenant on the real
installed server sees no site at that domain until someone does the manual
proxy work out-of-band, which is exactly the confusion that prompted this
design ("bila takde domain, dia memang tak ada site").

USIM's own deployment uses Caddy (via `install.sh`'s docker mode), but other
organizations standing up this CMS may already have their own way of routing
domains and terminating TLS (Kubernetes ingress, cPanel, an external load
balancer, a different reverse proxy entirely). The system must not assume
Caddy is in charge of TLS — it must be possible to register tenants purely as
DB records (today's behavior) and let some other layer handle domain routing
entirely outside this codebase.

## Goals

- Registering/removing a tenant, when the operator opts in, automatically
  wires that host into the bundled Caddy proxy — no `.env` edit, no
  container restart, no manual `Caddyfile` change.
- Support USIM's own paid certificate per domain (upload once, applied
  immediately), alongside Caddy's default automatic Let's Encrypt for any
  domain that doesn't need one.
- A single, explicit **on/off switch**, defaulting OFF, so an organization
  using a different domain/SSL mechanism (k8s ingress, cPanel, external LB,
  ...) is never affected by this feature and keeps managing domains its own
  way outside the CMS, same as today.
- When the switch is ON, the admin can always see whether the proxy is
  actually reachable and re-sync it on demand, rather than discovering a
  silent mismatch only when a tenant's site doesn't load.
- A paid certificate's expiry is tracked and surfaced with a warning before
  it lapses (Caddy does not auto-renew a certificate it didn't issue itself).

## Non-goals

- Bare-metal install mode (`install.sh --mode=bare-metal`) has no
  reverse-proxy/TLS layer at all today (plain Node processes on ports).
  Bringing one there is a separate, materially larger piece of work
  (introducing a whole new component, not automating one that already
  exists) — out of scope here, left as a possible follow-up.
- Local dev (`pnpm dev:*`) is unaffected — it has no proxy today (tenant
  identity comes from `x-tenant-host` or the `?__tenant=` dev override) and
  keeps working exactly as-is.
- Automatic renewal of a paid/uploaded certificate — it wasn't issued by
  Caddy, so nothing in this codebase can renew it; only an expiry warning is
  in scope.
- Any DNS automation. Pointing a domain's A/AAAA record at the server is
  always a manual prerequisite outside this system, on or off.

## Design

### 1. Master switch: `proxyAutomationEnabled`

A new control-plane singleton setting (own row, same "one instance" model as
`site_theme`, added via an `ALTER`/seed in `bootstrap-public.sql` the way
`tenant_languages.multilangEnabled` was) — `proxyAutomationEnabled boolean
default false`. Read/written via two new superadmin-only routes,
`GET`/`PUT /api/portal/proxy-settings`, mirroring the existing
`languages.write`-style gating (superadmin only — this is instance-wide
infrastructure, not a per-tenant permission).

Default **OFF**. While OFF, tenant create/update/delete behave exactly as
they do today (pure DB registry operations) — the rest of this design has
zero effect. This is the escape hatch for any organization not using the
bundled Caddy setup.

### 2. Sync mechanism (only active while the switch is ON)

`apps/api/src/proxy-sync.ts` (new module):

- `buildCaddyConfig()` — pure function, reads every `active` row from
  `tenants` plus `ADMIN_DOMAIN`/`API_DOMAIN` env vars, returns the full
  desired Caddy JSON config: static admin/API site blocks (unchanged) + one
  route per active tenant host, each pointing to the `frontend` service.
- `syncCaddy()` — calls `buildCaddyConfig()` and `POST`s it whole to Caddy's
  Admin API `/load` endpoint (`CADDY_ADMIN_URL`, e.g. `http://proxy:2019` on
  the docker-internal network — never published to the host, so it's
  unreachable from outside the Docker network regardless of firewall rules).
  Caddy swaps the active config atomically; unaffected routes keep serving
  live connections without interruption.
- Called after every tenant create/update/delete, and once at API startup
  (self-heal if the `proxy` container was recreated or lost its state) —
  but **only when `proxyAutomationEnabled` is true**. A failed sync (proxy
  unreachable, bad response, etc.) is caught, logged, and never fails the
  triggering request — registering a tenant must always succeed at the DB
  level regardless of proxy state.
- A superadmin-triggered `POST /api/portal/proxy-settings/resync` calls the
  same `syncCaddy()` on demand and returns its result (success, or the
  specific error) so the admin UI can show it directly instead of only
  finding out later that a tenant's site never came up.
- `GET /api/portal/proxy-settings` also reports live connectivity: a
  lightweight `GET` to the Admin API's `/config/` is enough to say
  "Connected" / "Not connected" without pushing any config.
- `docker-compose.yml`'s `proxy` service gains `--resume` to its Caddy run
  command (backed by the already-existing `caddy-config` volume) so a
  container restart resumes the last live config instead of reverting to
  the static `Caddyfile`, as a second layer of persistence underneath the
  API's own self-heal-on-boot sync.

### 3. Custom (paid) certificate per tenant

`tenants` gains two columns: `hasCustomCert boolean default false`,
`certExpiresAt timestamp | null`.

- `POST /api/portal/tenants/:host/cert` (superadmin, multipart: `cert` +
  `key` files, PEM). The API never writes the private key to its own disk
  or DB: it reads the two files into memory, parses the certificate's
  expiry with Node's built-in `crypto.X509Certificate` (stdlib — no new
  dependency), and forwards the PEM pair directly to Caddy's Admin API
  (`/config/apps/tls/certificates/load_pem`), which is the only place the
  key is ever persisted (inside Caddy's own encrypted-at-rest `caddy-data`
  volume, same as its Let's Encrypt keys today). If Caddy rejects the pair
  (mismatched key, malformed PEM, etc.), that error is surfaced verbatim to
  the admin UI and nothing is written to `tenants` — Caddy is the one real
  validator, the API doesn't reimplement certificate/key-matching checks.
  On success, `hasCustomCert`/`certExpiresAt` are saved and `syncCaddy()`
  runs so the tenant's route now specifies this certificate instead of
  automatic HTTPS.
- `DELETE /api/portal/tenants/:host/cert` — clears both columns and
  re-syncs, reverting that host to Caddy's automatic Let's Encrypt.
- Only meaningful while `proxyAutomationEnabled` is true; the endpoints
  404/400 when it's off (nothing to attach the certificate to).

### 4. Admin UI — Settings tab, superadmin-only

One new card, **"Domain & SSL Automation"**, alongside the existing "System
Languages" card in `SettingsPanel`:

- Toggle bound to `proxyAutomationEnabled`. Off by default.
- **When OFF:** short static guidance — add the domain to your own
  reverse proxy / ingress / cPanel vhost and point its DNS at this server;
  register the tenant here as usual, this card does nothing further.
- **When ON:** a status line (Connected / Not connected, from
  `GET /api/portal/proxy-settings`) + a **"Resync now"** button, then a
  table of every tenant: host, mode (`Automatic HTTPS` or `Custom
  certificate — expires DD/MM/YYYY`, with an amber badge once inside 30
  days of expiry, mirroring the existing amber "Staging" tag convention in
  `TenantCard`), and per-row **Upload certificate** / **Revert to
  automatic** actions (upload opens a small dialog with the two file
  inputs, same modal pattern as `MediaPickerModal`).
- Reminder line noting DNS must already point at this server regardless of
  the toggle — this system never touches DNS.

### 5. Docs

`CLAUDE.md`'s Deployment section drops the "TENANT_DOMAINS needs a live
tenant's host added to it" manual instruction for the docker+automation
path, replacing it with a short pointer to this card, while keeping the
manual `TENANT_DOMAINS`/Caddyfile-editing instructions as the documented
path for anyone who leaves the switch off (or is on bare-metal, where it
never applied to begin with).

## Error handling

- Every `syncCaddy()` call site treats sync failure as non-fatal to the
  triggering request (create/delete tenant, cert upload/revert all commit
  to the DB regardless); failures are logged server-side and, for the
  explicit `Resync now`/upload actions, returned to the caller so the
  admin sees the real reason instead of a silent no-op.
- `proxyAutomationEnabled = true` with an unreachable/misconfigured
  `CADDY_ADMIN_URL` (e.g. flipped on outside docker mode) shows "Not
  connected" in the Settings card — never a crash, never a blocked tenant
  action.

## Testing

- Unit test `buildCaddyConfig()` against a handful of tenant-table
  fixtures (no custom cert / custom cert / inactive tenant excluded).
- Integration-style test for the cert upload route: a self-signed
  cert/key pair that Node's `X509Certificate` can parse, and a mismatched
  pair, asserting the DB row is untouched on Caddy rejection.
- Existing tenant create/delete tests keep passing with
  `proxyAutomationEnabled` left at its default `false` (no behavior
  change unless explicitly opted in).
