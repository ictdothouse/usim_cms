# Tenant domain + SSL automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a superadmin opt in (default OFF) to having `apps/api` automatically wire a registered tenant's domain into the bundled Caddy reverse proxy — no `.env` edit, no container restart — and upload USIM's own paid TLS certificate per domain, while leaving organizations that route domains/TLS some other way (k8s ingress, cPanel, an external load balancer) completely untouched.

**Architecture:** A single control-plane boolean (`platform_settings.proxy_automation_enabled`, default `false`) gates everything. When on, `apps/api/src/proxy-sync.ts` rebuilds Caddy's *entire* desired config from the `tenants` table (single source of truth) and pushes it to Caddy's Admin API (`/load`) after every tenant create/delete/cert change and once at boot — an atomic, zero-downtime swap, never a `.env` edit or restart. A paid certificate is forwarded straight to Caddy's `/config/apps/tls/certificates/load_pem` endpoint and never touches the API's own disk or DB.

**Tech Stack:** Fastify + Drizzle (existing `apps/api`), Caddy 2's JSON Admin API (`http://proxy:2019`, docker-internal only), Node 22 built-in `fetch`/`crypto.X509Certificate` (no new npm dependencies), React admin (`apps/admin`), `node:test` (existing test runner, `tsx --test`).

## Global Constraints

- Default is **OFF** (`proxy_automation_enabled = false`). Every existing tenant create/update/delete flow must behave exactly as it does today when the switch is off — zero behavior change unless a superadmin explicitly opts in.
- Bare-metal install mode and local dev (`pnpm dev:*`) are never touched by this feature (no Caddy exists in either) — out of scope per the design's Non-goals.
- No new npm dependency. Certificate expiry parsing uses Node's built-in `crypto.X509Certificate`; Caddy calls use Node's built-in `fetch`.
- A certificate's private key is never written to the API's own disk or database — it is read into memory from the multipart upload and forwarded directly to Caddy, which is the only place it is ever persisted.
- Every Caddy-sync call site must be **non-fatal**: a tenant create/delete/cert action always succeeds at the DB level even if the proxy is unreachable; failures are logged (and, for the explicit resync/upload actions, returned to the caller).
- All new `/api/portal/*` routes are superadmin-only (`verifySuperadmin`), matching every existing route in that family.
- Match this codebase's existing test convention exactly: only pure, DB/network-free functions get `node:test` unit tests (see `apps/api/src/db/auth.test.ts`) — DB-touching functions (`tenant-pool.ts`) and network calls (Caddy Admin API) have no automated tests today, and this plan does not introduce test infrastructure to change that. Verify those tasks with `pnpm --filter @usim-cms/api typecheck` instead.
- **Environment limitation:** there is no Docker available in this session (see project memory), so the actual Caddy Admin API JSON shape (`buildCaddyConfig`'s route/listener structure) cannot be verified against a live Caddy instance here. Task 2 flags exactly which parts need a real `docker compose up` run to confirm once Docker is available — ship the code, but do not claim it's been live-verified.

---

### Task 1: Control-plane schema — `platform_settings` table + `tenants` cert columns

**Files:**
- Modify: `apps/api/src/db/schema.ts:181-192` (tenants table) and after it
- Modify: `apps/api/src/db/bootstrap-public.sql` (near the existing `tenants` ALTERs, top of file)
- Modify: `apps/api/src/db/tenant-pool.ts:569` (right after `setGlobalTheme`)

**Interfaces:**
- Produces: `schema.platformSettings` (Drizzle table), `schema.tenants.hasCustomCert` / `schema.tenants.certExpiresAt` columns, `getProxyAutomationEnabled(): Promise<boolean>`, `setProxyAutomationEnabled(enabled: boolean): Promise<void>`, `setTenantCertInfo(host: string, certExpiresAt: Date | null): Promise<void>` — later tasks call all three by these exact names.

- [ ] **Step 1: Add the two cert columns to `tenants` in `schema.ts`**

In `apps/api/src/db/schema.ts`, change:

```ts
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host").notNull().unique(),
  departmentName: text("department_name").notNull(),
  active: boolean("active").notNull().default(true),
  // Where this tenant's own database lives. Null = same Postgres server as
  // the control-plane DATABASE_URL, database name tenant_<host> (derived in
  // tenant-pool.ts). Set explicitly to move a tenant to another DB server —
  // topology is data here, never code.
  dbUrl: text("db_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

to:

```ts
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host").notNull().unique(),
  departmentName: text("department_name").notNull(),
  active: boolean("active").notNull().default(true),
  // Where this tenant's own database lives. Null = same Postgres server as
  // the control-plane DATABASE_URL, database name tenant_<host> (derived in
  // tenant-pool.ts). Set explicitly to move a tenant to another DB server —
  // topology is data here, never code.
  dbUrl: text("db_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Set once a paid/custom certificate (uploaded via the Settings "Domain &
  // SSL Automation" card) is loaded into Caddy for this host in place of
  // its automatic Let's Encrypt certificate — see proxy-sync.ts.
  hasCustomCert: boolean("has_custom_cert").notNull().default(false),
  certExpiresAt: timestamp("cert_expires_at"),
});

