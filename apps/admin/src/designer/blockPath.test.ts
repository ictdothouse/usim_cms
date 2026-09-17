import { test } from "node:test";
import assert from "node:assert/strict";
import { section } from "./blockPath";
import type { Block } from "./types";

function block(): Block {
  return { id: "b1", type: "section", props: { bg: "red" } as never, rows: [] } as unknown as Block;
}

test("section() casts a block's props to SectionProps by index", () => {
  const bs = [block(), block()];
  assert.equal(section(bs, 0).bg, "red");
  assert.equal(section(bs, 1).bg, "red");
});

test("section() reads through, not a copy — mutating the result mutates the block", () => {
  const bs = [block()];
  section(bs, 0).bg = "blue";
  assert.equal((bs[0].props as { bg: string }).bg, "blue");
});
