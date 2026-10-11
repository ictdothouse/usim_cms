import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { sql } from "drizzle-orm";
import { cacheInvalidate } from "./cache.js";
import {
  getTenantConnection,
  getTenantTheme,
  setTenantTheme,
  listTenants,
  getMediaMigrationStatus,
  setMediaMigrationStatus,
  type MediaMigrationStatus,
  type S3Settings,
} from "./db/tenant-pool.js";
import {
  contentTypeFor,
  getStorageConfig,
  isFile,
  isValidMediaKey,
  LEGACY_MOVED_MARKER,
  legacyTenantFolder,
  listS3Objects,
  localUploadsDir,
  makeS3Client,
  mediaDatePath,
  s3PublicUrl,
  tenantMediaPrefix,
} from "./storage.js";

// Media-location phases 2-3: the Settings > Storage connection probe and the
// one background media job. Every job is idempotent (a file already at the
// destination with the same size is skipped), so an interrupted run — api
// restart, deploy — is finished by simply starting it again. URLs never
// change between disk and bucket (storage.ts's scheme), so moving files needs
// no content rewrite; only the legacy normalize step rewrites URLs.

// --- connection probe (Settings "Test connection" + gate on saving s3) ---
export interface ProbeStep {
  step: "write" | "public-read" | "delete";
  ok: boolean;
  error?: string;
}

// Write -> fetch through the PUBLIC url -> delete. The public read is the step
// that matters most: a bucket that accepts writes but isn't publicly readable
// is exactly the "every image broken" failure this whole feature exists to
// prevent. ponytail: server-side fetch of a superadmin-supplied URL — fine for
// a superadmin-only route; restrict to an allowlist if that role widens.
export async function probeS3(s3: S3Settings): Promise<{ ok: boolean; steps: ProbeStep[] }> {
  const client = makeS3Client(s3);
  const key = `_probe/${randomBytes(8).toString("hex")}.txt`;
  const body = `ucms storage probe ${key}`;
  const steps: ProbeStep[] = [];
  const run = async (step: ProbeStep["step"], fn: () => Promise<void>) => {
    try {
      await fn();
      steps.push({ step, ok: true });
      return true;
    } catch (err) {
      steps.push({ step, ok: false, error: (err as Error).message || String(err) });
      return false;
    }
  };
  try {
    const wrote = await run("write", async () => {
      await client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: "text/plain" }));
    });
    if (wrote) {
      await run("public-read", async () => {
        const url = s3PublicUrl(s3, key);
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok || (await res.text()) !== body) throw new Error(`GET ${url} returned HTTP ${res.status}`);
      });
      await run("delete", async () => {
        await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
      });
    }
  } finally {
    client.destroy();
  }
  return { ok: steps.length === 3 && steps.every((s) => s.ok), steps };
}

// --- background job ---
// A run whose heartbeat stopped this long ago died with its process (deploy,
// crash) — a new run may start. Long enough to cover one slow large upload.
const STALE_MS = 10 * 60_000;
const MAX_ERRORS = 20;

interface Tenant {
  id: string;
  host: string;
  active: boolean;
}

interface Job {
  status: MediaMigrationStatus;
  s3?: S3Settings;
  client?: S3Client;
  report(force?: boolean): Promise<void>;
  fail(what: string, err: unknown): void;
}

// ponytail: two replicas clicking Start in the same instant could both pass
// the running check — superadmin-only button, not worth a DB lock.
export async function startMediaMigration(kind: MediaMigrationStatus["kind"], deleteSource: boolean): Promise<MediaMigrationStatus | string> {
  const current = await getMediaMigrationStatus();
  if (current?.state === "running" && Date.now() - Date.parse(current.updatedAt) < STALE_MS) return "a media migration is already running";
  const { s3 } = await getStorageConfig();
  if (kind !== "normalize" && !s3) return "no S3/R2 connection is configured";
  const tenants = await listTenants();
  const now = new Date().toISOString();
  const status: MediaMigrationStatus = {
    kind,
    state: "running",
    deleteSource: kind !== "normalize" && deleteSource,
    startedAt: now,
    updatedAt: now,
    tenantsTotal: tenants.length,
    tenantsDone: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    errors: [],
  };
  await setMediaMigrationStatus(status);
  void runJob(status, tenants, s3).catch((err) => console.error("[media-migration] job crashed", err));
  return status;
}

