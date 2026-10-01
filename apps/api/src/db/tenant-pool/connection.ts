import { resolve as dnsResolve } from "node:dns/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, dbDir, migrationFiles, ensurePublicSchema } from "./internal.js";

export type TenantDb = NodePgDatabase<typeof schema>;

export class UnknownTenantError extends Error {
  constructor(host: string) {
    super(`Unknown or inactive tenant host: ${host}`);
  }
}

export function tenantDbName(tenantHost: string): string {
  return `tenant_${tenantHost.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

// tenants.db_url null = this tenant's database lives on the same server as
// the control-plane, named tenant_<host>. An explicit db_url (set when a
// 2nd/3rd DB server exists) wins — topology is data, never code.
function deriveTenantDbUrl(tenantHost: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${tenantDbName(tenantHost)}`;
  return url.toString();
}

// One small pool per tenant database, created lazily and cached — but NOT
// for the process lifetime unconditionally, see the idle-eviction sweep
// below. Small max per pool: 50 tenants must share the server's connection
// budget (PgBouncer in front caps the global total in deploys).
const tenantPools = new Map<string, Pool>();

// Architecture audit finding: without this, a tenant pool (up to 5 held
// connections each) lived for the whole process lifetime once provisioned,
// even for a host that's gone quiet for weeks — at ~100 tenants that's up to
// 500 idle-but-open connections through PgBouncer that never get reclaimed.
// Sweeps periodically and closes any pool that's BOTH past the idle
// threshold AND has nothing currently checked out (ending a pool with an
// in-flight client would otherwise just block until it's released, which is
// fine, but skipping it here means the sweep never stalls on a busy tenant).
// Removed from the map before end() is even awaited — a request arriving
// mid-drain finds nothing there and simply creates a fresh Pool via
// getTenantPool below, rather than racing a connect() against a pool that's
// closing.
const poolLastUsed = new Map<string, number>();
const IDLE_POOL_EVICT_MS = 30 * 60 * 1000;
const IDLE_POOL_SWEEP_MS = 5 * 60 * 1000;
const idleSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [connectionString, tp] of tenantPools) {
    const lastUsed = poolLastUsed.get(connectionString) ?? 0;
    if (now - lastUsed < IDLE_POOL_EVICT_MS) continue;
    if (tp.waitingCount > 0 || tp.idleCount !== tp.totalCount) continue;
    tenantPools.delete(connectionString);
    poolLastUsed.delete(connectionString);
    tp.end().catch((err) => console.error("tenant pool: idle eviction close failed", err));
  }
}, IDLE_POOL_SWEEP_MS);
idleSweepTimer.unref();

// Raw pg Pool counters for GET /metrics — pool.totalCount/idleCount/
// waitingCount are pg's own live gauges, no extra bookkeeping needed.
export function getPoolStats(): {
  control: { total: number; idle: number; waiting: number };
  tenants: { total: number; idle: number; waiting: number; poolCount: number };
} {
  const tenants = [...tenantPools.values()].reduce(
    (acc, p) => ({
      total: acc.total + p.totalCount,
      idle: acc.idle + p.idleCount,
      waiting: acc.waiting + p.waitingCount,
    }),
    { total: 0, idle: 0, waiting: 0 },
  );
  return {
    control: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    tenants: { ...tenants, poolCount: tenantPools.size },
  };
}

function getTenantPool(connectionString: string): Pool {
  poolLastUsed.set(connectionString, Date.now());
  let tp = tenantPools.get(connectionString);
  if (!tp) {
    tp = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    tp.on("connect", (client) => {
      client.query("SET statement_timeout = 10000").catch(() => {});
    });
    // Same reasoning as the control-plane pool's own listener above. Strips
    // both a URL-style password (this codebase's only actual format, always
    // postgres://user:pass@host/db — deriveTenantDbUrl above) and, as extra
    // insurance against a future db_url shaped differently, a bare
    // "password=..." parameter, before this ever reaches a log line.
    tp.on("error", (err) => {
      const redacted = connectionString
        .replace(/:[^:@/?]+@/, ":***@")
        .replace(/(password\s*=\s*)[^&\s]+/gi, "$1***");
      console.error(`tenant pool (${redacted}): idle client error`, err);
    });
    tenantPools.set(connectionString, tp);
  }
  return tp;
}

