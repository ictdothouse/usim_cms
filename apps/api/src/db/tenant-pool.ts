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

// One shared pool across all tenants; tenant isolation is a Postgres schema
// per tenant host, selected via search_path on the checked-out client.
// max/timeouts stop one slow/stuck tenant query from starving the other 49.
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

function schemaNameFor(tenantHost: string): string {
  return `tenant_${tenantHost.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

// Creates the control-plane "public"."tenants" registry table, once per
// process, before any registry lookup.
let publicSchemaReady: Promise<unknown> | undefined;
function ensurePublicSchema(client: PoolClient): Promise<unknown> {
  publicSchemaReady ??= client.query(bootstrapPublicSql);
  return publicSchemaReady;
}

// Tracks which tenant schemas this process has already provisioned, so the
// migration files aren't re-run on every request.
const provisionedSchemas = new Set<string>();

// ponytail: provisions the tenant schema (+ runs all migrations into it) on
// first request per process, once the host is confirmed in the registry.
// Fine for ~50 known department hosts registered via the add-tenant script;
// revisit if tenants need true self-service provisioning.
async function ensureTenantSchema(client: PoolClient, schemaName: string) {
  if (provisionedSchemas.has(schemaName)) return;
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}", public`);
  for (const file of migrationFiles) {
    await client.query(readFileSync(path.join(dbDir, "migrations", file), "utf8"));
  }
  provisionedSchemas.add(schemaName);
}

export function closePool(): Promise<void> {
  return pool.end();
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

export async function createTenant(host: string, departmentName: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.tenants)
      .values({ host, departmentName })
      .onConflictDoUpdate({ target: schema.tenants.host, set: { departmentName, active: true } });
  } finally {
    client.release();
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

export interface TenantConnection {
  db: TenantDb;
  release: () => void;
}

export async function getTenantConnection(tenantHost: string): Promise<TenantConnection> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.host, tenantHost));
    if (!tenant || !tenant.active) {
      throw new UnknownTenantError(tenantHost);
    }

    const schemaName = schemaNameFor(tenantHost);
    await ensureTenantSchema(client, schemaName);
    await client.query(`SET search_path TO "${schemaName}", public`);
    return { db, release: () => client.release() };
  } catch (err) {
    client.release();
    throw err;
  }
}
