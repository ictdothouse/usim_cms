import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// Runtime media storage driver (Settings > Storage, media-location phase 2) —
// same singleton-row pattern as backup-destination.ts. null = never saved:
// storage.ts falls back to the STORAGE_DRIVER/S3_* env vars, so an install
// that only ever configured .env keeps working untouched. The s3 block is
// kept even while driver is "local" — the serve route still redirects to the
// bucket for files a migration hasn't brought back yet (dual-read).
export interface S3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Where browsers fetch objects from — an R2 public bucket/custom domain or a
  // CDN in front of the bucket. "" = `${endpoint}/${bucket}` (path-style).
  publicUrlBase: string;
  forcePathStyle: boolean;
}

export interface MediaStorageConfig {
  driver: "local" | "s3";
  s3?: S3Settings;
}

export interface MaskedMediaStorage {
  driver: "local" | "s3";
  s3?: Omit<S3Settings, "secretAccessKey"> & { secretAccessKeySet: boolean };
}

export function maskMediaStorage(cfg: MediaStorageConfig): MaskedMediaStorage {
  if (!cfg.s3) return { driver: cfg.driver };
  const { secretAccessKey, ...rest } = cfg.s3;
  return { driver: cfg.driver, s3: { ...rest, secretAccessKeySet: Boolean(secretAccessKey) } };
}

// Progress of the one background media job (media-migration.ts). Lives in the
// DB, not process memory, so any api replica can report it and a second
// replica refuses to start a parallel run.
export interface MediaMigrationStatus {
  kind: "normalize" | "to-s3" | "to-local";
  state: "running" | "done" | "failed";
  deleteSource: boolean;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  tenantsTotal: number;
  tenantsDone: number;
  currentHost?: string;
  done: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors: string[];
}

async function readRow() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const [row] = await drizzle(client, { schema }).select().from(schema.platformSettings);
    return row;
  } finally {
    client.release();
  }
}

async function writeRow(set: Partial<typeof schema.platformSettings.$inferInsert>) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    await drizzle(client, { schema })
      .insert(schema.platformSettings)
      .values({ id: "singleton", ...set })
      .onConflictDoUpdate({ target: schema.platformSettings.id, set: { ...set, updatedAt: new Date() } });
  } finally {
    client.release();
  }
}

export async function getMediaStorageSetting(): Promise<MediaStorageConfig | null> {
  const value = (await readRow())?.mediaStorage as MediaStorageConfig | null | undefined;
  return value && typeof value === "object" && value.driver ? value : null;
}

export const setMediaStorageSetting = (config: MediaStorageConfig) => writeRow({ mediaStorage: config });

export async function getMediaMigrationStatus(): Promise<MediaMigrationStatus | null> {
  return ((await readRow())?.mediaMigration as MediaMigrationStatus | null | undefined) ?? null;
}

export const setMediaMigrationStatus = (status: MediaMigrationStatus) => writeRow({ mediaMigration: status });
