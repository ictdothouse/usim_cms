import { test } from "node:test";
import assert from "node:assert/strict";
import { section, removeAt, insertEl } from "./blockPath";
import type { Block } from "./types";

function sampleBlocks(): Block[] {
  return [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ id: "e1", type: "text", props: { text: "a" } }] }] }],
      },
    } as unknown as Block,
  ];
}

test("section() returns the section's props cast to SectionProps", () => {
  const bs = sampleBlocks();
  assert.equal(section(bs, 0).rows.length, 1);
});

test("removeAt() splices out and returns the element at the path", () => {
  const bs = sampleBlocks();
  const el = removeAt(bs, [0, 0, 0, 0]);
  assert.equal(el.id, "e1");
  assert.equal(section(bs, 0).rows[0].columns[0].elements.length, 0);
});

test("insertEl() inserts at the given index, or appends when index is omitted", () => {
  const bs = sampleBlocks();
  const newEl = { id: "e2", type: "text", props: { text: "b" } } as unknown as import("./types").El;
  insertEl(bs, [0, 0, 0], newEl, 0);
  assert.equal(section(bs, 0).rows[0].columns[0].elements[0].id, "e2");
  assert.equal(section(bs, 0).rows[0].columns[0].elements[1].id, "e1");

  insertEl(bs, [0, 0, 0], { id: "e3", type: "text", props: {} } as unknown as import("./types").El);
  assert.equal(section(bs, 0).rows[0].columns[0].elements.at(-1)?.id, "e3");
});
