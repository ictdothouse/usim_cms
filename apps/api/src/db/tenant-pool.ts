import { readdirSync, readFileSync } from "node:fs";
import { resolve as dnsResolve } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type TenantDb = NodePgDatabase<typeof schema>;

export class UnknownTenantError extends Error {
  constructor(host: string) {
    super(`Unknown or inactive tenant host: ${host}`);
  }
}

// Control-plane pool: the fixed DATABASE_URL holding the public registry
// tables (tenants/users/roles/site_theme/shared_content). Tenant content
// does NOT live here — each tenant has its own database (see below).
// max/timeouts stop one slow/stuck query from starving everything else.
// statement_timeout is NOT passed as a Pool constructor option here: pg sends
// that one as a Postgres startup-packet parameter, which PgBouncer (sits in
// front in deploys, see pgbouncer.ini) rejects with "unsupported startup
// parameter" unless explicitly allowlisted. Setting it via a real SET on
// each new connection works through PgBouncer's session pool_mode the same
// way plugins/tenant.ts's own SET SESSION app.authenticated already does.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});
pool.on("connect", (client) => {
  client.query("SET statement_timeout = 10000").catch(() => {});
});
// Without this, an idle client's own background error (e.g. Postgres
// administratively killing the connection — "terminating connection due to
// administrator command", seen crash-looping the VPS process this listener
// was added for) has nowhere to go and surfaces as an uncaughtException,
// taking the whole process down instead of just losing that one connection.
pool.on("error", (err) => {
  console.error("control-plane pool: idle client error", err);
});

const dbDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFiles = readdirSync(path.join(dbDir, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const bootstrapPublicSql = readFileSync(path.join(dbDir, "bootstrap-public.sql"), "utf8");

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

// Creates the control-plane "public"."tenants" registry table, once per
// process, before any registry lookup.
let publicSchemaReady: Promise<unknown> | undefined;
function ensurePublicSchema(client: PoolClient): Promise<unknown> {
  publicSchemaReady ??= client.query(bootstrapPublicSql);
  return publicSchemaReady;
}

// One small pool per tenant database, created lazily and cached for the
// process lifetime. Small max per pool: 50 tenants must share the server's
// connection budget (PgBouncer in front caps the global total in deploys).
const tenantPools = new Map<string, Pool>();

function getTenantPool(connectionString: string): Pool {
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

// Tracks which tenant databases this process has already provisioned, so
// CREATE DATABASE + the migration replay aren't re-run on every request.
const provisionedDbs = new Set<string>();

// ponytail: provisions the tenant database (+ runs all migrations into it)
// on first request per process, once the host is confirmed in the registry.
// Derived (same-server) databases are auto-created; an explicit db_url on
// another server must already exist there (migrations still run). Fine for
// ~50 known department hosts; revisit if tenants need true self-service.
async function ensureTenantDatabase(tenantHost: string, dbUrl: string | null): Promise<string> {
  const connectionString = dbUrl ?? deriveTenantDbUrl(tenantHost);
  if (provisionedDbs.has(connectionString)) return connectionString;

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
  // schema-per-tenant provisioning did.
  const tp = getTenantPool(connectionString);
  const client = await tp.connect();
  try {
    for (const file of migrationFiles) {
      await client.query(readFileSync(path.join(dbDir, "migrations", file), "utf8"));
    }
  } finally {
    client.release();
  }
  provisionedDbs.add(connectionString);
  return connectionString;
}

export async function closePool(): Promise<void> {
  await Promise.all([pool.end(), ...[...tenantPools.values()].map((p) => p.end())]);
  tenantPools.clear();
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

// "" tenantHost = the global/default theme row, owned by superadmin.
const GLOBAL_THEME_HOST = "";

// "" tenantHost = the global/default storage-limits row, same shape as
// GLOBAL_THEME_HOST above — see storageLimits in schema.ts.
const GLOBAL_STORAGE_HOST = "";

// Fallback when NEITHER a tenant override NOR a global default has ever
// been set — matches this codebase's pre-quota behavior exactly (the old
// hardcoded 5 MB busboy limit, and no storage cap at all).
export const DEFAULT_MAX_UPLOAD_FILE_SIZE_MB = 5;

export interface StorageLimits {
  maxUploadFileSizeMb: number | null;
  maxTotalStorageMb: number | null;
}

export async function getGlobalStorageLimits(): Promise<StorageLimits> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.storageLimits).where(eq(schema.storageLimits.tenantHost, GLOBAL_STORAGE_HOST));
    return { maxUploadFileSizeMb: row?.maxUploadFileSizeMb ?? null, maxTotalStorageMb: row?.maxTotalStorageMb ?? null };
  } finally {
    client.release();
  }
}

export async function setGlobalStorageLimits(limits: StorageLimits): Promise<void> {
  await setTenantStorageLimits(GLOBAL_STORAGE_HOST, limits);
}

// Raw tenant row only (no global merge) — the Multisite per-site editor
// wants exactly what this tenant overrides, nothing inherited, so a blank
// field there means "inheriting global", not "global happens to equal 5".
export async function getTenantStorageLimits(tenantHost: string): Promise<StorageLimits> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.storageLimits).where(eq(schema.storageLimits.tenantHost, tenantHost));
    return { maxUploadFileSizeMb: row?.maxUploadFileSizeMb ?? null, maxTotalStorageMb: row?.maxTotalStorageMb ?? null };
  } finally {
    client.release();
  }
}

