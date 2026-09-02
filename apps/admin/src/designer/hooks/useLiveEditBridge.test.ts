import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_handleFrameLoad } from "./useLiveEditBridge";

test("handleFrameLoad resolves a pending hot-swap by activating the loaded slot", () => {
  let activeSlot: "a" | "b" = "a";
  let reloading = true;
  const swapPending = { current: "b" as "a" | "b" | null };
  const handle = __testOnly_handleFrameLoad({
    swapPending,
    setActiveSlot: (s) => { activeSlot = s; },
    setReloading: (v) => { reloading = v; },
    frameARef: { current: null },
    frameBRef: { current: null },
    liveSrcA: null,
    liveSrcB: "http://example.com/b",
    pendingScrollRestore: { current: null },
    activeSlot: "a",
  });
  handle("b");
  assert.equal(activeSlot, "b");
  assert.equal(reloading, false);
  assert.equal(swapPending.current, null);
});

test("handleFrameLoad on the currently-active slot with no pending swap just clears reloading", () => {
  let reloading = true;
  const swapPending = { current: null as "a" | "b" | null };
  const handle = __testOnly_handleFrameLoad({
    swapPending,
    setActiveSlot: () => {},
    setReloading: (v) => { reloading = v; },
    frameARef: { current: null },
    frameBRef: { current: null },
    liveSrcA: "http://example.com/a",
    liveSrcB: null,
    pendingScrollRestore: { current: null },
    activeSlot: "a",
  });
  handle("a");
  assert.equal(reloading, false);
});

test("handleFrameLoad ignores a load for neither the pending nor the active slot", () => {
  let reloading = true;
  const swapPending = { current: null as "a" | "b" | null };
  const handle = __testOnly_handleFrameLoad({
    swapPending,
    setActiveSlot: () => {},
    setReloading: (v) => { reloading = v; },
    frameARef: { current: null },
    frameBRef: { current: null },
    liveSrcA: null,
    liveSrcB: null,
    pendingScrollRestore: { current: null },
    activeSlot: "a",
  });
  handle("b");
  assert.equal(reloading, true); // untouched
});
