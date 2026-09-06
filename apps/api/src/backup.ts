import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { sql } from "drizzle-orm";
import { getTenantConnection, getTenantTheme, setTenantTheme } from "./db/tenant-pool.js";
import { localUploadsDir, dirSizeBytes } from "./storage.js";
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

// Shared by export (guards the in-memory zip build below) and restore
// (guards decompression further down) — this whole pipeline buffers a
// tenant's uploads fully in RAM via fflate's sync zipSync/unzipSync, fine
// for department sites (uploads capped at 5 MB/file, a few hundred MB of
// media total) but not a tool for a tenant with a genuinely large media
// library: past this size, use a filesystem-level copy (rsync/tar) of
// uploads/<tenantFolder>/ directly instead — streaming this pipeline
// properly is a real rewrite, not warranted while the practical answer for
// "large media, single shared process" is "don't put it through this path".
const MAX_LOCAL_MEDIA_BACKUP_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

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
  let pages, posts, media, mediaFolders, siteChrome, categories;
  try {
    // This root-scope call never goes through tenantPlugin/requireTenantAuth
    // (see plugins/auth.ts), so nothing else sets the RLS flag draft rows
    // and writes need — set it directly on this connection.
    await db.execute(sql`SET SESSION app.authenticated = 'true'`);
    [pages, posts, media, mediaFolders, siteChrome, categories] = await Promise.all([
      db.select().from(schema.pages),
      db.select().from(schema.posts),
      db.select().from(schema.media),
      db.select().from(schema.mediaFolders),
      // pages.headerId/footerId are real FKs into site_chrome — without this
      // table in the dump, restoring into a fresh tenant (clone/promote) 400s
      // on the very first page insert since those ids don't exist yet there.
      db.select().from(schema.siteChrome),
      // posts.categoryId is a real FK into categories — same failure mode as
      // site_chrome above, just surfaces on the posts insert instead.
      db.select().from(schema.categories),
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
        tables: { pages, posts, media, mediaFolders, siteChrome, categories },
        theme: await getTenantTheme(host),
      }),
    ),
  };
  const dir = path.join(localUploadsDir, tenantFolder(host));
  if (existsSync(dir)) {
    const mediaBytes = (await dirSizeBytes(dir)) ?? 0;
    if (mediaBytes > MAX_LOCAL_MEDIA_BACKUP_BYTES) {
      throw new Error(
        `${host}'s uploads folder is ${(mediaBytes / 1024 / 1024).toFixed(0)} MB — too large for this zip-backup ` +
          `path (buffers everything in memory). Use a filesystem copy (rsync/tar) of uploads/${tenantFolder(host)}/ ` +
          `instead; this export still covers the database rows and theme.`,
      );
    }
    for (const name of readdirSync(dir)) {
      files[`uploads/${name}`] = readFileSync(path.join(dir, name));
    }
  }
  return zipSync(files);
}

// Design/skeleton clone: same page rows as a full backup, but block props
// (the actual text/images) are stripped to just the block type/order, and
// posts/media are dropped entirely — only site structure + theme survive.
// Produces the same backup.json shape as exportTenantBackup, so it imports
// through the existing importTenantBackup unchanged.
export async function exportTenantDesignClone(host: string): Promise<Uint8Array> {
  const { db, release } = await getTenantConnection(host);
  let pages, siteChrome;
  try {
    await db.execute(sql`SET SESSION app.authenticated = 'true'`);
    [pages, siteChrome] = await Promise.all([db.select().from(schema.pages), db.select().from(schema.siteChrome)]);
  } finally {
    release();
  }
  const skeletonPages = pages.map((p) => ({
    ...p,
    layout: (p.layout as Array<{ type: string }>).map((block) => ({ type: block.type })),
    bannerImageUrl: null,
    status: "draft",
    publishedAt: null,
  }));
  return zipSync({
    "backup.json": strToU8(
      JSON.stringify({
        version: BACKUP_VERSION,
        sourceHost: host,
        exportedAt: new Date().toISOString(),
        // A page's headerId/footerId still points at these real site_chrome
        // rows even in a skeleton clone (see exportTenantBackup's own comment
        // on why this table can't be dropped) — header/footer design is
        // structure, not content, so keeping it here matches this clone
        // type's own "site structure + theme survive" premise anyway.
        tables: { pages: skeletonPages, posts: [], media: [], mediaFolders: [], siteChrome },
        theme: await getTenantTheme(host),
      }),
    ),
  });
}

export interface CloneMeta {
  id: string;
  sourceHost: string;
  type: "full" | "design";
  createdAt: string;
  // Optional free-text name OR a real domain, given at prepare time. Shown
  // as the clone's label in the box; if it looks like a domain it's also
  // used as the staging host (skips the auto-generated staging-<id> one)
  // and prefills the "make new site" host prompt.
  label?: string;
  stagingHost?: string;
}

// A label counts as a usable domain, not just a display name, when it looks
// like one: dotted, no spaces.
export const looksLikeDomain = (s: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim());

// ponytail: in-memory "box" of prepared clones the admin hasn't acted on
// yet — single instance (CLAUDE.md), so a process-local Map is enough; lost
// on API restart, same tradeoff as apps/frontend's stale-while-revalidate
// cache. Add a DB table only if clones need to survive a restart.
const cloneStore = new Map<string, { meta: CloneMeta; zip: Uint8Array }>();

export function prepareClone(sourceHost: string, type: "full" | "design", zip: Uint8Array, label?: string): CloneMeta {
  const meta: CloneMeta = { id: randomUUID(), sourceHost, type, createdAt: new Date().toISOString(), label: label?.trim() || undefined };
  cloneStore.set(meta.id, { meta, zip });
  return meta;
}