export async function setTenantStorageLimits(tenantHost: string, limits: StorageLimits): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.storageLimits)
      .values({ tenantHost, ...limits })
      .onConflictDoUpdate({
        target: schema.storageLimits.tenantHost,
        set: { ...limits, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

// What POST /api/media actually enforces: tenant override wins per-field,
// else the global default, else the hardcoded fallback above — same
// per-field (not whole-row) fallback chain getMergedTheme's shallow merge
// gives site_theme, just spelled out since these are 2 discrete columns
// rather than one jsonb blob to spread.
export async function getMergedStorageLimits(tenantHost: string): Promise<{ maxUploadFileSizeMb: number; maxTotalStorageMb: number | null }> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const rows = await db.select().from(schema.storageLimits);
    const global = rows.find((r) => r.tenantHost === GLOBAL_STORAGE_HOST);
    const tenant = rows.find((r) => r.tenantHost === tenantHost);
    return {
      maxUploadFileSizeMb: tenant?.maxUploadFileSizeMb ?? global?.maxUploadFileSizeMb ?? DEFAULT_MAX_UPLOAD_FILE_SIZE_MB,
      maxTotalStorageMb: tenant?.maxTotalStorageMb ?? global?.maxTotalStorageMb ?? null,
    };
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return user;
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
      layout: [
        {
          type: "hero",
          props: {
            title: departmentName,
            subtitle: "Website ini sedang disediakan. Kandungan akan dikemaskini tidak lama lagi.",
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

  const dbUrl = tenant.dbUrl as string | null;
  const connectionString = dbUrl ?? deriveTenantDbUrl(host);
  const tp = tenantPools.get(connectionString);
  if (tp) {
    await tp.end();
    tenantPools.delete(connectionString);
  }
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

export async function listUsers() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        tenantHost: schema.users.tenantHost,
        tenantHosts: schema.users.tenantHosts,
        roleId: schema.users.roleId,
        extraPermissions: schema.users.extraPermissions,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users);
  } finally {
    client.release();
  }
}

export async function createUser(
  email: string,
  passwordHash: string,
  role: string,
  tenantHost: string | null,
  roleId: string | null = null,
  tenantHosts: string[] = tenantHost ? [tenantHost] : [],
  extraPermissions: string[] = [],
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.users)
      .values({ email, passwordHash, role, tenantHost, tenantHosts, roleId, extraPermissions })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { passwordHash, role, tenantHost, tenantHosts, roleId, extraPermissions },
      });
  } finally {
    client.release();
  }
}

export async function updateUserRole(id: string, roleId: string | null, extraPermissions?: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set(extraPermissions === undefined ? { roleId } : { roleId, extraPermissions })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function updateUserPassword(id: string, passwordHash: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

// tenantHost (singular) stays in sync as hosts[0] — same convention createUser
// uses, since it's the webmaster's default/first site.
export async function updateUserTenantHosts(id: string, tenantHosts: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set({ tenantHosts, tenantHost: tenantHosts[0] ?? null })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function deleteUser(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.users).where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function listRoles() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db.select().from(schema.roles);
  } finally {
    client.release();
  }
}

export async function createRole(name: string, permissions: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.roles).values({ name, permissions });
  } finally {
    client.release();
  }
}

