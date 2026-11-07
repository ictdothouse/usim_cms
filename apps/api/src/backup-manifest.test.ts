import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { BACKUP_TABLES, isRestorableMediaFile, mergeRevisions, parseTenantBackupManifest } from "./backup.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("backup covers every table the tenant migrations create", () => {
  const dir = new URL("./db/migrations/", import.meta.url);
  const created = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    for (const [, name] of readFileSync(new URL(file, dir), "utf8").matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/gi)) created.add(name);
  }
  assert.deepEqual([...created].sort(), BACKUP_TABLES.map(([, table]) => getTableName(table)).sort());
});

test("backup table order inserts every FK target before the rows that reference it", () => {
  const order: string[] = BACKUP_TABLES.map(([, table]) => getTableName(table));
  for (const [, table] of BACKUP_TABLES) {
    for (const fk of getTableConfig(table).foreignKeys) {
      const target = getTableName(fk.reference().foreignTable);
      assert.ok(order.indexOf(target) < order.indexOf(getTableName(table)), `${getTableName(table)} → ${target}`);
    }
  }
});

test("backup manifest accepts generated and legacy optional table shapes", () => {
  // Pre-2026-11 backups carry only these 3 (or 6) tables; restore must take them.
  const parsed = parseTenantBackupManifest(JSON.stringify({
    version: 1,
    sourceHost: "source.example.org",
    tables: { pages: [], posts: [], media: [] },
    theme: null,
  }));
  assert.equal(parsed.sourceHost, "source.example.org");
  const full = Object.fromEntries(BACKUP_TABLES.map(([key]) => [key, []]));
  assert.deepEqual(Object.keys(parseTenantBackupManifest(JSON.stringify({ version: 1, sourceHost: "a.example.org", tables: full, theme: null })).tables).sort(),
    BACKUP_TABLES.map(([key]) => key).sort());
});

test("backup manifest rejects malformed table data before restore can begin", () => {
  assert.throws(() => parseTenantBackupManifest(JSON.stringify({
    version: 1,
    sourceHost: "source.example.org",
    tables: { pages: {}, posts: [], media: [] },
    theme: null,
  })), /Backup table 'pages'/);
  assert.throws(() => parseTenantBackupManifest(JSON.stringify({
    version: 1,
    sourceHost: "source.example.org",
    tables: { pages: [null], posts: [], media: [] },
    theme: null,
  })), /Backup table 'pages'/);
  assert.throws(() => parseTenantBackupManifest(JSON.stringify({
    version: 1,
    sourceHost: "source.example.org",
    tables: { pages: [], posts: [], media: [], menus: {} },
    theme: null,
  })), /Backup table 'menus'/);
  assert.throws(() => parseTenantBackupManifest("{}"), /Unsupported backup version/);
});

test("restore keeps existing revisions of surviving pages and adds the backup's", () => {
  const existing = [
    { id: "r1", pageId: "p1", title: "kept" },
    { id: "r2", pageId: "gone", title: "orphan" },
    { id: "r3", pageId: "p1", title: "old copy" },
  ];
  const fromBackup = [{ id: "r3", pageId: "p1", title: "backup copy" }, { id: "r4", pageId: "p2", title: "new" }];
  const merged = mergeRevisions(fromBackup, existing, "pageId", new Set(["p1", "p2"]));
  assert.deepEqual(merged.map((r) => [r.id, r.title]).sort(), [["r1", "kept"], ["r3", "backup copy"], ["r4", "new"]]);
  assert.deepEqual(mergeRevisions([], existing, "pageId", new Set(["p1"])).map((r) => r.id).sort(), ["r1", "r3"],
    "a backup without revisions no longer wipes them");
});

test("restore only writes media the upload route itself would accept", () => {
  assert.equal(isRestorableMediaFile("2026/01/banner-1a2b3c4d.png", PNG), true);
  assert.equal(isRestorableMediaFile("photo.JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true, "legacy client-named jpeg");
  assert.equal(isRestorableMediaFile("2026/01/x.html", Buffer.from("<script>fetch('/api/auth/session')</script>")), false);
  assert.equal(isRestorableMediaFile("2026/01/x.svg", Buffer.from("<svg onload=alert(1)/>")), false);
  assert.equal(isRestorableMediaFile("2026/01/x.png", Buffer.from("<html><script>alert(1)</script>")), false, "bytes must match the type");
  assert.equal(isRestorableMediaFile("favicon.ico", Uint8Array.from([0, 0, 1, 0])), false, "not a media-library type");
});
