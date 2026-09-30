import { test } from "node:test";
import assert from "node:assert/strict";
import { snapValue, centerXCandidates, centerYCandidates, edgeXCandidates, edgeYCandidates } from "./snap";

test("snapValue snaps to the nearest candidate within range", () => {
  assert.equal(snapValue(102, [100, 200], 8), 100);
});

test("snapValue leaves the value untouched when nothing is close enough", () => {
  assert.equal(snapValue(150, [100, 200], 8), 150);
});

test("snapValue picks the closer of two in-range candidates", () => {
  assert.equal(snapValue(198, [190, 200], 8), 200);
});

test("centerXCandidates includes the container center and each sibling's center", () => {
  const cands = centerXCandidates(1000, [{ left: 100, top: 0, width: 200, height: 50 }]);
  assert.deepEqual(cands, [500, 200]);
});

test("centerYCandidates mirrors centerXCandidates on the vertical axis", () => {
  const cands = centerYCandidates(500, [{ left: 0, top: 40, width: 50, height: 100 }]);
  assert.deepEqual(cands, [250, 90]);
});

test("edgeXCandidates includes the safe-area insets and each sibling's left/right edges", () => {
  const cands = edgeXCandidates(1000, [{ left: 100, top: 0, width: 200, height: 50 }]);
  assert.deepEqual(cands, [60, 940, 100, 300]);
});

test("edgeYCandidates includes the safe-area insets and each sibling's top/bottom edges", () => {
  const cands = edgeYCandidates(500, [{ left: 0, top: 40, width: 50, height: 100 }]);
  assert.deepEqual(cands, [30, 470, 40, 140]);
});
