import assert from "node:assert";
import { moveSection, moveColumn, childrenOf, getNode, removeAt, insertAt, moveWithin } from "./designerTree.ts";
import type { Block } from "./Designer.ts";

function fixture(): Block[] {
  return [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              { span: 1, elements: [{ id: "e1", type: "text", props: {} }] },
              { span: 1, elements: [{ id: "e2", type: "text", props: {} }] },
            ],
          },
        ],
      },
    },
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }] } },
    { type: "hero", props: {} },
  ] as unknown as Block[];
}

{
  const blocks = fixture();
  moveSection(blocks, 2, 0);
  assert.strictEqual(blocks[0].type, "hero");
  assert.strictEqual(blocks[1].type, "section");
  assert.strictEqual(blocks.length, 3);
}

{
  const blocks = fixture();
  moveColumn(blocks, 0, 0, 1, 0);
  const cols = (blocks[0].props as { rows: { columns: { elements: { id: string }[] }[] }[] }).rows[0].columns;
  assert.strictEqual(cols[0].elements[0].id, "e2");
  assert.strictEqual(cols[1].elements[0].id, "e1");
}

// childrenOf/getNode at every depth (0=blocks, 1=rows, 2=columns, 3=elements)
{
  const blocks = fixture();
  assert.strictEqual(childrenOf(blocks, []), blocks);
  assert.strictEqual(childrenOf(blocks, [0]), (blocks[0].props as unknown as { rows: unknown[] }).rows);
  assert.strictEqual(getNode(blocks, [0]), blocks[0]);
  assert.strictEqual((getNode(blocks, [0, 0, 1]) as { span: number }).span, 1);
  assert.strictEqual((getNode(blocks, [0, 0, 0, 0]) as { id: string }).id, "e1");
  assert.throws(() => childrenOf(blocks, [0, 0, 0, 0]));
}

// removeAt/insertAt round-trip at element depth
{
  const blocks = fixture();
  const removed = removeAt(blocks, [0, 0, 0, 0]) as { id: string };
  assert.strictEqual(removed.id, "e1");
  assert.strictEqual((getNode(blocks, [0, 0, 0]) as { elements: unknown[] }).elements.length, 0);
  insertAt(blocks, [0, 0, 1], removed, 0);
  const col1Elements = (getNode(blocks, [0, 0, 1]) as { elements: { id: string }[] }).elements;
  assert.strictEqual(col1Elements[0].id, "e1");
  assert.strictEqual(col1Elements[1].id, "e2");
}

// moveWithin at row depth (matches what deleteRow/moveRow/moveElement will delegate to)
{
  const blocks = fixture();
  const row = getNode(blocks, [0, 0]);
  assert.strictEqual(row, (blocks[0].props as unknown as { rows: unknown[] }).rows[0]);
  moveWithin(blocks, [0], 0, 0); // no-op move, same slot
  assert.strictEqual(getNode(blocks, [0, 0]), row);
}

console.log("designerTree self-check passed");