// Tracks which tenant databases this process has already provisioned (or is
// currently provisioning), so CREATE DATABASE + the migration replay aren't
// re-run — or run concurrently — on every request. A brand-new tenant's
// first page load fires several requests in parallel (e.g. the admin's Media
// Library loads folders+items via Promise.all), and without single-flighting
// this, two requests would race into `CREATE DATABASE` at once — one throws
// a Postgres "already exists" error mid-response, which was surfacing to the
// browser as a truncated body ("Unexpected end of JSON input"). Same
// single-flight-a-promise pattern as internal.ts's own `publicSchemaReady`.
const provisionedDbs = new Map<string, Promise<void>>();

// ponytail: provisions the tenant database (+ runs all migrations into it)
// on first request per process, once the host is confirmed in the registry.
// Derived (same-server) databases are auto-created; an explicit db_url on
// another server must already exist there (migrations still run). Fine for
// ~50 known department hosts; revisit if tenants need true self-service.
async function ensureTenantDatabase(tenantHost: string, dbUrl: string | null): Promise<string> {
  const connectionString = dbUrl ?? deriveTenantDbUrl(tenantHost);
  let provisioning = provisionedDbs.get(connectionString);
  if (!provisioning) {
    provisioning = provisionTenantDatabase(tenantHost, dbUrl, connectionString);
    // A failed attempt must not permanently poison the cache — let the next
    // request retry instead of every future request 500ing forever.
    provisioning.catch(() => provisionedDbs.delete(connectionString));
    provisionedDbs.set(connectionString, provisioning);
  }
  await provisioning;
  return connectionString;
}

async function provisionTenantDatabase(tenantHost: string, dbUrl: string | null, connectionString: string): Promise<void> {
  if (!dbUrl) {
    // Same-server case: create the database via the control-plane connection.
    const client = await pool.connect();
    try {
      const dbName = tenantDbName(tenantHost);
      const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
      if (rows.length === 0) {
        // dbName is sanitizer output ([a-z0-9_] only) — safe to interpolate;
        // CREATE DATABASE cannot be parameterized.
        await client.query(`CREATE DATABASE "${dbName}"`).catch((err: { code?: string }) => {
          if (err.code === "42501") {
            throw new Error(
              `Role lacks CREATEDB — run once as superuser: ALTER ROLE usim_cms_app CREATEDB; (see scripts/setup-db-role.sql)`,
            );
          }
          throw err;
        });
      }
    } finally {
      client.release();
    }
  }

  // Replay every migration into the tenant DB's own public schema. Idempotent
  // (IF NOT EXISTS / DROP POLICY IF EXISTS throughout), same replay the old
  // schema-per-tenant provisioning did. Wrapped in one transaction (audit
  // finding, 2026-09-23) — a crash mid-replay used to leave whichever
  // migration file was in flight only partially applied; none of the files
  // use CREATE INDEX CONCURRENTLY (checked — Postgres refuses that inside a
  // transaction), so BEGIN/COMMIT around the whole loop is safe and makes a
  // retry always start from either "nothing applied yet" or "fully applied".
  const tp = getTenantPool(connectionString);
  const client = await tp.connect();
  try {
    await client.query("BEGIN");
    try {
      for (const file of migrationFiles) {
        await client.query(readFileSync(path.join(dbDir, "migrations", file), "utf8"));
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  clearInterval(idleSweepTimer);
  await Promise.all([pool.end(), ...[...tenantPools.values()].map((p) => p.end())]);
  tenantPools.clear();
  poolLastUsed.clear();
}

export interface SharedContentEntry {
  sourceHost: string;
  sourceCollection: string;
  sourceId: string;
  title: string;
  excerpt: string | null;
  link: string;
  publishedAt: Date;
}

// The one deliberate, explicit path out of a tenant's isolation: an author
// opts a specific record into the cross-department "portal" pool. No other
// query in this codebase reaches across tenant schemas.
export async function publishSharedContent(entry: SharedContentEntry) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.sharedContent)
      .values(entry)
      .onConflictDoUpdate({
        target: [schema.sharedContent.sourceCollection, schema.sharedContent.sourceId],
        set: {
          title: entry.title,
          excerpt: entry.excerpt,
          link: entry.link,
          publishedAt: entry.publishedAt,
        },
      });
  } finally {
    client.release();
  }
}