// Instance-wide switch: whether apps/api keeps the bundled Caddy proxy's
// live config synced with the tenants table above (see proxy-sync.ts). Off
// by default — an organization routing domains/TLS some other way (k8s
// ingress, cPanel, an external load balancer) never touches this. Single
// row, "singleton" is the only id this table's code ever reads/writes.
export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default("singleton"),
  proxyAutomationEnabled: boolean("proxy_automation_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the matching bootstrap SQL**

In `apps/api/src/db/bootstrap-public.sql`, right after the existing line:

```sql
-- Upgrade path for control-plane DBs bootstrapped before db_url existed.
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "db_url" text;
```

add:

```sql
-- Upgrade path: paid/custom certificate tracking for the Domain & SSL
-- Automation card (see apps/api/src/proxy-sync.ts).
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "has_custom_cert" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS "cert_expires_at" timestamp;

-- Single-row instance-wide switch: whether apps/api keeps the bundled
-- Caddy proxy's config in sync with the tenants table above. Off by
-- default — orgs using their own reverse proxy/ingress/cPanel never touch
-- this. "singleton" is the only id ever inserted.
CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"proxy_automation_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
```

- [ ] **Step 3: Add the get/set functions to `tenant-pool.ts`**

In `apps/api/src/db/tenant-pool.ts`, right after `setGlobalTheme`'s closing brace (line 569, right before the `// "My collection"` comment), add:

```ts
// Instance-wide switch (see schema.ts's platformSettings) — whether apps/api
// keeps the bundled Caddy proxy's live config synced with the tenants table
// (proxy-sync.ts). Off by default; orgs routing domains/TLS some other way
// (k8s ingress, cPanel, an external load balancer) never touch this.
export async function getProxyAutomationEnabled(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.platformSettings);
    return row?.proxyAutomationEnabled ?? false;
  } finally {
    client.release();
  }
}

export async function setProxyAutomationEnabled(enabled: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", proxyAutomationEnabled: enabled })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { proxyAutomationEnabled: enabled, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

// Records that `host` now has a custom certificate loaded into Caddy
// (certExpiresAt parsed from the cert by the caller — see proxy-sync.ts's
// parseCertExpiry), or pass null to clear both columns and revert that
// host to Caddy's automatic HTTPS.
export async function setTenantCertInfo(host: string, certExpiresAt: Date | null): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.tenants)
      .set({ hasCustomCert: certExpiresAt !== null, certExpiresAt })
      .where(eq(schema.tenants.host, host));
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/bootstrap-public.sql apps/api/src/db/tenant-pool.ts
git commit -m "feat(api): add platform_settings table and tenant cert-tracking columns"
```

---

### Task 2: `proxy-sync.ts` — Caddy config builder + Admin API client

**Files:**
- Create: `apps/api/src/proxy-sync.ts`
- Create: `apps/api/src/proxy-sync.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone module; reads `process.env.CADDY_ADMIN_URL`/`ADMIN_DOMAIN`/`API_DOMAIN` directly).
- Produces: `buildCaddyConfig(tenants: TenantRouteInfo[]): Record<string, unknown>`, `parseCertExpiry(certPem: string): Date`, `pingCaddy(): Promise<boolean>`, `syncCaddy(tenants: TenantRouteInfo[]): Promise<void>`, `loadCaddyCert(certPem: string, keyPem: string): Promise<void>`, and the `TenantRouteInfo` type (`{ host: string; active: boolean }`) — Task 3/4 import all five by these exact names.

- [ ] **Step 1: Write the failing tests for the two pure functions**

Create `apps/api/src/proxy-sync.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaddyConfig, parseCertExpiry } from "./proxy-sync.js";

