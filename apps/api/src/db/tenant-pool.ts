import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq } from "drizzle-orm";
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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  statement_timeout: 10_000,
  idleTimeoutMillis: 30_000,
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
      statement_timeout: 10_000,
      idleTimeoutMillis: 30_000,
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

export async function createTenant(host: string, departmentName: string, dbUrl: string | null = null) {
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
  await ensureTenantDatabase(host, dbUrl);
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
        roleId: schema.users.roleId,
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
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.users)
      .values({ email, passwordHash, role, tenantHost, roleId })
      .onConflictDoUpdate({ target: schema.users.email, set: { passwordHash, role, tenantHost, roleId } });
  } finally {
    client.release();
  }
}

export async function updateUserRole(id: string, roleId: string | null) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.users).set({ roleId }).where(eq(schema.users.id, id));
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

export async function updateRole(id: string, permissions: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.roles).set({ permissions }).where(eq(schema.roles.id, id));
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
