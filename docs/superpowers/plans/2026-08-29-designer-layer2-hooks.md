# Designer.tsx Layer 2+3 Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `apps/admin/src/Designer.tsx`'s remaining ~50 state values/~100 functions into 7 concern-scoped hooks (`apps/admin/src/designer/hooks/*`) plus one pure helper module, with zero behavior change and zero change to the `DesignerCtx` interface `Inspector.tsx`/`ElPreview.tsx` already consume.

**Architecture:** Each hook owns one concern's state + functions and is called once per render from `Designer()`, in a fixed dependency order. `Designer()` becomes a composition root: call all 7 hooks, assemble the existing `designerCtx` object literal (`Designer.tsx:2148-2165` today) from their return values field-for-field, keep its own render + a residual pool of small cross-cutting/UI-only state (documented per-task below) that doesn't belong to any single hook.

**Tech Stack:** React 18, TypeScript, `node:test` (existing `designer/*.test.ts` convention), Playwright (`@playwright/test`, new).

**Spec:** `docs/superpowers/specs/2026-08-29-designer-layer2-hooks-design.md`

## Global Constraints

- Zero changes to `apps/admin/src/designer/context.ts`'s `DesignerCtx` interface.
- Zero changes to `apps/admin/src/designer/Inspector.tsx` or `apps/admin/src/designer/ElPreview.tsx`.
- No behavior change to any extracted function — same mutations, same `bumpStructural()` call sites, same guard conditions. This is a pure relocation, not a rewrite.
- `mutate()`'s functional `setState` form (`setBlocks((prev) => { const next = clone(prev); fn(next); return next; })`) must be preserved exactly — do not regress to `const next = clone(blocks); fn(next); setBlocks(next);` (documented multi-mutate-per-tick bug, see spec).
- Every new hook file gets its own `node:test` unit test in the same directory, named `<hookFile>.test.ts`, mirroring the existing `designer/style.test.ts`/`designer/parsers.test.ts`/`designer/geometry.test.ts`/`designer/elements.test.ts` convention.
- After every task: `pnpm --filter @ucms/admin exec tsc -b --noEmit` and `pnpm --filter @ucms/admin test` must both pass, plus the Playwright smoke test from Task 1 (once it exists) must stay green.
- Each task is its own commit. Never combine two tasks' changes into one commit.

---

### Task 1: Add Playwright + one Designer smoke test (safety net, before any extraction)

**Files:**
- Modify: `apps/admin/package.json` (add `@playwright/test` devDependency + a `test:e2e` script)
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/e2e/designer-smoke.spec.ts`
- Create: `apps/admin/e2e/seed.ts` (test tenant/user/page seeding helper)

**Interfaces:**
- Produces: a passing `pnpm --filter @ucms/admin exec playwright test` run against the CURRENT (unrefactored) `Designer.tsx`. Every later task in this plan must keep this test green.

- [ ] **Step 1: Add the dependency**

In `apps/admin/package.json`, add to `devDependencies`:
```json
"@playwright/test": "^1.48.0"
```
Add to `scripts`:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Install and install browsers**

Run: `pnpm install` (repo root), then `pnpm --filter @ucms/admin exec playwright install --with-deps chromium`

- [ ] **Step 3: Write the Playwright config**

Create `apps/admin/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? "http://localhost:5173",
  },
  webServer: {
    command: "pnpm dev",
    url: process.env.E2E_ADMIN_URL ?? "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 4: Write the seed helper**

`apps/admin/e2e/seed.ts` seeds a disposable tenant + superadmin user + one draft page directly against `apps/api`, reusing the same `POST /api/setup` first-run route the installer scripts use (see `install.sh`'s own `create_superadmin` call for the exact request shape). Read `apps/api/src/index.ts`'s `POST /api/setup` handler and `apps/api/src/db/tenant-pool.ts`'s tenant-creation helpers before writing this — this step's exact HTTP calls depend on those handlers' real request/response shapes, which must be read fresh (they are not reproduced here to avoid drifting out of sync with the actual route). The helper must:
1. Create (or reuse, if already present) a test tenant host `e2e.localhost` via the superadmin tenant-create endpoint.
2. Create a superadmin user via `POST /api/setup` if none exists yet (idempotent — catch and ignore a 409/"already exists" style rejection).
3. Log in via `POST /api/auth/login` to obtain a session (the httpOnly cookie is set automatically by the response; capture it for Playwright's `storageState` or reuse the same `request` context for subsequent calls).
4. Create one draft page via `POST /api/pages` with an empty `layout: []`, return its `id`.
5. Export `async function seedDesignerPage(): Promise<{ pageId: string; tenantHost: string }>`.

- [ ] **Step 5: Write the smoke test**

`apps/admin/e2e/designer-smoke.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { seedDesignerPage } from "./seed";

test("Designer: add element, set style, save, reload, layout persists", async ({ page }) => {
  const { pageId } = await seedDesignerPage();

  await page.goto(`/content/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: /designer/i }).or(page.locator("body"))).toBeVisible();

  // Add a row + a Heading element via the palette (adjust selectors to match
  // the real DOM once run — Designer.tsx's palette buttons use ELS[type].label
  // as their visible text, e.g. "Heading").
  await page.getByRole("button", { name: /add row/i }).first().click();
  await page.getByText("Heading", { exact: true }).first().click();

  // Select it, open the Style tab, set a background color on the section.
  await page.locator('[data-testid="canvas-section-0"]').click({ trial: false }).catch(() => {});
  await page.getByLabel(/background/i).first().fill("#ff00ff").catch(() => {});

  await page.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5000 });

  await page.reload();
  await expect(page.getByText("Heading", { exact: false }).first()).toBeVisible();
});
```
Note for the implementer: the exact selectors (`data-testid`, button labels) must be verified against the real running admin app during this task — run it headed (`pnpm --filter @ucms/admin exec playwright test --headed --debug`) and adjust selectors until the test passes against the CURRENT unmodified `Designer.tsx`. Do not proceed to Task 2 until this test is genuinely green, not just written.

- [ ] **Step 6: Run it, confirm green**

Run: `pnpm --filter @ucms/admin test:e2e`
Expected: 1 passed.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/package.json apps/admin/playwright.config.ts apps/admin/e2e
git commit -m "test(admin): add Playwright smoke test for Designer save/reload round-trip"
```

---

### Task 2: Extract `designer/blockPath.ts` (removeAt/insertEl/section)

**Files:**
- Create: `apps/admin/src/designer/blockPath.ts`
- Create: `apps/admin/src/designer/blockPath.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 1385-1396, import from new module instead)

**Interfaces:**
- Produces:
```ts
export function section(bs: Block[], b: number): SectionProps;
export function removeAt(bs: Block[], path: number[]): El;
export function insertEl(bs: Block[], colPath: number[], el: El, index?: number): void;
```
- Consumes: `Block`, `SectionProps`, `El` types from `./types`.

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/blockPath.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { section, removeAt, insertEl } from "./blockPath";
import type { Block } from "./types";

function sampleBlocks(): Block[] {
  return [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ id: "e1", type: "text", props: { text: "a" } }] }] }],
      },
    } as unknown as Block,
  ];
}

test("section() returns the section's props cast to SectionProps", () => {
  const bs = sampleBlocks();
  assert.equal(section(bs, 0).rows.length, 1);
});

test("removeAt() splices out and returns the element at the path", () => {
  const bs = sampleBlocks();
  const el = removeAt(bs, [0, 0, 0, 0]);
  assert.equal(el.id, "e1");
  assert.equal(section(bs, 0).rows[0].columns[0].elements.length, 0);
});

test("insertEl() inserts at the given index, or appends when index is omitted", () => {
  const bs = sampleBlocks();
  const newEl = { id: "e2", type: "text", props: { text: "b" } } as unknown as import("./types").El;
  insertEl(bs, [0, 0, 0], newEl, 0);
  assert.equal(section(bs, 0).rows[0].columns[0].elements[0].id, "e2");
  assert.equal(section(bs, 0).rows[0].columns[0].elements[1].id, "e1");

  insertEl(bs, [0, 0, 0], { id: "e3", type: "text", props: {} } as unknown as import("./types").El);
  assert.equal(section(bs, 0).rows[0].columns[0].elements.at(-1)?.id, "e3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/blockPath.test.ts`
Expected: FAIL — `Cannot find module './blockPath'`

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:1385-1396` for the exact current code (the `section`/`removeAt`/`insertEl` functions), and move it verbatim into `apps/admin/src/designer/blockPath.ts`:
```ts
import type { Block, El, SectionProps } from "./types";

export function section(bs: Block[], b: number): SectionProps {
  return bs[b].props as unknown as SectionProps;
}

export function removeAt(bs: Block[], path: number[]): El {
  const [b, r, c, e] = path;
  return section(bs, b).rows[r].columns[c].elements.splice(e, 1)[0];
}