test("buildCaddyConfig includes one route per active tenant", () => {
  const config = buildCaddyConfig([
    { host: "dept-a.usim.edu.my", active: true },
    { host: "dept-b.usim.edu.my", active: true },
  ]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.ok(hosts.includes("dept-a.usim.edu.my"));
  assert.ok(hosts.includes("dept-b.usim.edu.my"));
});

test("buildCaddyConfig excludes an inactive tenant", () => {
  const config = buildCaddyConfig([{ host: "suspended.usim.edu.my", active: false }]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.ok(!hosts.includes("suspended.usim.edu.my"));
});

test("buildCaddyConfig always includes the static admin/api routes", () => {
  const config = buildCaddyConfig([]);
  const servers = (config as any).apps.http.servers.srv0;
  const hosts = servers.routes.flatMap((r: any) => r.match[0].host);
  assert.equal(hosts.length, 2); // admin domain + api domain, no tenants
});

test("parseCertExpiry rejects a malformed PEM", () => {
  // A deliberately truncated/invalid PEM body — exercises the same
  // rejection path apps/api's cert-upload route (Task 4) depends on to
  // reject a bad upload with 400. Swap in a real self-signed cert (e.g.
  // `openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem
  // -days 3650 -subj "/CN=test"`) later if asserting the parsed date
  // itself is wanted.
  const pem = "-----BEGIN CERTIFICATE-----\nnotacertificate\n-----END CERTIFICATE-----";
  assert.throws(() => parseCertExpiry(pem));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @usim-cms/api test`
Expected: FAIL — `Cannot find module './proxy-sync.js'`.

- [ ] **Step 3: Implement `proxy-sync.ts`**

Create `apps/api/src/proxy-sync.ts`:

```ts
import { X509Certificate } from "node:crypto";

// Bundled Caddy proxy's Admin API — reachable only on the docker-internal
// network (never published to the host, see docker-compose.yml's proxy
// service) or a bare-metal Caddy's own localhost listener. Unset means this
// deployment has no Caddy to talk to; every network function below fails
// closed in that case, which is the expected state for local dev and
// bare-metal installs (see CLAUDE.md's Non-goals for this feature).
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL;
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? "admin.localhost";
const API_DOMAIN = process.env.API_DOMAIN ?? "api.localhost";
const TIMEOUT_MS = 5000;

export interface TenantRouteInfo {
  host: string;
  active: boolean;
}

// Pure — the whole desired Caddy config for the bundled proxy: static
// admin/API routes (always present) + one route per ACTIVE tenant, each
// reverse-proxied to the frontend container. No DB/network access, so this
// is unit-testable without a live Postgres or Caddy. A tenant with a custom
// certificate needs no special-casing here — loadCaddyCert (below) loads
// the certificate into Caddy separately, and Caddy automatically prefers an
// already-loaded certificate over requesting one via automatic HTTPS for a
// matching hostname.
export function buildCaddyConfig(tenants: TenantRouteInfo[]): Record<string, unknown> {
  const tenantRoutes = tenants
    .filter((t) => t.active)
    .map((t) => ({
      match: [{ host: [t.host] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "frontend:4321" }] }],
    }));

  const staticRoutes = [
    {
      match: [{ host: [ADMIN_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "admin:80" }] }],
    },
    {
      match: [{ host: [API_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "api:3000" }] }],
    },
  ];

  return {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":443", ":80"],
            routes: [...staticRoutes, ...tenantRoutes],
          },
        },
      },
    },
  };
}

// Parses a PEM certificate's expiry — stdlib only (Node's X509Certificate),
// no new dependency. Throws on malformed PEM; callers (Task 4's cert-upload
// route) surface that as a 400 to the admin rather than silently accepting
// a bad certificate.
export function parseCertExpiry(certPem: string): Date {
  const cert = new X509Certificate(certPem);
  return new Date(cert.validTo);
}

async function caddyRequest(path: string, init?: RequestInit): Promise<Response> {
  if (!CADDY_ADMIN_URL) throw new Error("CADDY_ADMIN_URL not configured");
  return fetch(`${CADDY_ADMIN_URL}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Cheap connectivity probe for the Settings card's Connected/Not connected
// status — never pushes any config.
export async function pingCaddy(): Promise<boolean> {
  try {
    const res = await caddyRequest("/config/");
    return res.ok;
  } catch {
    return false;
  }
}

// Pushes the FULL desired config in one atomic swap — Caddy diffs
// internally, so routes that didn't change keep serving live connections
// uninterrupted. The single source of truth is always the tenants table
// (passed in by the caller), never whatever Caddy happened to have before —
// safe to call repeatedly, and safe as a self-heal after the proxy
// container is recreated or loses its volume.
export async function syncCaddy(tenants: TenantRouteInfo[]): Promise<void> {
  const config = buildCaddyConfig(tenants);
  const res = await caddyRequest("/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Caddy /load failed: ${res.status} ${await res.text()}`);
}

