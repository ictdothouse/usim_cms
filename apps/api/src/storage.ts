import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export interface UploadResult {
  url: string;
}

// STORAGE_DRIVER=s3 with no bucket (e.g. install.sh's S3 prompt answered "y"
// then left blank) used to make every upload throw "S3_BUCKET not configured"
// AND unregister /uploads/ — falls back to local disk instead.
const s3Requested = process.env.STORAGE_DRIVER === "s3";
const DRIVER = s3Requested && process.env.S3_BUCKET ? "s3" : "local";
if (s3Requested && DRIVER === "local") {
  console.warn("[storage] STORAGE_DRIVER=s3 but S3_BUCKET is empty — using local disk uploads instead");
}

// --- local disk driver (default) ---
export const localUploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");

// --- media location scheme (phase 1) ---
// Storage: tenants/<tenantId>/<yyyy>/<mm>/<file> — keyed by the tenant's
// immutable registry id, not its hostname, so nothing on disk/S3 is named
// after a domain. Public URL: /uploads/<yyyy>/<mm>/<file> on the tenant's own
// domain (routes/media.ts resolves the tenant from Host) — no tenant id or
// host_folder in the URL, so a cross-host restore/clone only re-homes files,
// never rewrites a media path. Legacy rows stay flat under
// uploads/<host_folder>/<uuid>.<ext> and keep being served as-is.
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
// guard for the public serve route.
export function isValidMediaKey(key: string): boolean {
  return /^\d{4}\/\d{2}\/[a-z0-9][a-z0-9._-]*$/.test(key) && !key.includes("..");
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

async function uploadLocal(tenantFolder: string, filename: string, stream: Readable): Promise<UploadResult> {
  const dir = path.join(localUploadsDir, tenantFolder);
  await mkdir(dir, { recursive: true });
  await pipeline(stream, createWriteStream(path.join(dir, filename)));
  return { url: `/uploads/${tenantFolder}/${filename}` };
}

// --- S3-compatible driver: AWS S3, MinIO, or on-prem object storage (e.g.
// Sangfor) that speaks the S3 API. forcePathStyle is needed by most
// non-AWS S3-compatible providers. ---
let s3Client: S3Client | undefined;
function getS3Client(): S3Client {
  if (s3Client) return s3Client;
  const config: S3ClientConfig = {
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  };
  s3Client = new S3Client(config);
  return s3Client;
}

async function uploadS3(tenantFolder: string, filename: string, stream: Readable): Promise<UploadResult> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured (set S3_BUCKET env var)");
  const key = `${tenantFolder}/${filename}`;
  const upload = new Upload({ client: getS3Client(), params: { Bucket: bucket, Key: key, Body: stream } });
  await upload.done();
  return { url: s3PublicUrl(key) };
}

export function s3PublicUrl(key: string): string {
  const publicBase = process.env.S3_PUBLIC_URL_BASE ?? `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`;
  return `${publicBase}/${key}`;
}

export function uploadFile(tenantFolder: string, filename: string, stream: Readable): Promise<UploadResult> {
  return DRIVER === "s3" ? uploadS3(tenantFolder, filename, stream) : uploadLocal(tenantFolder, filename, stream);
}

export async function deleteFile(tenantFolder: string, filename: string): Promise<void> {
  if (DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET not configured (set S3_BUCKET env var)");
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: `${tenantFolder}/${filename}` }));
    return;
  }
  await rm(path.join(localUploadsDir, tenantFolder, filename), { force: true });
}

export const isLocalDriver = DRIVER === "local";