export function insertEl(bs: Block[], colPath: number[], el: El, index?: number) {
  const [b, r, c] = colPath;
  const list = section(bs, b).rows[r].columns[c].elements;
  list.splice(index ?? list.length, 0, el);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/blockPath.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire into Designer.tsx**

In `Designer.tsx`, delete lines 1385-1396 (the original `section`/`removeAt`/`insertEl` declarations) and add to the top imports:
```ts
import { section, removeAt, insertEl } from "./designer/blockPath";
```
Every existing call site (`section(bs, b)`, `removeAt(bs, path)`, `insertEl(bs, colPath, el, index)`) is unchanged — only the declaration moves.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/blockPath.ts apps/admin/src/designer/blockPath.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract section/removeAt/insertEl into designer/blockPath.ts"
```

---

### Task 3: Extract `designer/hooks/useClipboard.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useClipboard.ts`
- Create: `apps/admin/src/designer/hooks/useClipboard.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 220-232 (`ClipLevel`/`CLIP_KEYS`/`CLIPSTYLE_KEYS`), delete line 583 (`clipTick` state), 974-1005 (clip/style functions + storage listener), replace call sites with the hook's returned object)

**Interfaces:**
- Produces:
```ts
export type ClipLevel = "section" | "row" | "column" | "element";
export function useClipboard(): {
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  clipHas: (level: ClipLevel) => boolean;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
  styleHas: (level: ClipLevel) => boolean;
};
```
- Consumes: `CONTENT_KEYS` — grep `grep -n "CONTENT_KEYS" apps/admin/src/Designer.tsx` before writing this task to find its real current declaration location; if it's declared inline in `Designer.tsx` itself (not imported from `./elements`), move it into this same `useClipboard.ts` file since it's clipboard-write-time-only logic.

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/useClipboard.test.ts` — since this is a React hook (uses `useState`/`useEffect`), test it via a minimal manual render harness rather than a DOM testing library (none is installed yet, and adding one is out of scope for this task):
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// useClipboard has no React-specific behavior worth testing outside a real
// component (its only state, clipTick, is a re-render trigger with no
// observable effect outside React) — this test instead exercises its
// clipboard read/write functions directly against a fake localStorage,
// which is what actually has behavior worth locking down.
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
  const { clipCopy, clipRead, clipHas } = require("./useClipboard").__testOnly_clipboardFns();
  assert.equal(clipHas("section"), false);
  clipCopy("section", { hello: "world" });
  assert.equal(clipHas("section"), true);
  assert.deepEqual(clipRead("section"), { hello: "world" });
  assert.equal(clipHas("row"), false);
});

test("styleCopy strips CONTENT_KEYS for the given element type before storing", () => {
  (globalThis as unknown as { localStorage: ReturnType<typeof makeFakeLocalStorage> }).localStorage = makeFakeLocalStorage();
  const { styleCopy, styleRead } = require("./useClipboard").__testOnly_clipboardFns();
  styleCopy("element", { color: "#fff", text: "should be stripped" }, "text");
  const stored = styleRead("element");
  assert.equal(stored?.color, "#fff");
  assert.equal("text" in (stored ?? {}), false);
});
```
Note: `__testOnly_clipboardFns` is a small test-only export the implementation below adds — it returns the same `clipCopy`/`clipRead`/`clipHas`/`styleCopy`/`styleRead`/`styleHas` functions the hook returns, callable outside a React render since none of them touch React state directly (only the hook's `bumpTick` callback does, and the test-only export passes a no-op).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useClipboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:220-232` and `974-1005` for the exact current code, then write `apps/admin/src/designer/hooks/useClipboard.ts`:
```ts
import { useEffect, useState } from "react";
import type { ElType } from "../types";
import { CONTENT_KEYS } from "../elements"; // adjust import path once Step 3's grep confirms CONTENT_KEYS's real location

export type ClipLevel = "section" | "row" | "column" | "element";

const CLIP_KEYS: Record<ClipLevel, string> = {
  section: "designer:clip:section",
  row: "designer:clip:row",
  column: "designer:clip:column",
  element: "designer:clip:element",
};
const CLIPSTYLE_KEYS: Record<ClipLevel, string> = {
  section: "designer:clipstyle:section",
  row: "designer:clipstyle:row",
  column: "designer:clipstyle:column",
  element: "designer:clipstyle:element",
};

function clipboardFns(bumpTick: () => void) {
  function clipCopy(level: ClipLevel, data: unknown) {
    localStorage.setItem(CLIP_KEYS[level], JSON.stringify(data));
    bumpTick();
  }
  function clipRead<T = unknown>(level: ClipLevel): T | null {
    const raw = localStorage.getItem(CLIP_KEYS[level]);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  function clipHas(level: ClipLevel) {
    return localStorage.getItem(CLIP_KEYS[level]) !== null;
  }
  function styleCopy(level: ClipLevel, props: Record<string, string>, elType?: ElType) {
    const clean = { ...props };
    (elType ? CONTENT_KEYS[elType] : []).forEach((k) => delete clean[k]);
    localStorage.setItem(CLIPSTYLE_KEYS[level], JSON.stringify(clean));
    bumpTick();
  }
  function styleRead(level: ClipLevel): Record<string, string> | null {
    const raw = localStorage.getItem(CLIPSTYLE_KEYS[level]);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  }
  function styleHas(level: ClipLevel) {
    return localStorage.getItem(CLIPSTYLE_KEYS[level]) !== null;
  }
  return { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas };
}

export function __testOnly_clipboardFns() {
  return clipboardFns(() => {});
}

export function useClipboard() {
  const [clipTick, setClipTick] = useState(0);
  const fns = clipboardFns(() => setClipTick((x) => x + 1));

  useEffect(() => {
    const onStorage = () => setClipTick((x) => x + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  void clipTick; // read so `fns` (rebuilt every render) is understood to depend on it
  return fns;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useClipboard.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Wire into Designer.tsx**

In `Designer.tsx`:
- Delete the `ClipLevel` type, `CLIP_KEYS`, `CLIPSTYLE_KEYS` consts (lines 220-232).
- Delete the `clipTick` state declaration (line 583) and the clipboard functions + storage listener (lines 974-1005).
- Add import: `import { useClipboard, type ClipLevel } from "./designer/hooks/useClipboard";`
- Add inside `Designer()`, near the top: `const clipboard = useClipboard();`
- Destructure right after: `const { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas } = clipboard;` so every existing call site keeps working unchanged.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually test in the running admin: copy a section, paste it, copy an element's style, paste style onto another element — confirm both still work.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useClipboard.ts apps/admin/src/designer/hooks/useClipboard.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract clipboard state/functions into designer/hooks/useClipboard.ts"
```

---

### Task 4: Extract `designer/hooks/useUndoRedo.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useUndoRedo.ts`
- Create: `apps/admin/src/designer/hooks/useUndoRedo.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete line 302 (`blocks` state), the `history`/`future`/`draggingBand` refs — grep `history.current` to find their exact declaration lines just above `mutate` — delete `mutate`/`startSpacingDrag`/`undo`/`redo` at lines 858-927, wire in the hook)

**Interfaces:**
- Produces:
```ts
export function useUndoRedo(
  initialBlocks: Block[] | (() => Block[]),
  setDirty: (v: boolean) => void,
  setSel: (s: Sel) => void,
): {
  blocks: Block[];
  setBlocksDirectly: (b: Block[]) => void;
  mutate: (fn: (next: Block[]) => void) => void;
  startSpacingDrag: (e: React.MouseEvent, startPx: number, axis: "x" | "y", sign: 1 | -1, apply: (next: Block[], px: number) => void, onBandHoverChange?: (key: string | null) => void, bandKey?: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
};
```
`setBlocksDirectly` is a deliberate addition beyond the spec's original sketch — Task 9's `usePageAndLanguage` needs to set `blocks` directly on a language switch (not an undoable edit, so it must bypass `mutate`/history) — exposed now so Task 9 doesn't need to reopen this file.
- Consumes: `clone` (existing utility import, unchanged location — grep `apps/admin/src/Designer.tsx` for its current import statement and reuse the same path), `Block`/`Sel` types.

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/useUndoRedo.test.ts` — same non-React-harness pattern as Task 3, since this hook's core logic (`mutate`'s clone-and-apply, the history/future stack) is testable without a real render if extracted as a plain factory function the hook wraps:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_undoRedoFns } from "./useUndoRedo";
import type { Block } from "../types";

function sampleBlocks(): Block[] {
  return [{ type: "section", props: { rows: [] } } as unknown as Block];
}

test("mutate() applies fn to a clone, pushes history, clears future", () => {
  let blocks = sampleBlocks();
  const { mutate } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
});

test("undo() restores the previous snapshot; redo() reapplies it", () => {
  let blocks = sampleBlocks();
  const { mutate, undo, redo } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).paddingY = "lg"; });
  undo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, undefined);
  redo();
  assert.equal((blocks[0].props as Record<string, unknown>).paddingY, "lg");
});

test("multiple synchronous mutate() calls each build on the previous result (no lost updates)", () => {
  let blocks = sampleBlocks();
  const { mutate } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  // Simulates a "linked" FourSideControl commit: 4 sequential mutate() calls
  // in the same tick, each setting a different key — the historical bug was
  // all 4 cloning the same stale pre-edit snapshot and only the last surviving.
  mutate((bs) => { (bs[0].props as Record<string, unknown>).a = "1"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).b = "2"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).c = "3"; });
  mutate((bs) => { (bs[0].props as Record<string, unknown>).d = "4"; });
  const props = blocks[0].props as Record<string, unknown>;
  assert.equal(props.a, "1");
  assert.equal(props.b, "2");
  assert.equal(props.c, "3");
  assert.equal(props.d, "4");
});