export async function listSharedContent() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db.select().from(schema.sharedContent);
  } finally {
    client.release();
  }
}

// Read-only, control-plane-only lookup — the one apps/frontend's own
// middleware calls (via GET /api/tenant-status) on every request to decide
// whether to show the maintenance page instead of real content. Separate
// from the `active` gate tenant.ts's plugin already enforces (which 404s the
// whole tenant, admin included) — a maintenance tenant stays fully active.
export async function getTenantMaintenanceMode(host: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [tenant] = await db
      .select({ maintenanceMode: schema.tenants.maintenanceMode })
      .from(schema.tenants)
      .where(eq(schema.tenants.host, host));
    return tenant?.maintenanceMode ?? false;
  } finally {
    client.release();
  }
}

export async function setTenantMaintenanceMode(host: string, maintenanceMode: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.tenants).set({ maintenanceMode }).where(eq(schema.tenants.host, host));
  } finally {
    client.release();
  }
}

export async function listTenants() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db.select().from(schema.tenants);
  } finally {
    client.release();
  }
}

// Best-effort per-tenant database size for the Multisite panel's
// resource-usage column — a superadmin "how big is this site" glance, not
// billing-grade metering. Never throws: returns null (renders as "—") if
// the query fails for any reason, e.g. a tenant whose database hasn't been
// provisioned yet (never had its first request) has nothing to measure.
export async function getTenantDbSizeBytes(host: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_database_size($1) AS size", [tenantDbName(host)]);
    const size = rows[0]?.size;
    return size == null ? null : Number(size);
  } catch {
    return null;
  } finally {
    client.release();
  }
}

// Centralized here (not left to each caller in index.ts) so every path that
// registers a live Caddy route for a host — /api/setup, the normal register
// route, and clone stage/promote — gets the same guarantee: a real,
// bare-hostname shape, and (unless explicitly opted out, for the
// auto-derived staging subdomain below) a DNS record actually pointing
// somewhere, so a typo'd/unowned domain fails loudly here instead of
// registering successfully and only breaking once a visitor's browser hits
// ERR_NAME_NOT_RESOLVED.
async function assertValidTenantHost(host: string, opts: { requireDns?: boolean } = {}): Promise<void> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host.trim())) {
    throw Object.assign(new Error("host must be a bare hostname (e.g. site.example.com), not a full URL"), {
      statusCode: 400,
    });
  }
  if (opts.requireDns ?? true) {
    try {
      await dnsResolve(host);
    } catch {
      throw Object.assign(new Error(`"${host}" has no DNS record — point it at this server before registering`), {
        statusCode: 400,
      });
    }
  }
}

export async function createTenant(
  host: string,
  departmentName: string,
  dbUrl: string | null = null,
  opts: { skipDnsCheck?: boolean } = {},
) {
  await assertValidTenantHost(host, { requireDns: !opts.skipDnsCheck });
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.tenants)
      .values({ host, departmentName, dbUrl })
      .onConflictDoUpdate({ target: schema.tenants.host, set: { departmentName, active: true, dbUrl } });
  } finally {
    client.release();
  }
  tenantRegistryCache.delete(host);
  // Provision eagerly so the tenant works on its first request (and so a
  // missing CREATEDB grant fails loudly here, not on a visitor request).
  const connectionString = await ensureTenantDatabase(host, dbUrl);
  await seedDefaultHomePage(connectionString, departmentName);
}

