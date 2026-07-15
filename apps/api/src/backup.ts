import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { getTenantConnection, getTenantTheme, setTenantTheme } from "./db/tenant-pool.js";
import { localUploadsDir } from "./storage.js";
import * as schema from "./db/schema.js";

// Tenant backup/restore/static-export. JSON dump instead of pg_dump on
// purpose: restores work across Postgres versions and managed DBs where
// pg_dump access may not exist, and a backup taken on server A restores on
// server B under a different tenant host — that IS the "easy migration" path.
// ponytail: whole zip is built in memory — fine for department sites
// (uploads capped at 5 MB/file); switch to streaming zip if a tenant's
// media grows past a few hundred MB. Local storage driver only; S3-stored
// media is referenced by URL in the dump but not bundled.

const BACKUP_VERSION = 1;
const tenantFolder = (host: string) => host.toLowerCase().replace(/[^a-z0-9]/g, "_");

const DATE_KEYS = new Set(["createdAt", "updatedAt", "publishedAt"]);
function reviveDates(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  for (const row of rows) {
    for (const key of DATE_KEYS) {
      if (typeof row[key] === "string") row[key] = new Date(row[key] as string);
    }
  }
  return rows;
}

export async function exportTenantBackup(host: string): Promise<Uint8Array> {
  const { db, release } = await getTenantConnection(host);
  let pages, posts, media, mediaFolders;
  try {
    [pages, posts, media, mediaFolders] = await Promise.all([
      db.select().from(schema.pages),
      db.select().from(schema.posts),
      db.select().from(schema.media),
      db.select().from(schema.mediaFolders),
    ]);
  } finally {
    release();
  }
  const files: Record<string, Uint8Array> = {
    "backup.json": strToU8(
      JSON.stringify({
        version: BACKUP_VERSION,
        sourceHost: host,
        exportedAt: new Date().toISOString(),
        tables: { pages, posts, media, mediaFolders },
        theme: await getTenantTheme(host),
      }),
    ),
  };
  const dir = path.join(localUploadsDir, tenantFolder(host));
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      files[`uploads/${name}`] = readFileSync(path.join(dir, name));
    }
  }
  return zipSync(files);
}

export async function importTenantBackup(host: string, zip: Uint8Array): Promise<{ restored: string[] }> {
  const entries = unzipSync(zip);
  const manifest = entries["backup.json"];
  if (!manifest) throw new Error("Not a backup zip: backup.json missing");
  let raw = strFromU8(manifest);
  const sourceHost = (JSON.parse(raw) as { sourceHost: string }).sourceHost;
  // Cross-host restore (= migration): media URLs embed the tenant folder —
  // rewrite them to the target host's folder everywhere (media.url, page
  // layout JSON, post body HTML) in one pass on the serialized dump.
  if (sourceHost !== host) {
    raw = raw.replaceAll(`/uploads/${tenantFolder(sourceHost)}/`, `/uploads/${tenantFolder(host)}/`);
  }
  const backup = JSON.parse(raw) as {
    version: number;
    tables: {
      pages: Record<string, unknown>[];
      posts: Record<string, unknown>[];
      media: Record<string, unknown>[];
      // Older backups (pre-media-folders) won't have this key.
      mediaFolders?: Record<string, unknown>[];
    };
    theme: Record<string, unknown> | null;
  };
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${backup.version}`);

  const { db, release } = await getTenantConnection(host);
  try {
    // Full replace, not merge — a restore means "make the tenant look like
    // the backup". Wipe in FK-safe order: media references media_folders.
    await db.delete(schema.media);
    await db.delete(schema.posts);
    await db.delete(schema.pages);
    await db.delete(schema.mediaFolders);
    const { pages, posts, media, mediaFolders = [] } = backup.tables;
    if (mediaFolders.length)
      await db.insert(schema.mediaFolders).values(reviveDates(mediaFolders) as (typeof schema.mediaFolders.$inferInsert)[]);
    if (pages.length) await db.insert(schema.pages).values(reviveDates(pages) as (typeof schema.pages.$inferInsert)[]);
    if (posts.length) await db.insert(schema.posts).values(reviveDates(posts) as (typeof schema.posts.$inferInsert)[]);
    if (media.length) await db.insert(schema.media).values(reviveDates(media) as (typeof schema.media.$inferInsert)[]);
  } finally {
    release();
  }
  if (backup.theme) await setTenantTheme(host, backup.theme);

  const dir = path.join(localUploadsDir, tenantFolder(host));
  const restored: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith("uploads/") || name === "uploads/") continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, path.basename(name)), data);
    restored.push(name);
  }
  return { restored };
}

// ---------- static export ----------

// Where the Astro SSR frontend answers internally (compose: http://frontend:4321).
const FRONTEND_INTERNAL_URL = process.env.FRONTEND_INTERNAL_URL ?? "http://localhost:4321";

// node:http instead of fetch: undici's fetch forbids overriding the Host
// header, which is exactly how the frontend resolves the tenant.
function internalGet(urlPath: string, host: string): Promise<{ status: number; body: Buffer }> {
  const base = new URL(FRONTEND_INTERNAL_URL);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: base.hostname, port: base.port, path: urlPath, headers: { host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Renders every page/post through the real frontend and bundles the HTML
// plus any referenced local assets (/_astro/*, /uploads/*) into a zip that
// works on any static host. ponytail: regex asset discovery, not a real
// crawler — enough for archive/handover; nested client-side fetches won't
// be picked up.
export async function exportStaticSite(host: string): Promise<Uint8Array> {
  const { db, release } = await getTenantConnection(host);
  let pages, posts;
  try {
    [pages, posts] = await Promise.all([
      db.select({ slug: schema.pages.slug }).from(schema.pages),
      db.select({ slug: schema.posts.slug }).from(schema.posts),
    ]);
  } finally {
    release();
  }

  const files: Record<string, Uint8Array> = {};
  const assets = new Set<string>();
  const routes: Array<{ urlPath: string; file: string }> = [
    ...pages.map((p) => ({ urlPath: `/${p.slug}`, file: p.slug === "home" ? "index.html" : `${p.slug}.html` })),
    ...posts.map((p) => ({ urlPath: `/posts/${p.slug}`, file: `posts/${p.slug}.html` })),
  ];
  for (const { urlPath, file } of routes) {
    const res = await internalGet(urlPath, host);
    if (res.status !== 200) continue; // unpublished/broken page — skip, don't fail the whole export
    const html = res.body.toString("utf8");
    files[file] = strToU8(html);
    for (const match of html.matchAll(/(?:src|href)="(\/(?:_astro|uploads)\/[^"]+)"/g)) {
      assets.add(match[1]);
    }
  }
  for (const assetPath of assets) {
    const res = await internalGet(assetPath, host);
    if (res.status === 200) files[assetPath.slice(1)] = res.body;
  }
  if (Object.keys(files).length === 0) throw new Error("Nothing exported — is the frontend running and the tenant published?");
  return zipSync(files);
}