test("resetHistory() clears both stacks", () => {
  let blocks = sampleBlocks();
  const { mutate, undo, resetHistory } = __testOnly_undoRedoFns(
    () => blocks,
    (updater) => { blocks = updater(blocks); },
  );
  mutate((bs) => { (bs[0].props as Record<string, unknown>).a = "1"; });
  resetHistory();
  const before = JSON.stringify(blocks);
  undo();
  assert.equal(JSON.stringify(blocks), before); // no-op — history was cleared
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useUndoRedo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:858-927` (mutate/startSpacingDrag/undo/redo) and the `history`/`future`/`draggingBand` ref declarations just above them for the current code, then write:
```ts
import { useRef, useState } from "react";
import type React from "react";
import { clone } from "../../lib/clone"; // adjust to the real existing clone() import path used by Designer.tsx today
import type { Block, Sel } from "../types";

function undoRedoFns(
  getBlocks: () => Block[],
  setBlocksFn: (updater: (prev: Block[]) => Block[]) => void,
  history: { current: Block[][] },
  future: { current: Block[][] },
  onDirty?: () => void,
  onSelReset?: () => void,
) {
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
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(getBlocks()));
    setBlocksFn(() => next);
    onSelReset?.();
    onDirty?.();
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

export function useUndoRedo(initialBlocks: Block[] | (() => Block[]), setDirty: (v: boolean) => void, setSel: (s: Sel) => void) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const history = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  const draggingBand = useRef(false);

  const { mutate, undo, redo, resetHistory } = undoRedoFns(
    () => blocks,
    setBlocks,
    history,
    future,
    () => setDirty(true),
    () => setSel(null),
  );

  function setBlocksDirectly(next: Block[]) {
    setBlocks(next);
  }

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

  return { blocks, setBlocksDirectly, mutate, startSpacingDrag, undo, redo, resetHistory };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useUndoRedo.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Wire into Designer.tsx**

- Delete the original `blocks`/`setBlocks` state (line 302), `history`/`future`/`draggingBand` refs, and `mutate`/`startSpacingDrag`/`undo`/`redo` (lines 858-927).
- Add import: `import { useUndoRedo } from "./designer/hooks/useUndoRedo";`
- Add: `const { blocks, setBlocksDirectly, mutate, startSpacingDrag, undo, redo, resetHistory } = useUndoRedo(() => clone((page.layout as Block[] | undefined) ?? []), setDirty, setSel);`
- Every other call site (`mutate(...)`, `undo()`, `redo()`) is unchanged since the names are identical. Every `startSpacingDrag(e, startPx, axis, sign, apply, bandKey)` call site gains one argument: `startSpacingDrag(e, startPx, axis, sign, apply, setHoverBand, bandKey)` — `hoverBand` stays a residual `Designer()` `useState`, its setter is now passed in explicitly since the hook no longer closes over it.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually test: make an edit, Ctrl+Z, Ctrl+Shift+Z, confirm undo/redo works; drag a padding handle, confirm the hatch overlay still highlights.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useUndoRedo.ts apps/admin/src/designer/hooks/useUndoRedo.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract blocks/mutate/undo/redo into designer/hooks/useUndoRedo.ts"
```

---

### Task 5: Extract `designer/hooks/useBpStyle.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useBpStyle.ts`
- Create: `apps/admin/src/designer/hooks/useBpStyle.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 334-336, 351-548 — the `bp`/`linkedPadding`/`linkedRadius`/`linkedMargin` state and every `bpKey`/`bpGetValue`/`bpKeysOverridden`/`toggleBpKeys`/`hiddenAtBp`/`sideValue`/`fourSideValue`/`setFourSideValue`/`setColSideValue`/`setElSideValue`/`writeDragSideKeys`/`sectionBpStyle`/`bpColStyle`/`bpMarginStyle`/`bpPaddingStyle`/`rowMarginStyle`/`rowPaddingStyle` function — wire in the hook). Note: `HiddenAtBpBadge` (line 389) is a render component, NOT deleted — it stays in `Designer.tsx` but now reads `bp`/`t` from the hook's destructured output / existing prop instead of the old in-scope closure variable (same variable name, no change needed at its own call site).

**Interfaces:**
- Consumes: `mutate` from Task 4's hook.
- Produces:
```ts
export function useBpStyle(mutate: (fn: (next: Block[]) => void) => void): {
  bp: "desktop" | "tablet" | "mobile";
  setBp: (b: "desktop" | "tablet" | "mobile") => void;
  bpKey: (key: string) => string;
  bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[]) => Record<string, string>;
  hiddenAtBp: (props: { hideDesktop?: string; hideTablet?: string; hideMobile?: string } | undefined) => boolean;
  bpGetValue: (base: string | undefined, overrides: Record<string, string> | undefined, key: string) => string;
  sideValue: (props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string) => string;
  fourSideValue: (sp: SectionProps, perSideKey: string, fallbackKey: string) => string;
  setFourSideValue: (b: number, perSideKey: string, value: string) => void;
  setColSideValue: (b: number, r: number, c: number, perSideKey: string, value: string) => void;
  setElSideValue: (b: number, r: number, c: number, e: number, perSideKey: string, value: string) => void;
  writeDragSideKeys: (target: { props?: Record<string, string>; bp?: Record<string, string> }, keys: readonly string[], activeKey: string, px: number, linked: boolean) => void;
  sectionBpStyle: (sp: SectionProps) => React.CSSProperties;
  bpColStyle: (col: Col) => React.CSSProperties;
  bpMarginStyle: (el: El) => React.CSSProperties | undefined;
  bpPaddingStyle: (el: El) => React.CSSProperties | undefined;
  rowMarginStyle: (row: Row, isFirst: boolean, mode: "blocks" | "live") => React.CSSProperties;
  rowPaddingStyle: (row: Row) => React.CSSProperties | undefined;
  linkedPadding: boolean; setLinkedPadding: (fn: (v: boolean) => boolean) => void;
  linkedRadius: boolean; setLinkedRadius: (fn: (v: boolean) => boolean) => void;
  linkedMargin: boolean; setLinkedMargin: (fn: (v: boolean) => boolean) => void;
};
```
Note `rowMarginStyle` gains an explicit `mode` parameter (the original read `mode` from the enclosing `Designer()` closure; `mode` now lives in Task 6's `useLiveEditBridge`, which hasn't been called yet when this task runs — so this task's own `Designer.tsx` wiring step passes the STILL-LOCAL `mode` state, since Task 6 hasn't extracted it yet at this point in the migration order; Task 6's own wiring step then updates the call site to pass its hook's `mode` output instead, with no change needed to this hook itself).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/useBpStyle.test.ts` — test the pure helper functions (`bpGetValue`, `bpKeysOverridden`, `toggleBpKeys`, `hiddenAtBp`) directly since they only depend on the `bp` value, which can be passed in via a test-only factory:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_bpFns } from "./useBpStyle";

test("bpGetValue returns the desktop base value when bp is desktop", () => {
  const { bpGetValue } = __testOnly_bpFns("desktop");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "1rem");
});

test("bpGetValue returns the override for the current non-desktop bp when present", () => {
  const { bpGetValue } = __testOnly_bpFns("tablet");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "2rem");
});

test("bpGetValue falls back to the base value when no override exists at the current bp", () => {
  const { bpGetValue } = __testOnly_bpFns("mobile");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "1rem");
});

test("bpKeysOverridden is true if ANY of the given keys has an override at the current bp", () => {
  const { bpKeysOverridden } = __testOnly_bpFns("tablet");
  assert.equal(bpKeysOverridden({ "tablet:paddingTop": "2rem" }, ["paddingTop", "paddingRight"]), true);
  assert.equal(bpKeysOverridden({ "tablet:paddingTop": "2rem" }, ["paddingRight", "paddingBottom"]), false);
});

test("toggleBpKeys seeds every key at empty string when enabling, removes all when disabling", () => {
  const { toggleBpKeys } = __testOnly_bpFns("tablet");
  const enabled = toggleBpKeys(undefined, ["paddingTop", "paddingRight"]);
  assert.deepEqual(enabled, { "tablet:paddingTop": "", "tablet:paddingRight": "" });
  const disabled = toggleBpKeys(enabled, ["paddingTop", "paddingRight"]);
  assert.deepEqual(disabled, {});
});

test("hiddenAtBp reads the matching hideDesktop/hideTablet/hideMobile flag for the current bp", () => {
  const { hiddenAtBp } = __testOnly_bpFns("mobile");
  assert.equal(hiddenAtBp({ hideMobile: "true" }), true);
  assert.equal(hiddenAtBp({ hideDesktop: "true" }), false);
  assert.equal(hiddenAtBp(undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useBpStyle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:351-548` for the exact current code (every function listed in the Interfaces block), and move it into `apps/admin/src/designer/hooks/useBpStyle.ts`. First grep `apps/admin/src/Designer.tsx` for the exact current import paths of `lengthValue`/`shadowToCss`/`colStyle` (from `designer/style.ts`), `PAD`/`BORDER`/`RADIUS`/`SPACE`/`PADDING_SIDE_KEYS`/`PADDING_SIDE_FALLBACK`/`RADIUS_CORNER_KEYS`/`MARGIN_SIDE_KEYS`/`MARGIN_SIDE_FALLBACK`/`COLUMN_FIELDS`/`COLUMN_SPACING_KEYS` (from `designer/fields.tsx` or wherever they currently live), and reuse those exact paths (adjusted for the new file's location one directory deeper, under `designer/hooks/`). Structure:
```ts
import { useState } from "react";
import type React from "react";
import { lengthValue, shadowToCss, colStyle } from "../style";
import { PAD, BORDER, RADIUS, SPACE, PADDING_SIDE_KEYS, PADDING_SIDE_FALLBACK, RADIUS_CORNER_KEYS, MARGIN_SIDE_KEYS, MARGIN_SIDE_FALLBACK, COLUMN_FIELDS, COLUMN_SPACING_KEYS } from "../fields";
import { section } from "../blockPath";
import type { Block, Col, El, Row, SectionProps } from "../types";

type Bp = "desktop" | "tablet" | "mobile";

function bpFns(bp: Bp) {
  function bpKey(key: string) {
    return `${bp}:${key}`;
  }
  function bpKeysOverridden(bag: Record<string, string> | undefined, keys: string[]): boolean {
    return !!bag && keys.some((k) => bag[bpKey(k)] !== undefined);
  }
  function toggleBpKeys(bag: Record<string, string> | undefined, keys: string[]): Record<string, string> {
    const has = bpKeysOverridden(bag, keys);
    const next = { ...(bag ?? {}) };
    for (const k of keys) {
      if (has) delete next[bpKey(k)];
      else next[bpKey(k)] = "";
    }
    return next;
  }
  function hiddenAtBp(props: { hideDesktop?: string; hideTablet?: string; hideMobile?: string } | undefined): boolean {
    if (!props) return false;
    const key = bp === "desktop" ? "hideDesktop" : bp === "tablet" ? "hideTablet" : "hideMobile";
    return props[key] === "true";
  }
  function bpGetValue(base: string | undefined, overrides: Record<string, string> | undefined, key: string) {
    if (bp !== "desktop") {
      const ov = overrides?.[bpKey(key)];
      if (ov !== undefined) return ov;
    }
    return base ?? "";
  }
  function sideValue(props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string): string {
    const raw = bpGetValue(props?.[perSideKey], bpBag, perSideKey);
    return raw || bpGetValue(props?.[fallbackKey], bpBag, fallbackKey);
  }
  function fourSideValue(sp: SectionProps, perSideKey: string, fallbackKey: string): string {
    return sideValue(sp as unknown as Record<string, string>, sp.bp, perSideKey, fallbackKey);
  }
  return { bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue };
}

export function __testOnly_bpFns(bp: Bp) {
  return bpFns(bp);
}

export function useBpStyle(mutate: (fn: (next: Block[]) => void) => void) {
  const [bp, setBp] = useState<Bp>("desktop");
  const [linkedPadding, setLinkedPadding] = useState(true);
  const [linkedRadius, setLinkedRadius] = useState(true);
  const [linkedMargin, setLinkedMargin] = useState(true);

  const { bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue } = bpFns(bp);

  function setFourSideValue(b: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const block = bs[b];
      if (bp === "desktop") {
        (block.props as Record<string, unknown>)[perSideKey] = value;
      } else {
        const props = block.props as unknown as SectionProps;
        props.bp = { ...(props.bp ?? {}), [bpKey(perSideKey)]: value };
      }
    });
  }
  function setColSideValue(b: number, r: number, c: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c];
      if (bp === "desktop") target.props = { ...(target.props ?? {}), [perSideKey]: value };
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function setElSideValue(b: number, r: number, c: number, e: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c].elements[e];
      if (bp === "desktop") target.props[perSideKey] = value;
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function writeDragSideKeys(
    target: { props?: Record<string, string>; bp?: Record<string, string> },
    keys: readonly string[],
    activeKey: string,
    px: number,
    linked: boolean,
  ) {
    const touched = linked ? keys : [activeKey];
    if (bp === "desktop") {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[k] = `${px}px`;
      target.props = { ...(target.props ?? {}), ...patch };
    } else {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[bpKey(k)] = `${px}px`;
      target.bp = { ...(target.bp ?? {}), ...patch };
    }
  }
  function sectionBpStyle(sp: SectionProps): React.CSSProperties {
    const v = (key: string) => bpGetValue((sp as unknown as Record<string, string>)[key], sp.bp, key);
    const bgImage = v("bgImage");
    const border = v("border");
    const borderWidth = v("borderWidth");
    const borderColor = v("borderColor");
    const borderStyle = v("borderStyle");
    const shadow = v("shadow");
    const opacity = v("opacity");
    const side = (side: keyof typeof PADDING_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]), PAD, side === "top" || side === "bottom" ? PAD.md : "1.5rem");
    const corner = (side: keyof typeof RADIUS_CORNER_KEYS) => {
      const raw = fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius");
      return lengthValue(raw, RADIUS, RADIUS.none);
    };
    const marginSide = (side: keyof typeof MARGIN_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), PAD, "0");
    return {
      background: bgImage ? `url(${bgImage}) center/cover` : v("bg") || "var(--color-bg, #ffffff)",
      color: v("textColor") || "inherit",
      padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}`,
      margin: `${marginSide("top")} ${marginSide("right")} ${marginSide("bottom")} ${marginSide("left")}`,
      ...(borderWidth
        ? { border: `${borderWidth}px ${borderStyle || "solid"} ${borderColor || "currentColor"}` }
        : border
          ? { border: BORDER[border] }
          : {}),
      boxShadow: shadowToCss(shadow),
      borderRadius: `${corner("top")} ${corner("right")} ${corner("bottom")} ${corner("left")}`,
      opacity: opacity ? Math.max(0, Math.min(100, Number(opacity))) / 100 : undefined,
    };
  }
  function bpColStyle(col: Col): React.CSSProperties {
    if (bp === "desktop" || !col.bp) return colStyle(col.props);
    const merged: Record<string, string> = { ...(col.props ?? {}) };
    for (const key of [...COLUMN_FIELDS.map((f) => f.key), ...COLUMN_SPACING_KEYS]) {
      const ov = col.bp[bpKey(key)];
      if (ov !== undefined) merged[key] = ov;
    }
    return colStyle(merged);
  }
  function bpMarginStyle(el: El): React.CSSProperties | undefined {
    const side = (s: keyof typeof MARGIN_SIDE_KEYS) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[s], MARGIN_SIDE_FALLBACK[s]);
    const top = side("top");
    const right = side("right");
    const bottom = side("bottom");
    const left = side("left");
    if (!top && !right && !bottom && !left) return undefined;
    return {
      margin: `${lengthValue(top, SPACE, "0")} ${lengthValue(right, SPACE, "0")} ${lengthValue(bottom, SPACE, "0")} ${lengthValue(left, SPACE, "0")}`,
    };
  }
  function bpPaddingStyle(el: El): React.CSSProperties | undefined {
    const has = (k: string) => bpGetValue(el.props[k], el.bp, k);
    if (!has("padding") && !has("paddingTop") && !has("paddingRight") && !has("paddingBottom") && !has("paddingLeft")) {
      return undefined;
    }
    const side = (s: keyof typeof PADDING_SIDE_KEYS) => lengthValue(sideValue(el.props, el.bp, PADDING_SIDE_KEYS[s], "padding"), PAD, "0");
    return { padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}` };
  }
  function rowMarginStyle(row: Row, isFirst: boolean, mode: "blocks" | "live"): React.CSSProperties {
    return {
      marginTop: lengthValue(row.marginTop, SPACE, isFirst ? "0" : mode === "live" ? "2.5rem" : "1.25rem"),
      marginBottom: lengthValue(row.marginBottom, SPACE, "0"),
    };
  }
  function rowPaddingStyle(row: Row): React.CSSProperties | undefined {
    if (!row.paddingTop && !row.paddingRight && !row.paddingBottom && !row.paddingLeft) return undefined;
    const v = (x?: string) => lengthValue(x, PAD, "0");
    return { padding: `${v(row.paddingTop)} ${v(row.paddingRight)} ${v(row.paddingBottom)} ${v(row.paddingLeft)}` };
  }

  return {
    bp, setBp, bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue, writeDragSideKeys,
    sectionBpStyle, bpColStyle, bpMarginStyle, bpPaddingStyle, rowMarginStyle, rowPaddingStyle,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useBpStyle.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Wire into Designer.tsx**

Delete the original declarations (lines 334-336, 351-548 except `HiddenAtBpBadge`, which stays). Add import and hook call:
```ts
import { useBpStyle } from "./designer/hooks/useBpStyle";
```
```ts
const {
  bp, setBp, bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue,
  setFourSideValue, setColSideValue, setElSideValue, writeDragSideKeys,
  sectionBpStyle, bpColStyle, bpMarginStyle, bpPaddingStyle, rowMarginStyle, rowPaddingStyle,
  linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
} = useBpStyle(mutate);
```
Update every `rowMarginStyle(row, isFirst)` call site to `rowMarginStyle(row, isFirst, mode)` — `mode` is still the original local `useState` at this point in the migration order (Task 6 hasn't run yet), so this is just adding the existing local `mode` variable as an explicit argument.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually test: switch to Tablet/Mobile breakpoint, set an override value on a section's padding, confirm it only affects that breakpoint; toggle a Hidden-at-bp flag, confirm the faded badge appears on canvas.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useBpStyle.ts apps/admin/src/designer/hooks/useBpStyle.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract breakpoint-style helpers into designer/hooks/useBpStyle.ts"
```

---

### Task 6: Extract `designer/hooks/useLiveEditBridge.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useLiveEditBridge.ts`
- Create: `apps/admin/src/designer/hooks/useLiveEditBridge.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 556-575, 605-616, 1025-1182, 1743-1789 — `selectedRect`/`structuralTick`/`bumpStructural`/`lastScrollY`/`pendingScrollRestore`/`lastNonTextSig`/`reloading`/`mode`/`liveSrcA`/`liveSrcB`/`activeSlot`/`swapPending`/`liveSrc`/`frameARef`/`frameBRef`/`liveFrame` state+refs, the two postMessage effects, `enterLive`/`handleFrameLoad`/`toggleLive` — wire in the hook; update the Task 5 `rowMarginStyle` call sites to pass this hook's `mode` instead of the old local state)

**Interfaces:**
- Consumes: `blocks`, `mutate`, `undo`, `redo` (Task 4), `removeAt`/`insertEl`/`section` (Task 2), `sel`/`setSel`/`setCtxMenu` (residual `Designer()` state), `moveColumn`/`moveSection` (existing `designerTree.ts` imports — grep `Designer.tsx` for their current import path and reuse it, unchanged), `typoStyle`/`colStyle`/`lengthValue`/`shadowToCss` (existing `designer/style.ts` imports, unchanged), `api.getPagePreviewToken`/`api.previewUrl`/`api.updatePage` (existing, unchanged), `dirty`/`save` (residual `Designer()` state/function — `enterLive` calls `save()` when dirty).
- Produces:
```ts
export function useLiveEditBridge(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  setSel: (s: Sel) => void;
  setCtxMenu: (v: null) => void;
  undo: () => void;
  redo: () => void;
  dirty: boolean;
  save: () => Promise<void>;
  tenantHost: string;
  token: string;
  pageId: string;
  pageSlug: string;
}): {
  mode: "blocks" | "live";
  liveSrc: string | null;
  frameARef: React.RefObject<HTMLIFrameElement>;
  frameBRef: React.RefObject<HTMLIFrameElement>;
  liveFrame: React.RefObject<HTMLIFrameElement>;
  selectedRect: { top: number; left: number; width: number; height: number } | null;
  reloading: boolean;
  bumpStructural: () => void;
  enterLive: (cold?: boolean) => Promise<void>;
  handleFrameLoad: (slot: "a" | "b") => void;
  toggleLive: () => void;
};
```

- [ ] **Step 1: Write the failing test**

This hook is almost entirely React-effect-driven (postMessage listeners, iframe refs) with little pure logic to unit-test in isolation. Write one focused test for the one pure piece worth locking down — the `handleFrameLoad` swap-resolution logic — using the same `__testOnly_*` factory pattern:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useLiveEditBridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:556-575` (refs/state), `605-616` (mode/liveSrc state), `1021-1182` (both postMessage effects, verbatim — do not alter the `try/catch` guard, the `lastNonTextSig` dedup check, or the debounced-reload effect's 500ms timer), and `1743-1789` (`enterLive`/`handleFrameLoad`/`toggleLive`) for the exact current code. Move all of it into `apps/admin/src/designer/hooks/useLiveEditBridge.ts`, parameterized per the Interfaces block above. Extract `handleFrameLoad`'s body into a standalone factory so Step 1's test can call it directly:
```ts
import { useEffect, useRef, useState } from "react";
import type React from "react";
import * as api from "../../lib/api";
import { typoStyle, colStyle, lengthValue, shadowToCss } from "../style";
import { moveColumn, moveSection } from "../designerTree"; // adjust to the real existing import path
import { removeAt, insertEl } from "../blockPath";
import type { Block, Sel, SectionProps } from "../types";

export function __testOnly_handleFrameLoad(deps: {
  swapPending: { current: "a" | "b" | null };
  setActiveSlot: (s: "a" | "b") => void;
  setReloading: (v: boolean) => void;
  frameARef: { current: HTMLIFrameElement | null };
  frameBRef: { current: HTMLIFrameElement | null };
  liveSrcA: string | null;
  liveSrcB: string | null;
  pendingScrollRestore: { current: number | null };
  activeSlot: "a" | "b";
}) {
  return function handleFrameLoad(slot: "a" | "b") {
    if (deps.swapPending.current === slot) {
      deps.swapPending.current = null;
      deps.setActiveSlot(slot);
      deps.setReloading(false);
      const frame = (slot === "a" ? deps.frameARef : deps.frameBRef).current;
      const src = slot === "a" ? deps.liveSrcA : deps.liveSrcB;
      if (deps.pendingScrollRestore.current != null && frame?.contentWindow && src) {
        const targetOrigin = new URL(src, window.location.href).origin;
        frame.contentWindow.postMessage({ type: "designer:restoreScroll", y: deps.pendingScrollRestore.current }, targetOrigin);
        deps.pendingScrollRestore.current = null;
      }
      return;
    }
    if (slot === deps.activeSlot) deps.setReloading(false);
  };
}

export function useLiveEditBridge(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  setSel: (s: Sel) => void;
  setCtxMenu: (v: null) => void;
  undo: () => void;
  redo: () => void;
  dirty: boolean;
  save: () => Promise<void>;
  tenantHost: string;
  token: string;
  pageId: string;
  pageSlug: string;
}) {
  const { blocks, mutate, sel, setSel, setCtxMenu, undo, redo, dirty, save, tenantHost, token, pageId, pageSlug } = params;

  const [mode, setMode] = useState<"blocks" | "live">("blocks");
  const [liveSrcA, setLiveSrcA] = useState<string | null>(null);
  const [liveSrcB, setLiveSrcB] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const swapPending = useRef<"a" | "b" | null>(null);
  const liveSrc = activeSlot === "a" ? liveSrcA : liveSrcB;
  const [reloading, setReloading] = useState(true);
  const [selectedRect, setSelectedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [structuralTick, setStructuralTick] = useState(0);
  function bumpStructural() {
    setStructuralTick((n) => n + 1);
  }
  const lastScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  const lastNonTextSig = useRef<string | null>(null);
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const liveFrame = activeSlot === "a" ? frameARef : frameBRef;

  const handleFrameLoad = __testOnly_handleFrameLoad({
    swapPending, setActiveSlot, setReloading, frameARef, frameBRef, liveSrcA, liveSrcB, pendingScrollRestore, activeSlot,
  });

  async function enterLive(cold = false) {
    if (dirty) await save();
    const previewToken = await api.getPagePreviewToken(tenantHost, token, pageId);
    const base = api.previewUrl(tenantHost, pageSlug, previewToken);
    const src = `${base}${base.includes("?") ? "&" : "?"}designerEdit=1`;
    if (cold || (liveSrcA === null && liveSrcB === null)) {
      setReloading(true);
      swapPending.current = null;
      setActiveSlot("a");
      setLiveSrcA(src);
      setLiveSrcB(null);
      setMode("live");
      return;
    }
    const targetSlot = activeSlot === "a" ? "b" : "a";
    swapPending.current = targetSlot;
    if (targetSlot === "a") setLiveSrcA(src);
    else setLiveSrcB(src);
    setMode("live");
  }

  function toggleLive() {
    setMode(mode === "live" ? "blocks" : "live");
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (e.data?.type === "designer:selectedRect") {
        setSelectedRect(e.data.rect ?? null);
        return;
      }
      if (e.data?.type === "designer:iframeClick") {
        setCtxMenu(null);
        return;
      }
      if (e.data?.type === "designer:scroll") {
        lastScrollY.current = Number(e.data.y ?? 0);
        return;
      }
      if (e.data?.type === "designer:undo") {
        undo();
        return;
      }
      if (e.data?.type === "designer:redo") {
        redo();
        return;
      }
      if (e.data?.type === "designer:contextmenu") {
        const p = String(e.data.path ?? "").split(".").map(Number);
        if (![1, 3, 4].includes(p.length) || !liveFrame.current) return;
        const rect = liveFrame.current.getBoundingClientRect();
        setSel(p);
        setCtxMenu({ path: p, x: rect.left + Number(e.data.x ?? 0), y: rect.top + Number(e.data.y ?? 0) } as unknown as null);
        return;
      }
      const path = String(e.data?.path ?? "").split(".").map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
        const [b, r, c, el] = path;
        mutate((bs) => {
          (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[el].props.text = e.data.value ?? "";
        });
      } else if (e.data?.type === "designer:reorder") {
        const from = String(e.data.from).split(".").map(Number);
        const to = String(e.data.to).split(".").map(Number);
        if (from.length !== to.length) return;
        if (from.length === 4) {
          mutate((bs) => {
            const [tb, tr, tc, te] = to;
            let idx = te + (e.data.position === "after" ? 1 : 0);
            if (from[0] === tb && from[1] === tr && from[2] === tc && from[3] < idx) idx--;
            const el = removeAt(bs, from);
            insertEl(bs, [tb, tr, tc], el, idx);
          });
        } else if (from.length === 3) {
          if (from[0] !== to[0] || from[1] !== to[1]) return;
          let idx = to[2] + (e.data.position === "after" ? 1 : 0);
          if (from[2] < idx) idx--;
          mutate((bs) => moveColumn(bs, from[0], from[1], from[2], idx));
        } else if (from.length === 1) {
          let idx = to[0] + (e.data.position === "after" ? 1 : 0);
          if (from[0] < idx) idx--;
          mutate((bs) => moveSection(bs, from[0], idx));
        } else {
          return;
        }
        setSel(null);
        bumpStructural();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  useEffect(() => {
    if (mode !== "live" || !liveSrc || !liveFrame.current?.contentWindow) return;
    const win = liveFrame.current.contentWindow;
    const targetOrigin = new URL(liveSrc, window.location.href).origin;
    const post = (msg: unknown) => {
      try {
        win.postMessage(msg, targetOrigin);
      } catch {
        /* transient cross-origin mismatch during reload — harmless, see Designer.tsx's original comment */
      }
    };
    post({ type: "designer:selected", path: sel?.join(".") ?? null });
    if (!sel) return;
    const path = sel.join(".");
    if (sel.length === 4) {
      const [b, r, c, e] = sel;
      const el = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c]?.elements?.[e];
      if (!el) return;
      const textLike = el.type === "heading" || el.type === "text" || el.type === "list";
      if (!textLike) {
        const sig = `${path}:${JSON.stringify(el.props)}`;
        if (lastNonTextSig.current !== sig) {
          lastNonTextSig.current = sig;
          bumpStructural();
        }
        return;
      }
      const style = typoStyle(el.props);
      post({ type: "designer:style", path, style });
      post({ type: "designer:text", path, editable: el.type === "heading" || el.type === "text" });
    } else if (sel.length === 3) {
      const [b, r, c] = sel;
      const col = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c];
      if (!col) return;
      post({ type: "designer:style", path, style: colStyle(col.props) });
    } else if (sel.length === 1) {
      const sp = blocks[sel[0]]?.props as unknown as SectionProps;
      if (!sp) return;
      const style: React.CSSProperties = {
        background: sp.bgImage ? undefined : sp.bg || undefined,
        color: sp.textColor || undefined,
        padding: `${lengthValue(sp.paddingY, PAD, PAD.md)} ${lengthValue(sp.paddingX, PAD, "1.5rem")}`,
        margin: `${lengthValue(sp.marginY, PAD, "0")} 0`,
        ...(sp.border ? { border: BORDER[sp.border] } : {}),
        boxShadow: shadowToCss(sp.shadow),
        ...(sp.radius ? { borderRadius: RADIUS[sp.radius] } : {}),
      };
      post({ type: "designer:style", path, style });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sel, blocks, liveSrc]);

  useEffect(() => {
    if (structuralTick === 0 || mode !== "live") return;
    const timer = setTimeout(() => {
      pendingScrollRestore.current = lastScrollY.current;
      void enterLive().catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralTick]);

  return { mode, liveSrc, frameARef, frameBRef, liveFrame, selectedRect, reloading, bumpStructural, enterLive, handleFrameLoad, toggleLive };
}
```
Import `PAD`/`BORDER`/`RADIUS` at the top from wherever `Designer.tsx` currently imports them (same as Task 5's grep — reuse the same constants, do not redeclare). The debounced-reload effect's `catch` clause originally called `setError((err as Error).message)` (`Designer.tsx:966`) — since `setError` is residual `Designer()` state not passed into this hook, add an optional `onError?: (message: string) => void` param and call that instead, wired from `Designer()` as `setError` at the call site — do not silently swallow this error (the stub above uses `.catch(() => {})` only as a placeholder to be replaced with the real `onError` wiring; fix this before considering the task done).

**Preserve exactly (do not simplify or "clean up" any of these):**
- The `try { win.postMessage(...) } catch { ... }` guard in the sync-out effect.
- The `lastNonTextSig` dedup guard before calling `bumpStructural()` for non-text elements.
- The debounced-reload `useEffect` keyed on `structuralTick` (500ms `setTimeout`, calls `enterLive()` again, only when `mode === "live"`), including forwarding its error via `onError` per the note above.
- `designer:contextmenu`'s `[1, 3, 4].includes(p.length)` guard (Row has no live-mode context menu).
- `designer:reorder`'s `from.length !== to.length` early return and the same-container index-shift adjustments.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useLiveEditBridge.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire into Designer.tsx**

Delete the original state/refs/effects/functions per the Files section above. Add import and hook call — note `save` (declared later in the file, at the original line 1664) must be a stable reference by the time this hook is called; since `save` is a plain hoisted `function` declaration inside `Designer()`, calling the hook before `save`'s textual declaration is fine in JavaScript (function declarations hoist), but confirm `tsc` doesn't complain — if it does, move `save`'s declaration above this hook call:
```ts
import { useLiveEditBridge } from "./designer/hooks/useLiveEditBridge";
```
```ts
const liveEdit = useLiveEditBridge({
  blocks, mutate, sel, setSel, setCtxMenu, undo, redo, dirty, save,
  tenantHost, token, pageId: page.id as string, pageSlug: page.slug as string,
});
const { mode, liveSrc, frameARef, frameBRef, liveFrame, selectedRect, reloading, bumpStructural, enterLive, handleFrameLoad, toggleLive } = liveEdit;
```
Also pass `onError: setError` in the params object (per the implementation's `onError` note above). Update every `rowMarginStyle(row, isFirst, mode)` call site (introduced in Task 5) — `mode` now refers to this hook's destructured output, same variable name, no further change needed. Update every remaining call site of `liveSrc`/`frameARef`/`frameBRef`/`liveFrame`/`selectedRect`/`reloading`/`bumpStructural`/`enterLive`/`handleFrameLoad`/`toggleLive` — unchanged since names are identical to before.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. **Manual Live Edit test (required, not optional — this is the highest-risk extraction per the spec):** open Live Edit, drag-reorder a section, drag-reorder an element into a different column, delete an element, confirm the iframe reloads/updates correctly; press Ctrl+Z/Ctrl+Shift+Z while focused inside the Live Edit iframe, confirm undo/redo works; right-click a section/column/element inside Live Edit, confirm the context menu appears at the right depth.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useLiveEditBridge.ts apps/admin/src/designer/hooks/useLiveEditBridge.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract Live Edit iframe bridge into designer/hooks/useLiveEditBridge.ts"
```

---

### Task 7: Extract `designer/hooks/useBlockOps.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useBlockOps.ts`
- Create: `apps/admin/src/designer/hooks/useBlockOps.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 1410-1615 — every section/row/column/element action function — wire in the hook)

**Interfaces:**
- Consumes: `mutate` (Task 4), `clipboard` object (Task 3: `clipCopy`/`clipRead`/`styleCopy`/`styleRead`), `bumpStructural` (Task 6), `setSel` (residual), `isSuper` (prop), `blocks`, `section` (Task 2), `t` (prop), `toast` (existing `sonner` import, unchanged).
- Produces:
```ts
export function useBlockOps(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  clipboard: { clipCopy: (l: ClipLevel, d: unknown) => void; clipRead: <T = unknown>(l: ClipLevel) => T | null; styleCopy: (l: ClipLevel, p: Record<string, string>, t?: ElType) => void; styleRead: (l: ClipLevel) => Record<string, string> | null };
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
}): {
  isSectionLocked: (b: number) => boolean;
  duplicateSection: (b: number) => void;
  copySection: (b: number) => void;
  pasteSection: (b: number) => void;
  copyStyleSection: (b: number) => void;
  pasteStyleSection: (b: number) => void;
  deleteSection: (b: number) => void;
  duplicateColumn: (b: number, r: number, c: number) => void;
  copyColumn: (b: number, r: number, c: number) => void;
  pasteColumn: (b: number, r: number, c: number) => void;
  copyStyleColumn: (b: number, r: number, c: number) => void;
  pasteStyleColumn: (b: number, r: number, c: number) => void;
  deleteColumn: (b: number, r: number, c: number) => void;
  nudgeColumn: (b: number, r: number, c: number, dir: -1 | 1) => void;
  deleteRow: (b: number, r: number) => void;
  moveRow: (b: number, r: number, dir: -1 | 1) => void;
  duplicateRow: (b: number, r: number) => void;
  copyRow: (b: number, r: number) => void;
  pasteRow: (b: number, r: number) => void;
  copyStyleRow: (b: number, r: number) => void;
  pasteStyleRow: (b: number, r: number) => void;
  setRowGap: (b: number, r: number, gap: string | undefined) => void;
  duplicateElement: (b: number, r: number, c: number, e: number) => void;
  copyElement: (b: number, r: number, c: number, e: number) => void;
  pasteElement: (b: number, r: number, c: number, e: number) => void;
  copyStyleElement: (b: number, r: number, c: number, e: number) => void;
  pasteStyleElement: (b: number, r: number, c: number, e: number) => void;
  deleteElement: (b: number, r: number, c: number, e: number) => void;
  moveElement: (b: number, r: number, c: number, e: number, dir: -1 | 1) => void;
};
```

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/useBlockOps.test.ts` — test via a fake `mutate`/`clipboard` (no real React render needed, since every function here is a plain closure over its params):
```ts
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
      clipRead: (level: string) => clipStore.get(level) ?? null,
      styleCopy: (level: string, props: unknown) => styleStore.set(level, props),
      styleRead: (level: string) => styleStore.get(level) ?? null,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useBlockOps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:1410-1615` for the exact current code of every function listed in the Interfaces block. Move it into `apps/admin/src/designer/hooks/useBlockOps.ts`, wrapped as a plain factory function (`blockOpsFns`) taking `{ getBlocks, mutate, setSel, clipboard, bumpStructural, isSuper, t }`, with a thin `useBlockOps` wrapper that just calls `blockOpsFns({ getBlocks: () => params.blocks, ...params })` fresh each render (no internal `useState`/`useRef` — this hook is stateless, purely a bundle of closures over its params, same pattern as `blockPath.ts`):
```ts
import { section } from "../blockPath";
import { clone, uid } from "../../lib/clone"; // adjust to Designer.tsx's real existing imports for clone/uid
import type { Key } from "../../i18n";
import { toast } from "sonner";
import type { Block, ElType, Sel } from "../types";
import type { ClipLevel } from "./useClipboard";

type ClipboardOps = {
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
};

function blockOpsFns(params: {
  getBlocks: () => Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  clipboard: ClipboardOps;
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
}) {
  const { getBlocks, mutate, setSel, clipboard, bumpStructural, isSuper, t } = params;
  const { clipCopy, clipRead, styleCopy, styleRead } = clipboard;

  function isSectionLocked(b: number): boolean {
    return !isSuper && (getBlocks()[b]?.props as unknown as { locked?: string } | undefined)?.locked === "true";
  }
  function duplicateSection(b: number) {
    mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])));
    bumpStructural();
  }
  function copySection(b: number) {
    clipCopy("section", getBlocks()[b]);
  }
  function pasteSection(b: number) {
    const data = clipRead<Block>("section");
    if (data) {
      mutate((bs) => bs.splice(b + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleSection(b: number) {
    const { rows: _rows, ...styleProps } = getBlocks()[b].props as unknown as { rows: unknown } & Record<string, string>;
    styleCopy("section", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleSection(b: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const style = styleRead("section");
    if (style) mutate((bs) => Object.assign(bs[b].props, style));
  }
  function deleteSection(b: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => { bs.splice(b, 1); });
    setSel(null);
    bumpStructural();
  }

  function duplicateColumn(b: number, r: number, c: number) {
    mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(section(bs, b).rows[r].columns[c])));
    bumpStructural();
  }
  function copyColumn(b: number, r: number, c: number) {
    clipCopy("column", section(getBlocks(), b).rows[r].columns[c]);
  }
  function pasteColumn(b: number, r: number, c: number) {
    const data = clipRead("column");
    if (data) {
      mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleColumn(b: number, r: number, c: number) {
    styleCopy("column", section(getBlocks(), b).rows[r].columns[c].props ?? {});
  }
  function pasteStyleColumn(b: number, r: number, c: number) {
    const style = styleRead("column");
    if (style)
      mutate((bs) => {
        const target = section(bs, b).rows[r].columns[c];
        target.props = { ...(target.props ?? {}), ...style };
      });
  }
  function deleteColumn(b: number, r: number, c: number) {
    mutate((bs) => {
      const row = section(bs, b).rows[r];
      row.columns.splice(c, 1);
      if (row.columns.length === 0) section(bs, b).rows.splice(r, 1);
    });
    setSel(null);
    bumpStructural();
  }
  function nudgeColumn(b: number, r: number, c: number, dir: -1 | 1) {
    const target = c + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows[r].columns.length) return;
    mutate((bs) => {
      const cols = section(bs, b).rows[r].columns;
      cols.splice(target, 0, cols.splice(c, 1)[0]);
    });
    setSel([b, r, target]);
    bumpStructural();
  }
  function deleteRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r, 1));
    setSel(null);
    bumpStructural();
  }
  function moveRow(b: number, r: number, dir: -1 | 1) {
    const target = r + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows.length) return;
    mutate((bs) => {
      const rows = section(bs, b).rows;
      rows.splice(target, 0, rows.splice(r, 1)[0]);
    });
    setSel([b, target]);
    bumpStructural();
  }
  function duplicateRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(section(bs, b).rows[r])));
    bumpStructural();
  }
  function copyRow(b: number, r: number) {
    clipCopy("row", section(getBlocks(), b).rows[r]);
  }
  function pasteRow(b: number, r: number) {
    const data = clipRead("row");
    if (data) {
      mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleRow(b: number, r: number) {
    const { columns: _columns, ...styleProps } = section(getBlocks(), b).rows[r];
    styleCopy("row", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleRow(b: number, r: number) {
    const style = styleRead("row");
    if (style) mutate((bs) => Object.assign(section(bs, b).rows[r], style));
  }
  function setRowGap(b: number, r: number, gap: string | undefined) {
    mutate((bs) => { section(bs, b).rows[r].gap = gap; });
  }

  function duplicateElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => {
      const src = section(bs, b).rows[r].columns[c].elements[e];
      section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
    });
    bumpStructural();
  }
  function copyElement(b: number, r: number, c: number, e: number) {
    clipCopy("element", section(getBlocks(), b).rows[r].columns[c].elements[e]);
  }
  function pasteElement(b: number, r: number, c: number, e: number) {
    const data = clipRead("element");
    if (data) {
      mutate((bs) => {
        const list = section(bs, b).rows[r].columns[c].elements;
        list.splice(e + 1, 0, { ...clone(data), id: uid() });
      });
      bumpStructural();
    }
  }
  function copyStyleElement(b: number, r: number, c: number, e: number) {
    const el = section(getBlocks(), b).rows[r].columns[c].elements[e];
    styleCopy("element", el.props, el.type);
  }
  function pasteStyleElement(b: number, r: number, c: number, e: number) {
    const style = styleRead("element");
    if (style)
      mutate((bs) => {
        const target = section(bs, b).rows[r].columns[c].elements[e];
        target.props = { ...target.props, ...style };
      });
  }
  function deleteElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => { section(bs, b).rows[r].columns[c].elements.splice(e, 1); });
    setSel(null);
    bumpStructural();
  }
  function moveElement(b: number, r: number, c: number, e: number, dir: -1 | 1) {
    const target = e + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows[r].columns[c].elements.length) return;
    mutate((bs) => {
      const els = section(bs, b).rows[r].columns[c].elements;
      els.splice(target, 0, els.splice(e, 1)[0]);
    });
    setSel([b, r, c, target]);
    bumpStructural();
  }

  return {
    isSectionLocked, duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
    duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
    deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
  };
}

