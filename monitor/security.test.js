import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { trackedDependencyStatus } from "./security.js";

test("tracked advisories use every installed lockfile version", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ucms-security-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), [
    "packages:",
    "  swiper@12.2.0:",
    "  sharp@0.35.5:",
    "  '@fastify/static@10.1.6':",
    "  react-router@7.18.4:",
    "  esbuild@0.28.2:",
    "  esbuild@0.18.20:",
  ].join("\n"));
  const items = Object.fromEntries(trackedDependencyStatus(dir).map((item) => [item.name, item]));
  assert.equal(items.swiper.status, "patched");
  assert.equal(items.sharp.status, "patched");
  assert.equal(items["@fastify/static"].status, "patched");
  assert.equal(items["react-router"].status, "patched");
  assert.equal(items.esbuild.status, "vulnerable");
  assert.deepEqual(items.esbuild.versions, ["0.18.20", "0.28.2"]);
});

test("missing and prerelease packages do not appear patched", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ucms-security-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "packages:\n  swiper@12.1.2-rc.1:\n");
  const items = Object.fromEntries(trackedDependencyStatus(dir).map((item) => [item.name, item]));
  assert.equal(items.swiper.status, "vulnerable");
  assert.equal(items.sharp.status, "unknown");
});

test("a major-version fix recommends a reviewed manifest change", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ucms-security-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "packages:\n  swiper@11.2.10:\n");
  const swiper = trackedDependencyStatus(dir).find((item) => item.name === "swiper");
  assert.equal(swiper.status, "vulnerable");
  assert.match(swiper.recommendation, /reviewed package\.json major-version change/);
});
