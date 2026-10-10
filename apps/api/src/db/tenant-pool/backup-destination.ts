import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// Off-site push target for the nightly backup cron (install.sh's
// install_backup_cron/run.sh) — same singleton-row pattern as mfa-entra.ts.
// "local" (default) means the dump/uploads snapshot never leaves this VPS;
// the other three types all get pushed somewhere else after the local run.
export type BackupDestinationType = "local" | "ssh" | "s3" | "gdrive";

export interface BackupDestinationConfig {
  type: BackupDestinationType;
  ssh?: { target: string };
  s3?: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
  gdrive?: { folderId: string; serviceAccountJson: string };
}

// What the browser ever sees — secrets are reported as a boolean "is one
// already stored", never round-tripped in plaintext once saved. Mirrors the
// masking monitor/server.js does independently (it has no pg driver to share
// this module with — see that file's own comment on why it shells to psql).
export interface MaskedBackupDestination {
  type: BackupDestinationType;
  ssh?: { target: string };
  s3?: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKeySet: boolean };
  gdrive?: { folderId: string; serviceAccountConfigured: boolean };
}

export function maskBackupDestination(cfg: BackupDestinationConfig): MaskedBackupDestination {
  const out: MaskedBackupDestination = { type: cfg.type };
  if (cfg.ssh) out.ssh = { target: cfg.ssh.target };
  if (cfg.s3) {
    out.s3 = {
      endpoint: cfg.s3.endpoint,
      bucket: cfg.s3.bucket,
      region: cfg.s3.region,
      accessKeyId: cfg.s3.accessKeyId,
      secretAccessKeySet: Boolean(cfg.s3.secretAccessKey),
    };
  }
  if (cfg.gdrive) {
    out.gdrive = { folderId: cfg.gdrive.folderId, serviceAccountConfigured: Boolean(cfg.gdrive.serviceAccountJson) };
  }
  return out;
}

export async function getBackupDestination(): Promise<BackupDestinationConfig> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.platformSettings);
    const value = row?.backupDestination as BackupDestinationConfig | undefined;
    return value && typeof value === "object" && value.type ? value : { type: "local" };
  } finally {
    client.release();
  }
}

export async function setBackupDestination(config: BackupDestinationConfig): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .insert(schema.platformSettings)
      .values({ id: "singleton", backupDestination: config })
      .onConflictDoUpdate({
        target: schema.platformSettings.id,
        set: { backupDestination: config, updatedAt: new Date() },
      });
  } finally {
    client.release();
  }
}