export async function updateRole(id: string, permissions: string[], name?: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.roles)
      .set(name === undefined ? { permissions } : { permissions, name })
      .where(eq(schema.roles.id, id));
  } finally {
    client.release();
  }
}

export async function deleteRole(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  } finally {
    client.release();
  }
}

export async function listLanguages() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db.select().from(schema.languages).orderBy(asc(schema.languages.sortOrder), asc(schema.languages.label));
  } finally {
    client.release();
  }
}

export async function createLanguage(code: string, label: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.languages).values({ code, label });
  } finally {
    client.release();
  }
}

// Blocks disabling/deleting the last enabled row — leaving zero enabled
// languages would mean neither content author nor visitor has a usable one.
async function guardLastEnabled(db: NodePgDatabase<typeof schema>, id: string, willDisable: boolean) {
  if (!willDisable) return null;
  const enabledRows = await db.select({ id: schema.languages.id }).from(schema.languages).where(eq(schema.languages.enabled, true));
  if (enabledRows.length === 1 && enabledRows[0].id === id) {
    return "at least one language must stay enabled";
  }
  return null;
}

export async function updateLanguage(id: string, patch: { label?: string; enabled?: boolean; sortOrder?: number }) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    if (patch.enabled === false) {
      const guardError = await guardLastEnabled(db, id, true);
      if (guardError) return { error: guardError };
    }
    await db.update(schema.languages).set(patch).where(eq(schema.languages.id, id));
    return { error: null };
  } finally {
    client.release();
  }
}

export async function deleteLanguage(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select({ enabled: schema.languages.enabled }).from(schema.languages).where(eq(schema.languages.id, id));
    if (row) {
      const guardError = await guardLastEnabled(db, id, row.enabled);
      if (guardError) return { error: guardError };
    }
    await db.delete(schema.languages).where(eq(schema.languages.id, id));
    return { error: null };
  } finally {
    client.release();
  }
}

// Page Blueprint (Sprint 5 sub-project 2) — control-plane, tenantHost NULL
// means system-wide. See schema.ts's pageBlueprints comment.
export async function listPageBlueprints(tenantHost: string, category?: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const scopeFilter = or(isNull(schema.pageBlueprints.tenantHost), eq(schema.pageBlueprints.tenantHost, tenantHost));
    const where = category ? and(scopeFilter, eq(schema.pageBlueprints.category, category)) : scopeFilter;
    return db.select().from(schema.pageBlueprints).where(where).orderBy(asc(schema.pageBlueprints.name));
  } finally {
    client.release();
  }
}

export async function getPageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
    return row;
  } finally {
    client.release();
  }
}

export async function createPageBlueprint(input: {
  tenantHost: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  layout: unknown;
  settings?: unknown;
  createdBy?: string | null;
  createdByEmail?: string | null;
}) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db
      .insert(schema.pageBlueprints)
      .values({
        tenantHost: input.tenantHost,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        layout: input.layout ?? [],
        settings: input.settings ?? {},
        createdBy: input.createdBy ?? null,
        createdByEmail: input.createdByEmail ?? null,
      })
      .returning();
    return row;
  } finally {
    client.release();
  }
}

export async function updatePageBlueprint(
  id: string,
  patch: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown },
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.pageBlueprints).set({ ...patch, updatedAt: new Date() }).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}

export async function deletePageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}