// A brand-new tenant with zero pages served a bare "Not found" for "/" —
// confusing right after creation, before an author has touched Designer.
// Seed one real, published "home" page (WordPress-style default content) so
// the site is never empty. Skipped if a "home" page already exists — cheap
// idempotency that also makes this a no-op after a clone/staging restore
// (importTenantBackup fully replaces `pages` right after this runs).
async function seedDefaultHomePage(connectionString: string, departmentName: string): Promise<void> {
  const client = await getTenantPool(connectionString).connect();
  try {
    // pages' RLS insert/update policies require this session var (see
    // migrations/0002_pages_rls.sql) — same as importTenantBackup's restore.
    await client.query("SET SESSION app.authenticated = 'true'");
    const db = drizzle(client, { schema });
    const [existing] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, "home"));
    if (existing) return;
    await db.insert(schema.pages).values({
      slug: "home",
      title: departmentName,
      status: "published",
      publishedAt: new Date(),
      // Section-shaped (heading + text), not the legacy top-level "hero"
      // block type — that BlockBuilder-era shape has no edit path left in
      // Designer.tsx at all (see its own comment on the block-type switch),
      // so a tenant seeded with one could never re-edit its own homepage.
      layout: [
        {
          type: "section",
          props: {
            rows: [
              {
                columns: [
                  {
                    span: 1,
                    elements: [
                      { type: "heading", props: { level: "1", text: departmentName } },
                      {
                        type: "text",
                        props: { text: "Website ini sedang disediakan. Kandungan akan dikemaskini tidak lama lagi." },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
  } finally {
    client.release();
  }
}

// Danger Zone: removes the registry row and, for a same-server derived
// database (dbUrl null), actually drops it — an explicit dbUrl points at
// another server this process shouldn't assume it can DROP DATABASE on, so
// that case only unregisters the tenant. Also evicts this host's pool/
// provisioned-flag so a future createTenant with the same host provisions
// a clean database instead of reusing stale cache state.
export async function deleteTenant(host: string): Promise<void> {
  const client = await pool.connect();
  let tenant;
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.host, host));
    if (!tenant) return;
    await db.delete(schema.tenants).where(eq(schema.tenants.host, host));
  } finally {
    client.release();
  }
  tenantRegistryCache.delete(host);

  const dbUrl = tenant.dbUrl as string | null;
  const connectionString = dbUrl ?? deriveTenantDbUrl(host);
  const tp = tenantPools.get(connectionString);
  if (tp) {
    await tp.end();
    tenantPools.delete(connectionString);
  }
  poolLastUsed.delete(connectionString);
  provisionedDbs.delete(connectionString);

  if (!dbUrl) {
    const dbName = tenantDbName(host);
    const admin = await pool.connect();
    try {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [dbName]);
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      admin.release();
    }
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

export interface TenantConnection {
  db: TenantDb;
  release: () => void;
}

// Audit finding (2026-09-23): this registry lookup ran on the SAME 10-backend
// PgBouncer pool on literally every request, ahead of the tenant's own DB
// connection — the shared control-plane pool saturates before any individual
// tenant's own pool does, well under the ~8-tenant ceiling documented in
// deployment/SKILL.md. A tenant row (active/dbUrl) only ever changes via an
// explicit admin action (createTenant/deleteTenant above, both invalidate
// their own host's entry on write), so a short TTL is enough to absorb the
// common case — repeated requests to the same host inside the window skip
// the control-plane pool entirely — without a stale row surviving much past
// an actual registry change.
const TENANT_REGISTRY_CACHE_TTL_MS = 30_000;
type TenantRow = typeof schema.tenants.$inferSelect;
const tenantRegistryCache = new Map<string, { tenant: TenantRow | null; expiresAt: number }>();

async function lookupTenantCached(tenantHost: string): Promise<TenantRow | null> {
  const cached = tenantRegistryCache.get(tenantHost);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;
  const registryClient = await pool.connect();
  let tenant: TenantRow | undefined;
  try {
    await ensurePublicSchema(registryClient);
    const db = drizzle(registryClient, { schema });
    [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.host, tenantHost));
  } finally {
    registryClient.release();
  }
  tenantRegistryCache.set(tenantHost, { tenant: tenant ?? null, expiresAt: Date.now() + TENANT_REGISTRY_CACHE_TTL_MS });
  return tenant ?? null;
}

export async function getTenantConnection(tenantHost: string): Promise<TenantConnection> {
  // Registry lookup on the control-plane — the x-tenant-host trust boundary.
  const tenant = await lookupTenantCached(tenantHost);
  if (!tenant || !tenant.active) {
    throw new UnknownTenantError(tenantHost);
  }

  const connectionString = await ensureTenantDatabase(tenantHost, (tenant.dbUrl as string | null) ?? null);
  const client = await getTenantPool(connectionString).connect();
  return { db: drizzle(client, { schema }), release: () => client.release() };
}
