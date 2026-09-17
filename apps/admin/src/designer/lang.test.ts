import { test } from "node:test";
import assert from "node:assert/strict";
import { isTextKey, pathKey, applyLangOverrides, migrateOldTranslation } from "./lang";
import type { Block } from "./types";

test("isTextKey checks TRANSLATABLE_TEXT_KEYS for the element type", () => {
  assert.equal(isTextKey("heading", "text"), true);
  assert.equal(isTextKey("heading", "color"), false);
  assert.equal(isTextKey(undefined, "text"), false);
  assert.equal(isTextKey("spacer", "text"), false);
});

test("pathKey joins only the defined depth segments", () => {
  assert.equal(pathKey(0), "0");
  assert.equal(pathKey(0, 1), "0.1");
  assert.equal(pathKey(0, 1, 2, 3), "0.1.2.3");
});

function sampleBase(): Block[] {
  return [
    {
      type: "section",
      props: { bg: "red", rows: [{ columns: [{ elements: [{ id: "e1", type: "text", props: { text: "hello" } }] }] }] },
    } as unknown as Block,
  ];
}

test("applyLangOverrides overlays a flat key onto the matching node, leaves the base untouched", () => {
  const base = sampleBase();
  const out = applyLangOverrides(base, { "0.0.0.0": { text: "bonjour" } });
  assert.equal((out[0].props as { rows: { columns: { elements: { props: { text: string } }[] }[] }[] }).rows[0].columns[0].elements[0].props.text, "bonjour");
  assert.equal((base[0].props as { rows: { columns: { elements: { props: { text: string } }[] }[] }[] }).rows[0].columns[0].elements[0].props.text, "hello");
});

test("applyLangOverrides routes a tablet:-prefixed key into the node's own bp bag", () => {
  const base = sampleBase();
  const out = applyLangOverrides(base, { "0": { "tablet:paddingY": "2rem" } });
  const sp = out[0].props as unknown as { bp?: Record<string, string> };
  assert.equal(sp.bp?.["tablet:paddingY"], "2rem");
});

test("migrateOldTranslation keeps only translatable text values at matching positions", () => {
  const base = sampleBase();
  const oldLayout = sampleBase();
  (oldLayout[0].props as { rows: { columns: { elements: { props: { text: string } }[] }[] }[] }).rows[0].columns[0].elements[0].props.text = "old translated text";
  const out = migrateOldTranslation(base, oldLayout);
  assert.deepEqual(out, { "0.0.0.0": { text: "old translated text" } });
});

test("migrateOldTranslation stops at a structural mismatch instead of throwing", () => {
  const base = sampleBase();
  const out = migrateOldTranslation(base, []);
  assert.deepEqual(out, {});
});
