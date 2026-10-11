import type { FastifyInstance } from "fastify";
import { verifySuperadmin } from "../plugins/auth.js";
import {
  getMediaStorageSetting,
  setMediaStorageSetting,
  maskMediaStorage,
  getMediaMigrationStatus,
  insertAuditLog,
  type MediaStorageConfig,
} from "../db/tenant-pool.js";
import { getStorageConfig, invalidateStorageConfig } from "../storage.js";
import { probeS3, startMediaMigration } from "../media-migration.js";

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,62}$/;
const REGION_RE = /^[a-z0-9-]{0,40}$/;

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// `existing` = the effective config (saved row, else env), so a blank secret
// on an edit keeps the stored one — same convention as validateBackupDestination.
function validateMediaStorage(body: unknown, existing: MediaStorageConfig): string | MediaStorageConfig {
  const b = (body as Record<string, unknown>) || {};
  const driver = b.driver;
  if (driver !== "local" && driver !== "s3") return "driver must be local or s3";
  const raw = (b.s3 as Record<string, unknown>) || {};
  const bucket = String(raw.bucket ?? "").trim();
  // No bucket = no S3 connection at all (local, form cleared).
  if (!bucket) return driver === "s3" ? "s3 settings are required for the s3 driver" : { driver };
  const endpoint = String(raw.endpoint ?? "").trim().replace(/\/+$/, "");
  const region = String(raw.region ?? "").trim();
  const accessKeyId = String(raw.accessKeyId ?? "").trim();
  const secretAccessKey = String(raw.secretAccessKey ?? "") || existing.s3?.secretAccessKey || "";
  const publicUrlBase = String(raw.publicUrlBase ?? "").trim().replace(/\/+$/, "");
  if (!isHttpUrl(endpoint)) return "s3.endpoint must be an http(s) URL";
  if (!BUCKET_RE.test(bucket)) return "s3.bucket is not a valid bucket name";
  if (!REGION_RE.test(region)) return "s3.region may contain only lowercase letters, digits and dashes";
  if (!accessKeyId || /\s/.test(accessKeyId)) return "s3.accessKeyId is required";
  if (!secretAccessKey || /\s/.test(secretAccessKey)) return "s3.secretAccessKey is required";
  if (publicUrlBase && !isHttpUrl(publicUrlBase)) return "s3.publicUrlBase must be an http(s) URL";
  return {
    driver,
    s3: { endpoint, bucket, region, accessKeyId, secretAccessKey, publicUrlBase, forcePathStyle: raw.forcePathStyle !== false },
  };
}

// Settings > Storage (media-location phases 2-3), superadmin-only. The
// cache drop before each read makes this replica see a save made on another
// one immediately, not after storage.ts's 30s TTL.
export function registerMediaStorageRoutes(app: FastifyInstance) {
  async function view(source?: "settings" | "env") {
    invalidateStorageConfig();
    return {
      source: source ?? ((await getMediaStorageSetting()) ? "settings" : "env"),
      config: maskMediaStorage(await getStorageConfig()),
      migration: await getMediaMigrationStatus(),
    };
  }

  app.get("/api/portal/media-storage", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return view();
  });

  app.put("/api/portal/media-storage", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    invalidateStorageConfig();
    const result = validateMediaStorage(req.body, await getStorageConfig());
    if (typeof result === "string") {
      reply.code(400);
      return { error: result };
    }
    // Never point live uploads at a bucket that fails the probe — an
    // unusable S3 config is how every image on the demo VPS broke (2026-10-11).
    if (result.driver === "s3") {
      const failed = (await probeS3(result.s3!)).steps.find((s) => !s.ok);
      if (failed) {
        reply.code(400);
        return { error: `S3/R2 connection test failed at "${failed.step}": ${failed.error ?? "no response"} — not saved` };
      }
    }
    await setMediaStorageSetting(result);
    await insertAuditLog({
      actorUserId: session.userId,
      actorEmail: session.email,
      action: "platform.media_storage",
      meta: { driver: result.driver, bucket: result.s3?.bucket ?? null },
      ip: req.ip,
    });
    return view("settings");
  });

  // Probe a not-yet-saved form (blank secret = the stored one).
  app.post("/api/portal/media-storage/test", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    invalidateStorageConfig();
    const result = validateMediaStorage({ ...((req.body as object) || {}), driver: "s3" }, await getStorageConfig());
    if (typeof result === "string") {
      reply.code(400);
      return { error: result };
    }
    return probeS3(result.s3!);
  });

  app.post("/api/portal/media-storage/migrate", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const { kind, deleteSource } = ((req.body as Record<string, unknown>) || {}) as { kind?: string; deleteSource?: boolean };
    if (kind !== "normalize" && kind !== "to-s3" && kind !== "to-local") {
      reply.code(400);
      return { error: "kind must be normalize, to-s3 or to-local" };
    }
    const result = await startMediaMigration(kind, deleteSource === true);
    if (typeof result === "string") {
      reply.code(409);
      return { error: result };
    }
    await insertAuditLog({
      actorUserId: session.userId,
      actorEmail: session.email,
      action: "platform.media_migration",
      meta: { kind, deleteSource: result.deleteSource },
      ip: req.ip,
    });
    return { migration: result };
  });
}
