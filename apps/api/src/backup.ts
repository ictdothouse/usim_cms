import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTenantConnection, getTenantRecord, getTenantTheme, setTenantTheme, type TenantDb } from "./db/tenant-pool.js";
import { contentTypeFor, localUploadsDir, dirSizeBytes, isValidMediaKey, tenantMediaPrefix, LEGACY_MOVED_MARKER } from "./storage.js";
import { matchesAllowedMediaSignature } from "./file-validation.js";
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

// Every tenant table, in FK-safe insert order (a table only references ones
// above it); the first element is its key under backup.json's `tables`.
// backup-manifest.test.ts fails if a tenant migration creates a table that
// is missing here, or if this order would break an FK on restore.
export const BACKUP_TABLES = [
  ["siteChrome", schema.siteChrome],
  ["mediaFolders", schema.mediaFolders],
  ["categories", schema.categories],
  ["menus", schema.menus],
  ["symbols", schema.symbols],
  ["designTemplates", schema.designTemplates],
  ["events", schema.events],
  ["pages", schema.pages],
  ["posts", schema.posts],
  ["media", schema.media],
  ["pageRevisions", schema.pageRevisions],
  ["postRevisions", schema.postRevisions],
] as const satisfies ReadonlyArray<readonly [string, PgTable]>;

type TableKey = (typeof BACKUP_TABLES)[number][0];
type Row = Record<string, unknown>;
// In every backup ever written. Any other key can be missing from an older
// zip, and restore then leaves that table exactly as it is.
const REQUIRED_TABLES: readonly TableKey[] = ["pages", "posts", "media"];
type BackupTables = Partial<Record<TableKey, Row[]>> & Record<"pages" | "posts" | "media", Row[]>;

