import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTenantBackupManifest } from "./backup.js";

test("backup manifest accepts generated and legacy optional table shapes", () => {
  const parsed = parseTenantBackupManifest(JSON.stringify({
    version: 1,
    sourceHost: "source.example.org",
    tables: { pages: [], posts: [], media: [] },
    theme: null,
  }));
  assert.equal(parsed.sourceHost, "source.example.org");
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
  assert.throws(() => parseTenantBackupManifest("{}"), /Unsupported backup version/);
});
