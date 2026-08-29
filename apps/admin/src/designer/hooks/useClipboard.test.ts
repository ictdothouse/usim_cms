import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_clipboardFns } from "./useClipboard";

// useClipboard has no React-specific behavior worth testing outside a real
// component (its only state, clipTick, is a re-render trigger with no
// observable effect outside React) — this test instead exercises its
// clipboard read/write functions directly against a fake localStorage,
// which is what actually has behavior worth locking down.
//
// Note: this package is ESM ("type": "module" in package.json, confirmed by
// every sibling designer/*.test.ts using static imports) — the brief's
// original draft used require("./useClipboard") inside each test body
// (presumably to get a fresh module per test), but `require` isn't defined
// under tsx's ESM test runner here. A static top-level import works exactly
// the same for this module: __testOnly_clipboardFns() carries no state of
// its own, and localStorage is looked up fresh on every clipCopy/clipRead
// call rather than captured at import time, so re-requiring per test would
// have been equivalent to this anyway.
function makeFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

test("clipCopy/clipRead round-trip JSON through localStorage, namespaced per level", () => {
  (globalThis as unknown as { localStorage: ReturnType<typeof makeFakeLocalStorage> }).localStorage = makeFakeLocalStorage();
  const { clipCopy, clipRead, clipHas } = __testOnly_clipboardFns();
  assert.equal(clipHas("section"), false);
  clipCopy("section", { hello: "world" });
  assert.equal(clipHas("section"), true);
  assert.deepEqual(clipRead("section"), { hello: "world" });
  assert.equal(clipHas("row"), false);
});

test("styleCopy strips CONTENT_KEYS for the given element type before storing", () => {
  (globalThis as unknown as { localStorage: ReturnType<typeof makeFakeLocalStorage> }).localStorage = makeFakeLocalStorage();
  const { styleCopy, styleRead } = __testOnly_clipboardFns();
  styleCopy("element", { color: "#fff", text: "should be stripped" }, "text");
  const stored = styleRead("element");
  assert.equal(stored?.color, "#fff");
  assert.equal("text" in (stored ?? {}), false);
});
