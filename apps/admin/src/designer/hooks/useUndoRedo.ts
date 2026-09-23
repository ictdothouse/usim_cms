// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — owns rawBlocks (the true,
// undo-tracked source of the layout tree; Designer()'s own `blocks`, the
// per-language VIEW of it, is a separate useMemo built on top of
// rawBlocks + langOverrides/activeLang, which live in usePageAndLanguage —
// that derivation stays in Designer() itself since it's a genuine
// cross-hook composition, not owned by either hook alone), history/future
// (capped at 50 entries), draggingBand, mutate/undo/redo, and the spacing-
// drag helper.
import { useRef, useState } from "react";
import type React from "react";
import type { Block, Sel } from "../types";
import { clone } from "@/lib/utils";

type SetHoverBand = React.Dispatch<React.SetStateAction<string | null>>;

// Pulled out of useUndoRedo() so mutate/undo/redo's actual behavior — the
// history-cap, the functional-setState fix for the multi-mutate-per-tick
// bug (see mutate's own comment below), the future-stack clearing — is
// unit-testable with plain injected refs/closures, no React renderer
// needed.
function undoRedoFns(
  getRawBlocks: () => Block[],
  setRawBlocksFn: (updater: (prev: Block[]) => Block[]) => void,
  history: { current: Block[][] },
  future: { current: Block[][] },
  onDirty: () => void,
  onSelReset: () => void,
  onStructuralChange: () => void,
) {
  // Uses the functional setState form so multiple mutate() calls fired
  // synchronously in the same tick each build on the PREVIOUS call's result
  // instead of all cloning the same pre-edit `rawBlocks` closure value and
  // racing to overwrite each other. This came up for real: a "linked"
  // FourSideControl commit calls setSide once per side (sides.forEach) — 4
  // separate mutate() calls back to back — and with a plain `const next =
  // clone(rawBlocks)` here, all 4 cloned the same stale snapshot and only
  // the LAST call's single-side change actually stuck (every other side's
  // change was silently discarded), even though the linked value looked
  // right in the input itself. Do not regress to that form.
  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(getRawBlocks()));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setRawBlocksFn((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    onDirty();
  }
  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(clone(getRawBlocks()));
    setRawBlocksFn(() => prev);
    onSelReset();
    onDirty();
    onStructuralChange();
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(getRawBlocks()));
    setRawBlocksFn(() => next);
    onSelReset();
    onDirty();
    onStructuralChange();
  }
  return { mutate, undo, redo };
}

export function __testOnly_undoRedoFns(getRawBlocks: () => Block[], setRawBlocksFn: (updater: (prev: Block[]) => Block[]) => void) {
  const history: { current: Block[][] } = { current: [] };
  const future: { current: Block[][] } = { current: [] };
  const calls = { dirty: 0, selReset: 0, structural: 0 };
  const fns = undoRedoFns(
    getRawBlocks,
    setRawBlocksFn,
    history,
    future,
    () => calls.dirty++,
    () => calls.selReset++,
    () => calls.structural++,
  );
  return { ...fns, history, future, calls };
}

export interface UndoRedoApi {
  rawBlocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  // A non-undoable direct set — used by restoreRevision (loading a past
  // revision isn't an edit, so it must bypass mutate()/history entirely)
  // and any other caller that needs to replace rawBlocks wholesale without
  // pushing a history entry.
  setRawBlocksDirectly: (next: Block[]) => void;
  startSpacingDrag: (
    e: React.MouseEvent,
    startPx: number,
    axis: "x" | "y",
    sign: 1 | -1,
    apply: (next: Block[], px: number) => void,
    bandKey?: string,
  ) => void;
  undo: () => void;
  redo: () => void;
  // Read directly by Designer()'s own bandHoverProps (residual render-only
  // helper) so a mouseleave off the ~20px handle mid-drag doesn't clear the
  // hover band — see startSpacingDrag's own comment.
  draggingBand: React.MutableRefObject<boolean>;
}

export function useUndoRedo(
  initialBlocks: Block[],
  setDirty: (v: boolean) => void,
  setSel: (s: Sel) => void,
  bumpStructural: () => void,
  setHoverBand: SetHoverBand,
): UndoRedoApi {
  const [rawBlocks, setRawBlocks] = useState<Block[]>(initialBlocks);
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  // A drag in progress must keep its hover-band shown even once the mouse
  // leaves the small handle it started on — see Designer.tsx's
  // bandHoverProps, which reads this ref directly (a drag moves the cursor
  // away from the ~20px hit target almost immediately, which would
  // otherwise fire onMouseLeave and clear the band right as the drag began).
  const draggingBand = useRef(false);

  const { mutate, undo, redo } = undoRedoFns(
    () => rawBlocks,
    setRawBlocks,
    history,
    future,
    () => setDirty(true),
    () => setSel(null),
    bumpStructural,
  );

  function setRawBlocksDirectly(next: Block[]) {
    setRawBlocks(next);
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
    bandKey?: string,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const base = clone(rawBlocks);
    history.current.push(clone(rawBlocks));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    draggingBand.current = true;
    if (bandKey) setHoverBand(bandKey);
    function onMove(ev: MouseEvent) {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      const px = Math.max(0, Math.round(startPx + sign * (pos - startPos)));
      const next = clone(base);
      apply(next, px);
      setRawBlocks(next);
      setDirty(true);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      draggingBand.current = false;
      if (bandKey) setHoverBand((k) => (k === bandKey ? null : k));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { rawBlocks, mutate, setRawBlocksDirectly, startSpacingDrag, undo, redo, draggingBand };
}
