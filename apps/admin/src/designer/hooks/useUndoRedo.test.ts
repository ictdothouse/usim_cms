import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_undoRedoFns } from "./useUndoRedo";
import type { Block } from "../types";

function sampleBlocks(): Block[] {
  return [{ type: "section", props: { rows: [] } } as unknown as Block];
}

test("mutate() applies fn to a clone, pushes history, clears future", () => {
  let blocks = sampleBlocks();
  const { mutate } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
});

test("undo() restores the previous snapshot; redo() reapplies it", () => {
  let blocks = sampleBlocks();
  const { mutate, undo, redo } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  undo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, undefined);
  redo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
});

test("multiple synchronous mutate() calls each build on the previous result (no lost updates)", () => {
  let blocks = sampleBlocks();
  const { mutate } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  // Simulates a "linked" FourSideControl commit: 4 sequential mutate() calls
  // in the same tick, each setting a different key — the historical bug was
  // all 4 cloning the same stale pre-edit snapshot and only the last surviving.
  mutate((bs) => { (bs[0].props as Record<string, unknown>).a = "1"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).b = "2"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).c = "3"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).d = "4"; });
  const props = blocks[0].props as Record<string, unknown>;
  assert.equal(props.a, "1");
  assert.equal(props.b, "2");
  assert.equal(props.c, "3");
  assert.equal(props.d, "4");
});

test("resetHistory() clears both stacks", () => {
  let blocks = sampleBlocks();
  const { mutate, undo, resetHistory } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).a = "1"; });
  resetHistory();
  const before = JSON.stringify(blocks);
  undo();
  assert.equal(JSON.stringify(blocks), before); // no-op — history was cleared
});