// Loads a certificate+key pair into Caddy; Caddy automatically prefers an
// already-loaded certificate over requesting one via automatic HTTPS for a
// matching hostname — no route-level change needed (see buildCaddyConfig).
// Caddy is the one real validator of the pair (mismatched key, malformed
// PEM, ...); its rejection is thrown verbatim for the caller to surface to
// the admin UI rather than this module reimplementing that validation.
export async function loadCaddyCert(certPem: string, keyPem: string): Promise<void> {
  const res = await caddyRequest("/config/apps/tls/certificates/load_pem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ certificate: certPem, key: keyPem }]),
  });
  if (!res.ok) throw new Error(`Caddy rejected certificate: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 4: Run the tests again to see them pass**

Run: `pnpm --filter @usim-cms/api test`
Expected: PASS for all four tests in `proxy-sync.test.ts` (existing `auth.test.ts` tests keep passing too).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/proxy-sync.ts apps/api/src/proxy-sync.test.ts
git commit -m "feat(api): add proxy-sync module (Caddy config builder + Admin API client)"
```

**Note for later verification:** `buildCaddyConfig`'s route/listener JSON shape and `loadCaddyCert`'s `/config/apps/tls/certificates/load_pem` endpoint path are written from Caddy 2's documented Admin API — neither has been exercised against a real running Caddy in this environment (no Docker available). Once Docker is available, run `docker compose up`, flip the Settings toggle on, and confirm `POST /api/portal/proxy-settings/resync` actually makes a registered tenant's domain reachable through the proxy before relying on this in production.

---

### Task 3: API routes — proxy settings (GET/PUT/resync) + hook into tenant lifecycle

**Files:**
- Modify: `apps/api/src/index.ts:16-47` (import block), `apps/api/src/index.ts:371-408` (existing portal/tenants routes), `apps/api/src/index.ts:1555-1560` (listen callback)

**Interfaces:**
- Consumes: `getProxyAutomationEnabled`, `setProxyAutomationEnabled` (Task 1), `syncCaddy`, `pingCaddy` (Task 2), `listTenants`, `createTenant`, `deleteTenant` (already imported).
- Produces: `maybeSyncCaddy(): Promise<void>` (module-level helper, used again by Task 4), routes `GET/PUT /api/portal/proxy-settings`, `POST /api/portal/proxy-settings/resync`.

- [ ] **Step 1: Extend the `tenant-pool.js` import list**

In `apps/api/src/index.ts`, in the existing import block (lines 16-47), add two names to the list (alongside the existing `listTenants, createTenant, deleteTenant,`):

```ts
  getProxyAutomationEnabled,
  setProxyAutomationEnabled,
```

and add a new import right after it (after the `sanitize-html` import, alongside the other local-module imports around line 48-62):

```ts
import { syncCaddy, pingCaddy } from "./proxy-sync.js";
```

- [ ] **Step 2: Add the `maybeSyncCaddy` helper and hook it into tenant create/delete**

In `apps/api/src/index.ts`, right before the existing `app.get("/api/portal/tenants", ...)` route (currently line 371), add:

```ts
// Fires the Caddy resync after any tenant-table change, but only when the
// superadmin has opted in (getProxyAutomationEnabled) — and never lets a
// sync failure fail the request that triggered it; a tenant create/delete
// must always succeed at the DB level regardless of proxy state.
async function maybeSyncCaddy(): Promise<void> {
  try {
    if (!(await getProxyAutomationEnabled())) return;
    await syncCaddy(await listTenants());
  } catch (err) {
    app.log.warn({ err }, "Caddy proxy sync failed");
  }
}
```

Then update the existing create route (currently lines 376-389) so it reads:

```ts
app.post("/api/portal/tenants", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host, departmentName, dbUrl } = req.body as {
    host?: string;
    departmentName?: string;
    dbUrl?: string;
  };
  if (!host || !departmentName) {
    reply.code(400);
    return { error: "host and departmentName required" };
  }
  await createTenant(host, departmentName, dbUrl || null);
  await maybeSyncCaddy();
  return { created: true };
});
```

(only the `await maybeSyncCaddy();` line is new, right after `createTenant`).

And the existing delete route (currently lines 394-408) so it reads:

```ts
app.delete("/api/portal/tenants/:host", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  const { confirm } = req.body as { confirm?: string };
  if (confirm !== host) {
    reply.code(400);
    return { error: "confirm must match the site's host exactly" };
  }
  await deleteTenant(host);
  if (isLocalDriver) {
    const tenantFolder = host.toLowerCase().replace(/[^a-z0-9]/g, "_");
    await rm(path.join(localUploadsDir, tenantFolder), { recursive: true, force: true });
  }
  await maybeSyncCaddy();
  return { deleted: true };
});
```

(only the `await maybeSyncCaddy();` line is new, right before `return { deleted: true };`).

- [ ] **Step 3: Add the proxy-settings routes**

Right after the (now-updated) `DELETE /api/portal/tenants/:host` route, add:

```ts
app.get("/api/portal/proxy-settings", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const enabled = await getProxyAutomationEnabled();
  const connected = enabled ? await pingCaddy() : false;
  return { enabled, connected };
});

app.put("/api/portal/proxy-settings", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    reply.code(400);
    return { error: "enabled must be a boolean" };
  }
  await setProxyAutomationEnabled(enabled);
  if (enabled) await maybeSyncCaddy();
  return { enabled };
});

app.post("/api/portal/proxy-settings/resync", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  if (!(await getProxyAutomationEnabled())) {
    reply.code(400);
    return { error: "proxy automation is not enabled" };
  }
  try {
    await syncCaddy(await listTenants());
    return { synced: true };
  } catch (err) {
    reply.code(502);
    return { synced: false, error: (err as Error).message };
  }
});
```

- [ ] **Step 4: Self-heal at boot**

In `apps/api/src/index.ts`, change the closing `app.listen` block (currently lines 1555-1560):

```ts
app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
```

to:

```ts
app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // Self-heal: if the proxy container was recreated or lost its volume
  // since this process last ran, resync it from the tenants table now
  // rather than waiting for the next tenant create/delete. No-op when the
  // switch is off (maybeSyncCaddy checks getProxyAutomationEnabled itself).
  void maybeSyncCaddy();
});
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add proxy-settings routes and hook Caddy sync into tenant lifecycle"
```

---

### Task 4: API routes — custom certificate upload/revert

**Files:**
- Modify: `apps/api/src/index.ts` (import block, and a new block right after Task 3's proxy-settings routes)

**Interfaces:**
- Consumes: `setTenantCertInfo` (Task 1), `parseCertExpiry`, `loadCaddyCert` (Task 2), `maybeSyncCaddy`, `getProxyAutomationEnabled` (Task 3).
- Produces: `POST /api/portal/tenants/:host/cert`, `DELETE /api/portal/tenants/:host/cert`.

- [ ] **Step 1: Extend the imports**

Add `setTenantCertInfo,` to the `tenant-pool.js` import list (same block Task 3 edited), and extend the `proxy-sync.js` import from Task 3 to:

```ts
import { syncCaddy, pingCaddy, parseCertExpiry, loadCaddyCert } from "./proxy-sync.js";
```

- [ ] **Step 2: Add the cert routes**

Right after the `POST /api/portal/proxy-settings/resync` route (Task 3, Step 3), add:

```ts
// Uploads USIM's own paid certificate for `host`, forwarded straight to
// Caddy — never written to this API's own disk or DB (see proxy-sync.ts's
// loadCaddyCert). Caddy is the one real validator of the cert/key pair.
app.post("/api/portal/tenants/:host/cert", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  if (!(await getProxyAutomationEnabled())) {
    reply.code(400);
    return { error: "proxy automation is not enabled" };
  }
  const { host } = req.params as { host: string };
  let certPem: string | null = null;
  let keyPem: string | null = null;
  for await (const part of req.parts()) {
    if (part.type !== "file") continue;
    const buf = await part.toBuffer();
    if (part.fieldname === "cert") certPem = buf.toString("utf8");
    if (part.fieldname === "key") keyPem = buf.toString("utf8");
  }
  if (!certPem || !keyPem) {
    reply.code(400);
    return { error: "cert and key files required (multipart/form-data, fields 'cert' and 'key')" };
  }
  let expiresAt: Date;
  try {
    expiresAt = parseCertExpiry(certPem);
  } catch {
    reply.code(400);
    return { error: "certificate could not be parsed (expected PEM)" };
  }
  try {
    await loadCaddyCert(certPem, keyPem);
  } catch (err) {
    reply.code(400);
    return { error: (err as Error).message };
  }
  await setTenantCertInfo(host, expiresAt);
  await maybeSyncCaddy();
  return { hasCustomCert: true, certExpiresAt: expiresAt.toISOString() };
});

// Reverts `host` to Caddy's automatic Let's Encrypt HTTPS.
app.delete("/api/portal/tenants/:host/cert", async (req, reply) => {
  if (!verifySuperadmin(req, reply)) return;
  const { host } = req.params as { host: string };
  await setTenantCertInfo(host, null);
  await maybeSyncCaddy();
  return { hasCustomCert: false };
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @usim-cms/api typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add custom certificate upload/revert routes"
```

---

### Task 5: Infra — `docker-compose.yml` + `Caddyfile`

**Files:**
- Modify: `docker-compose.yml:28-33` (api service environment), `docker-compose.yml:82-100` (proxy service)
- Modify: `Caddyfile:9` (before the `ADMIN_DOMAIN` block)

**Interfaces:**
- Consumes: nothing code-level; this is the wiring that makes `CADDY_ADMIN_URL` (Task 2) resolve inside the docker network and makes Caddy's config survive a container restart.

- [ ] **Step 1: Give the `api` service `CADDY_ADMIN_URL`**

In `docker-compose.yml`, the `api` service's `environment` block currently reads:

```yaml
    environment:
      DATABASE_URL: postgres://usim_cms_app:usim_cms_app@db:5432/usim_cms
      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET in .env}
      PORT: 3000
      # Static export renders pages through the frontend container.
      FRONTEND_INTERNAL_URL: http://frontend:4321
```

Add one line:

```yaml
    environment:
      DATABASE_URL: postgres://usim_cms_app:usim_cms_app@db:5432/usim_cms
      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET in .env}
      PORT: 3000
      # Static export renders pages through the frontend container.
      FRONTEND_INTERNAL_URL: http://frontend:4321
      # Caddy's Admin API, docker-internal only (never published — see the
      # proxy service below). Harmless to always set: proxy-sync.ts's calls
      # are only ever made when a superadmin turns the Settings "Domain &
      # SSL Automation" switch on (default off).
      CADDY_ADMIN_URL: http://proxy:2019
```

- [ ] **Step 2: Make the `proxy` service resume its last live config on restart**

In `docker-compose.yml`, the `proxy` service currently has no `command:` override (it uses the `caddy:2-alpine` image's default `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`). Add one:

```yaml
  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    command: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --resume
```

(insert the `command:` line right after `image:`, before `restart:`). `--resume` tells Caddy to load its last-saved live config (persisted in the already-existing `caddy-config` volume) instead of re-adapting the static `Caddyfile` on every restart — so a config pushed at runtime via `/load` (Task 2/3) survives a container restart. The static `Caddyfile` is still what a *brand-new* `caddy-config` volume boots from the very first time, and is also exactly what a superadmin who leaves the Settings switch OFF keeps editing manually (see Task 8's `TENANT_DOMAINS` doc update) — this change does not remove or shrink that path.

- [ ] **Step 3: Bind Caddy's Admin API to the docker network, not just its own loopback**

In `Caddyfile`, right before the existing:

```
{$ADMIN_DOMAIN:admin.localhost} {
	reverse_proxy admin:80
}
```

add a global options block:

```
# Admin API bound to all interfaces INSIDE this container so the api
# service (same docker-internal network, see docker-compose.yml's
# CADDY_ADMIN_URL) can reach it — this port is never published to the host
# (no "2019:2019" in docker-compose.yml's proxy.ports), so it stays
# unreachable from outside the Docker network regardless of any firewall
# rule on the host.
{
	admin 0.0.0.0:2019
}

{$ADMIN_DOMAIN:admin.localhost} {
	reverse_proxy admin:80
}
```

- [ ] **Step 4: Sanity-check the compose file parses**

Run: `docker compose config --quiet`
Expected: exits 0 with no output (only validates YAML/interpolation — does not require Docker to actually be running an engine; if this command itself isn't available in this environment, skip this step and note it as unverified, consistent with this task's other Docker-dependent caveats).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml Caddyfile
git commit -m "feat(deploy): wire Caddy Admin API into api service, persist live config across restarts"
```

---

### Task 6: Admin client (`api.ts`) + i18n keys

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (after the existing `deletePortalTenant`, around line 316)
- Modify: `apps/admin/src/i18n.ts` (after `"settings-languages-add-btn"` in both the `ms` object at line 45 and the `en` object at line 564)

**Interfaces:**
- Produces: `api.getProxySettings`, `api.setProxyAutomationEnabled`, `api.resyncProxy`, `api.uploadTenantCert`, `api.revertTenantCert`, and the i18n keys `settings-proxy-*` — Task 7 uses all of these by these exact names.

- [ ] **Step 1: Add the client functions**

In `apps/admin/src/lib/api.ts`, right after `deletePortalTenant` (currently ending at line 316), add:

```ts
export interface ProxySettings {
  enabled: boolean;
  connected: boolean;
}

// Superadmin-only "Domain & SSL Automation" switch in the Settings tab —
// off by default (see CLAUDE.md's Deployment section). All of the below
// are no-ops on the server unless that switch is on.
export const getProxySettings = (token: string) =>
  request("/api/portal/proxy-settings", null, token) as Promise<ProxySettings>;

export const setProxyAutomationEnabled = (token: string, enabled: boolean) =>
  request("/api/portal/proxy-settings", null, token, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }) as Promise<{ enabled: boolean }>;

export const resyncProxy = (token: string) =>
  request("/api/portal/proxy-settings/resync", null, token, { method: "POST" }) as Promise<{
    synced: boolean;
    error?: string;
  }>;

// cert/key are PEM files (USIM's paid certificate) — forwarded to apps/api,
// which forwards them straight to Caddy without ever writing the key to
// its own disk or DB (see apps/api/src/proxy-sync.ts).
export async function uploadTenantCert(token: string, host: string, cert: File, key: File): Promise<{ certExpiresAt: string }> {
  const form = new FormData();
  form.append("cert", cert);
  form.append("key", key);
  const res = await fetch(`${API_URL}/api/portal/tenants/${host}/cert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  return body;
}

export const revertTenantCert = (token: string, host: string) =>
  request(`/api/portal/tenants/${host}/cert`, null, token, { method: "DELETE" });
```

- [ ] **Step 2: Add the i18n keys (Bahasa Melayu)**

In `apps/admin/src/i18n.ts`, right after `"settings-languages-add-btn": "Tambah bahasa",` (currently line 45), add:

```ts
  "settings-proxy-title": "Domain & Automasi SSL",
  "settings-proxy-desc": "Bila dihidupkan, mendaftar/padam laman terus wire domain tu ke proxy Caddy terbina-dalam — tak perlu edit .env atau restart. Biarkan OFF kalau organisasi guna proxy/ingress/cPanel sendiri.",
  "settings-proxy-enable": "Hidupkan automasi domain & SSL (Caddy)",
  "settings-proxy-manual-hint": "OFF: tambah domain ni ke reverse-proxy/ingress/cPanel korang sendiri, dan pastikan DNS domain tu dah point ke server ni. Daftar laman kat sini seperti biasa — bahagian ni tak buat apa-apa lagi.",
  "settings-proxy-status-connected": "Disambung",
  "settings-proxy-status-disconnected": "Tak disambung",
  "settings-proxy-resync-btn": "Resync sekarang",
  "settings-proxy-cert-auto": "HTTPS Automatik",
  "settings-proxy-cert-custom": "Sijil sendiri",
  "settings-proxy-upload-btn": "Muat naik sijil",
  "settings-proxy-upload-cert-file": "Fail sijil (.crt / fullchain)",
  "settings-proxy-upload-key-file": "Fail kunci peribadi (.key)",
  "settings-proxy-upload-submit": "Muat naik & pakai",
  "settings-proxy-revert-btn": "Kembali ke automatik",
  "settings-proxy-dns-reminder": "DNS domain mesti dah point ke server ni dulu — sistem ni tak sentuh DNS.",
```

- [ ] **Step 3: Add the matching i18n keys (English)**

In the same file, right after `"settings-languages-add-btn": "Add language",` (currently line 564), add:

```ts
  "settings-proxy-title": "Domain & SSL Automation",
  "settings-proxy-desc": "When on, registering/removing a site automatically wires that domain into the bundled Caddy proxy — no .env edit, no restart. Leave this off if your organization routes domains/TLS its own way (ingress, cPanel, an external load balancer).",
  "settings-proxy-enable": "Enable automatic domain & SSL routing (Caddy)",
  "settings-proxy-manual-hint": "OFF: add this domain to your own reverse proxy/ingress/cPanel, and make sure its DNS already points at this server. Register the site here as usual — this card does nothing further.",
  "settings-proxy-status-connected": "Connected",
  "settings-proxy-status-disconnected": "Not connected",
  "settings-proxy-resync-btn": "Resync now",
  "settings-proxy-cert-auto": "Automatic HTTPS",
  "settings-proxy-cert-custom": "Custom certificate",
  "settings-proxy-upload-btn": "Upload certificate",
  "settings-proxy-upload-cert-file": "Certificate file (.crt / fullchain)",
  "settings-proxy-upload-key-file": "Private key file (.key)",
  "settings-proxy-upload-submit": "Upload & apply",
  "settings-proxy-revert-btn": "Revert to automatic",
  "settings-proxy-dns-reminder": "This domain's DNS must already point at this server — this system never touches DNS.",
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: passes with no errors (the `en` object is typed `Record<Key, string>`, so a key added only to `ms` would fail here — confirming both were added correctly).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/i18n.ts
git commit -m "feat(admin): add proxy-settings/cert client functions and i18n strings"
```

---

### Task 7: Admin UI — "Domain & SSL Automation" card in Settings

**Files:**
- Modify: `apps/admin/src/App.tsx:3412-3646` (`SettingsPanel`)

**Interfaces:**
- Consumes: `api.getProxySettings`, `api.setProxyAutomationEnabled`, `api.resyncProxy`, `api.uploadTenantCert`, `api.revertTenantCert`, `api.listPortalTenants` (all existing/Task 6), the `t()`/`card`/`btnPrimary`/`btnGhost`/`ShieldCheck` already in scope in this file.

- [ ] **Step 1: Add state and data-loading to `SettingsPanel`**

In `apps/admin/src/App.tsx`, inside `SettingsPanel` (starts line 3412), right after the existing language-related state block (after `const [langSuggestOpen, setLangSuggestOpen] = useState(false);`, before `const existingCodes = ...`), add:

```ts
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyConnected, setProxyConnected] = useState(false);
  const [proxyErr, setProxyErr] = useState<string | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyTenants, setProxyTenants] = useState<Array<Record<string, unknown>>>(tenants);
  const [certUploadHost, setCertUploadHost] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
```

Then, right after the existing `useEffect(reloadLanguages, [token]);` line, add:

```ts
  function reloadProxySettings() {
    void api.getProxySettings(token).then((s) => {
      setProxyEnabled(s.enabled);
      setProxyConnected(s.connected);
    }).catch((e) => setProxyErr((e as Error).message));
  }
  useEffect(reloadProxySettings, [token]);
  useEffect(() => setProxyTenants(tenants), [tenants]);

  function reloadProxyTenants() {
    void api.listPortalTenants(token).then(setProxyTenants);
  }

  async function toggleProxyEnabled(enabled: boolean) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.setProxyAutomationEnabled(token, enabled);
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function resyncProxy() {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      const res = await api.resyncProxy(token);
      if (!res.synced) setProxyErr(res.error ?? "Resync failed");
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function submitCertUpload() {
    if (!certUploadHost || !certFile || !keyFile) return;
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.uploadTenantCert(token, certUploadHost, certFile, keyFile);
      setCertUploadHost(null);
      setCertFile(null);
      setKeyFile(null);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function revertCert(host: string) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.revertTenantCert(token, host);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }
```

- [ ] **Step 2: Render the card**

In the same file, right before the closing `</div>` / `);` / `}` that ends `SettingsPanel` (currently lines 3645-3648, right after the languages card's closing `</div>`), add:

```tsx
      <div className={`${card} space-y-3 p-5`}>
        <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-proxy-title")}
        </h3>
        <p className="text-xs text-sub">{t("settings-proxy-desc")}</p>
        {proxyErr && <p className="text-xs text-red-600">{proxyErr}</p>}
        <label className="flex items-center gap-2 text-xs font-medium text-ink">
          <input
            type="checkbox"
            checked={proxyEnabled}
            disabled={proxyBusy}
            onChange={(e) => void toggleProxyEnabled(e.target.checked)}
          />
          {t("settings-proxy-enable")}
        </label>
        <p className="text-xs text-sub">{t("settings-proxy-dns-reminder")}</p>
        {!proxyEnabled && <p className="text-xs text-sub">{t("settings-proxy-manual-hint")}</p>}
        {proxyEnabled && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span className={proxyConnected ? "text-ok" : "text-red-600"}>
                {proxyConnected ? t("settings-proxy-status-connected") : t("settings-proxy-status-disconnected")}
              </span>
              <button onClick={() => void resyncProxy()} disabled={proxyBusy} className={btnGhost}>
                {proxyBusy ? t("settings-busy") : t("settings-proxy-resync-btn")}
              </button>
            </div>
            <div className="space-y-2">
              {proxyTenants.map((tn) => {
                const tHost = tn.host as string;
                const hasCustomCert = Boolean(tn.hasCustomCert);
                const certExpiresAt = tn.certExpiresAt as string | null;
                const expiringSoon =
                  hasCustomCert && certExpiresAt !== null &&
                  new Date(certExpiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                return (
                  <div
                    key={tHost}
                    className="flex items-center justify-between gap-2 border-t border-line pt-2 text-xs first:border-0 first:pt-0"
                  >
                    <div>
                      <p className="font-mono text-ink">{tHost}</p>
                      <p className={expiringSoon ? "font-semibold text-amber-700" : "text-sub"}>
                        {hasCustomCert && certExpiresAt
                          ? `${t("settings-proxy-cert-custom")} — ${new Date(certExpiresAt).toLocaleDateString()}`
                          : t("settings-proxy-cert-auto")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {hasCustomCert && (
                        <button onClick={() => void revertCert(tHost)} disabled={proxyBusy} className={btnGhost}>
                          {t("settings-proxy-revert-btn")}
                        </button>
                      )}
                      <button
                        onClick={() => setCertUploadHost(certUploadHost === tHost ? null : tHost)}
                        disabled={proxyBusy}
                        className={btnGhost}
                      >
                        {t("settings-proxy-upload-btn")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {certUploadHost && (
              <div className={`${card} space-y-2 border border-line p-3`}>
                <p className="text-xs font-semibold text-ink">{certUploadHost}</p>
                <label className="block text-xs text-sub">
                  {t("settings-proxy-upload-cert-file")}
                  <input
                    type="file"
                    accept=".crt,.pem,.cer"
                    onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block text-xs"
                  />
                </label>
                <label className="block text-xs text-sub">
                  {t("settings-proxy-upload-key-file")}
                  <input
                    type="file"
                    accept=".key,.pem"
                    onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block text-xs"
                  />
                </label>
                <button
                  onClick={() => void submitCertUpload()}
                  disabled={proxyBusy || !certFile || !keyFile}
                  className={btnPrimary}
                >
                  {proxyBusy ? t("settings-busy") : t("settings-proxy-upload-submit")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev:api` and `pnpm dev:admin` (separate terminals), log in as superadmin, open Settings.
Expected: the "Domain & SSL Automation" card renders, toggle is off by default and shows the manual-hint text; switching it on shows "Not connected" (no `CADDY_ADMIN_URL` in local dev — expected, since dev has no Caddy) without any crash, and switching it back off returns to the manual-hint text.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "feat(admin): add Domain & SSL Automation card to Settings"
```

---

### Task 8: Docs — `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md:1001-1008`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the Deployment section's `proxy` bullet**

In `CLAUDE.md`, change:

```markdown
- `proxy` (`caddy:2-alpine`, config in `./Caddyfile`) is the public-facing reverse proxy
  and TLS terminator. Default behavior: automatic Let's Encrypt issuance/renewal for
  every domain in `ADMIN_DOMAIN`/`API_DOMAIN`/`TENANT_DOMAINS` (`.env.example`) — no
  manual cert steps. To use a certificate USIM's ICT centre issues instead (the
  cPanel-style flow), swap the matching `Caddyfile` site block to a `tls <cert> <key>`
  directive and mount the cert files in via the commented `./certs` volume on `proxy`.
  `TENANT_DOMAINS` needs a live tenant's host added to it before that department's site
  is reachable through the proxy.
```

to:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document opt-in Caddy domain/SSL automation in Deployment section"
```

---

## Self-Review Notes

- **Spec coverage:** §1 master switch → Task 1 + 3; §2 sync mechanism → Task 2 + 3 + 5; §3 custom cert → Task 1 + 2 + 4; §4 admin UI → Task 6 + 7; §5 docs → Task 8. Error handling (non-fatal sync) → Task 3's `maybeSyncCaddy`. Testing section's pure-function tests → Task 2.
- **Placeholder scan:** no TBD/TODO; the one deliberately-approximate test fixture (Task 2, Step 1's truncated cert PEM) is called out explicitly with its limitation and an upgrade path, not left as a silent gap.
- **Type consistency:** `TenantRouteInfo { host, active }` (Task 2) matches what Task 3's `maybeSyncCaddy` passes via `listTenants()`'s existing return shape (already has `host`/`active` columns); `setTenantCertInfo(host, certExpiresAt: Date | null)` (Task 1) is called identically in Task 4's upload route (`Date`) and revert route (`null`).
- **Scope:** eight tasks, each independently testable/typecheckable and committed separately, matching the design's single-feature scope (no bare-metal work, no dev-mode changes).
