import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

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

// Same singleton-row pattern as getMfaEnabled/setMfaEnabled above — see
// schema.ts's platformSettings.mfaRequired comment for what it means.
export async function getMfaRequired(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.platformSettings);
    return row?.mfaRequired ?? false;
  } finally {
    client.release();
  }
}

export async function setMfaRequired(required: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", mfaRequired: required })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { mfaRequired: required, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}

export interface EntraSettings {
  entraEnabled: boolean;
  entraOnly: boolean;
  entraTenantId: string | null;
  entraClientId: string | null;
}

// Same singleton-row pattern as getMfaEnabled/setMfaEnabled above — see
// schema.ts's platformSettings comment for what entraOnly's break-glass
// exemption means.
export async function getEntraSettings(): Promise<EntraSettings> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.platformSettings);
    return {
      entraEnabled: row?.entraEnabled ?? false,
      entraOnly: row?.entraOnly ?? false,
      entraTenantId: row?.entraTenantId ?? null,
      entraClientId: row?.entraClientId ?? null,
    };
  } finally {
    client.release();
  }
}

export async function setEntraSettings(patch: Partial<EntraSettings>): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", ...patch })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { ...patch, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}
