import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToIframeLocal, resolveInsertionIndex, commitDropTarget, resolveDropTargetFromPath } from "./liveEditDropTarget";

test("clientToIframeLocal: scale 1 (no CSS shrink) passes coordinates through minus the iframe's own offset", () => {
  const p = clientToIframeLocal(150, 80, { left: 50, top: 20, width: 800 }, 800);
  assert.deepEqual(p, { x: 100, y: 60 });
});

test("clientToIframeLocal: divides by the recovered scale when the iframe is CSS-shrunk (DeviceViewport)", () => {
  // Rendered at true 800px width, visually shrunk to 400px (scale 0.5).
  const p = clientToIframeLocal(250, 120, { left: 50, top: 20, width: 400 }, 800);
  assert.deepEqual(p, { x: 400, y: 200 });
});

test("clientToIframeLocal: zero offsetWidth (iframe not yet laid out) falls back to scale 1 instead of dividing by zero", () => {
  const p = clientToIframeLocal(150, 80, { left: 50, top: 20, width: 400 }, 0);
  assert.deepEqual(p, { x: 100, y: 60 });
});

test("clientToIframeLocal: zero iframeRect.width (DeviceViewport scale currently 0, not yet laid out) also falls back to scale 1 instead of producing Infinity/NaN", () => {
  const p = clientToIframeLocal(150, 80, { left: 50, top: 20, width: 0 }, 800);
  assert.deepEqual(p, { x: 100, y: 60 });
});

test("resolveInsertionIndex: pointer in the hovered element's top half inserts BEFORE it", () => {
  assert.equal(resolveInsertionIndex(100, { top: 80, height: 100 }, 2), 2);
});

test("resolveInsertionIndex: pointer in the hovered element's bottom half inserts AFTER it", () => {
  assert.equal(resolveInsertionIndex(150, { top: 80, height: 100 }, 2), 3);
});

test("resolveInsertionIndex: pointer exactly at the midpoint inserts AFTER (boundary is inclusive-after)", () => {
  assert.equal(resolveInsertionIndex(130, { top: 80, height: 100 }, 2), 3);
});

test("commitDropTarget: a null target (drag released outside the iframe, or no hover ever resolved) calls neither function", () => {
  const calls: string[] = [];
  commitDropTarget(null, (colPath, index) => calls.push(`into-column:${colPath}:${index}`), (after) => calls.push(`new-section:${after}`));
  assert.deepEqual(calls, []);
});

test("commitDropTarget: an into-column target calls dropIntoColumn with its colPath/index", () => {
  const calls: unknown[] = [];
  commitDropTarget(
    { kind: "into-column", colPath: [0, 1, 2], index: 3 },
    (colPath, index) => calls.push(["into-column", colPath, index]),
    (after) => calls.push(["new-section", after]),
  );
  assert.deepEqual(calls, [["into-column", [0, 1, 2], 3]]);
});

test("commitDropTarget: a new-section target calls dropIntoNewSection with its afterBlockIndex", () => {
  const calls: unknown[] = [];
  commitDropTarget(
    { kind: "new-section", afterBlockIndex: 4 },
    (colPath, index) => calls.push(["into-column", colPath, index]),
    (after) => calls.push(["new-section", after]),
  );
  assert.deepEqual(calls, [["new-section", 4]]);
});

test("resolveDropTargetFromPath: a section-level path (length 1), pointer in the top third, resolves to new-section BEFORE it", () => {
  const rect = { top: 0, bottom: 300, height: 300 };
  assert.deepEqual(resolveDropTargetFromPath([2], 50, rect, rect, 5), { kind: "new-section", afterBlockIndex: 1 });
});

test("resolveDropTargetFromPath: a section-level path (length 1), pointer in the bottom third, resolves to new-section AFTER it", () => {
  const rect = { top: 0, bottom: 300, height: 300 };
  assert.deepEqual(resolveDropTargetFromPath([2], 250, rect, rect, 5), { kind: "new-section", afterBlockIndex: 2 });
});

test("resolveDropTargetFromPath: a section-level path (length 1), pointer in the middle third, resolves into that section's first column", () => {
  const rect = { top: 0, bottom: 300, height: 300 };
  assert.deepEqual(resolveDropTargetFromPath([2], 150, rect, rect, 5), { kind: "into-column", colPath: [2, 0, 0] });
});

test("resolveDropTargetFromPath: a COLUMN-level path (length 3) resolves directly into that column — NOT its parent row (regression test for the tree-corruption bug the final review found)", () => {
  const rect = { top: 50, bottom: 150, height: 100 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3], 100, rect, sectionRect, 5), { kind: "into-column", colPath: [2, 1, 3] });
});

test("resolveDropTargetFromPath: an element-level path (length 4) resolves relative to its own parent column and index", () => {
  const rect = { top: 80, bottom: 180, height: 100 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5], 100, rect, sectionRect, 5), { kind: "into-column", colPath: [2, 1, 3], index: 5 });
});

test("resolveDropTargetFromPath: a nested container child path (length 5+) generalizes the same way", () => {
  const rect = { top: 80, bottom: 180, height: 100 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5, 0], 170, rect, sectionRect, 5), { kind: "into-column", colPath: [2, 1, 3, 5], index: 1 });
});

test("resolveDropTargetFromPath: no path under the pointer (empty page, or below the last section) appends a new section at the very end", () => {
  assert.deepEqual(resolveDropTargetFromPath(null, 400, null, null, 3), { kind: "new-section", afterBlockIndex: 2 });
});

test("resolveDropTargetFromPath: no path under the pointer on a genuinely empty page (0 sections) resolves afterBlockIndex -1", () => {
  assert.deepEqual(resolveDropTargetFromPath(null, 50, null, null, 0), { kind: "new-section", afterBlockIndex: -1 });
});

test("resolveDropTargetFromPath: hovering deep content (not the section's own box) within 12px of the section's TOP edge still resolves new-section-before — a full-bleed/zero-padding section has no other reachable way to trigger this (final review finding)", () => {
  const elRect = { top: 5, bottom: 60, height: 55 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5], 5, elRect, sectionRect, 5), { kind: "new-section", afterBlockIndex: 1 });
});

test("resolveDropTargetFromPath: hovering deep content within 12px of the section's BOTTOM edge still resolves new-section-after", () => {
  const elRect = { top: 350, bottom: 400, height: 50 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5], 395, elRect, sectionRect, 5), { kind: "new-section", afterBlockIndex: 2 });
});

test("resolveDropTargetFromPath: hovering deep content well inside the section (not near either edge) resolves into-column as normal, unaffected by the edge-band fallback", () => {
  const elRect = { top: 180, bottom: 220, height: 40 };
  const sectionRect = { top: 0, bottom: 400, height: 400 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5], 200, elRect, sectionRect, 5), { kind: "into-column", colPath: [2, 1, 3], index: 6 });
});

test("resolveDropTargetFromPath: no sectionRect available (edge case) falls back to normal into-column resolution without the edge band", () => {
  const elRect = { top: 5, bottom: 60, height: 55 };
  assert.deepEqual(resolveDropTargetFromPath([2, 1, 3, 5], 5, elRect, null, 5), { kind: "into-column", colPath: [2, 1, 3], index: 5 });
});
