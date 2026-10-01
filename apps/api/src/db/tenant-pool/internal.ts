import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

// Internal to the tenant-pool/ split — NOT re-exported by the ../tenant-pool.ts
// barrel. Every sibling file here shares the same control-plane pool and
// bootstrap helper rather than each opening its own.

// Control-plane pool: the fixed DATABASE_URL holding the public registry
// tables (tenants/users/roles/site_theme/shared_content). Tenant content
// does NOT live here — each tenant has its own database (see connection.ts).
// max/timeouts stop one slow/stuck query from starving everything else.
// statement_timeout is NOT passed as a Pool constructor option here: pg sends
// that one as a Postgres startup-packet parameter, which PgBouncer (sits in
// front in deploys, see pgbouncer.ini) rejects with "unsupported startup
// parameter" unless explicitly allowlisted. Setting it via a real SET on
// each new connection works through PgBouncer's session pool_mode the same
// way plugins/tenant.ts's own SET SESSION app.authenticated already does.
export const pool = new Pool({
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

// db/ (one level up from this tenant-pool/ subdirectory) — where
// migrations/ and bootstrap-public.sql actually live.
export const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const migrationFiles = readdirSync(path.join(dbDir, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
export const bootstrapPublicSql = readFileSync(path.join(dbDir, "bootstrap-public.sql"), "utf8");

// Creates the control-plane "public"."tenants" registry table, once per
// process, before any registry lookup.
let publicSchemaReady: Promise<unknown> | undefined;
export function ensurePublicSchema(client: PoolClient): Promise<unknown> {
  publicSchemaReady ??= client.query(bootstrapPublicSql);
  return publicSchemaReady;
}