type TenantBackup = {
  version: number;
  sourceHost: string;
  exportedAt?: string;
  tables: BackupTables;
  theme: Record<string, unknown> | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validate the complete manifest before a restore is allowed to modify a tenant. */
export function parseTenantBackupManifest(raw: string): TenantBackup {
  const backup: unknown = JSON.parse(raw);
  if (!isPlainRecord(backup)) throw new Error("Invalid backup manifest");
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${String(backup.version)}`);
  if (typeof backup.sourceHost !== "string" || !backup.sourceHost.trim() || backup.sourceHost.length > 253 || /[\s/\\]/.test(backup.sourceHost)) {
    throw new Error("Invalid backup source host");
  }
  if (!isPlainRecord(backup.tables)) throw new Error("Backup tables are missing or invalid");
  for (const [table] of BACKUP_TABLES) {
    const rows = backup.tables[table];
    if (rows === undefined && !REQUIRED_TABLES.includes(table)) continue;
    if (!Array.isArray(rows) || rows.some((row) => !isPlainRecord(row))) {
      throw new Error(`Backup table '${table}' must be an array of records`);
    }
  }
  if (backup.theme !== null && backup.theme !== undefined && !isPlainRecord(backup.theme)) {
    throw new Error("Backup theme is invalid");
  }
  return backup as unknown as TenantBackup;
}

function rewriteBackupStrings(value: unknown, replacements: Array<[string, string]>): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteBackupStrings(item, replacements);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      value[key] = replacements.reduce((text, [from, to]) => text.replaceAll(from, to), child);
    } else {
      rewriteBackupStrings(child, replacements);
    }
  }
}

// Shared by export (guards the in-memory zip build below) and restore
// (guards decompression further down) — this whole pipeline buffers a
// tenant's uploads fully in RAM via fflate's sync zipSync/unzipSync, fine
// for department sites (uploads capped at 5 MB/file, a few hundred MB of
// media total) but not a tool for a tenant with a genuinely large media
// library: past this size, use a filesystem-level copy (rsync/tar) of
// uploads/<tenantFolder>/ directly instead — streaming this pipeline
// properly is a real rewrite, not warranted while the practical answer for
// "large media, single shared process" is "don't put it through this path".
// The API container defaults to 512 MiB. Bound ZIP restore well below that
// because the compressed input, decompressed entries and parsed manifest are
// simultaneously resident in memory. Larger libraries need filesystem-level
// migration until this path is replaced with streaming archive I/O.
const MAX_LOCAL_MEDIA_BACKUP_BYTES = 128 * 1024 * 1024; // 128 MiB
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024; // 64 MiB compressed upload
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024; // backup.json, checked on both sides

const DATE_KEYS = new Set(["createdAt", "updatedAt", "publishedAt", "startDate", "endDate"]);
function reviveDates(rows: Row[]): Row[] {
  for (const row of rows) {
    for (const key of DATE_KEYS) {
      if (typeof row[key] === "string") row[key] = new Date(row[key] as string);
    }
  }
  return rows;
}

type TenantTx = Parameters<Parameters<TenantDb["transaction"]>[0]>[0];

// Every table at once, in one transaction so the FKs between them agree.
async function dumpTables<K extends TableKey>(host: string, keys: readonly K[]): Promise<Record<K, Row[]>> {
  const { db, release } = await getTenantConnection(host);
  try {
    return await db.transaction(async (tx) => {
      // LOCAL scopes privileged RLS access to this transaction and cannot
      // survive when the pooled connection is returned to another request.
      await tx.execute(sql`SET LOCAL app.authenticated = 'true'`);
      const tables = BACKUP_TABLES.filter(([key]) => keys.includes(key as K));
      const rows = await Promise.all(tables.map(([, table]) => tx.select().from(table as PgTable)));
      return Object.fromEntries(tables.map(([key], i) => [key, rows[i]])) as Record<K, Row[]>;
    });
  } finally {
    release();
  }
}

// Postgres caps one statement at 65,535 bind parameters: a ~20-column table
// hits that near 3,000 rows (revisions pile up over a site's lifetime), so
// rows go in fixed-size batches.
async function insertRows(tx: TenantTx, table: PgTable, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    // Rows are this table's own dump, so their shape is the table's insert shape.
    await tx.insert(table).values(rows.slice(i, i + 500) as never);
  }
}

// page_revisions/post_revisions are history. Deleting pages/posts cascades
// them away (the FK action bypasses RLS) and they have no DELETE policy of
// their own. A restore therefore re-inserts the tenant's existing revisions
// plus the backup's (backup wins on the same id), keeping every one whose
// page/post exists afterwards — an older backup, or one without revisions,
// no longer erases the "restore to last known good" history.
export function mergeRevisions(fromBackup: Row[], existing: Row[], parentKey: "pageId" | "postId", parentIds: Set<unknown>): Row[] {
  const byId = new Map<unknown, Row>();
  for (const row of [...existing, ...fromBackup]) byId.set(row.id, row);
  return [...byId.values()].filter((row) => parentIds.has(row[parentKey]));
}

// Restore writes zip entries straight onto the public /uploads/ tree, so they
// get POST /api/media's own gate: an extension that maps (contentTypeFor) to a
// type matchesAllowedMediaSignature allows, with bytes that match it. A
// crafted zip can no longer plant .html/.svg that runs script on this origin.
export const isRestorableMediaFile = (name: string, data: Uint8Array): boolean =>
  matchesAllowedMediaSignature(contentTypeFor(name), data);

export async function exportTenantBackup(host: string): Promise<Uint8Array> {
  const tables = await dumpTables(host, BACKUP_TABLES.map(([key]) => key));
  const manifest = strToU8(
    JSON.stringify({
      version: BACKUP_VERSION,
      sourceHost: host,
      exportedAt: new Date().toISOString(),
      tables,
      theme: await getTenantTheme(host),
    }),
  );
  if (manifest.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error(`${host}'s backup.json would be ${(manifest.byteLength / 1024 / 1024).toFixed(0)} MB — over the ${MAX_MANIFEST_BYTES / 1024 / 1024} MB restore limit`);
  }
  const files: Record<string, Uint8Array> = { "backup.json": manifest };
  const dir = path.join(localUploadsDir, tenantFolder(host));
  // Phase-1 tree (storage.ts): tenants/<id>/<yyyy>/<mm>/<file>, bundled as
  // media/<yyyy>/<mm>/<file> — tenant-relative, so a restore re-homes it under
  // whatever id the target tenant has.
  const tenant = await getTenantRecord(host);
  const mediaDir = tenant ? path.join(localUploadsDir, tenantMediaPrefix(tenant.id)) : null;
  const mediaBytes = ((await dirSizeBytes(dir)) ?? 0) + (mediaDir ? ((await dirSizeBytes(mediaDir)) ?? 0) : 0);
  // Restore refuses an archive that inflates past this, manifest included.
  if (mediaBytes + manifest.byteLength > MAX_LOCAL_MEDIA_BACKUP_BYTES) {
    throw new Error(
      `${host}'s uploads plus database rows are ${((mediaBytes + manifest.byteLength) / 1024 / 1024).toFixed(0)} MB — too large for this zip-backup ` +
        `path (buffers everything in memory). Use a filesystem copy (rsync/tar) of uploads/${tenantFolder(host)}/ ` +
        `and uploads/${tenant ? tenantMediaPrefix(tenant.id) : "tenants/<id>"}/ instead; this export still covers the database rows and theme.`,
    );
  }
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      files[`uploads/${name}`] = readFileSync(path.join(dir, name));
    }
  }
  if (mediaDir && existsSync(mediaDir)) {
    for (const rel of readdirSync(mediaDir, { recursive: true }) as string[]) {
      const full = path.join(mediaDir, rel);
      if (statSync(full).isFile()) files[`media/${rel.split(path.sep).join("/")}`] = readFileSync(full);
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
  const { pages, siteChrome, menus, symbols } = await dumpTables(host, ["pages", "siteChrome", "menus", "symbols"]);
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
        // A page's headerId/footerId is a real FK into site_chrome even in a
        // skeleton clone, so the page insert would fail without these rows.
        // Header/footer layouts are kept whole and reference menus/symbols by
        // id (a Menu or Symbol element), so those come along too — all
        // structure, not content, matching this clone's own premise.
        tables: { pages: skeletonPages, posts: [], media: [], mediaFolders: [], siteChrome, menus, symbols },
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

export async function importTenantBackup(host: string, zip: Uint8Array): Promise<{ restored: string[]; skipped: string[] }> {
  if (zip.byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error(`backup archive exceeds ${MAX_BACKUP_ARCHIVE_BYTES} bytes — refusing to restore`);
  }
  let decompressedTotal = 0;
  let entryCount = 0;
  const entries = unzipSync(zip, {
    filter(file) {
      entryCount += 1;
      if (entryCount > 20_000) throw new Error("Backup contains too many files");
      decompressedTotal += file.originalSize;
      if (decompressedTotal > MAX_LOCAL_MEDIA_BACKUP_BYTES) {
        throw new Error(`backup decompresses to more than ${MAX_LOCAL_MEDIA_BACKUP_BYTES} bytes — refusing to restore`);
      }
      if (file.name === "backup.json" && file.originalSize > MAX_MANIFEST_BYTES) {
        throw new Error("Backup manifest is too large");
      }
      return true;
    },
  });
  const manifest = entries["backup.json"];
  if (!manifest) throw new Error("Not a backup zip: backup.json missing");
  const backup = parseTenantBackupManifest(strFromU8(manifest));
  const sourceHost = backup.sourceHost;
  // Cross-host restore (= migration): media URLs embed the tenant folder —
  // rewrite them to the target host's folder everywhere (media.url, page
  // layout JSON, post body HTML) in one pass on the serialized dump.
  if (sourceHost !== host) {
    rewriteBackupStrings(backup, [
      [`/uploads/${tenantFolder(sourceHost)}/`, `/uploads/${tenantFolder(host)}/`],
      // Phase-1 media paths carry no tenant at all, but apps/admin bakes the
      // tenant's own domain in front of them (publicMediaBase) — and that host
      // is what resolves the files. Repoint it (prod form, then dev form).
      [`//${sourceHost}/uploads/`, `//${host}/uploads/`],
      [`/_tenant/${sourceHost}/uploads/`, `/_tenant/${host}/uploads/`],
    ]);
  }

  const { db, release } = await getTenantConnection(host);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.authenticated = 'true'`);
      // Full replace, not merge — a restore means "make the tenant look like
      // the backup" — for every table the backup carries. A table an older
      // backup predates is left as it is; revisions merge (mergeRevisions).
      // Delete and insert stay atomic so a malformed row/FK error cannot
      // leave a tenant empty or only partly restored.
      const [pageRevisions, postRevisions] = await Promise.all([
        tx.select().from(schema.pageRevisions),
        tx.select().from(schema.postRevisions),
      ]);
      const tables = BACKUP_TABLES.filter(([key]) => key !== "pageRevisions" && key !== "postRevisions" && backup.tables[key]);
      for (const [, table] of [...tables].reverse()) await tx.delete(table as PgTable);
      for (const [key, table] of tables) await insertRows(tx, table, reviveDates(backup.tables[key]!));
      const pageIds = new Set(backup.tables.pages.map((row) => row.id));
      const postIds = new Set(backup.tables.posts.map((row) => row.id));
      await insertRows(tx, schema.pageRevisions, mergeRevisions(reviveDates(backup.tables.pageRevisions ?? []), pageRevisions, "pageId", pageIds));
      await insertRows(tx, schema.postRevisions, mergeRevisions(reviveDates(backup.tables.postRevisions ?? []), postRevisions, "postId", postIds));
    });
  } finally {
    release();
  }
  if (backup.theme) await setTenantTheme(host, backup.theme);

  const dir = path.join(localUploadsDir, tenantFolder(host));
  const tenant = await getTenantRecord(host);
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue; // directory entry
    if (name.startsWith("media/") && tenant) {
      // isValidMediaKey doubles as the zip-slip guard (no "..", fixed shape).
      const key = name.slice("media/".length);
      if (!isValidMediaKey(key) || !isRestorableMediaFile(key, data)) {
        skipped.push(name);
        continue;
      }
      const target = path.join(localUploadsDir, tenantMediaPrefix(tenant.id), key);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
      restored.push(name);
      continue;
    }
    if (!name.startsWith("uploads/")) continue;
    const file = path.basename(name);
    // The normalize job's dotfile marker is never served; its month is
    // re-validated on read (routes/media.ts) before the legacy route 301s.
    if (file !== LEGACY_MOVED_MARKER && !isRestorableMediaFile(file, data)) {
      skipped.push(name);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, file), data);
    restored.push(name);
  }
  return { restored, skipped };
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
