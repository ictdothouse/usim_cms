import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidMediaKey, mediaDatePath, mediaStem } from "./storage.js";

test("mediaStem slugifies the original name and appends a random suffix", () => {
  assert.match(mediaStem("Banner Utama (Final).PNG"), /^banner-utama-final-[0-9a-f]{8}$/);
  assert.match(mediaStem("Café déjà vu.jpg"), /^cafe-deja-vu-[0-9a-f]{8}$/);
  assert.match(mediaStem("???.png"), /^file-[0-9a-f]{8}$/);
  assert.notEqual(mediaStem("a.png"), mediaStem("a.png"));
});

test("mediaDatePath is UTC yyyy/mm", () => {
  assert.equal(mediaDatePath(new Date("2026-01-05T00:00:00Z")), "2026/01");
});

test("isValidMediaKey accepts phase-1 keys and rejects traversal/odd shapes", () => {
  assert.ok(isValidMediaKey("2026/10/banner-utama-1a2b3c4d.png"));
  assert.ok(isValidMediaKey("2026/10/banner-utama-1a2b3c4d-800w.webp"));
  assert.ok(!isValidMediaKey("2026/10/../x.png"));
  assert.ok(!isValidMediaKey("2026/10/a..b.png"));
  assert.ok(!isValidMediaKey("faiz_host/x.png"));
  assert.ok(!isValidMediaKey("2026/10/sub/x.png"));
  assert.ok(!isValidMediaKey("2026/10/.hidden"));
});
