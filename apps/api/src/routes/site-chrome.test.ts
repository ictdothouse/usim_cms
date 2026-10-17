import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import { siteChromeCollection } from "./collections.js";

const { beforeChange, afterRead } = siteChromeCollection.hooks!;
const anon = { headers: {}, params: {} } as unknown as FastifyRequest;
const webmaster = { role: "webmaster", permissions: ["headerFooter.write"] };
const unsafeLayout = [{ type: "section", props: { rows: [{ columns: [{ elements: [{ type: "button", props: { href: "javascript:alert(1)" } }] }] }] } }];

test("a header/footer draft is null or a { layout } validated like the live one", async () => {
  await assert.rejects(Promise.resolve().then(() => beforeChange!({ draft: { title: "x" } }, webmaster, anon)), /draft must be null or \{ layout \}/);
  await assert.rejects(Promise.resolve().then(() => beforeChange!({ draft: [] }, webmaster, anon)), /draft must be null or \{ layout \}/);
  await assert.rejects(Promise.resolve().then(() => beforeChange!({ draft: { layout: unsafeLayout } }, webmaster, anon)), /unsafe/);
  const cleared = (await beforeChange!({ draft: null }, webmaster, anon)) as Record<string, unknown>;
  assert.equal(cleared.draft, null);
});

test("trash is a status that drops the default flag; unknown statuses and blank names are rejected", async () => {
  const trashed = (await beforeChange!({ status: "trash", isDefault: true }, webmaster, anon)) as Record<string, unknown>;
  assert.equal(trashed.isDefault, false);
  await assert.rejects(Promise.resolve().then(() => beforeChange!({ status: "deleted" }, webmaster, anon)), /status must be/);
  await assert.rejects(Promise.resolve().then(() => beforeChange!({ name: "  " }, webmaster, anon)), /name must be/);
});

test("an anonymous read never carries the draft", async () => {
  const [row] = await afterRead!([{ id: "1", layout: [], draft: { layout: [] } }], anon);
  assert.equal("draft" in (row as object), false);
});
