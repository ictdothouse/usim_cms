import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

type TenantDb = NodePgDatabase<typeof schema>;

// One pg Pool per tenant host, created lazily and reused across requests.
const pools = new Map<string, TenantDb>();

export function getTenantDb(tenantHost: string): TenantDb {
  const existing = pools.get(tenantHost);
  if (existing) return existing;

  // TODO: resolve tenantHost -> connection string via a tenant registry
  // instead of a single shared DATABASE_URL.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  pools.set(tenantHost, db);
  return db;
}
