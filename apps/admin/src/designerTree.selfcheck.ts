import assert from "node:assert";
import { moveSection, moveColumn } from "./designerTree.ts";
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

console.log("designerTree self-check passed");
