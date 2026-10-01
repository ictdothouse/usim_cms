import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// Shared by getSeoDefaults (its own client) and getTenantSeoDefaults (an
// existing client, to resolve a tenant's inherited value without a second
// DB round-trip) — same pattern as languages.ts's readSwitcherDefaults.
async function readSeoDefaults(db: NodePgDatabase<typeof schema>): Promise<{ titleTemplate: string; defaultDescription: string }> {
  const [row] = await db.select().from(schema.platformSettings);
  return { titleTemplate: row?.seoTitleTemplate ?? "", defaultDescription: row?.seoDefaultDescription ?? "" };
}

// Instance-wide default title template/description (Settings "SEO & AEO
// Defaults" card) — same singleton-row pattern as the language-switcher
// defaults in languages.ts.
export async function getSeoDefaults(): Promise<{ titleTemplate: string; defaultDescription: string }> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return await readSeoDefaults(db);
  } finally {
    client.release();
  }
}

export async function setSeoDefaults(titleTemplate: string, defaultDescription: string): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", seoTitleTemplate: titleTemplate, seoDefaultDescription: defaultDescription })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { seoTitleTemplate: titleTemplate, seoDefaultDescription: defaultDescription, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

// i18n Phase/switcher-placement's own resolve-at-read-time convention,
// applied to SEO defaults: a tenant's own site_theme columns (both
// nullable) win when set, otherwise the global default above.
export async function getTenantSeoDefaults(tenantHost: string): Promise<{ titleTemplate: string; defaultDescription: string }> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db
      .select({ seoTitleTemplate: schema.siteTheme.seoTitleTemplate, seoDefaultDescription: schema.siteTheme.seoDefaultDescription })
      .from(schema.siteTheme)
      .where(eq(schema.siteTheme.tenantHost, tenantHost));
    const globalDefaults = await readSeoDefaults(db);
    return {
      titleTemplate: row?.seoTitleTemplate ?? globalDefaults.titleTemplate,
      defaultDescription: row?.seoDefaultDescription ?? globalDefaults.defaultDescription,
    };
  } finally {
    client.release();
  }
}

// Always writes the exact (already-resolved) values the admin form showed —
// same "no separate reset-to-inherit affordance" convention switcherPosition/
// switcherStyle's own per-site write already uses (see languages.ts's
// setTenantLanguageSelection comment). Partial upsert: only these two
// columns are touched on conflict, never site_theme's own `settings` jsonb
// bag (theme.ts's setTenantTheme/setGlobalTheme write that column the same
// partial way, so the two features never clobber each other's half of this
// shared row).
export async function setTenantSeoDefaults(tenantHost: string, titleTemplate: string, defaultDescription: string): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.siteTheme)
      .values({ tenantHost, seoTitleTemplate: titleTemplate, seoDefaultDescription: defaultDescription })
      .onConflictDoUpdate({
        target: schema.siteTheme.tenantHost,
        set: { seoTitleTemplate: titleTemplate, seoDefaultDescription: defaultDescription, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}
