import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getMediaStorageSetting, type MediaStorageConfig, type S3Settings } from "./db/tenant-pool/media-storage.js";

export interface UploadResult {
  url: string;
}

// --- driver config (phase 2) ---
// Settings > Storage (platform_settings.media_storage) wins; never saved = the
// STORAGE_DRIVER/S3_* env vars, exactly as before phase 2. STORAGE_DRIVER=s3
// with no bucket (install.sh's S3 prompt answered "y" then left blank) used to
// make every upload throw AND unregister /uploads/ — it falls back to local.
function envStorageConfig(): MediaStorageConfig {
  const bucket = process.env.S3_BUCKET;
  const s3: S3Settings | undefined = bucket
    ? {
        endpoint: process.env.S3_ENDPOINT ?? "",
        bucket,
        region: process.env.S3_REGION ?? "us-east-1",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        publicUrlBase: process.env.S3_PUBLIC_URL_BASE ?? "",
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      }
    : undefined;
  return { driver: process.env.STORAGE_DRIVER === "s3" && s3 ? "s3" : "local", s3 };
}
if (process.env.STORAGE_DRIVER === "s3" && !process.env.S3_BUCKET) {
  console.warn("[storage] STORAGE_DRIVER=s3 but S3_BUCKET is empty — using local disk uploads instead");
}

// Re-read every 30s so a save on one api replica reaches the others without a
// restart; the replica that saved drops its own cache immediately.
const CONFIG_TTL_MS = 30_000;
let configCache: { cfg: MediaStorageConfig; at: number } | undefined;

export async function getStorageConfig(): Promise<MediaStorageConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.cfg;
  try {
    const cfg = (await getMediaStorageSetting()) ?? envStorageConfig();
    configCache = { cfg, at: Date.now() };
    return cfg;
  } catch (err) {
    // Control-plane blip: keep the last known driver rather than silently
    // flipping to the env one.
    if (configCache) return configCache.cfg;
    throw err;
  }
}

export function invalidateStorageConfig(): void {
  configCache = undefined;
}

// --- local disk driver (default) ---
export const localUploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");

// Pre-phase-1 flat folder name: uploads/<host_folder>/<uuid>.<ext>.
export const legacyTenantFolder = (host: string) => host.toLowerCase().replace(/[^a-z0-9]/g, "_");

// Written into a legacy folder by the normalize job (media-migration.ts):
// holds the <yyyy>/<mm> its files were moved to, so routes/media.ts can 301
// an old /uploads/<host_folder>/<file> link to the new URL. Dotfile = never
// served by the static plugin itself.
export const LEGACY_MOVED_MARKER = ".moved-to";

// --- media location scheme (phase 1) ---
// Storage: tenants/<tenantId>/<yyyy>/<mm>/<file> — keyed by the tenant's
// immutable registry id, not its hostname, so nothing on disk/S3 is named
// after a domain. Public URL: /uploads/<yyyy>/<mm>/<file> on the tenant's own
// domain (routes/media.ts resolves the tenant from Host) — no tenant id or
// host_folder in the URL, so a cross-host restore/clone only re-homes files,
// never rewrites a media path, and the same key sits on disk or in the bucket.
export const tenantMediaPrefix = (tenantId: string) => `tenants/${tenantId}`;

export function mediaDatePath(d = new Date()): string {
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// "Banner Utama (Final).PNG" -> "banner-utama-final-1a2b3c4d". The random
// suffix keeps every stored name unique — the 1y immutable cache on served
// files relies on a name never being reused for different bytes.
export function mediaStem(originalName: string): string {
  const slug =
    path
      .parse(originalName)
      .name.normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "file";
  return `${slug}-${randomBytes(4).toString("hex")}`;
}

// Tenant-relative key as it appears after /uploads/ — also the traversal
// guard for the public serve route, zip restore, and S3->local migration.
export function isValidMediaKey(key: string): boolean {
  return /^\d{4}\/\d{2}\/[a-z0-9][a-z0-9._-]*$/.test(key) && !key.includes("..");
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// Recursively sums file sizes under `dir` — used for a tenant's uploads
// folder. Returns null (not 0) when the folder doesn't exist at all yet
// (a tenant with no uploads), so callers can tell "empty" from "unmeasurable" apart from a real zero.
export async function dirSizeBytes(dir: string): Promise<number | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += (await dirSizeBytes(full)) ?? 0;
    } else {
      try {
        total += (await stat(full)).size;
      } catch {
        // File removed mid-scan — ignore, not worth failing the whole sum.
      }
    }
  }
  return total;
}

