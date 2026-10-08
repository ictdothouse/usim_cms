# Live Edit Drag-to-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author drag an element from Designer's Elements palette directly onto the real rendered page inside Live Edit (not just Blocks mode), dropping either between two sections (auto-wrapped in a new section→row→column) or directly into an existing column — without any new mutation logic, by reusing `useBlockOps.ts`'s existing `dropIntoColumn`/`dropIntoNewSection`.

**Architecture:** A pointer-events gesture (not native HTML5 drag-and-drop) starts in the admin parent window and uses `Element.setPointerCapture` so the parent keeps receiving `pointermove`/`pointerup` even while the cursor is visually over the cross-origin Live Edit iframe. The parent posts throttled pointer-position messages into the iframe; the iframe (apps/frontend's existing `designerEdit` bridge script) resolves the hovered drop target using the `data-designer-path` attributes already stamped on every section/column/element, draws a local drop-indicator overlay, and reports the resolved target back. On release, the admin parent commits via the existing `dropIntoColumn`/`dropIntoNewSection` — the iframe never mutates anything.

**Tech Stack:** React 18 + TypeScript (apps/admin), Astro inline `<script is:inline>` plain JS (apps/frontend), Pointer Events API, `postMessage`, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md`

## Global Constraints

- Every `postMessage` send/receive must validate origin exactly like every existing `designer:*` message in this codebase (`e.origin === targetOrigin` on receive; `targetOrigin` derived from `liveSrc`/`document.referrer`, never `"*"`).
- No new mutation logic — every structural change must route through the existing `dropIntoColumn`/`dropIntoNewSection` in `apps/admin/src/designer/hooks/useBlockOps.ts`.
- `apps/frontend/src/layouts/BaseLayout.astro`'s `designerEdit` script is `<script is:inline>` (deliberately unbundled, no imports) — any logic added there must be hand-written plain JS, with a comment pointing at the canonical TypeScript copy it mirrors (same convention this codebase already uses for every admin/frontend duplicated render helper).
- Existing Blocks-mode call sites of `dropIntoNewSection()` (no argument) must keep their exact current behavior (append a new empty section at the end) — this plan only ADDS an optional parameter, never changes the default.
- Follow this repo's existing test conventions exactly: `node:test` + `node:assert/strict` for pure-function/hook-logic tests (see `useBlockOps.test.ts`), Playwright for the one E2E smoke path (see `e2e/designer-smoke.spec.ts`).

## Review Focus

- **Drag released outside the iframe entirely** (e.g. over the admin's own toolbar/sidebar) — must no-op, not throw or silently create an empty section.
- **Live Edit reloads mid-drag** (an autosave or an unrelated concurrent edit swaps the active iframe slot while the user is still dragging) — `postMessage` to the torn-down `contentWindow` must fail silently, matching the existing try/catch pattern, not crash the gesture.
- **Dropping onto a locked section** — must be rejected with the existing toast, exactly like Blocks-mode's own `dropIntoColumn`/`dropIntoNewSection` already reject it; no new lock-bypass path introduced by the new entry point.
- **`afterBlockIndex` extension changes default behavior** — a regression here would silently break every existing Blocks-mode "+ Add Section" click/drop, which runs on every page a webmaster edits. Must be covered by a test that calls `dropIntoNewSection()` with no argument and asserts append-at-end, unchanged from before this plan.
- **Iframe not yet laid out / zero-width** when a drag starts (e.g. Live Edit just switched on) — the coordinate-mapping math divides by the iframe's `offsetWidth`; a zero or missing value must not produce `NaN`/`Infinity` coordinates sent into the iframe.

---

### Task 1: Pure drop-target math (`liveEditDropTarget.ts`)

**Files:**
- Create: `apps/admin/src/designer/liveEditDropTarget.ts`
- Test: `apps/admin/src/designer/liveEditDropTarget.test.ts`

**Interfaces:**
- Produces: `clientToIframeLocal(clientX: number, clientY: number, iframeRect: {left:number; top:number; width:number}, iframeOffsetWidth: number): {x:number; y:number}`
- Produces: `resolveInsertionIndex(pointerY: number, hoveredRect: {top:number; height:number}, hoveredIndex: number): number`
- Produces: `export type DropTarget = { kind: "into-column"; colPath: number[]; index?: number } | { kind: "new-section"; afterBlockIndex: number }`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/admin/src/designer/liveEditDropTarget.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToIframeLocal, resolveInsertionIndex, commitDropTarget } from "./liveEditDropTarget";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ucms/admin test`
Expected: FAIL — `Cannot find module './liveEditDropTarget'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/designer/liveEditDropTarget.ts
// Pure math for Live Edit's drag-to-add feature (see
// docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md).
// apps/frontend/src/layouts/BaseLayout.astro's `designerEdit` script hand-
// ports resolveInsertionIndex's same logic (it's <script is:inline>, plain
// unbundled JS, so it can't import this module) — that file's own comment
// points back here. Keep both in sync by hand.

export interface IframeRectLike {
  left: number;
  top: number;
  width: number;
}

export type DropTarget = { kind: "into-column"; colPath: number[]; index?: number } | { kind: "new-section"; afterBlockIndex: number };

// DeviceViewport renders the Live Edit iframe at its true device width then
// CSS `transform: scale()`s it to fit the available space — rect.width
// (post-scale, parent-viewport px) divided by offsetWidth (pre-scale, the
// iframe's own true width) recovers that scale factor. Same derivation
// useLiveEditBridge.ts's existing `designer:contextmenu` handler already
// uses for the opposite direction (iframe-local -> parent).
export function clientToIframeLocal(
  clientX: number,
  clientY: number,
  iframeRect: IframeRectLike,
  iframeOffsetWidth: number,
): { x: number; y: number } {
  const scale = iframeOffsetWidth ? iframeRect.width / iframeOffsetWidth : 1;
  return {
    x: (clientX - iframeRect.left) / scale,
    y: (clientY - iframeRect.top) / scale,
  };
}

// Given the pointer's Y (iframe-local px), the hovered element's own
// bounding box, and that element's own index within its parent column,
// returns the index a dragged element should be inserted at: before the
// hovered element if the pointer is in its top half, after it otherwise.
export function resolveInsertionIndex(pointerY: number, hoveredRect: { top: number; height: number }, hoveredIndex: number): number {
  const midpoint = hoveredRect.top + hoveredRect.height / 2;
  return pointerY < midpoint ? hoveredIndex : hoveredIndex + 1;
}

// The single decision point between "what the iframe resolved" and "which
// existing useBlockOps function actually runs" — pulled out as its own pure
// function so a target-less drag (released outside the iframe, or dropped
// before any hover ever resolved) is a tested no-op rather than logic
// buried inside a pointerup event handler with no unit-test harness.
export function commitDropTarget(
  target: DropTarget | null,
  dropIntoColumn: (colPath: number[], index?: number) => void,
  dropIntoNewSection: (afterBlockIndex?: number) => void,
): void {
  if (!target) return;
  if (target.kind === "into-column") dropIntoColumn(target.colPath, target.index);
  else dropIntoNewSection(target.afterBlockIndex);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ucms/admin test`
Expected: PASS (all 6 new tests, plus every pre-existing test still green)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/designer/liveEditDropTarget.ts apps/admin/src/designer/liveEditDropTarget.test.ts
git commit -m "feat(admin): add pure drop-target math for Live Edit drag-to-add"
```

---

### Task 2: Extend `dropIntoNewSection` with an optional insertion index

**Files:**
- Modify: `apps/admin/src/designer/hooks/useBlockOps.ts` (the `dropIntoNewSection` function added earlier this session, and its entry in the returned object — currently takes no parameters)
- Test: `apps/admin/src/designer/hooks/useBlockOps.test.ts`

**Interfaces:**
- Consumes: `insertAt(bs: Block[], path: number[], node: unknown, index?: number): void` (already imported in this file from `../../designerTree`)
- Produces: `dropIntoNewSection(afterBlockIndex?: number): void` — when `afterBlockIndex` is omitted, behavior is byte-identical to today (append at the very end); when provided, the new section is inserted at `afterBlockIndex + 1`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/admin/src/designer/hooks/useBlockOps.test.ts` (new helper + 3 new tests, appended after the existing `dropIntoColumn` tests):

```ts
function twoSectionBlocks(): Block[] {
  return [
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }] } } as unknown as Block,
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }], anchorId: "second" } } as unknown as Block,
  ];
}

test("dropIntoNewSection: appends a fresh section with the dragged element at the very end by default", () => {
  const { deps, state } = makeDeps(sampleBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  ops.dropIntoNewSection();
  assert.equal(state.blocks.length, 2);
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { elements: { type: string }[] }[] }[] } };
  assert.equal(inserted.props.rows[0].columns[0].elements[0].type, "heading");
});

test("dropIntoNewSection: an explicit afterBlockIndex inserts the new section right after that index, not at the end", () => {
  const { deps, state } = makeDeps(twoSectionBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new", type: "heading" };
  ops.dropIntoNewSection(0);
  assert.equal(state.blocks.length, 3);
  assert.equal((state.blocks[2].props as { anchorId?: string }).anchorId, "second", "original second section stays last");
  const inserted = state.blocks[1] as unknown as { props: { rows: { columns: { elements: { type: string }[] }[] }[] } };
  assert.equal(inserted.props.rows[0].columns[0].elements[0].type, "heading");
});

test("dropIntoNewSection: a Layout 'new-section' preset inserts a fresh empty Block at afterBlockIndex+1", () => {
  const { deps, state } = makeDeps(twoSectionBlocks());
  const ops = __testOnly_blockOpsFns(deps as never);
  ops.drag.current = { kind: "new-section" };
  ops.dropIntoNewSection(0);
  assert.equal(state.blocks.length, 3);
  assert.equal(state.blocks[1].type, "section");
  assert.equal((state.blocks[2].props as { anchorId?: string }).anchorId, "second");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ucms/admin test`
Expected: FAIL — the 2nd and 3rd new tests fail (`dropIntoNewSection` ignores the argument and always appends at the end, so `state.blocks[1]` is still the untouched original second section, not the newly-inserted one)

- [ ] **Step 3: Modify the implementation**

In `apps/admin/src/designer/hooks/useBlockOps.ts`, replace the `dropIntoNewSection` function (added earlier this session) with:

```ts
  function dropIntoNewSection(afterBlockIndex?: number) {
    const d = drag.current;
    drag.current = null;
    setDropHint(null);
    if (!d || d.kind === "tree-reorder" || d.kind === "new-row") return;
    if (d.kind === "new-section") {
      mutate((bs) => insertAt(bs, [], newSection(), afterBlockIndex === undefined ? bs.length : afterBlockIndex + 1));
      return;
    }
    if (d.kind !== "new" && isSectionLocked(d.path[0])) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => {
      const at = afterBlockIndex === undefined ? bs.length : afterBlockIndex + 1;
      insertAt(bs, [], newSection(), at);
      const colPath = [at, 0, 0];
      if (d.kind === "new") {
        insertAt(bs, colPath, newEl(d.type, d.propsOverride));
        return;
      }
      const el = removeAt(bs, d.path);
      insertAt(bs, colPath, el);
    });
    setSel(null);
  }
```

(Only the function body changes — its entry in the `return { ... }` object at the bottom of the file stays `dropIntoColumn, dropIntoNewSection,` exactly as already written.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ucms/admin test`
Expected: PASS (all `useBlockOps.test.ts` tests, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/designer/hooks/useBlockOps.ts apps/admin/src/designer/hooks/useBlockOps.test.ts
git commit -m "feat(admin): let dropIntoNewSection insert at an explicit position"
```

---

### Task 3: `useLiveEditPaletteDrag` hook (pointer-capture gesture + postMessage bridge)

**Files:**
- Create: `apps/admin/src/designer/hooks/useLiveEditPaletteDrag.ts`

**Interfaces:**
- Consumes: `clientToIframeLocal`, `resolveInsertionIndex`, `DropTarget` from `../liveEditDropTarget` (Task 1)
- Consumes: `dropIntoColumn(colPath: number[], index?: number): void`, `dropIntoNewSection(afterBlockIndex?: number): void` from `useBlockOps` (Task 2)
- Consumes: `Drag` type from `../types`
- Produces: `useLiveEditPaletteDrag(deps): { ghost: {label:string; x:number; y:number} | null; startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void }`

The actual decision logic ("what to do with the last-known drop target") is `commitDropTarget` from Task 1, already unit-tested there. What's left in this hook is pure browser event-listener wiring (pointer capture, postMessage send/receive, `requestAnimationFrame` throttling) with no DOM-tree logic of its own to unit test in isolation — exercised for real by Task 6's Playwright test, consistent with `useLiveEditBridge.ts` itself having no dedicated unit test either (same reason: it's event-wiring glue, not business logic). The one edge case genuinely not covered by any test — `postMessage` to a torn-down `contentWindow` when Live Edit reloads mid-drag — matches an existing, equally-untested precedent in `useLiveEditBridge.ts`'s own `post` helper; accepted as consistent with that precedent, not a new gap introduced by this task.

- [ ] **Step 1: Write the implementation**

```ts
// apps/admin/src/designer/hooks/useLiveEditPaletteDrag.ts
// Owns the Live Edit drag-to-add gesture (see
// docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md): a
// palette item's pointerdown starts a pointer-captured drag that tracks the
// cursor even while it's visually over the cross-origin Live Edit iframe
// (Element.setPointerCapture keeps delivering pointermove/pointerup to the
// capturing element in THIS document regardless of what's under the
// cursor — the standard fix for "mouse events stop firing once the cursor
// enters an iframe"). The iframe never mutates the block tree; it only
// ever reports where the pointer resolved to (designer:dropTarget), and
// this hook commits through the exact same dropIntoColumn/dropIntoNewSection
// Blocks mode already uses.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { clientToIframeLocal, commitDropTarget, type DropTarget } from "../liveEditDropTarget";
import type { Drag } from "../types";

export interface LiveEditPaletteDragDeps {
  drag: MutableRefObject<Drag | null>;
  liveFrame: React.RefObject<HTMLIFrameElement>;
  liveSrc: string | null;
  dropIntoColumn: (colPath: number[], index?: number) => void;
  dropIntoNewSection: (afterBlockIndex?: number) => void;
}

export interface LiveEditPaletteDragApi {
  ghost: { label: string; x: number; y: number } | null;
  startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void;
}

export function useLiveEditPaletteDrag(deps: LiveEditPaletteDragDeps): LiveEditPaletteDragApi {
  const { drag, liveFrame, liveSrc, dropIntoColumn, dropIntoNewSection } = deps;
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const lastTarget = useRef<DropTarget | null>(null);
  const rafPending = useRef(false);

  // Mirrors useLiveEditBridge.ts's own onMessage guard exactly: only accept
  // messages that actually came from the currently-active Live Edit iframe,
  // from the origin that iframe's own src resolves to.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (!liveSrc || e.origin !== new URL(liveSrc, window.location.href).origin) return;
      if (e.data?.type === "designer:dropTarget") {
        lastTarget.current = (e.data.target as DropTarget | null) ?? null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [liveFrame, liveSrc]);

  // Mirrors useLiveEditBridge.ts's own `post` helper: a transient
  // cross-origin mismatch right after a reload/slot-swap (navigation to
  // targetOrigin hasn't completed yet) throws synchronously — harmless to
  // swallow, the next frame's postMessage call supersedes it anyway.
  const postToIframe = useCallback(
    (msg: unknown) => {
      if (!liveSrc || !liveFrame.current?.contentWindow) return;
      try {
        liveFrame.current.contentWindow.postMessage(msg, new URL(liveSrc, window.location.href).origin);
      } catch {
        /* transient cross-origin mismatch mid-reload */
      }
    },
    [liveFrame, liveSrc],
  );

  const startPaletteDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => {
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      drag.current = payload;
      lastTarget.current = null;
      setGhost({ label, x: e.clientX, y: e.clientY });

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        setGhost({ label, x: ev.clientX, y: ev.clientY });
        if (rafPending.current) return;
        const frame = liveFrame.current;
        if (!frame) return;
        rafPending.current = true;
        requestAnimationFrame(() => {
          rafPending.current = false;
          const rect = frame.getBoundingClientRect();
          const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
          if (!inside) {
            lastTarget.current = null;
            postToIframe({ type: "designer:paletteDragEnd" });
            return;
          }
          const { x, y } = clientToIframeLocal(ev.clientX, ev.clientY, rect, frame.offsetWidth);
          postToIframe({ type: "designer:paletteDragMove", x, y });
        });
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        setGhost(null);
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        cleanup();
        postToIframe({ type: "designer:paletteDragEnd" });
        const target = lastTarget.current;
        lastTarget.current = null;
        commitDropTarget(target, dropIntoColumn, dropIntoNewSection);
        if (!target) drag.current = null;
      }

      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        drag.current = null;
        lastTarget.current = null;
        postToIframe({ type: "designer:paletteDragEnd" });
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [drag, liveFrame, dropIntoColumn, dropIntoNewSection, postToIframe],
  );

  return { ghost, startPaletteDrag };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit`
Expected: no errors (this file isn't imported anywhere yet, so this only validates its own internal types compile — Task 4 wires it in and will surface any integration mismatch).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/designer/hooks/useLiveEditPaletteDrag.ts
git commit -m "feat(admin): add useLiveEditPaletteDrag pointer-capture bridge hook"
```

---

### Task 4: Wire the hook into `Designer.tsx` and `DesignerPalette.tsx`

**Files:**
- Modify: `apps/admin/src/Designer.tsx:408-417` (the `useLiveEditBridge` destructure), and its `<DesignerPalette ... />` call (currently `apps/admin/src/Designer.tsx:752-771`)
- Modify: `apps/admin/src/designer/DesignerPalette.tsx:127-146` (props interface + destructure), and the two `draggable` item blocks at lines 184-201 (Layout presets) and 203-224 (Content elements)

**Interfaces:**
- Consumes: `useLiveEditPaletteDrag` from `./hooks/useLiveEditPaletteDrag` (Task 3)

- [ ] **Step 1: Add `liveFrame`/`liveSrc` to Designer.tsx's existing `useLiveEditBridge` destructure**

In `apps/admin/src/Designer.tsx`, change:

```ts
  const {
    mode,
    toggleLive,
    liveSrcA,
    liveSrcB,
    activeSlot,
    frameARef,
    frameBRef,
    handleFrameLoad,
  } = useLiveEditBridge({
```

to:

```ts
  const {
    mode,
    toggleLive,
    liveSrc,
    liveSrcA,
    liveSrcB,
    activeSlot,
    frameARef,
    frameBRef,
    liveFrame,
    handleFrameLoad,
  } = useLiveEditBridge({
```

(`liveSrc` and `liveFrame` both already exist on `LiveEditBridgeApi`'s return type — see `apps/admin/src/designer/hooks/useLiveEditBridge.ts:71-84` — this only adds them to the destructure, no change to the hook itself.)

- [ ] **Step 2: Instantiate `useLiveEditPaletteDrag` in Designer.tsx**

Add this import near Designer.tsx's other `designer/hooks/*` imports:

```ts
import { useLiveEditPaletteDrag } from "./designer/hooks/useLiveEditPaletteDrag";
```

Add this call right after the `useBlockOps({...})` call block (which already produces `drag`, `dropIntoColumn`, `dropIntoNewSection` — see the destructure ending `dropIntoColumn, dropIntoNewSection,` from this session's earlier change):

```ts
  const { ghost, startPaletteDrag } = useLiveEditPaletteDrag({
    drag,
    liveFrame,
    liveSrc,
    dropIntoColumn,
    dropIntoNewSection,
  });
```

- [ ] **Step 3: Pass `mode`/`startPaletteDrag` into `<DesignerPalette>` and render the ghost**

In `apps/admin/src/Designer.tsx`, change the `<DesignerPalette ... />` call (currently ending `patchChromeMeta={patchChromeMeta}\n        />`) to also pass:

```tsx
        <DesignerPalette
          ctx={designerCtx}
          mobilePanel={mobilePanel}
          activeLeftTab={activeLeftTab}
          setActiveLeftTab={setActiveLeftTab}
          drag={drag}
          mode={mode}
          startPaletteDrag={startPaletteDrag}
          blocks={blocks}
          treeDropHint={treeDropHint}
          rowDragProps={rowDragProps}
          expanded={expanded}
          selEq={selEq}
          pick={pick}
          toggleExpand={toggleExpand}
          t={t}
          kind={kind}
          chromeKind={chromeKind}
          chromeIsDefault={chromeIsDefault}
          chromeMobileNav={chromeMobileNav}
          patchChromeMeta={patchChromeMeta}
        />

        {ghost && (
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-lg"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {ghost.label}
          </div>
        )}
```

- [ ] **Step 4: Add `mode`/`startPaletteDrag` to `DesignerPalette`'s props and wire the two draggable item blocks**

In `apps/admin/src/designer/DesignerPalette.tsx`, change the props interface and destructure:

```ts
export interface DesignerPaletteProps {
  ctx: DesignerCtx;
  mobilePanel: "palette" | null;
  activeLeftTab: "elements" | "layers" | "settings";
  setActiveLeftTab: (tab: "elements" | "layers" | "settings") => void;
  drag: MutableRefObject<Drag | null>;
  mode: "blocks" | "live";
  startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void;
  blocks: Block[];
  treeDropHint: { key: string; pos: "before" | "after" } | null;
  rowDragProps: (kind: "section" | "column" | "element", path: number[], key: string) => Record<string, unknown>;
  expanded: Set<string>;
  selEq: (p: number[]) => boolean;
  pick: (e: React.MouseEvent, p: number[]) => void;
  toggleExpand: (key: string) => void;
  t: (k: Key) => string;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  chromeKind: ReturnType<typeof useSiteChrome>["chromeKind"];
  chromeIsDefault: ReturnType<typeof useSiteChrome>["chromeIsDefault"];
  chromeMobileNav: ReturnType<typeof useSiteChrome>["chromeMobileNav"];
  patchChromeMeta: ReturnType<typeof useSiteChrome>["patchChromeMeta"];
}

export function DesignerPalette({
  ctx, mobilePanel, activeLeftTab, setActiveLeftTab, drag, mode, startPaletteDrag,
  blocks, treeDropHint, rowDragProps, expanded, selEq, pick, toggleExpand, t,
  kind, chromeKind, chromeIsDefault, chromeMobileNav, patchChromeMeta,
}: DesignerPaletteProps) {
```

Change the Layout presets block (currently):

```tsx
                  <div
                    key={preset.key}
                    draggable
                    onDragStart={(ev) => {
                      drag.current = preset.drag;
                      ev.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => (drag.current = null)}
                    className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-line/30 bg-canvas/60 px-2 py-2.5 text-center text-[10px] font-medium leading-tight text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
                  >
```

to:

```tsx
                  <div
                    key={preset.key}
                    draggable={mode !== "live"}
                    onDragStart={
                      mode === "live"
                        ? undefined
                        : (ev) => {
                            drag.current = preset.drag;
                            ev.dataTransfer.effectAllowed = "copy";
                          }
                    }
                    onDragEnd={mode === "live" ? undefined : () => (drag.current = null)}
                    onPointerDown={mode === "live" ? (e) => startPaletteDrag(e, preset.drag, t(preset.labelKey)) : undefined}
                    className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-line/30 bg-canvas/60 px-2 py-2.5 text-center text-[10px] font-medium leading-tight text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
                  >
```

Change the Content elements block (currently):

```tsx
                  <div
                    key={type}
                    draggable
                    onDragStart={(ev) => {
                      drag.current = { kind: "new", type };
                      ev.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => (drag.current = null)}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-line/30 bg-canvas/60 px-2.5 py-2 text-xs font-medium text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
                  >
```

to:

```tsx
                  <div
                    key={type}
                    draggable={mode !== "live"}
                    onDragStart={
                      mode === "live"
                        ? undefined
                        : (ev) => {
                            drag.current = { kind: "new", type };
                            ev.dataTransfer.effectAllowed = "copy";
                          }
                    }
                    onDragEnd={mode === "live" ? undefined : () => (drag.current = null)}
                    onPointerDown={mode === "live" ? (e) => startPaletteDrag(e, { kind: "new", type }, t(ELS[type].labelKey)) : undefined}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-line/30 bg-canvas/60 px-2.5 py-2 text-xs font-medium text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
                  >
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit`
Expected: no errors

- [ ] **Step 6: Run the full admin unit test suite**

Run: `pnpm --filter @ucms/admin test`
Expected: PASS (unchanged — this task touches no logic the unit tests cover, confirms no accidental breakage)

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/Designer.tsx apps/admin/src/designer/DesignerPalette.tsx
git commit -m "feat(admin): wire Live Edit drag-to-add into the palette and Designer"
```

---

### Task 5: `BaseLayout.astro` — resolve drop target, draw overlay, reply

**Files:**
- Modify: `apps/frontend/src/layouts/BaseLayout.astro` (inside the existing `designerEdit` inline script, specifically the `window.addEventListener("message", (e) => {...})` block, currently at lines 1127-1177)

**Interfaces:**
- Consumes (by convention, hand-ported from Task 1): the same `resolveInsertionIndex` logic as `apps/admin/src/designer/liveEditDropTarget.ts`
- Produces (postMessage): `designer:dropTarget` with `{ target: DropTarget | null }` matching the `DropTarget` shape from Task 1/3

- [ ] **Step 1: Add the new message handlers**

In `apps/frontend/src/layouts/BaseLayout.astro`, inside the existing `window.addEventListener("message", (e) => {` block (the one starting at line 1127), add these two branches BEFORE the existing `const node = findByPath(e.data.path);` fallback line (so they return early and never fall into a path lookup that doesn't apply to them):

```js
            // Live Edit drag-to-add (see
            // docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md).
            // dropIndicatorEl is a single reused <div>, created lazily on
            // first use and repositioned on every move rather than recreated.
            if (e.data.type === "designer:paletteDragMove") {
              const target = resolveDropTarget(e.data.x, e.data.y);
              const changed = JSON.stringify(target) !== JSON.stringify(lastReportedTarget);
              lastReportedTarget = target;
              drawDropIndicator(target);
              if (changed) parent.postMessage({ type: "designer:dropTarget", target }, targetOrigin);
              return;
            }
            if (e.data.type === "designer:paletteDragEnd") {
              lastReportedTarget = null;
              drawDropIndicator(null);
              return;
            }
```

- [ ] **Step 2: Add the resolution + overlay functions**

In the same `<script is:inline>` IIFE, add these declarations right before the `window.addEventListener("message", ...)` call (so `resolveDropTarget`/`drawDropIndicator`/`lastReportedTarget` are in scope when the handler above references them):

```js
          let lastReportedTarget = null;
          let dropIndicatorEl = null;

          // Hand-ported from apps/admin/src/designer/liveEditDropTarget.ts's
          // resolveInsertionIndex — this script is <script is:inline>
          // (deliberately unbundled plain JS, no imports), so the two copies
          // are kept in sync by hand. Keep the logic identical.
          function resolveInsertionIndexPlain(pointerY, hoveredTop, hoveredHeight, hoveredIndex) {
            const midpoint = hoveredTop + hoveredHeight / 2;
            return pointerY < midpoint ? hoveredIndex : hoveredIndex + 1;
          }

          // x/y are iframe-local px (already translated by the admin parent
          // via clientToIframeLocal before this message was sent).
          function resolveDropTarget(x, y) {
            const el = document.elementFromPoint(x, y);
            const node = el && el.closest("[data-designer-path]");
            if (!node) return null;
            const path = node.dataset.designerPath.split(".").map(Number);
            const rect = node.getBoundingClientRect();
            // Section-level node (path length 1): top/bottom ~1/3 of its own
            // box means "drop between sections", not "into this section's
            // first column".
            if (path.length === 1) {
              const third = rect.height / 3;
              if (y <= rect.top + third) return { kind: "new-section", afterBlockIndex: path[0] - 1 };
              if (y >= rect.bottom - third) return { kind: "new-section", afterBlockIndex: path[0] };
              return { kind: "into-column", colPath: [path[0], 0, 0] };
            }
            // Element-level node (any length >= 4, including a container's
            // own nested children): resolve to its PARENT's children array
            // (colPath = its own path minus the last index) and an
            // insertion index relative to its own position there — generic
            // over depth, matching insertAt/childrenOf's own depth-agnostic
            // behavior (see designerTree.ts).
            const colPath = path.slice(0, -1);
            const hoveredIndex = path[path.length - 1];
            const index = resolveInsertionIndexPlain(y, rect.top, rect.height, hoveredIndex);
            return { kind: "into-column", colPath, index };
          }

          function drawDropIndicator(target) {
            if (!target) {
              if (dropIndicatorEl) dropIndicatorEl.style.display = "none";
              return;
            }
            if (!dropIndicatorEl) {
              dropIndicatorEl = document.createElement("div");
              dropIndicatorEl.style.position = "fixed";
              dropIndicatorEl.style.zIndex = "99999";
              dropIndicatorEl.style.pointerEvents = "none";
              document.body.appendChild(dropIndicatorEl);
            }
            dropIndicatorEl.style.display = "block";
            if (target.kind === "new-section") {
              const sections = document.querySelectorAll('[data-designer-path]:not([data-designer-path*="."])');
              const after = sections[target.afterBlockIndex];
              const before = sections[target.afterBlockIndex + 1];
              const y = after ? after.getBoundingClientRect().bottom : before ? before.getBoundingClientRect().top : 0;
              Object.assign(dropIndicatorEl.style, { left: "0", width: "100%", top: `${y - 2}px`, height: "4px", background: "#0f62fe", border: "none" });
            } else {
              const colNode = document.querySelector(`[data-designer-path="${target.colPath.join(".")}"]`);
              if (!colNode) {
                dropIndicatorEl.style.display = "none";
                return;
              }
              const rect = colNode.getBoundingClientRect();
              Object.assign(dropIndicatorEl.style, {
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                top: `${rect.top}px`,
                height: `${rect.height}px`,
                background: "rgba(15, 98, 254, 0.15)",
                border: "2px dashed #0f62fe",
              });
            }
          }

```

- [ ] **Step 3: Manual verification (no automated test for this step alone — covered end-to-end by Task 6)**

Run `pnpm dev:admin` and `pnpm dev:frontend` locally, open a page in Live Edit, open the browser devtools console on the Live Edit iframe, and confirm no script errors fire when the file loads. (Full drag behavior is verified by Task 6's Playwright test, since this task's code only runs inside the cross-origin iframe and has no standalone unit-test harness — consistent with every other piece of this inline script, none of which has unit tests today either.)

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/layouts/BaseLayout.astro
git commit -m "feat(frontend): resolve and draw Live Edit drag-to-add drop targets"
```

---

### Task 6: Playwright E2E — drag an element onto Live Edit

**Files:**
- Modify: `apps/admin/e2e/designer-smoke.spec.ts` (add a new `test(...)` block; the existing test in this file is untouched)

**Interfaces:**
- Consumes: `seedDesignerPage` from `./seed` (already used by the existing test in this file)

- [ ] **Step 1: Write the test**

Append to `apps/admin/e2e/designer-smoke.spec.ts`:

```ts
test("Designer: Live Edit drag-to-add creates a new section with the dropped element", async ({ page, context }) => {
  const { pageId, tenantHost, cookieValue, csrfToken } = await seedDesignerPage();

  await context.addCookies([
    {
      name: "ucms_session",
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
  const session = JSON.stringify({
    token: csrfToken,
    role: "superadmin",
    tenantHost,
    tenantHosts: [tenantHost],
  });
  await page.addInitScript((json) => {
    window.localStorage.setItem("usim_cms_session", json);
  }, session);

  await page.goto(`/content/pages/${pageId}`);

  // Live Edit is the default view (see Designer.tsx's own "opens by
  // default" note) — no mode toggle needed. The palette item has no
  // [draggable="true"] attribute in this mode (DesignerPalette.tsx sets
  // draggable={mode !== "live"}), so it's located by its visible text
  // instead, and dragged via a real pointer sequence (mousedown/move/up)
  // rather than Playwright's HTML5-DnD-only dragTo() helper.
  const headingPaletteItem = page.getByText("Heading", { exact: true }).first();
  await expect(headingPaletteItem).toBeVisible();

  const iframe = page.locator('iframe[title="live-view"]');
  await expect(iframe).toBeVisible();
  const box = await iframe.boundingBox();
  if (!box) throw new Error("live-view iframe has no bounding box");

  const start = await headingPaletteItem.boundingBox();
  if (!start) throw new Error("Heading palette item has no bounding box");

  // Drop near the middle of the live-rendered page — an empty page's only
  // content is the "+ Add Section"-equivalent empty state, so any drop
  // point resolves to "new-section".
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  // The drop triggers mutate() -> autosave -> Live Edit reload; the new
  // Heading renders for real inside the iframe once that reload completes.
  await expect(page.frameLocator('iframe[title="live-view"]').getByText("Heading", { exact: true })).toBeVisible({ timeout: 10000 });
});
```

- [ ] **Step 2: Run the test (requires a live `apps/api` + Postgres + admin dev server — same pre-existing limitation as this file's first test, not wired into the Docker build-time test gate)**

Run: `pnpm --filter @ucms/admin test:e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/admin/e2e/designer-smoke.spec.ts
git commit -m "test(admin): add Playwright coverage for Live Edit drag-to-add"
```

---

### Task 7: Update `apps/admin/CLAUDE.md`

**Files:**
- Modify: `apps/admin/CLAUDE.md` (append a new paragraph to the Slider/Designer history section, following this file's own established convention of recording every shipped Designer change inline)

- [ ] **Step 1: Append the summary paragraph**

Add, after the most recent dated paragraph in that file's Designer history section:

```markdown
**Live Edit drag-to-add (2026-10-08)**: the postMessage bridge
(`useLiveEditBridge.ts`/`BaseLayout.astro`'s `designerEdit` script), previously
selection-only, now also supports dragging an element from the Elements
palette directly onto the real rendered page — dropping either between two
sections (auto-wrapped in a new section/row/column, same as Blocks mode's
`dropIntoNewSection`) or into an existing column (`dropIntoColumn`), with no
new mutation logic in either case. The gesture uses `Element.setPointerCapture`
(not native HTML5 Drag-and-Drop — `dataTransfer` access during `dragover` is
spec-restricted to `.types` only in every browser, and cross-origin iframe
drag has known extra browser restrictions) so the admin parent keeps
receiving `pointermove`/`pointerup` even while the cursor is visually over
the cross-origin Live Edit iframe; the iframe only ever reports where the
pointer resolved to (`designer:dropTarget`) and draws its own local
drop-indicator overlay, never mutating the block tree itself. New:
`designer/liveEditDropTarget.ts` (coordinate-mapping + insertion-index pure
math, hand-ported into `BaseLayout.astro`'s inline script since that script
is deliberately unbundled and can't import it) and
`designer/hooks/useLiveEditPaletteDrag.ts` (the gesture itself).
`dropIntoNewSection()` gained an optional `afterBlockIndex` parameter for
this (Blocks mode's own existing callers are unaffected — omitting it keeps
the original append-at-the-end behavior). See
`docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md` for the
full design, including the Webflow/Wix same-origin-canvas alternative that
was considered and rejected as a much larger, separate architecture change.
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/CLAUDE.md
git commit -m "docs: record Live Edit drag-to-add in apps/admin/CLAUDE.md"
```