export const listClones = (sourceHost: string): CloneMeta[] =>
  [...cloneStore.values()].filter((c) => c.meta.sourceHost === sourceHost).map((c) => c.meta);

export const getClone = (id: string) => cloneStore.get(id);

export function markCloneStaged(id: string, stagingHost: string) {
  const entry = cloneStore.get(id);
  if (entry) entry.meta.stagingHost = stagingHost;
}

// Drops the in-memory clone entry only — a staged clone's real tenant
// row/database (created by stageClone's own createTenant call) is a
// separate concern the caller (index.ts's DELETE /api/portal/clones/:id)
// handles itself via the existing deleteTenant, so this never has to know
// about tenant provisioning.
export function deleteClone(id: string): boolean {
  return cloneStore.delete(id);
}

export async function importTenantBackup(host: string, zip: Uint8Array): Promise<{ restored: string[] }> {
  let decompressedTotal = 0;
  const entries = unzipSync(zip, {
    filter(file) {
      decompressedTotal += file.originalSize;
      if (decompressedTotal > MAX_LOCAL_MEDIA_BACKUP_BYTES) {
        throw new Error(`backup decompresses to more than ${MAX_LOCAL_MEDIA_BACKUP_BYTES} bytes — refusing to restore`);
      }
      return true;
    },
  });
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
      // Older backups (pre-media-folders / pre-site-chrome / pre-categories) won't have these keys.
      mediaFolders?: Record<string, unknown>[];
      siteChrome?: Record<string, unknown>[];
      categories?: Record<string, unknown>[];
    };
    theme: Record<string, unknown> | null;
  };
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${backup.version}`);

  const { db, release } = await getTenantConnection(host);
  try {
    await db.execute(sql`SET SESSION app.authenticated = 'true'`);
    // Full replace, not merge — a restore means "make the tenant look like
    // the backup". Wipe in FK-safe order: media references media_folders,
    // pages references site_chrome (headerId/footerId), posts references
    // categories (onDelete: "restrict" — can't delete a category while a
    // post still points at it) — delete posts before categories, insert
    // categories before posts.
    await db.delete(schema.media);
    await db.delete(schema.posts);
    await db.delete(schema.pages);
    await db.delete(schema.mediaFolders);
    await db.delete(schema.siteChrome);
    await db.delete(schema.categories);
    const { pages, posts, media, mediaFolders = [], siteChrome = [], categories = [] } = backup.tables;
    if (siteChrome.length)
      await db.insert(schema.siteChrome).values(reviveDates(siteChrome) as (typeof schema.siteChrome.$inferInsert)[]);
    if (mediaFolders.length)
      await db.insert(schema.mediaFolders).values(reviveDates(mediaFolders) as (typeof schema.mediaFolders.$inferInsert)[]);
    if (categories.length)
      await db.insert(schema.categories).values(reviveDates(categories) as (typeof schema.categories.$inferInsert)[]);
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
  let pages, posts, categories;
  try {
    [pages, posts, categories] = await Promise.all([
      db.select({ slug: schema.pages.slug }).from(schema.pages),
      db.select({ slug: schema.posts.slug, tags: schema.posts.tags, authorEmail: schema.posts.authorEmail }).from(schema.posts),
      db.select({ slug: schema.categories.slug }).from(schema.categories),
    ]);
  } finally {
    release();
  }

  // Every OTHER real public route type (category/tag/author archives) —
  // missing these left them 404ing in the exported zip whenever the site's
  // own header/footer/menu linked to one, since only pages/posts were ever
  // crawled here before.
  const tags = new Set<string>();
  const authors = new Set<string>();
  for (const p of posts) {
    for (const tg of p.tags ?? []) tags.add(tg);
    if (p.authorEmail) authors.add(p.authorEmail);
  }

  const files: Record<string, Uint8Array> = {};
  const assets = new Set<string>();
  const routes: Array<{ urlPath: string; file: string }> = [
    ...pages.map((p) => ({ urlPath: `/${p.slug}`, file: p.slug === "home" ? "index.html" : `${p.slug}.html` })),
    ...posts.map((p) => ({ urlPath: `/posts/${p.slug}`, file: `posts/${p.slug}.html` })),
    ...categories.map((c) => ({ urlPath: `/category/${encodeURIComponent(c.slug)}`, file: `category/${encodeURIComponent(c.slug)}.html` })),
    ...[...tags].map((tg) => ({ urlPath: `/tag/${encodeURIComponent(tg)}`, file: `tag/${encodeURIComponent(tg)}.html` })),
    ...[...authors].map((email) => ({
      urlPath: `/author/${encodeURIComponent(email)}`,
      file: `author/${encodeURIComponent(email)}.html`,
    })),
  ];
  for (const { urlPath, file } of routes) {
    const res = await internalGet(urlPath, host);
    if (res.status !== 200) continue; // unpublished/broken page — skip, don't fail the whole export
    const html = res.body.toString("utf8");
    files[file] = strToU8(html);
    for (const match of html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
      // srcset carries a comma-separated "url widthDescriptor" list, not a
      // single URL — split it out so a responsive image's other candidate
      // sizes get bundled too, not just whichever src happened to match.
      for (const candidate of match[1].split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (/^\/(?:_astro|uploads)\//.test(url)) assets.add(url);
      }
    }
  }
  for (const assetPath of assets) {
    const res = await internalGet(assetPath, host);
    if (res.status === 200) files[assetPath.slice(1)] = res.body;
  }
  if (Object.keys(files).length === 0) throw new Error("Nothing exported — is the frontend running and the tenant published?");
  return zipSync(files);
}