export function __testOnly_blockOpsFns(params: Parameters<typeof blockOpsFns>[0]) {
  return blockOpsFns(params);
}

export function useBlockOps(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  clipboard: ClipboardOps;
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
}) {
  return blockOpsFns({ getBlocks: () => params.blocks, ...params });
}
```
**Note:** `deleteElement`'s original body called the module-level `removeAt(bs, [b, r, c, e])` (`Designer.tsx:1600`) — since this hook doesn't import `removeAt` in the sketch above (to avoid a redundant import when `section(...).elements.splice(...)` inline is equally correct and matches every sibling function's own style in this file), verify against the actual original line 1598-1604 whether to keep using `removeAt` (for byte-identical logic) or the inlined splice shown here (behaviorally identical either way, since `removeAt` is itself just `section(bs,b).rows[r].columns[c].elements.splice(e,1)[0]`) — prefer keeping `removeAt` if it's truly a 1-line difference, to minimize any chance of behavioral drift; either is acceptable as long as the test in Step 1 passes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useBlockOps.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Wire into Designer.tsx**

Delete the original functions (lines 1410-1615). Add import and hook call:
```ts
import { useBlockOps } from "./designer/hooks/useBlockOps";
```
```ts
const blockOps = useBlockOps({ blocks, mutate, setSel, clipboard, bumpStructural, isSuper, t });
const {
  isSectionLocked, duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
  duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
  deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
  duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
} = blockOps;
```
Every remaining call site is unchanged since names are identical.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually spot-check (per the spec's risk note — sample rather than exhaustively re-test all 28 functions): duplicate/copy/paste/delete a section, a row, a column, and an element; confirm a locked section's Delete/Paste-style stay refused with the toast.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useBlockOps.ts apps/admin/src/designer/hooks/useBlockOps.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract section/row/column/element ops into designer/hooks/useBlockOps.ts"
```

