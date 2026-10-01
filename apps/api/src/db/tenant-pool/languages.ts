import { asc, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

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

// Shared by getLanguageSwitcherDefaults (its own client) and
// getTenantLanguageSelection (an existing client, to resolve a tenant's
// inherited value without a second DB round-trip).
async function readSwitcherDefaults(db: NodePgDatabase<typeof schema>): Promise<{ switcherPosition: string; switcherStyle: string }> {
  const [row] = await db.select().from(schema.platformSettings);
  return { switcherPosition: row?.switcherPosition ?? "header", switcherStyle: row?.switcherStyle ?? "text" };
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
        switcherPosition: schema.tenantLanguages.switcherPosition,
        switcherStyle: schema.tenantLanguages.switcherStyle,
      })
      .from(schema.tenantLanguages)
      .where(eq(schema.tenantLanguages.tenantHost, tenantHost));
    // A default language whose code has since been globally disabled is
    // dropped here rather than stored — same re-intersect-at-read-time
    // tolerance as selectedCodes, so callers never see a dangling default.
    const defaultLanguage = row?.defaultLanguage && allEnabled.some((l) => l.code === row.defaultLanguage) ? row.defaultLanguage : null;
    const selectedCodes = row && row.enabledCodes.length > 0 ? row.enabledCodes : null;
    const platformDefaults = await readSwitcherDefaults(db);
    return {
      allEnabled,
      selectedCodes,
      showHeaderSwitcher: row?.showHeaderSwitcher ?? false,
      multilangEnabled: row?.multilangEnabled ?? false,
      defaultLanguage,
      switcherPosition: row?.switcherPosition ?? platformDefaults.switcherPosition,
      switcherStyle: row?.switcherStyle ?? platformDefaults.switcherStyle,
    };
  } finally {
    client.release();
  }
}

// codes=[] stores an explicit empty override, which getTenantLanguageSelection
// already treats the same as "no row" (selectedCodes: null, inherit all) —
// so this always upserts rather than deleting, keeping showHeaderSwitcher/
// multilangEnabled/defaultLanguage intact even when the language subset
// itself is cleared back to "inherit". switcherPosition/switcherStyle follow
// the same "always write the effective value the form showed" convention as
// the rest of this row — there's no separate "reset to global default" UI.
export async function setTenantLanguageSelection(
  tenantHost: string,
  codes: string[],
  showHeaderSwitcher: boolean,
  multilangEnabled: boolean,
  defaultLanguage: string | null,
  switcherPosition: string,
  switcherStyle: string,
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.tenantLanguages)
      .values({ tenantHost, enabledCodes: codes, showHeaderSwitcher, multilangEnabled, defaultLanguage, switcherPosition, switcherStyle })
      .onConflictDoUpdate({
        target: schema.tenantLanguages.tenantHost,
        set: { enabledCodes: codes, showHeaderSwitcher, multilangEnabled, defaultLanguage, switcherPosition, switcherStyle, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

// Instance-wide default language-switcher placement/style (Settings
// "Language Switcher" card) — same singleton-row pattern as MFA/proxy above.
export async function getLanguageSwitcherDefaults(): Promise<{ switcherPosition: string; switcherStyle: string }> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return await readSwitcherDefaults(db);
  } finally {
    client.release();
  }
}

export async function setLanguageSwitcherDefaults(switcherPosition: string, switcherStyle: string): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", switcherPosition, switcherStyle })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { switcherPosition, switcherStyle, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}
