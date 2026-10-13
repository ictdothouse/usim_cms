import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

export interface EdgeProtectionSettings {
  enabled: boolean;
  providerName: string;
  trustedProxyCidrs: string[];
  originLockdownConfirmed: boolean;
}

export const DEFAULT_EDGE_PROTECTION: EdgeProtectionSettings = {
  enabled: false,
  providerName: "",
  trustedProxyCidrs: [],
  originLockdownConfirmed: false,
};

function normalize(value: unknown): EdgeProtectionSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_EDGE_PROTECTION };
  const raw = value as Partial<EdgeProtectionSettings>;
  const cidrs = Array.isArray(raw.trustedProxyCidrs) ? raw.trustedProxyCidrs.filter((v): v is string => typeof v === "string") : [];
  return {
    enabled: raw.enabled === true,
    providerName: typeof raw.providerName === "string" ? raw.providerName : "",
    trustedProxyCidrs: cidrs,
    originLockdownConfirmed: raw.originLockdownConfirmed === true,
  };
}

export async function getEdgeProtectionSettings(): Promise<EdgeProtectionSettings> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const [row] = await drizzle(client, { schema }).select().from(schema.platformSettings);
    return normalize(row?.edgeProtection);
  } finally {
    client.release();
  }
}

export async function setEdgeProtectionSettings(settings: EdgeProtectionSettings): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    await drizzle(client, { schema })
      .insert(schema.platformSettings)
      .values({ id: "singleton", edgeProtection: settings })
      .onConflictDoUpdate({ target: schema.platformSettings.id, set: { edgeProtection: settings, updatedAt: new Date() } });
  } finally {
    client.release();
  }
}
