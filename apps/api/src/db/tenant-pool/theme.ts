import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// "" tenantHost = the global/default theme row, owned by superadmin.
const GLOBAL_THEME_HOST = "";

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
    const rows = await db
      .select()
      .from(schema.siteTheme)
      .where(inArray(schema.siteTheme.tenantHost, [GLOBAL_THEME_HOST, tenantHost]));
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