// Without it S3/R2 serves everything as application/octet-stream — a <video>
// or PDF link downloads instead of playing/opening.
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};
export const contentTypeFor = (filename: string) => MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";

// --- S3-compatible driver: AWS S3, Cloudflare R2, MinIO, or on-prem object
// storage (e.g. Sangfor) that speaks the S3 API. forcePathStyle is needed by
// most non-AWS S3-compatible providers. ---
export function makeS3Client(s3: S3Settings): S3Client {
  return new S3Client({
    region: s3.region || "us-east-1",
    endpoint: s3.endpoint || undefined,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
}

let clientCache: { key: string; client: S3Client } | undefined;
export function activeS3Client(s3: S3Settings): S3Client {
  const key = JSON.stringify(s3);
  if (clientCache?.key !== key) clientCache = { key, client: makeS3Client(s3) };
  return clientCache.client;
}

export function s3PublicUrl(s3: S3Settings, key: string): string {
  const base =
    s3.publicUrlBase || (s3.endpoint ? `${s3.endpoint}/${s3.bucket}` : `https://${s3.bucket}.s3.${s3.region || "us-east-1"}.amazonaws.com`);
  return `${base.replace(/\/+$/, "")}/${key}`;
}

export async function* listS3Objects(client: S3Client, bucket: string, prefix: string): AsyncGenerator<Array<{ key: string; size: number }>> {
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    yield (res.Contents ?? []).flatMap((o) => (o.Key ? [{ key: o.Key, size: o.Size ?? 0 }] : []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

export async function uploadFile(tenantFolder: string, filename: string, stream: Readable): Promise<UploadResult> {
  const { driver, s3 } = await getStorageConfig();
  if (driver === "s3" && s3) {
    const key = `${tenantFolder}/${filename}`;
    const params = { Bucket: s3.bucket, Key: key, Body: stream, ContentType: contentTypeFor(filename) };
    await new Upload({ client: activeS3Client(s3), params }).done();
    return { url: s3PublicUrl(s3, key) };
  }
  const dir = path.join(localUploadsDir, tenantFolder);
  await mkdir(dir, { recursive: true });
  await pipeline(stream, createWriteStream(path.join(dir, filename)));
  return { url: `/uploads/${tenantFolder}/${filename}` };
}

// Removes both copies — mid-migration a file may sit on disk, in the bucket,
// or both. A bucket failure only matters while the bucket is the live driver.
export async function deleteFile(tenantFolder: string, filename: string): Promise<void> {
  await rm(path.join(localUploadsDir, tenantFolder, filename), { force: true });
  const { driver, s3 } = await getStorageConfig();
  if (!s3) return;
  try {
    await activeS3Client(s3).send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: `${tenantFolder}/${filename}` }));
  } catch (err) {
    if (driver === "s3") throw err;
    console.warn(`[storage] bucket delete of ${tenantFolder}/${filename} skipped: ${(err as Error).message}`);
  }
}

// Tenant delete: drop everything under tenants/<id>/ in the bucket too.
export async function deleteRemotePrefix(prefix: string): Promise<void> {
  const { s3 } = await getStorageConfig();
  if (!s3) return;
  const client = activeS3Client(s3);
  for await (const batch of listS3Objects(client, s3.bucket, `${prefix}/`)) {
    if (batch.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: s3.bucket, Delete: { Objects: batch.map((o) => ({ Key: o.key })) } }));
    }
  }
}
