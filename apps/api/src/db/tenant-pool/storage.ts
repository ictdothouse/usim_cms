import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// "" tenantHost = the global/default storage-limits row, same shape as
// theme.ts's GLOBAL_THEME_HOST — see storageLimits in schema.ts.
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
