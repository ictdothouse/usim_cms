import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export interface UploadResult {
  url: string;
}

const DRIVER = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";

// --- local disk driver (default) ---
export const localUploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");

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
  const publicBase = process.env.S3_PUBLIC_URL_BASE ?? `${process.env.S3_ENDPOINT}/${bucket}`;
  return { url: `${publicBase}/${key}` };
}

export function uploadFile(tenantFolder: string, filename: string, stream: Readable): Promise<UploadResult> {
  return DRIVER === "s3" ? uploadS3(tenantFolder, filename, stream) : uploadLocal(tenantFolder, filename, stream);
}

export const isLocalDriver = DRIVER === "local";