// i18n Phase 2 — per-tenant enabled-language subset, re-intersected with the
// currently globally-enabled set on every read (see schema.ts's
// tenantLanguages comment for why).
export async function getTenantLanguageSelection(tenantHost: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const allEnabled = await db
      .select()
      .from(schema.languages)
      .where(eq(schema.languages.enabled, true))
      .orderBy(asc(schema.languages.sortOrder), asc(schema.languages.label));
    const [row] = await db
      .select({
        enabledCodes: schema.tenantLanguages.enabledCodes,
        showHeaderSwitcher: schema.tenantLanguages.showHeaderSwitcher,
        multilangEnabled: schema.tenantLanguages.multilangEnabled,
        defaultLanguage: schema.tenantLanguages.defaultLanguage,
      })
      .from(schema.tenantLanguages)
      .where(eq(schema.tenantLanguages.tenantHost, tenantHost));
    // A default language whose code has since been globally disabled is
    // dropped here rather than stored — same re-intersect-at-read-time
    // tolerance as selectedCodes, so callers never see a dangling default.
    const defaultLanguage = row?.defaultLanguage && allEnabled.some((l) => l.code === row.defaultLanguage) ? row.defaultLanguage : null;
    const selectedCodes = row && row.enabledCodes.length > 0 ? row.enabledCodes : null;
    return { allEnabled, selectedCodes, showHeaderSwitcher: row?.showHeaderSwitcher ?? false, multilangEnabled: row?.multilangEnabled ?? false, defaultLanguage };
  } finally {
    client.release();
  }
}

// codes=[] stores an explicit empty override, which getTenantLanguageSelection
// already treats the same as "no row" (selectedCodes: null, inherit all) —
// so this always upserts rather than deleting, keeping showHeaderSwitcher/
// multilangEnabled/defaultLanguage intact even when the language subset
// itself is cleared back to "inherit".
export async function setTenantLanguageSelection(tenantHost: string, codes: string[], showHeaderSwitcher: boolean, multilangEnabled: boolean, defaultLanguage: string | null) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.tenantLanguages)
      .values({ tenantHost, enabledCodes: codes, showHeaderSwitcher, multilangEnabled, defaultLanguage })
      .onConflictDoUpdate({
        target: schema.tenantLanguages.tenantHost,
        set: { enabledCodes: codes, showHeaderSwitcher, multilangEnabled, defaultLanguage, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

// Superadmin sessions never consult this (hasPermission in index.ts always
// bypasses); webmasters with no role assigned get zero permissions.
export async function getRolePermissions(roleId: string | null): Promise<string[]> {
  if (!roleId) return [];
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    return (role?.permissions as string[] | undefined) ?? [];
  } finally {
    client.release();
  }
}

export async function getGlobalTheme(): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.siteTheme).where(eq(schema.siteTheme.tenantHost, GLOBAL_THEME_HOST));
    return (row?.settings as Record<string, unknown>) ?? {};
  } finally {
    client.release();
  }
}

export async function setGlobalTheme(settings: Record<string, unknown>): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.siteTheme)
      .values({ tenantHost: GLOBAL_THEME_HOST, settings })
      .onConflictDoUpdate({
        target: schema.siteTheme.tenantHost,
        set: { settings, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

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

// Instance-wide "Login Methods" master switch (Settings tab) — same
// singleton-row pattern as proxy automation above.
export async function getMfaEnabled(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.platformSettings);
    return row?.mfaEnabled ?? false;
  } finally {
    client.release();
  }
}

export async function setMfaEnabled(enabled: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", mfaEnabled: enabled })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { mfaEnabled: enabled, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

export async function findUserById(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  } finally {
    client.release();
  }
}

// Enrollment step 1 (POST /api/auth/totp-setup) — stores the new secret but
// leaves totpEnabled false until confirmed with a real code
// (setUserTotpEnabled below), so a half-finished enrollment never silently
// starts requiring a code the user hasn't confirmed they can generate.
export async function setUserTotpSecret(id: string, secret: string): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.users).set({ totpSecret: secret, totpEnabled: false }).where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

// enabled=false also clears totpSecret (a user turning MFA off, or a
// superadmin resetting a locked-out user's MFA for recovery, should require
// a fresh enrollment next time, not silently reactivate an old secret).
export async function setUserTotpEnabled(id: string, enabled: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set(enabled ? { totpEnabled: true } : { totpEnabled: false, totpSecret: null })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.loginAttempts).values({ email, ip, success });
    // Lazy prune, piggybacked on the same write — no separate cleanup cron.
    await client.query("DELETE FROM login_attempts WHERE created_at < $1", [
      new Date(Date.now() - LOGIN_ATTEMPTS_RETENTION_MS),
    ]);
  } finally {
    client.release();
  }
}