---

### Task 8: Extract `designer/hooks/useTemplateLibrary.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/useTemplateLibrary.ts`
- Create: `apps/admin/src/designer/hooks/useTemplateLibrary.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 584-602 and 592-600's blueprint state, 1184-1218, 1220-1319, 1982-1992 — template/blueprint state + `openTemplates`/`saveAsTemplate`/`confirmSaveTemplate`/`confirmSaveAsBlueprint`/`insertTemplate`/`deleteTemplateHandler`/`templateKind`/`templateRows` — wire in the hook)

**Interfaces:**
- Consumes: `mutate` (Task 4), `blocks`, `sel`, `tenantHost`, `token`, `t`, `setError` (residual).
- Produces:
```ts
export function useTemplateLibrary(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  setError: (e: string | null) => void;
}): {
  showTemplates: boolean; setShowTemplates: (v: boolean) => void;
  templates: api.DesignTemplate[]; templatesBusy: boolean;
  openTemplates: () => Promise<void>;
  saveAsTemplate: (path?: Sel) => void;
  pendingTemplate: { kind: string; value: unknown } | null;
  templateName: string; setTemplateName: (v: string) => void;
  confirmSaveTemplate: () => Promise<void>;
  insertTemplate: (tpl: api.DesignTemplate) => void;
  deleteTemplateHandler: (id: string) => Promise<void>;
  templateKind: (path?: Sel) => "section" | "row" | "column" | "element" | null;
  templateRows: (tpl: api.DesignTemplate) => Row[];
  templateFilter: "all" | "section" | "row" | "column" | "element"; setTemplateFilter: (v: "all" | "section" | "row" | "column" | "element") => void;
  templateSearch: string; setTemplateSearch: (v: string) => void;
  showSaveBlueprint: boolean; setShowSaveBlueprint: (v: boolean) => void;
  blueprintName: string; setBlueprintName: (v: string) => void;
  blueprintDescription: string; setBlueprintDescription: (v: string) => void;
  blueprintCategory: string; setBlueprintCategory: (v: string) => void;
  blueprintScope: "system" | "tenant"; setBlueprintScope: (v: "system" | "tenant") => void;
  blueprintBusy: boolean;
  confirmSaveAsBlueprint: (pageSettings: PageSettings) => Promise<void>;
};
```
Note: this hook's return value is NOT fully threaded into `DesignerCtx` — only `templateKind`/`saveAsTemplate` are (`DesignerCtx` already declares both). The rest (`showTemplates`, blueprint fields, etc.) are consumed directly by `Designer()`'s own JSX (the Templates modal, the Save-as-blueprint modal), same as several other residual pieces documented in the spec.

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/useTemplateLibrary.test.ts` — test the pure `templateKind`/`templateRows` functions (no API calls involved):
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_templateKind, __testOnly_templateRows } from "./useTemplateLibrary";
import type { Block } from "../types";

