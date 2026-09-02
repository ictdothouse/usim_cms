import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_blockOpsFns } from "./useBlockOps";
import type { Block } from "../types";

function sampleBlocks(): Block[] {
  return [
    { type: "section", props: { rows: [{ columns: [{ elements: [] }] }] } } as unknown as Block,
  ];
}

function fakeHarness() {
  let blocks = sampleBlocks();
  const bumpStructuralCalls: number[] = [];
  const setSelCalls: unknown[] = [];
  const clipStore = new Map<string, unknown>();
  const styleStore = new Map<string, unknown>();
  const ops = __testOnly_blockOpsFns({
    getBlocks: () => blocks,
    mutate: (fn) => { const next = JSON.parse(JSON.stringify(blocks)); fn(next); blocks = next; },
    setSel: (s) => setSelCalls.push(s),
    clipboard: {
      clipCopy: (level: string, data: unknown) => clipStore.set(level, data),
      clipRead: <T,>(level: string) => (clipStore.get(level) as T | undefined) ?? null,
      styleCopy: (level: string, props: unknown) => styleStore.set(level, props),
      styleRead: (level: string) => (styleStore.get(level) as Record<string, string> | undefined) ?? null,
    },
    bumpStructural: () => bumpStructuralCalls.push(1),
    isSuper: false,
    t: (k: string) => k,
  });
  return { ops, getBlocks: () => blocks, bumpStructuralCalls, setSelCalls };
}

test("duplicateSection inserts a deep clone right after the original and bumps structural", () => {
  const { ops, getBlocks, bumpStructuralCalls } = fakeHarness();
  ops.duplicateSection(0);
  assert.equal(getBlocks().length, 2);
  assert.equal(bumpStructuralCalls.length, 1);
});

test("deleteSection refuses to delete a locked section for a non-superadmin", () => {
  const { ops, getBlocks } = fakeHarness();
  (getBlocks()[0].props as Record<string, unknown>).locked = "true";
  ops.deleteSection(0);
  assert.equal(getBlocks().length, 1); // unchanged — refused
});

test("copySection then pasteSection round-trips through the clipboard", () => {
  const { ops, getBlocks } = fakeHarness();
  ops.copySection(0);
  ops.pasteSection(0);
  assert.equal(getBlocks().length, 2);
});

test("deleteColumn cascades to remove the row once its last column is gone", () => {
  const { ops, getBlocks } = fakeHarness();
  ops.deleteColumn(0, 0, 0);
  assert.equal((getBlocks()[0].props as unknown as { rows: unknown[] }).rows.length, 0);
});

test("copySection captures the CURRENT blocks value, not a stale one from an earlier call", () => {
  const { ops, getBlocks } = fakeHarness();
  (getBlocks()[0].props as Record<string, unknown>).paddingY = "lg";
  ops.copySection(0);
  ops.pasteSection(0);
  assert.equal((getBlocks()[1].props as Record<string, unknown>).paddingY, "lg");
});