async function runJob(status: MediaMigrationStatus, tenants: Tenant[], s3: S3Settings | undefined): Promise<void> {
  let lastWrite = 0;
  const job: Job = {
    status,
    s3,
    client: s3 && status.kind !== "normalize" ? makeS3Client(s3) : undefined,
    async report(force = false) {
      if (!force && Date.now() - lastWrite < 2000) return;
      lastWrite = Date.now();
      status.updatedAt = new Date().toISOString();
      await setMediaMigrationStatus(status);
    },
    fail(what, err) {
      status.failed++;
      if (status.errors.length < MAX_ERRORS) status.errors.push(`${what}: ${(err as Error).message || String(err)}`);
    },
  };
  try {
    for (const t of tenants) {
      status.currentHost = t.host;
      await job.report(true);
      try {
        if (status.kind === "normalize") status.done += await normalizeLegacyTenant(t);
        else if (status.kind === "to-s3") {
          // Legacy flat files only ever exist on disk under a host-named
          // folder — bring them into the tenants/<id>/ tree first so they
          // travel to the bucket too. A suspended site has no DB connection
          // for the URL rewrite; its legacy files stay put until reactivated.
          if (t.active) status.done += await normalizeLegacyTenant(t);
          await tenantToS3(job, t);
        } else await tenantToLocal(job, t);
      } catch (err) {
        job.fail(t.host, err);
      }
      status.tenantsDone++;
    }
    status.state = "done";
  } catch (err) {
    status.state = "failed";
    job.fail("job", err);
  } finally {
    job.client?.destroy();
    status.currentHost = undefined;
    status.finishedAt = new Date().toISOString();
    await job.report(true);
  }
}

// Legacy uploads/<host_folder>/<uuid>.<ext> -> tenants/<id>/<yyyy>/<mm>/<same
// name>, plus every content reference rewritten to /uploads/<yyyy>/<mm>/.
// One month folder for the whole tenant (the run's month — the original
// upload month only lives in media.created_at, not on disk) keeps the rewrite
// a single prefix replace per column; filenames are UUIDs, so they can't
// collide with phase-1 names. Order is the safety net: hardlink (or copy) ->
// marker -> DB rewrite in one transaction -> only then unlink the old names.
// A failed rewrite unlinks the new names instead, leaving the tenant as it was.
// Returns how many files moved.
export async function normalizeLegacyTenant(t: { id: string; host: string }): Promise<number> {
  const folder = legacyTenantFolder(t.host);
  const legacyDir = path.join(localUploadsDir, folder);
  let names: string[];
  try {
    names = (await readdir(legacyDir)).filter((n) => n !== LEGACY_MOVED_MARKER);
  } catch {
    return 0; // no legacy uploads for this tenant
  }
  const markerPath = path.join(legacyDir, LEGACY_MOVED_MARKER);
  const month = (await readFile(markerPath, "utf8").catch(() => "")).trim() || mediaDatePath();
  // The prefix rewrite repoints EVERY /uploads/<folder>/ reference, so a name
  // that can't live under the new scheme would turn into a 404 — refuse the
  // whole tenant instead of half-moving it.
  const bad: string[] = [];
  for (const n of names) if (!isValidMediaKey(`${month}/${n}`) || !(await isFile(path.join(legacyDir, n)))) bad.push(n);
  if (bad.length) throw new Error(`uploads/${folder}/ has ${bad.length} entr(y/ies) the new scheme can't hold (e.g. "${bad[0]}") — move them by hand`);

  const targetDir = path.join(localUploadsDir, tenantMediaPrefix(t.id), month);
  await mkdir(targetDir, { recursive: true });
  const created: string[] = [];
  for (const n of names) {
    const dest = path.join(targetDir, n);
    if (await isFile(dest)) continue; // left by an interrupted earlier run
    // Hardlink: instant and no extra disk; copy only across filesystems.
    await link(path.join(legacyDir, n), dest).catch(() => copyFile(path.join(legacyDir, n), dest));
    created.push(dest);
  }
  await writeFile(markerPath, month);
  try {
    await rewriteTenantMediaUrls(t.host, `/uploads/${folder}/`, `/uploads/${month}/`, month);
  } catch (err) {
    await Promise.all(created.map((f) => rm(f, { force: true })));
    throw err;
  }
  await Promise.all(names.map((n) => rm(path.join(legacyDir, n), { force: true })));
  return names.length;
}

