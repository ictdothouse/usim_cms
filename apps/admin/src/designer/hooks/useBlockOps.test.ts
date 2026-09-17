import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_blockOpsFns } from "./useBlockOps";
import type { Block } from "../types";

function makeDeps(blocks: Block[]) {
  const state = { blocks };
  const clip = new Map<string, string>();
  const clipStyle = new Map<string, string>();
  const calls = { structural: 0 };
  const mutate = (fn: (next: Block[]) => void) => {
    const next = JSON.parse(JSON.stringify(state.blocks));
    fn(next);
    state.blocks = next;
  };
  const deps = {
    get blocks() {
      return state.blocks;
    },
    mutate,
    setSel: () => {},
    bumpStructural: () => calls.structural++,
    isSuper: false,
    t: (k: string) => k,
    clipboard: {
      clipCopy: (level: string, data: unknown) => clip.set(level, JSON.stringify(data)),
      clipRead: (level: string) => (clip.has(level) ? JSON.parse(clip.get(level) as string) : null),
      styleCopy: (level: string, props: Record<string, string>) => clipStyle.set(level, JSON.stringify(props)),
      styleRead: (level: string) => (clipStyle.has(level) ? JSON.parse(clipStyle.get(level) as string) : null),
    },
    setDropHint: () => {},
  };
  return { deps, state, calls };
}

function sampleBlocks(): Block[] {
  return [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ span: 12, elements: [{ id: "e1", type: "text", props: { text: "hi" } }] }] }],
      },
    } as unknown as Block,
  ];
}

test("duplicateSection inserts a clone right after the original and bumps structural", () => {
  const { deps, state, calls } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.duplicateSection(0);
  assert.equal(state.blocks.length, 2);
  assert.equal(calls.structural, 1);
});

test("copySection/pasteSection round-trip through the clipboard", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.copySection(0);
  ops.pasteSection(0);
  assert.equal(state.blocks.length, 2);
});

test("isSectionLocked: non-superadmin blocked, deleteSection no-ops on a locked section", () => {
  const blocks = sampleBlocks();
  (blocks[0].props as Record<string, unknown>).locked = "true";
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  assert.equal(ops.isSectionLocked(0), true);
  ops.deleteSection(0);
  assert.equal(state.blocks.length, 1);
});

test("isSectionLocked: superadmin bypasses the lock", () => {
  const blocks = sampleBlocks();
  (blocks[0].props as Record<string, unknown>).locked = "true";
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns({ ...deps, isSuper: true } as never);
  assert.equal(ops.isSectionLocked(0), false);
  ops.deleteSection(0);
  assert.equal(state.blocks.length, 0);
});

test("deleteColumn cascades to remove the row once its last column is gone", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.deleteColumn(0, 0, 0);
  const rows = (state.blocks[0].props as { rows: unknown[] }).rows;
  assert.equal(rows.length, 0);
});

test("moveElement is a no-op past the array bounds", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.moveElement(0, 0, 0, 0, -1);
  const before = JSON.stringify(state.blocks);
  ops.moveElement(0, 0, 0, 0, 1);
  assert.equal(JSON.stringify(state.blocks), before);
});

test("pasteStyleElement merges the copied style onto the target, leaving its own content untouched", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  deps.clipboard.styleCopy("element", { color: "#fff" });
  ops.pasteStyleElement(0, 0, 0, 0);
  const el = (state.blocks[0].props as { rows: { columns: { elements: { props: Record<string, unknown> }[] }[] }[] }).rows[0].columns[0].elements[0];
  assert.equal(el.props.color, "#fff");
  assert.equal(el.props.text, "hi");
});

test("dropIntoColumn: dragging a new element type inserts it and clears the drag/dropHint state", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  ops.dropIntoColumn([0, 0, 0], 1);
  const els = (state.blocks[0].props as { rows: { columns: { elements: { type: string }[] }[] }[] }).rows[0].columns[0].elements;
  assert.equal(els.length, 2);
  assert.equal(els[1].type, "heading");
  assert.equal(ops.drag.current, null);
});