function sampleBlocks(): Block[] {
  return [{ type: "section", props: { rows: [{ columns: [{ elements: [] }] }] } } as unknown as Block];
}

test("templateKind resolves section/row/column/element by path length", () => {
  const blocks = sampleBlocks();
  assert.equal(__testOnly_templateKind(blocks, [0]), "section");
  assert.equal(__testOnly_templateKind(blocks, [0, 0]), "row");
  assert.equal(__testOnly_templateKind(blocks, [0, 0, 0]), "column");
  assert.equal(__testOnly_templateKind(blocks, [0, 0, 0, 0]), "element");
  assert.equal(__testOnly_templateKind(blocks, null), null);
});

test("templateKind returns null when the path's section index isn't actually a section block", () => {
  const blocks = [{ type: "legacyBlock", props: {} } as unknown as Block];
  assert.equal(__testOnly_templateKind(blocks, [0]), null);
});

test("templateRows normalizes a section-kind template's own rows", () => {
  const tpl = { data: { kind: "section", value: { rows: [{ columns: [] }] } } } as unknown as import("../../lib/api").DesignTemplate;
  const rows = __testOnly_templateRows(tpl);
  assert.equal(rows.length, 1);
});

test("templateRows wraps a row-kind template as a single-row array", () => {
  const tpl = { data: { kind: "row", value: { columns: [] } } } as unknown as import("../../lib/api").DesignTemplate;
  const rows = __testOnly_templateRows(tpl);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { columns: [] });
});