// True once either this email or this IP has LOGIN_RATE_LIMIT_MAX_FAILURES
// failed attempts within LOGIN_RATE_LIMIT_WINDOW_MS — checked BEFORE the
// password is even compared, so a locked-out caller never gets a fresh
// timing oracle either. Keying on email OR ip (not just one) catches both a
// single account under brute force AND one IP enumerating many emails.
export async function isLoginRateLimited(email: string, ip: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const cutoff = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS);
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM login_attempts WHERE success = false AND created_at > $1 AND (email = $2 OR ip = $3)",
      [cutoff, email, ip],
    );
    return (rows[0]?.n ?? 0) >= LOGIN_RATE_LIMIT_MAX_FAILURES;
  } finally {
    client.release();
  }
}

// Control-plane audit trail — see schema.ts's audit_log comment for what
// this is (and isn't) meant to cover.
export async function insertAuditLog(entry: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      target: entry.target ?? null,
      meta: entry.meta ?? {},
      ip: entry.ip ?? null,
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

// "My collection" in the admin's Theme panel — personal, per-user, never
// read by getMergedTheme/apps/frontend. Ownership is enforced in the WHERE
// clause itself (not just an app-level check before the query), so a
// guessed id can never touch another user's row.
export async function listThemePresets(ownerUserId: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db
      .select()
      .from(schema.themePresets)
      .where(eq(schema.themePresets.ownerUserId, ownerUserId))
      .orderBy(desc(schema.themePresets.createdAt));
  } finally {
    client.release();
  }
}

export async function createThemePreset(ownerUserId: string, name: string, settings: Record<string, unknown>) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.insert(schema.themePresets).values({ ownerUserId, name, settings }).returning();
    return row;
  } finally {
    client.release();
  }
}

export async function deleteThemePreset(ownerUserId: string, id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db
      .delete(schema.themePresets)
      .where(and(eq(schema.themePresets.id, id), eq(schema.themePresets.ownerUserId, ownerUserId)))
      .returning();
    return Boolean(row);
  } finally {
    client.release();
  }
}

// site_theme is control-plane data (keyed by tenant_host, one public-schema
// table for all tenants) — with DB-per-tenant it must never be read through
// req.db, whose site_theme copy in the tenant database is empty.
export async function getMergedTheme(tenantHost: string): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const rows = await db.select().from(schema.siteTheme);
    const global = (rows.find((r) => r.tenantHost === GLOBAL_THEME_HOST)?.settings as Record<string, unknown>) ?? {};
    const tenant = (rows.find((r) => r.tenantHost === tenantHost)?.settings as Record<string, unknown>) ?? {};
    return { ...global, ...tenant };
  } finally {
    client.release();
  }
}

// Raw tenant row only (no global merge) — backup/restore wants exactly what
// this tenant owns, nothing inherited.
export async function getTenantTheme(tenantHost: string): Promise<Record<string, unknown> | null> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.siteTheme).where(eq(schema.siteTheme.tenantHost, tenantHost));
    return (row?.settings as Record<string, unknown>) ?? null;
  } finally {
    client.release();
  }
}

export async function setTenantTheme(tenantHost: string, settings: Record<string, unknown>): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.siteTheme)
      .values({ tenantHost, settings })
      .onConflictDoUpdate({
        target: schema.siteTheme.tenantHost,
        set: { settings, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

export interface TenantConnection {
  db: TenantDb;
  release: () => void;
}

export async function getTenantConnection(tenantHost: string): Promise<TenantConnection> {
  // Registry lookup on the control-plane — the x-tenant-host trust boundary.
  const registryClient = await pool.connect();
  let tenant;
  try {
    await ensurePublicSchema(registryClient);
    const db = drizzle(registryClient, { schema });
    [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.host, tenantHost));
  } finally {
    registryClient.release();
  }
  if (!tenant || !tenant.active) {
    throw new UnknownTenantError(tenantHost);
  }

  const connectionString = await ensureTenantDatabase(tenantHost, (tenant.dbUrl as string | null) ?? null);
  const client = await getTenantPool(connectionString).connect();
  return { db: drizzle(client, { schema }), release: () => client.release() };
}