// Generic over the tenant schema — every text/varchar/jsonb column of every
// table (pages.layout/draft/translations, posts.body, menus, siteChrome,
// media.url, ...) so a table added later is covered without touching this.
// Append-only tables with no RLS UPDATE policy (page/post revisions, design
// templates) silently match 0 rows — fine, their old URLs keep resolving
// through the marker 301. Plain prefix replace, no regex: `from`/`to` are
// fixed /uploads/... strings that need no JSON escaping.
async function rewriteTenantMediaUrls(host: string, from: string, to: string, month: string): Promise<void> {
  const { db, release } = await getTenantConnection(host);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.authenticated = 'true'`);
      // Before the generic pass — it finds legacy rows by their old url.
      await tx.execute(sql`UPDATE media SET storage_key = ${`${month}/`} || filename WHERE storage_key IS NULL AND strpos(url, ${from}) > 0`);
      const { rows } = await tx.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
        SELECT c.table_name, c.column_name, c.data_type
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.is_generated = 'NEVER'
          AND c.data_type IN ('text', 'character varying', 'jsonb')`);
      for (const c of rows) {
        const tbl = sql.identifier(c.table_name);
        const col = sql.identifier(c.column_name);
        await tx.execute(
          c.data_type === "jsonb"
            ? sql`UPDATE ${tbl} SET ${col} = replace(${col}::text, ${from}, ${to})::jsonb WHERE strpos(${col}::text, ${from}) > 0`
            : sql`UPDATE ${tbl} SET ${col} = replace(${col}, ${from}, ${to}) WHERE strpos(${col}, ${from}) > 0`,
        );
      }
    });
  } finally {
    release();
  }
  // Logo/favicon live in the control-plane theme row, not the tenant DB.
  // Anything else outside the tenant DB still resolves via the marker 301.
  const theme = await getTenantTheme(host);
  const themeJson = theme ? JSON.stringify(theme) : "";
  if (themeJson.includes(from)) await setTenantTheme(host, JSON.parse(themeJson.replaceAll(from, to)) as Record<string, unknown>);
  await cacheInvalidate(`ucms:cache:${host}:`);
  await cacheInvalidate(`ucms:htmlcache:${host}:`);
}

async function tenantToS3(job: Job, t: Tenant): Promise<void> {
  const s3 = job.s3!;
  const client = job.client!;
  const prefix = tenantMediaPrefix(t.id);
  const root = path.join(localUploadsDir, prefix);
  let rels: string[];
  try {
    rels = (await readdir(root, { recursive: true })) as string[];
  } catch {
    return;
  }
  for (const raw of rels) {
    const rel = raw.split(path.sep).join("/");
    const full = path.join(root, raw);
    const st = await stat(full).catch(() => null);
    if (!st?.isFile() || !isValidMediaKey(rel)) continue;
    const key = `${prefix}/${rel}`;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: key })).catch(() => null);
      if (head?.ContentLength === st.size) job.status.skipped++;
      else {
        const params = { Bucket: s3.bucket, Key: key, Body: createReadStream(full), ContentType: contentTypeFor(rel) };
        await new Upload({ client, params }).done();
        job.status.done++;
        job.status.bytes += st.size;
      }
      if (job.status.deleteSource) await rm(full, { force: true });
    } catch (err) {
      job.fail(`${t.host} ${rel}`, err);
    }
    await job.report();
  }
}

async function tenantToLocal(job: Job, t: Tenant): Promise<void> {
  const s3 = job.s3!;
  const client = job.client!;
  const prefix = tenantMediaPrefix(t.id);
  for await (const batch of listS3Objects(client, s3.bucket, `${prefix}/`)) {
    for (const obj of batch) {
      const rel = obj.key.slice(prefix.length + 1);
      // Also the path-traversal guard for names that came from the bucket.
      if (!isValidMediaKey(rel)) continue;
      const dest = path.join(localUploadsDir, prefix, rel);
      // Temp name outside the tenant tree: a half-written file is never
      // served, nor picked up by a later to-s3 run.
      const tmp = path.join(localUploadsDir, `.migrate-${randomBytes(6).toString("hex")}`);
      try {
        const st = await stat(dest).catch(() => null);
        if (st?.size === obj.size) job.status.skipped++;
        else {
          const res = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: obj.key }));
          await mkdir(path.dirname(dest), { recursive: true });
          await pipeline(res.Body as Readable, createWriteStream(tmp));
          await rename(tmp, dest);
          job.status.done++;
          job.status.bytes += obj.size;
        }
        if (job.status.deleteSource) await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: obj.key }));
      } catch (err) {
        await rm(tmp, { force: true });
        job.fail(`${t.host} ${rel}`, err);
      }
      await job.report();
    }
  }
}