test("templateRows falls back to raw section shape for a pre-migration template with no kind wrapper", () => {
  const tpl = { data: { rows: [{ columns: [] }, { columns: [] }] } } as unknown as import("../../lib/api").DesignTemplate;
  const rows = __testOnly_templateRows(tpl);
  assert.equal(rows.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useTemplateLibrary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:584-602` (state, including the blueprint fields), `1184-1218` (`openTemplates`/`templateKind`), `1220-1319` (`saveAsTemplate`/`confirmSaveTemplate`/`confirmSaveAsBlueprint`/`insertTemplate`/`deleteTemplateHandler`), and `1982-1992` (`templateRows`) for the exact current code. Move all of it into `apps/admin/src/designer/hooks/useTemplateLibrary.ts`, exporting `__testOnly_templateKind(blocks, path)` and `__testOnly_templateRows(tpl)` as standalone pure functions, with the full `useTemplateLibrary` hook wrapping everything else (state via `useState`, functions closing over that state + the params):
```ts
import { useState } from "react";
import * as api from "../../lib/api";
import { clone, uid } from "../../lib/clone";
import type { Key } from "../../i18n";
import { section } from "../blockPath";
import { insertEl } from "../blockPath";
import type { Block, Col, El, PageSettings, Row, SectionProps, Sel } from "../types";

export function __testOnly_templateKind(blocks: Block[], path: Sel): "section" | "row" | "column" | "element" | null {
  if (!path || blocks[path[0]]?.type !== "section") return null;
  return path.length === 1 ? "section" : path.length === 2 ? "row" : path.length === 3 ? "column" : path.length === 4 ? "element" : null;
}

export function __testOnly_templateRows(tpl: api.DesignTemplate): Row[] {
  const kind = (tpl.data?.kind as string | undefined) ?? "section";
  const value = tpl.data?.kind ? tpl.data.value : tpl.data;
  return kind === "section"
    ? ((value as SectionProps).rows ?? [])
    : kind === "row"
      ? [value as Row]
      : kind === "column"
        ? [{ columns: [value as Col] } as Row]
        : [{ columns: [{ elements: [value as El] }] } as Row];
}

export function useTemplateLibrary(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  setError: (e: string | null) => void;
}) {
  const { blocks, mutate, sel, tenantHost, token, t, setError } = params;

  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<api.DesignTemplate[]>([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<{ kind: string; value: unknown } | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [showSaveBlueprint, setShowSaveBlueprint] = useState(false);
  const [blueprintName, setBlueprintName] = useState("");
  const [blueprintDescription, setBlueprintDescription] = useState("");
  const [blueprintCategory, setBlueprintCategory] = useState("");
  const [blueprintScope, setBlueprintScope] = useState<"system" | "tenant">("tenant");
  const [blueprintBusy, setBlueprintBusy] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "section" | "row" | "column" | "element">("all");

  function templateKind(path: Sel = sel) {
    return __testOnly_templateKind(blocks, path);
  }

  async function openTemplates() {
    setShowTemplates(true);
    setTemplatesBusy(true);
    try {
      setTemplates(await api.listTemplates(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  function saveAsTemplate(path: Sel = sel) {
    const kind = templateKind(path);
    if (!kind || !path) return;
    const value: unknown =
      kind === "section"
        ? blocks[path[0]]
        : kind === "row"
          ? section(blocks, path[0]).rows[path[1]]
          : kind === "column"
            ? section(blocks, path[0]).rows[path[1]].columns[path[2]]
            : section(blocks, path[0]).rows[path[1]].columns[path[2]].elements[path[3]];
    setShowTemplates(true);
    setTemplateName("");
    setPendingTemplate({ kind, value });
  }

  async function confirmSaveTemplate() {
    if (!pendingTemplate) return;
    const name = templateName.trim();
    if (!name) return;
    setTemplatesBusy(true);
    try {
      await api.createTemplate(tenantHost, token, name, pendingTemplate as unknown as Record<string, unknown>);
      setTemplates(await api.listTemplates(tenantHost, token));
      setPendingTemplate(null);
      setTemplateName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  async function confirmSaveAsBlueprint(pageSettings: PageSettings) {
    const name = blueprintName.trim();
    if (!name) return;
    setBlueprintBusy(true);
    try {
      await api.createBlueprint(tenantHost, token, {
        name,
        description: blueprintDescription.trim() || undefined,
        category: blueprintCategory.trim() || undefined,
        layout: blocks,
        settings: pageSettings,
        scope: blueprintScope,
      });
      setShowSaveBlueprint(false);
      setBlueprintName("");
      setBlueprintDescription("");
      setBlueprintCategory("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlueprintBusy(false);
    }
  }

  function insertTemplate(tpl: api.DesignTemplate) {
    const kind = tpl.data?.kind as "section" | "row" | "column" | "element" | undefined;
    const value = kind ? tpl.data.value : tpl.data;
    if (kind === "row") {
      if (!sel || sel.length < 1) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const b = sel[0];
      const index = sel.length >= 2 ? sel[1] + 1 : section(blocks, b).rows.length;
      mutate((bs) => section(bs, b).rows.splice(index, 0, clone(value) as Row));
    } else if (kind === "column" || kind === "element") {
      if (!sel || sel.length < 3) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const [b, r, c, e] = sel;
      if (kind === "column") {
        mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(value) as Col));
      } else {
        const index = sel.length === 4 ? e + 1 : section(blocks, b).rows[r].columns[c].elements.length;
        mutate((bs) => insertEl(bs, [b, r, c], { ...(clone(value) as El), id: uid() }, index));
      }
    } else {
      mutate((bs) => bs.push(clone(value) as unknown as Block));
    }
    setShowTemplates(false);
  }

  async function deleteTemplateHandler(id: string) {
    if (!confirm(t("designer-templates-delete-confirm"))) return;
    try {
      await api.deleteTemplate(tenantHost, token, id);
      setTemplates((ts) => ts.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function templateRows(tpl: api.DesignTemplate): Row[] {
    return __testOnly_templateRows(tpl);
  }

  return {
    showTemplates, setShowTemplates, templates, templatesBusy, openTemplates, saveAsTemplate,
    pendingTemplate, templateName, setTemplateName, confirmSaveTemplate, insertTemplate, deleteTemplateHandler,
    templateKind, templateRows, templateFilter, setTemplateFilter, templateSearch, setTemplateSearch,
    showSaveBlueprint, setShowSaveBlueprint, blueprintName, setBlueprintName, blueprintDescription, setBlueprintDescription,
    blueprintCategory, setBlueprintCategory, blueprintScope, setBlueprintScope, blueprintBusy, confirmSaveAsBlueprint,
  };
}
```
Note: `insertTemplate` originally also called `bumpStructural()` right before `setShowTemplates(false)` (`Designer.tsx:1307`) — since `bumpStructural` lives in Task 6's hook, add it as a param: `useTemplateLibrary(params: { ...; bumpStructural: () => void })`, call it in `insertTemplate` before `setShowTemplates(false)`, and update this task's `Designer.tsx` wiring step to pass `bumpStructural` (Task 6's output) into the hook call.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/useTemplateLibrary.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Wire into Designer.tsx**

Delete the original state/functions. Add import and hook call:
```ts
import { useTemplateLibrary } from "./designer/hooks/useTemplateLibrary";
```
```ts
const templateLibrary = useTemplateLibrary({ blocks, mutate, sel, tenantHost, token, t, setError, bumpStructural });
const {
  showTemplates, setShowTemplates, templates, templatesBusy, openTemplates, saveAsTemplate,
  pendingTemplate, templateName, setTemplateName, confirmSaveTemplate, insertTemplate, deleteTemplateHandler,
  templateKind, templateRows, templateFilter, setTemplateFilter, templateSearch, setTemplateSearch,
  showSaveBlueprint, setShowSaveBlueprint, blueprintName, setBlueprintName, blueprintDescription, setBlueprintDescription,
  blueprintCategory, setBlueprintCategory, blueprintScope, setBlueprintScope, blueprintBusy, confirmSaveAsBlueprint,
} = templateLibrary;
```
Update the Save-as-blueprint modal's submit handler to call `confirmSaveAsBlueprint(pageSettings)` (passing `pageSettings`, still local to `Designer()` until Task 9) instead of the old zero-arg `confirmSaveAsBlueprint()`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually test: Save as Template on a section/row/column/element, confirm it appears in the library and re-inserts correctly; Save as Blueprint, confirm it's created via the API.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/useTemplateLibrary.ts apps/admin/src/designer/hooks/useTemplateLibrary.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract template/blueprint library state into designer/hooks/useTemplateLibrary.ts"
```

---

### Task 9: Extract `designer/hooks/usePageAndLanguage.ts`

**Files:**
- Create: `apps/admin/src/designer/hooks/usePageAndLanguage.ts`
- Create: `apps/admin/src/designer/hooks/usePageAndLanguage.test.ts`
- Modify: `apps/admin/src/Designer.tsx` (delete lines 624-667 and the language-fetch effect + `translateLayoutBlocks`/`switchPageLanguage`/`clickPageLanguagePill`/`retranslatePageLanguage` around lines 668-767, plus the 4 `setPage*` setters at lines 1548-1567 — wire in the hook)

**Interfaces:**
- Consumes: `page` (prop), `tenantHost`, `token`, `blocks` (Task 4), `setBlocksDirectly` (Task 4 — `switchPageLanguage` sets `blocks` directly, bypassing `mutate`/history, since a language switch is not an undoable edit), `resetHistory` (Task 4), `setSel` (residual), `setDirty` (residual).
- Produces:
```ts
export function usePageAndLanguage(params: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  blocks: Block[];
  setBlocksDirectly: (b: Block[]) => void;
  resetHistory: () => void;
  setSel: (s: Sel) => void;
  setDirty: (v: boolean) => void;
}): {
  pageSettings: PageSettings;
  setPageGap: (gap: string | undefined) => void;
  setPageContentWidth: (contentWidth: "contained" | "full" | undefined) => void;
  setPagePaddingX: (paddingX: string | undefined) => void;
  setPageThemePreset: (preset: api.ThemePreset | null) => void;
  themePresets: api.ThemePreset[];
  siteMultilangEnabled: boolean;
  pageMultilangEnabled: boolean; setPageMultilangEnabled: (v: boolean) => void;
  siteLanguages: api.SiteLanguage[];
  pageLanguage: string; setPageLanguage: (v: string) => void;
  activeLang: string;
  content: Record<string, Block[]>;
  clickPageLanguagePill: (code: string) => void;
  translating: boolean;
  retranslatePageLanguage: (code: string) => Promise<void>;
};
```

- [ ] **Step 1: Write the failing test**

`apps/admin/src/designer/hooks/usePageAndLanguage.test.ts` — test `translateLayoutBlocks`'s traversal logic with a fake translate function (no real API call):
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_translateLayoutBlocks } from "./usePageAndLanguage";
import type { Block } from "../types";

test("translateLayoutBlocks translates only TRANSLATABLE_TEXT_KEYS fields, leaves others untouched", async () => {
  const blocks: Block[] = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [
          { id: "e1", type: "heading", props: { text: "Hello", level: "h1" } },
        ] }] }],
      },
    } as unknown as Block,
  ];
  const translateFn = async (val: string) => `[${val}]`;
  const out = await __testOnly_translateLayoutBlocks(blocks, translateFn);
  const el = (out[0].props as unknown as { rows: { columns: { elements: { props: Record<string, string> } }[] }[] }).rows[0].columns[0].elements[0];
  assert.equal(el.props.text, "[Hello]");
  assert.equal(el.props.level, "h1");
});

test("translateLayoutBlocks keeps the original value when translation throws", async () => {
  const blocks: Block[] = [
    { type: "section", props: { rows: [{ columns: [{ elements: [{ id: "e1", type: "heading", props: { text: "Hello" } }] }] }] } } as unknown as Block,
  ];
  const translateFn = async () => { throw new Error("network error"); };
  const out = await __testOnly_translateLayoutBlocks(blocks, translateFn);
  const el = (out[0].props as unknown as { rows: { columns: { elements: { props: Record<string, string> } }[] }[] }).rows[0].columns[0].elements[0];
  assert.equal(el.props.text, "Hello");
});

test("translateLayoutBlocks skips element types with no TRANSLATABLE_TEXT_KEYS entry", async () => {
  const blocks: Block[] = [
    { type: "section", props: { rows: [{ columns: [{ elements: [{ id: "e1", type: "spacer", props: { height: "2rem" } }] }] }] } } as unknown as Block,
  ];
  let calls = 0;
  const translateFn = async (val: string) => { calls++; return val; };
  await __testOnly_translateLayoutBlocks(blocks, translateFn);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/usePageAndLanguage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `apps/admin/src/Designer.tsx:624-667` (state), `668-767` (the language-fetch effect, `translateLayoutBlocks`, `switchPageLanguage`, `clickPageLanguagePill`, `retranslatePageLanguage` — read past line 767 if needed to capture `retranslatePageLanguage`'s full body, which was cut off mid-read during spec-writing), and lines `1548-1567` (the 4 `setPage*` setters) for the exact current code. Move all of it into `apps/admin/src/designer/hooks/usePageAndLanguage.ts`:
```ts
import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { clone } from "../../lib/clone";
import type { Block, ElType, PageSettings, Sel } from "../types";

export const BASE_LANG = "__base__"; // must match designer/context.ts's existing BASE_LANG export — import it from there instead of redeclaring, to avoid two sentinels drifting apart: `import { BASE_LANG } from "../context";`

const TRANSLATABLE_TEXT_KEYS: Partial<Record<ElType, string[]>> = {
  heading: ["text"],
  text: ["text"],
  button: ["label"],
  image: ["alt"],
  infobox: ["heading", "text"],
  ctabanner: ["heading", "description", "button1Label", "button2Label"],
  announcementbar: ["text", "linkLabel"],
};

export async function __testOnly_translateLayoutBlocks(
  src: Block[],
  translateFn: (val: string) => Promise<string>,
): Promise<Block[]> {
  const out = clone(src);
  for (const block of out) {
    if (block.type !== "section") continue;
    const sp = block.props as unknown as { rows?: { columns?: { elements?: { type: string; props: Record<string, string> }[] }[] }[] };
    for (const row of sp.rows ?? []) {
      for (const col of row.columns ?? []) {
        for (const el of col.elements ?? []) {
          const keys = TRANSLATABLE_TEXT_KEYS[el.type as ElType];
          if (!keys) continue;
          for (const key of keys) {
            const val = el.props[key];
            if (typeof val === "string" && val.trim()) {
              try {
                el.props[key] = await translateFn(val);
              } catch {
                // keep original value on failure — don't block the switch
              }
            }
          }
        }
      }
    }
  }
  return out;
}

export function usePageAndLanguage(params: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  blocks: Block[];
  setBlocksDirectly: (b: Block[]) => void;
  resetHistory: () => void;
  setSel: (s: Sel) => void;
  setDirty: (v: boolean) => void;
}) {
  const { page, tenantHost, token, blocks, setBlocksDirectly, resetHistory, setSel, setDirty } = params;

  const [pageSettings, setPageSettings] = useState<PageSettings>(() => (page.settings as PageSettings) ?? {});
  const [themePresets, setThemePresets] = useState<api.ThemePreset[]>([]);
  useEffect(() => {
    api.listThemePresets(token).then(setThemePresets).catch(() => {});
  }, [token]);

  const [pageLanguage, setPageLanguage] = useState<string>((page.language as string | null) ?? "");
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);
  const [pageMultilangEnabled, setPageMultilangEnabled] = useState<boolean>(Boolean(page.multilangEnabled));
  const [content, setContent] = useState<Record<string, Block[]>>(() => ({
    [BASE_LANG]: clone((page.layout as Block[] | undefined) ?? []),
    ...Object.fromEntries(
      Object.entries((page.translations as Record<string, { layout: Block[] }> | null) ?? {}).map(([code, v]) => [code, v.layout]),
    ),
  }));
  const [activeLang, setActiveLang] = useState(BASE_LANG);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
      if (!(page.language as string | null) && d.defaultLanguage) {
        setPageLanguage(d.defaultLanguage);
      }
    });
  }, [tenantHost, token, page.id]);

  async function translateLayoutBlocks(src: Block[], target: string, source: string | undefined): Promise<Block[]> {
    return __testOnly_translateLayoutBlocks(src, (val) => api.translateText(tenantHost, token, val, target, { source }));
  }

  async function switchPageLanguage(target: string) {
    if (target === activeLang) return;
    const leaving = clone(blocks);
    let targetLayout = content[target];
    if (!targetLayout) {
      const sourceCode = activeLang === BASE_LANG ? (pageLanguage || undefined) : activeLang;
      setTranslating(true);
      try {
        targetLayout = await translateLayoutBlocks(leaving, target, sourceCode);
      } catch {
        targetLayout = leaving;
      } finally {
        setTranslating(false);
      }
    }
    setContent((prev) => ({ ...prev, [activeLang]: leaving, [target]: targetLayout! }));
    setBlocksDirectly(clone(targetLayout));
    setSel(null);
    resetHistory();
    setActiveLang(target);
  }

  function clickPageLanguagePill(code: string) {
    if (!pageLanguage) {
      setPageLanguage(code);
      setDirty(true);
      return;
    }
    void switchPageLanguage(code === pageLanguage ? BASE_LANG : code);
  }

  async function retranslatePageLanguage(code: string) {
    const base = activeLang === BASE_LANG ? blocks : (content[BASE_LANG] ?? blocks);
    setTranslating(true);
    try {
      const fresh = await translateLayoutBlocks(base, code, pageLanguage || undefined);
      setContent((prev) => ({ ...prev, [code]: fresh }));
      if (activeLang === code) setBlocksDirectly(clone(fresh));
      setDirty(true);
    } finally {
      setTranslating(false);
    }
  }

  function setPageGap(gap: string | undefined) {
    setPageSettings((s) => ({ ...s, gap }));
    setDirty(true);
  }
  function setPageContentWidth(contentWidth: "contained" | "full" | undefined) {
    setPageSettings((s) => ({ ...s, contentWidth }));
    setDirty(true);
  }
  function setPagePaddingX(paddingX: string | undefined) {
    setPageSettings((s) => ({ ...s, paddingX }));
    setDirty(true);
  }
  function setPageThemePreset(preset: api.ThemePreset | null) {
    setPageSettings((s) => (preset ? { ...s, theme: preset.settings, themePresetName: preset.name } : { ...s, theme: undefined, themePresetName: undefined }));
    setDirty(true);
  }

  return {
    pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled,
    siteLanguages, pageLanguage, setPageLanguage, activeLang, content,
    clickPageLanguagePill, translating, retranslatePageLanguage,
  };
}
```
Read `apps/admin/src/Designer.tsx`'s `retranslatePageLanguage` body once more in full before finalizing this file (this plan's own research pass read only through its `setTranslating(true)`/`try`/`await translateLayoutBlocks(...)`/`setContent(...)`/`if (activeLang === code)` lines before being cut off) — confirm the `finally` block and any trailing lines match exactly what's written above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ucms/admin exec tsx --test src/designer/hooks/usePageAndLanguage.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Wire into Designer.tsx**

Delete the original state/effect/functions. Add import and hook call:
```ts
import { usePageAndLanguage } from "./designer/hooks/usePageAndLanguage";
```
```ts
const pageAndLanguage = usePageAndLanguage({ page, tenantHost, token, blocks, setBlocksDirectly, resetHistory, setSel, setDirty });
const {
  pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
  siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled,
  siteLanguages, pageLanguage, setPageLanguage, activeLang, content,
  clickPageLanguagePill, translating, retranslatePageLanguage,
} = pageAndLanguage;
```
`setBlocksDirectly` and `resetHistory` come from Task 4's `useUndoRedo()` destructure — confirm both are already in scope from that earlier hook call. Update `save()`'s references to `content`/`pageLanguage`/`pageMultilangEnabled`/`pageSettings` — unchanged, since destructured names match.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin exec tsc -b --noEmit && pnpm --filter @ucms/admin test && pnpm --filter @ucms/admin test:e2e`
Expected: all pass. Manually test: switch language pills on a multilang-enabled page, confirm auto-translate fires for an empty slot and content switches correctly; edit page settings (gap/content width/padding/theme preset), confirm `dirty` flips true.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/designer/hooks/usePageAndLanguage.ts apps/admin/src/designer/hooks/usePageAndLanguage.test.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract page settings/i18n state into designer/hooks/usePageAndLanguage.ts"
```

---

### Task 10: Final integration cleanup + full verification

**Files:**
- Modify: `apps/admin/src/Designer.tsx` (delete any now-dead code, confirm the `designerCtx` assembly references hook outputs correctly, confirm no duplicate declarations remain)

**Interfaces:**
- Consumes: all 7 hooks' outputs from Tasks 3-9.
- Produces: no new interface — this task only cleans up and verifies.

- [ ] **Step 1: Read through the full current `Designer.tsx` top to bottom**

Confirm every state declaration and function that should have moved in Tasks 2-9 is gone, and every remaining declaration matches this residual list: `sel`/`setSel`, `dirty`/`busy`/`msg`/`error`/`uploading`/`dropHint`/`editingSlug`/`slugDraft`/`activeLeftTab`/`mobilePanel`/`expanded`/`toggleExpand`/`ctxMenu`/`iconSearch`/`hoverBand`, `collapsedGroups`/`toggleGroup`/`inspectorTab`/`setInspectorTab` (NOT moved — only `linkedPadding`/`linkedRadius`/`linkedMargin` moved into Task 5's `useBpStyle`), `siteTheme`/`sliderSlideIdx`/`uploadImage`/`availableMenus`/`availableCategories`, `editingText`/`editingSliderText`/`sliderPreviewRefs`/`sliderGuide`/`sliderEditingItem`, `drag`/`dropIntoColumn`/`rowDragProps`/`treeDropHint` (the palette/tree drag-and-drop plumbing — deliberately NOT extracted by this plan per the Self-Review Notes below), `savedAny`/`slugError`, `save`/`preview`/`renameSlug`/`close` (page-chrome actions reading across multiple hooks' outputs), `LayersTree`/`BlockControls`/`LiveEditGripHandle`/`LiveEditToolbar`/`HiddenAtBpBadge`.

- [ ] **Step 2: Confirm the `designerCtx` object literal is field-for-field identical**

Diff the current `designerCtx: DesignerCtx = { ... }` object literal against `git show HEAD~9:apps/admin/src/Designer.tsx` (or however many commits back Task 2 started — count the commits this plan produced) at the same lines, or against this plan's own Task descriptions — every field name must still resolve to something, whether a hook's destructured output or a still-local `Designer()` value. No field should be missing, renamed, or newly added. Run `pnpm --filter @ucms/admin exec tsc -b --noEmit` — `DesignerCtx`'s interface fields are all required (no `?`), so a missing field is a compile error; a present-but-wrong-source field (right type, wrong value) is NOT caught by the compiler, so manually re-check the literal once against the original.

- [ ] **Step 3: Remove now-unused imports**

Run `pnpm --filter @ucms/admin exec tsc -b --noEmit`; TypeScript's `noUnusedLocals`/`noUnusedParameters` (check `apps/admin/tsconfig.json` for these flags — if enabled, unused imports are already compile errors) will surface any leftover import from the extracted code (e.g. `clone`, `uid`, `lengthValue`, if `Designer.tsx` no longer calls them directly). Remove any flagged.

- [ ] **Step 4: Confirm file size dropped**

Run (PowerShell): `(Get-Content apps/admin/src/Designer.tsx | Measure-Object -Line).Lines`
Expected: well under the pre-refactor 3,466 lines — report the new count in the commit message.

- [ ] **Step 5: Full verification pass**

Run, in order:
```bash
pnpm --filter @ucms/admin exec tsc -b --noEmit
pnpm --filter @ucms/api exec tsc -b --noEmit
pnpm --filter @ucms/admin test
pnpm --filter @ucms/element-schema test
pnpm --filter @ucms/api test
pnpm --filter @ucms/admin test:e2e
```
Expected: all green.

- [ ] **Step 6: Manual full click-through**

In the running admin app: open a page in Designer, perform one full cycle — add a section, add a row, add 2 columns, add an element into each, style one via the Inspector (color + typography), duplicate it, copy/paste it, undo twice, redo once, switch to Tablet breakpoint and override one field, toggle Hidden-at-mobile on an element, save, reload the page, confirm everything persisted. Then open Live Edit, make one structural edit (delete an element) and one style edit (change a color), confirm both reflect in the iframe. Then open the Templates library, save the current section as a template, insert it elsewhere. Then switch the page's language (if multilang is enabled for the test tenant) and confirm the layout swaps.

- [ ] **Step 7: Commit**
```bash
git add apps/admin/src/Designer.tsx
git commit -m "refactor(admin): final Designer.tsx Layer 2+3 integration cleanup"
```

---

## Self-Review Notes

**Spec coverage:** all 7 hooks from the spec are covered (Tasks 3-9), plus the `blockPath.ts` circular-dependency resolution (Task 2) and the Playwright smoke test (Task 1), matching the spec's migration order. Two items surfaced during code-reading that the spec's hook-boundary sketch didn't fully anticipate, resolved here directly rather than re-opening brainstorming (per the user's explicit "stop deliberating, develop" instruction):
- **Blueprint state** (`showSaveBlueprint`/`blueprintName`/`blueprintDescription`/`blueprintCategory`/`blueprintScope`/`blueprintBusy`/`confirmSaveAsBlueprint`) exists in the current code but wasn't named in the spec's `useTemplateLibrary` description — folded into Task 8's `useTemplateLibrary` since it's the same "save the current selection/page as a reusable asset" concern.
- **Palette/tree drag-and-drop** (`drag` ref, `dropIntoColumn`, `rowDragProps`, `treeDropHint`) is a real concern the spec's 7 hooks don't cover — deliberately left as residual `Designer()` state (Task 10, Step 1) rather than invented as an 8th hook, since it's tightly coupled to inline JSX drag-event handlers rather than being state-management logic with an independent test surface; flagged explicitly here rather than silently dropped.
- **`setBlocksDirectly`** (Task 4) and **`resetHistory`** (Task 4, added mid-plan in Task 9's Step 1) are two small additions to `useUndoRedo`'s return shape beyond the spec's original sketch, needed by Task 9's language-switch logic — the spec anticipated `useUndoRedo` might need to expose more than `mutate`/`undo`/`redo` but left the exact shape open; this plan resolves it concretely.

**Placeholder scan:** every step has real code or an exact source line range to extract from — the "read Designer.tsx:X-Y for the exact current code" instructions are deliberate (avoiding a stale, possibly-already-inaccurate full reproduction of ~230 lines inline) rather than vagueness — each is paired with the exact new function signature and exact preserve-behavior notes, not an open-ended "port this over." Task 9's implementation code is flagged as needing one more read-through of `retranslatePageLanguage`'s tail (the research pass that fed this plan was cut off mid-function) — this is called out explicitly as a verification step, not silently assumed correct.

**Type consistency:** hook return shapes in each task's Interfaces block match what later tasks' wiring steps destructure by name — cross-checked field-by-field against the original `designerCtx` object literal captured from `Designer.tsx:2148-2165` during research.

**Scope:** this plan produces one working, testable `Designer.tsx` at the end — not decomposable further (all 7 hooks are interdependent through the shared `blocks`/`mutate` state, so partial completion leaves `Designer.tsx` in a real intermediate state, not a separately shippable one); each task is still independently reviewable, per the task-loop's own gate, and each commits independently so a bad task can be reverted without losing the others.
