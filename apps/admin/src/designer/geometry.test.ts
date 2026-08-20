import { test } from "node:test";
import assert from "node:assert/strict";
import { fluidPreviewPx, fitTextBox, nudgePosition, edgeGap } from "./geometry";
import type { Positionable, EdgeRect } from "./types";

test("fluidPreviewPx never exceeds the ceiling and respects the 14px-ish floor", () => {
  assert.equal(fluidPreviewPx(20, "desktop"), 20);
  assert.ok(fluidPreviewPx(60, "mobile") < 60);
  assert.ok(fluidPreviewPx(60, "mobile") >= 14);
});

test("fitTextBox no-ops on a null node instead of throwing", () => {
  assert.doesNotThrow(() => fitTextBox(null));
});

test("nudgePosition starts a still-flow item from 50/50 and clamps to 0..100", () => {
  const flowItem: Positionable = { position: "flow", x: "50", y: "50" };
  const right = nudgePosition(flowItem, "ArrowRight");
  assert.equal(right?.position, "custom");
  assert.equal(right?.x, "52");
  const atEdge: Positionable = { position: "custom", x: "99", y: "0" };
  assert.equal(nudgePosition(atEdge, "ArrowRight")?.x, "100");
  assert.equal(nudgePosition(atEdge, "ArrowUp")?.y, "0");
});

test("nudgePosition returns null for a non-arrow key", () => {
  const item: Positionable = { position: "flow", x: "50", y: "50" };
  assert.equal(nudgePosition(item, "Enter"), null);
});

test("edgeGap finds a vertical gap only when the rects x-overlap and don't y-overlap", () => {
  const boxRect: EdgeRect = { left: 0, right: 100, top: 0, bottom: 100 };
  const a: EdgeRect = { left: 10, right: 30, top: 10, bottom: 20 };
  const b: EdgeRect = { left: 10, right: 30, top: 40, bottom: 50 };
  const mark = edgeGap(a, b, boxRect, "v");
  assert.ok(mark);
  assert.equal(mark?.length, 20);
});

test("edgeGap returns null when the rects don't overlap on the perpendicular axis", () => {
  const boxRect: EdgeRect = { left: 0, right: 100, top: 0, bottom: 100 };
  const a: EdgeRect = { left: 10, right: 20, top: 10, bottom: 20 };
  const b: EdgeRect = { left: 50, right: 60, top: 40, bottom: 50 };
  assert.equal(edgeGap(a, b, boxRect, "v"), null);
});
