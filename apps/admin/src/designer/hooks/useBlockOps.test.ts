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

test("dropIntoColumn: dragging a new element with propsOverride merges it onto that type's own defaults", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "container", propsOverride: { flexDirection: "column" } };
  ops.dropIntoColumn([0, 0, 0], 1);
  const els = (state.blocks[0].props as { rows: { columns: { elements: { type: string; props: Record<string, string> }[] }[] }[] }).rows[0].columns[0].elements;
  assert.equal(els[1].type, "container");
  assert.equal(els[1].props.flexDirection, "column");
  assert.equal(els[1].props.gap, "1rem", "container's own other defaults still apply, only the overridden key changes");
});

test("dropIntoColumn: a Layout 'new-row' preset pushes a whole Row onto that column's own section, ignoring the column itself", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 2] };
  ops.dropIntoColumn([0, 0, 0]);
  const rows = (state.blocks[0].props as { rows: { columns: { span: number }[] }[] }).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].columns.map((c) => c.span), [1, 2]);
});

test("dropIntoColumn: a Layout 'new-section' preset inserts a fresh Block right after the hovered column's own section", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-section" };
  ops.dropIntoColumn([0, 0, 0]);
  assert.equal(state.blocks.length, 2);
  assert.equal(state.blocks[1].type, "section");
});

function twoSectionBlocks(): Block[] {
  return [
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }] } } as unknown as Block,
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }], anchorId: "second" } } as unknown as Block,
  ];
}

test("dropIntoNewSection: appends a fresh section with the dragged element at the very end by default", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  ops.dropIntoNewSection();
  assert.equal(state.blocks.length, 2);
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { elements: { type: string }[] }[] }[] } };
  assert.equal(inserted.props.rows[0].columns[0].elements[0].type, "heading");
});

test("dropIntoNewSection: an explicit afterBlockIndex inserts the new section right after that index, not at the end", () => {
  const { deps, state } = makeDeps(twoSectionBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  ops.dropIntoNewSection(0);
  assert.equal(state.blocks.length, 3);
  assert.equal((state.blocks[2].props as { anchorId?: string }).anchorId, "second", "original second section stays last");
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { elements: { type: string }[] }[] }[] } };
  assert.equal(inserted.props.rows[0].columns[0].elements[0].type, "heading");
});

test("dropIntoNewSection: a stale afterBlockIndex far past the array end doesn't crash — the new section lands at the real end, not past it (regression test for the final review's splice/colPath mismatch finding)", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  assert.doesNotThrow(() => ops.dropIntoNewSection(999));
  assert.equal(state.blocks.length, 2);
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { elements: { type: string }[] }[] }[] } };
  assert.equal(inserted.props.rows[0].columns[0].elements[0].type, "heading");
});

test("dropIntoColumn: dropping a non-curated element type into a container's own children (colPath length > 3) is rejected, not silently saved invisible", () => {
  const blocks: Block[] = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ span: 1, elements: [{ id: "c1", type: "container", props: { flexDirection: "row" }, children: [] }] }] }],
      },
    } as unknown as Block,
  ];
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  // "slider" is a real ElType but NOT in CONTAINER_CHILD_TYPES — reproduces
  // the final review's "renders as null after reload" finding.
  ops.drag.current = { kind: "new", type: "slider" };
  ops.dropIntoColumn([0, 0, 0, 0]);
  const container = (state.blocks[0].props as { rows: { columns: { elements: { children: unknown[] }[] }[] }[] }).rows[0].columns[0].elements[0];
  assert.equal(container.children.length, 0, "the unsupported type must not be inserted into the container");
});

test("dropIntoColumn: a colPath that doesn't resolve to a real column (e.g. a row deleted since the drop target was computed) no-ops instead of throwing", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  const before = JSON.stringify(state.blocks);
  assert.doesNotThrow(() => ops.dropIntoColumn([0, 5, 0], 0));
  assert.equal(JSON.stringify(state.blocks), before);
});

test("dropIntoNewSection: a Layout 'new-section' preset inserts a fresh empty Block at afterBlockIndex+1", () => {
  const { deps, state } = makeDeps(twoSectionBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-section" };
  ops.dropIntoNewSection(0);
  assert.equal(state.blocks.length, 3);
  assert.equal(state.blocks[1].type, "section");
  assert.equal((state.blocks[2].props as { anchorId?: string }).anchorId, "second");
});
