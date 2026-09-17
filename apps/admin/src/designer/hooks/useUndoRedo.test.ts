import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_undoRedoFns } from "./useUndoRedo";
import type { Block } from "../types";

function sampleBlocks(): Block[] {
  return [{ type: "section", props: { rows: [] } } as unknown as Block];
}

test("mutate() applies fn to a clone, marks dirty", () => {
  let blocks = sampleBlocks();
  const { mutate, calls } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
  assert.equal(calls.dirty, 1);
});

test("undo() restores the previous snapshot and resets selection; redo() reapplies it", () => {
  let blocks = sampleBlocks();
  const { mutate, undo, redo, calls } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  undo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, undefined);
  assert.equal(calls.selReset, 1);
  assert.equal(calls.structural, 1);
  redo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
});

test("undo() with an empty history stack is a no-op", () => {
  const blocks = sampleBlocks();
  const { undo, calls } = __testOnly_undoRedoFns(
    () => blocks,
    () => blocks,
  );
  undo();
  assert.equal(calls.selReset, 0);
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

test("history is capped at 50 entries", () => {
  let blocks = sampleBlocks();
  const { mutate, history } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  for (let i = 0; i < 60; i++) {
    mutate((bs) => { (bs[0].props as Record<string, unknown>).n = i; });
  }
  assert.equal(history.current.length, 50);
});
