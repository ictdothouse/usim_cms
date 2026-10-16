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

type NestedEl = { type: string; props: Record<string, string>; children?: NestedEl[] };

test("dropIntoColumn: a Layout 'new-row' preset nests an H Flex of V Flex columns at the drop index, not a Row at the section's end", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 2] };
  ops.dropIntoColumn([0, 0, 0], 0);
  const rows = (state.blocks[0].props as { rows: { columns: { elements: NestedEl[] }[] }[] }).rows;
  assert.equal(rows.length, 1);
  const [cols, text] = rows[0].columns[0].elements;
  assert.equal(text.type, "text");
  assert.equal(cols.type, "container");
  assert.equal(cols.props.flexDirection, "row");
  assert.deepEqual(cols.children?.map((c) => [c.type, c.props.flexDirection, c.props.grow]), [
    ["container", "column", "1"],
    ["container", "column", "2"],
  ]);
});

test("dropIntoColumn: a Layout 'new-row' preset turns a lone empty section column into the preset's real columns", () => {
  const { deps, state } = makeDeps(twoSectionBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 2] };
  ops.dropIntoColumn([1, 0, 0]);
  const rows = (state.blocks[1].props as { rows: { columns: { span: number; elements: unknown[] }[] }[] }).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].columns.map((c) => [c.span, c.elements.length]), [[1, 0], [2, 0]]);
});

test("dropIntoColumn: a Layout 'new-row' preset nests inside a container", () => {
  const blocks: Block[] = [
    {
      type: "section",
      props: { rows: [{ columns: [{ span: 1, elements: [{ id: "c1", type: "container", props: { flexDirection: "column" }, children: [] }] }] }] },
    } as unknown as Block,
  ];
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 1, 1] };
  ops.dropIntoColumn([0, 0, 0, 0]);
  const box = (state.blocks[0].props as { rows: { columns: { elements: NestedEl[] }[] }[] }).rows[0].columns[0].elements[0];
  assert.equal(box.children?.[0].children?.length, 3);
});

test("dropIntoColumn: a Layout 'new-row' preset is rejected on a locked section instead of mutating its own content (pre-existing gap the final review found)", () => {
  const blocks = sampleBlocks();
  (blocks[0].props as Record<string, unknown>).locked = "true";
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 2] };
  ops.dropIntoColumn([0, 0, 0]);
  const rows = (state.blocks[0].props as { rows: unknown[] }).rows;
  assert.equal(rows.length, 1, "the locked section's own rows must be untouched");
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

test("dropIntoNewSection: moving an element into a new section placed BEFORE its own section moves that element (not an empty slot)", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "move", path: [0, 0, 0, 0] };
  ops.dropIntoNewSection(-1);
  const els = (b: Block) => (b.props as unknown as { rows: { columns: { elements: { id: string }[] }[] }[] }).rows[0].columns[0].elements;
  assert.equal(state.blocks.length, 2);
  assert.deepEqual(els(state.blocks[0]).map((e) => e.id), ["e1"]);
  assert.equal(els(state.blocks[1]).length, 0);
});

test("a move whose source path no longer exists (stale Live Edit iframe) is a no-op, never inserts undefined", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const before = JSON.stringify(state.blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "move", path: [0, 0, 0, 7] };
  ops.dropIntoColumn([0, 0, 0]);
  ops.drag.current = { kind: "move", path: [5, 0, 0, 0] };
  ops.dropIntoNewSection();
  assert.equal(JSON.stringify(state.blocks), before);
});

test("dropIntoNewSection: a Layout 'new-row' preset creates a fresh section with exactly that column layout, instead of silently no-oping (final review finding)", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-row", spans: [1, 2] };
  ops.dropIntoNewSection();
  assert.equal(state.blocks.length, 2);
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { span: number }[] }[] } };
  assert.equal(inserted.props.rows.length, 1, "the requested row replaces newSection()'s own default row, not alongside it");
  assert.deepEqual(inserted.props.rows[0].columns.map((c) => c.span), [1, 2]);
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

test("dropIntoColumn: any element type drops into a container's own children (ContainerBlock.astro renders every type)", () => {
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
  ops.drag.current = { kind: "new", type: "gallery" };
  ops.dropIntoColumn([0, 0, 0, 0]);
  const container = (state.blocks[0].props as { rows: { columns: { elements: { children: { type: string }[] }[] }[] }[] }).rows[0].columns[0].elements[0];
  assert.deepEqual(container.children.map((c) => c.type), ["gallery"]);
});

test("dropIntoColumn: a colPath that doesn't resolve to a real column (e.g. a row deleted since the drop target was computed) no-ops instead of throwing", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  const before = JSON.stringify(state.blocks);
  assert.doesNotThrow(() => ops.dropIntoColumn([0, 5, 0], 0));
  assert.equal(JSON.stringify(state.blocks), before);
});

test("boxAction (Live Edit's column/container toolbar): add column, duplicate and delete at a section column and inside a nested 'N Columns'", () => {
  const blocks: Block[] = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                span: 1,
                elements: [
                  {
                    id: "h",
                    type: "container",
                    props: { flexDirection: "row" },
                    children: [{ id: "v", type: "container", props: { flexDirection: "column", grow: "2" }, children: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as unknown as Block,
  ];
  const { deps, state } = makeDeps(blocks);
  const ops = __testOnly_blockOpsFns(deps as never);
  const row = () => (state.blocks[0].props as { rows: { columns: { span: number; elements: NestedEl[] }[] }[] }).rows[0];
  const nested = () => row().columns[0].elements[0].children ?? [];

  ops.boxAction([0, 0, 0, 0, 0], "addColumn");
  assert.deepEqual(nested().map((c) => [c.props.flexDirection, c.props.grow]), [["column", "2"], ["column", "1"]]);
  ops.boxAction([0, 0, 0, 0, 0], "duplicate");
  assert.equal(nested().length, 3);
  assert.notEqual((nested()[1] as NestedEl & { id: string }).id, "v", "a duplicate gets its own id");
  ops.boxAction([0, 0, 0], "addColumn");
  assert.deepEqual(row().columns.map((c) => [c.span, c.elements.length]), [[1, 1], [1, 0]]);
  ops.boxAction([0, 0, 1], "delete");
  ops.boxAction([0, 0, 0], "delete");
  assert.equal((state.blocks[0].props as { rows: unknown[] }).rows.length, 0, "the row goes with its last column (deleteColumn's rule)");

  const locked = sampleBlocks();
  (locked[0].props as Record<string, unknown>).locked = "true";
  const l = makeDeps(locked);
  const before = JSON.stringify(l.state.blocks);
  __testOnly_blockOpsFns(l.deps as never).boxAction([0, 0, 0], "delete");
  assert.equal(JSON.stringify(l.state.blocks), before, "refused on a locked section");
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
