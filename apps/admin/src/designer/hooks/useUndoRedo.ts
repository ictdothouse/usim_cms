import { useRef, useState } from "react";
import type React from "react";
import type { Block, Sel } from "../types";

// Designer.tsx keeps its own copy of this same one-liner for its remaining
// (non-extracted) mutate-adjacent call sites — not shared via an import,
// since a `designer/` file may never import back from Designer.tsx
// (`designer/types.ts`'s own rule) and no other `designer/` module has
// needed a clone helper yet (see `useClipboard.ts`).
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function undoRedoFns(
  getBlocks: () => Block[],
  setBlocksFn: (updater: (prev: Block[]) => Block[]) => void,
  history: { current: Block[][] },
  future: { current: Block[][] },
  onDirty?: () => void,
  onSelReset?: () => void,
  onStructuralChange?: () => void,
) {
  // Uses the functional setState form so multiple mutate() calls fired
  // synchronously in the same tick each build on the PREVIOUS call's result
  // instead of all cloning the same pre-edit `blocks` closure value and
  // racing to overwrite each other. This came up for real: a "linked"
  // FourSideControl commit calls setSide once per side (sides.forEach) — 4
  // separate mutate() calls back to back — and with a plain `const next =
  // clone(blocks)` here, all 4 cloned the same stale snapshot and only the
  // LAST call's single-side change actually stuck (every other side's
  // change was silently discarded), even though the linked value looked
  // right in the input itself.
  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(getBlocks()));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setBlocksFn((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    onDirty?.();
  }
  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(clone(getBlocks()));
    setBlocksFn(() => prev);
    onSelReset?.();
    onDirty?.();
    onStructuralChange?.();
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(getBlocks()));
    setBlocksFn(() => next);
    onSelReset?.();
    onDirty?.();
    onStructuralChange?.();
  }
  function resetHistory() {
    history.current = [];
    future.current = [];
  }
  return { mutate, undo, redo, resetHistory };
}

export function __testOnly_undoRedoFns(getBlocks: () => Block[], setBlocksFn: (updater: (prev: Block[]) => Block[]) => void) {
  return undoRedoFns(getBlocks, setBlocksFn, { current: [] }, { current: [] });
}

export function useUndoRedo(
  initialBlocks: Block[] | (() => Block[]),
  setDirty: (v: boolean) => void,
  setSel: (s: Sel) => void,
  onStructuralChange?: () => void,
) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  // A drag in progress must keep its hover-band shown even once the mouse
  // leaves the small handle it started on — see Designer.tsx's
  // bandHoverProps, which reads this ref directly (a drag moves the cursor
  // away from the ~20px hit target almost immediately, which would
  // otherwise fire onMouseLeave and clear the band right as the drag began).
  const draggingBand = useRef(false);

  const { mutate, undo, redo, resetHistory } = undoRedoFns(
    () => blocks,
    setBlocks,
    history,
    future,
    () => setDirty(true),
    () => setSel(null),
    onStructuralChange,
  );

  // A non-undoable direct set — used by a language switch (the loaded
  // layout for the target language isn't an edit, so it must bypass
  // mutate()/history entirely) and any other caller that needs to replace
  // `blocks` wholesale without pushing a history entry.
  function setBlocksDirectly(next: Block[]) {
    setBlocks(next);
  }

  // Figma-style drag-to-resize for the spacing-overlay badges: one history
  // entry for the whole drag (pushed once, up front) instead of one per
  // mousemove — every subsequent move re-derives the full next value from
  // the drag's start snapshot and overwrites, rather than accumulating.
  function startSpacingDrag(
    e: React.MouseEvent,
    startPx: number,
    axis: "x" | "y",
    sign: 1 | -1,
    apply: (next: Block[], px: number) => void,
    onBandHoverChange?: (key: string | null) => void,
    bandKey?: string,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const base = clone(blocks);
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    draggingBand.current = true;
    if (bandKey) onBandHoverChange?.(bandKey);
    function onMove(ev: MouseEvent) {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      const px = Math.max(0, Math.round(startPx + sign * (pos - startPos)));
      const next = clone(base);
      apply(next, px);
      setBlocks(next);
      setDirty(true);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      draggingBand.current = false;
      if (bandKey) onBandHoverChange?.(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { blocks, setBlocksDirectly, mutate, startSpacingDrag, undo, redo, resetHistory, draggingBand };
}
