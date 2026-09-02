# Designer.tsx Layer 2+3: concern-scoped state hooks

**Status:** approved by user, ready for writing-plans.
**Supersedes:** the Layer 2/3 sections of `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md`, which described a single `useDesignerState(page)` hook and deferred a Playwright test. This doc replaces both decisions per explicit user direction this session ("split by concern terus (Layer 2+3 sekali)", "tambah 1 Playwright smoke test dulu"). Layers 0/1a/1b from that doc are done and unaffected.

## Goal

`apps/admin/src/Designer.tsx` is 3,466 lines. Layers 0/1a/1b already pulled the pure helpers and the giant render sub-functions (`FieldInput`, `FieldGroups`, `Inspector`, `ElPreview`) into `apps/admin/src/designer/*`. What remains inside `Designer()` itself is state and logic: ~50 `useState`/`useRef` declarations and ~100 functions — undo/redo, clipboard, per-level (section/row/column/element) copy/paste/duplicate/delete/move, bp-style helpers, the template/blueprint library, the Live Edit iframe postMessage bridge, page settings, and i18n/translation state.

This phase extracts that logic into 7 concern-scoped hooks living in `apps/admin/src/designer/hooks/`. `Designer()` becomes a thin composition root: call the 7 hooks, assemble the existing `DesignerCtx` object from their return values exactly as it does today, and keep its own render (canvas JSX, `LayersTree`/`BlockControls`/`LiveEditToolbar`/`LiveEditGripHandle`, and a residual pool of small UI-only state that doesn't belong to any single concern).

**Hard constraint: zero changes to `apps/admin/src/designer/context.ts`'s `DesignerCtx` interface, and zero changes to `Inspector.tsx`/`ElPreview.tsx`.** Both already consume `ctx: DesignerCtx` as a bundled object (Layer 1b). This phase only changes *where* the values composing that object are computed — never the shape those two files receive.

## Non-goals

- No behavior change. Every function's observable behavior (what it mutates, when it calls `bumpStructural`, what it returns) must be identical before and after.
- No change to `ELS`/the validator/`ElPreview.tsx`'s render switch/`SectionBlock.astro` — that's the separate, already-completed "ElementDefinition unification" work (exported validator buckets + `elements.test.ts` cross-check, see `CLAUDE.md`).
- No new features. This is a refactor.
- Section-lock, template library, blueprint gallery *behavior* are unchanged — only which file owns their state.

## Why 7 hooks, not one `useDesignerState`

A single hook consolidating all ~50 state values would just relocate the God Component one level down — same coupling, same difficulty reasoning about one piece in isolation, harder to unit-test. Splitting by concern gives each hook an independently testable contract (inputs → outputs), matching how Layer 1a/1b already split `FieldControls`/`FieldGroups`/`FieldInput` by concern rather than as one blob.

## Hook boundaries

All 7 hooks live in `apps/admin/src/designer/hooks/`, one file each, each with its own `node:test` unit test (mirroring the existing `designer/*.test.ts` convention). `Designer()` calls all 7 in a fixed order (below) since several depend on earlier hooks' return values.

### 1. `useUndoRedo(initialBlocks: Block[])`

Owns: `blocks` state, `history`/`future` refs (capped at 50 entries), `draggingBand` ref, `dirty` is NOT owned here (stays in `Designer()` — see "Residual state" below, since `dirty` is read/written by code outside undo/redo too, e.g. Save).

Returns:
```ts
{
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  startSpacingDrag: (e: React.MouseEvent, startPx: number, axis: "x"|"y", sign: 1|-1, apply: (next: Block[], px: number) => void, bandKey?: string) => void;
  undo: () => void;
  redo: () => void;
}
```
`setBlocks` itself is NOT part of this hook's return value — every current caller in the code being extracted (including the Live Edit message handler's reorder/move branches, `startSpacingDrag`'s drag-move handler) goes through `mutate()` or is internal to this hook. No external caller needs raw `setBlocks`.
```
Also takes a `setDirty: (v: boolean) => void` and `setSel: (s: Sel) => void` param (undo/redo call both) — passed in from `Designer()`.

**Preserve exactly:** `mutate`'s functional `setState` form (`setBlocks((prev) => { const next = clone(prev); fn(next); return next; })`) — this is the fix for the documented bug where multiple synchronous `mutate()` calls in one tick (a "linked" FourSideControl commit) each cloned the same stale snapshot and silently dropped all but the last call. Do not regress to `const next = clone(blocks); fn(next); setBlocks(next);`.

### 2. `useClipboard()`

Owns: `clipTick` state, the `storage` event listener effect.

Returns:
```ts
{
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  clipHas: (level: ClipLevel) => boolean;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
  styleHas: (level: ClipLevel) => boolean;
}
```
No dependency on `blocks`/`mutate` — pure localStorage I/O keyed by `CLIP_KEYS`/`CLIPSTYLE_KEYS` (move these two const maps into this hook's file, they're clipboard-only). `styleCopy` still strips `CONTENT_KEYS[elType]` before storing (`CONTENT_KEYS` stays in `designer/elements.ts` or wherever it already lives — this hook imports it, doesn't own it).

### 3. `useBpStyle(mutate, blocks)`

Owns: `bp` state (`"desktop"|"tablet"|"mobile"`), `linkedPadding`/`linkedRadius`/`linkedMargin` state (FourSideControl "linked" toggles — grouped here because every call site that reads them is right next to a `sideValue`/`fourSideValue` call).

Returns:
```ts
{
  bp: Bp;
  setBp: (b: Bp) => void; // Designer()'s BpToggle in its own header needs this even though it's not in DesignerCtx
  bpKey: (key: string) => string;
  bpGetValue: (base: string | undefined, overrides: Record<string,string> | undefined, key: string) => string;
  bpKeysOverridden: (bag: Record<string,string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string,string> | undefined, keys: string[]) => Record<string,string>;
  sideValue: (props: Record<string,string> | undefined, bpBag: Record<string,string> | undefined, perSideKey: string, fallbackKey: string) => string;
  fourSideValue: (sp: SectionProps, perSideKey: string, fallbackKey: string) => string;
  setFourSideValue: (b: number, perSideKey: string, value: string) => void;
  setColSideValue: (b: number, r: number, c: number, perSideKey: string, value: string) => void;
  setElSideValue: (b: number, r: number, c: number, e: number, perSideKey: string, value: string) => void;
  linkedPadding: boolean; setLinkedPadding: (fn: (v: boolean) => boolean) => void;
  linkedRadius: boolean; setLinkedRadius: (fn: (v: boolean) => boolean) => void;
  linkedMargin: boolean; setLinkedMargin: (fn: (v: boolean) => boolean) => void;
}
```
`setFourSideValue`/`setColSideValue`/`setElSideValue` call the passed-in `mutate`. These 3 writers are why this hook needs `mutate` from hook 1 — confirms call order: `useUndoRedo` before `useBpStyle`.

### 4. `useBlockOps(mutate, setSel, clipboard, bumpStructural, isSuper, blocks)`

The largest extraction — every section/row/column/element copy/paste/duplicate/delete/move/nudge function (Designer.tsx lines ~1385-1616 today), plus `section()`/`removeAt()`/`insertEl()` (the small path-indexing helpers those functions share).

Takes `clipboard` as the object returned by `useClipboard()` (destructures `clipCopy`/`clipRead`/`styleCopy`/`styleRead` internally) and `bumpStructural` (produced by hook 6, `useLiveEditBridge` — confirms call order: this hook is constructed AFTER `useLiveEditBridge`, or `bumpStructural` is threaded in as a plain callback ref rather than a direct return-value dependency; either works, prefer passing it as a parameter since `useBlockOps`'s own return values don't feed back into `useLiveEditBridge`).

Returns: `isSectionLocked`, `duplicateSection`, `copySection`, `pasteSection`, `copyStyleSection`, `pasteStyleSection`, `deleteSection`, `duplicateColumn`, `copyColumn`, `pasteColumn`, `copyStyleColumn`, `pasteStyleColumn`, `deleteColumn`, `nudgeColumn`, `deleteRow`, `moveRow`, `duplicateRow`, `copyRow`, `pasteRow`, `copyStyleRow`, `pasteStyleRow`, `setRowGap`, `duplicateElement`, `copyElement`, `pasteElement`, `copyStyleElement`, `pasteStyleElement`, `deleteElement`, `moveElement`, plus `removeAt`/`insertEl`/`section` as internal (non-returned) helpers used by hook 6's live-edit reorder handler — **hook 6 needs `removeAt`/`insertEl`/`section` too** (its `designer:reorder` message handler calls them directly), so these 3 helpers must be exported from this hook's return value even though they're not part of `DesignerCtx`.

**Preserve exactly:** `isSectionLocked(b)` returns `!isSuper && props.locked === "true"` — the toast-and-refuse-to-mutate behavior in `deleteSection`/`pasteStyleSection` when locked (every other section action stays enabled on a locked section, per the existing comment — do not add locking to `duplicateSection`/`copySection`/`pasteSection`/`copyStyleSection`, that's intentional).

### 5. `useTemplateLibrary(mutate, tenantHost, token)`

Owns: `showTemplates`, `templates`, `templatesBusy`, `pendingTemplate`, `templateName`, `templateFilter`, `templateSearch` state.

Returns: `showTemplates`, `setShowTemplates`, `templates`, `templatesBusy`, `openTemplates`, `saveAsTemplate`, `pendingTemplate`, `templateName`, `setTemplateName`, `confirmSaveTemplate`, `insertTemplate`, `templateKind`, `templateFilter`, `setTemplateFilter`, `templateSearch`, `setTemplateSearch`.

`templateKind(path)` needs `blocks` (reads `blocks[path[0]]?.type`) — takes `blocks` as a plain param, same as `mutate`/`tenantHost`/`token`. No staleness risk: `Designer()` calls this hook fresh on every render exactly like it calls any other hook, so `blocks` is always the current render's value, identical to how `templateKind` closes over `blocks` today as a plain function inside `Designer()`'s own body.

### 6. `useLiveEditBridge(blocks, mutate, sel, setSel, undo, redo, removeAt, insertEl, moveColumn, moveSection)`

Owns: `mode`, `liveSrcA`/`liveSrcB`, `activeSlot`, `frameARef`/`frameBRef` (derives `liveFrame`), `selectedRect`, `structuralTick`, `lastScrollY`/`pendingScrollRestore`/`lastNonTextSig` refs, the `ctxMenu`-adjacent postMessage-receive effect (lines ~1025-1113: handles `designer:selectedRect`/`iframeClick`/`scroll`/`undo`/`redo`/`contextmenu`/`select`/`textInput`/`reorder`), the sync-out effect (lines ~1119-1182: posts `designer:selected`/`designer:style`/`designer:text` whenever `sel`/`blocks`/`mode`/`liveSrc` change), `bumpStructural`, `enterLive`/`toggleLive`/`closeLive`/`handleFrameLoad`.

Returns:
```ts
{
  mode: "blocks" | "live";
  liveSrc: string | null; // derived from liveSrcA/liveSrcB + activeSlot, whichever Designer() currently reads
  frameARef: React.RefObject<HTMLIFrameElement>;
  frameBRef: React.RefObject<HTMLIFrameElement>;
  liveFrame: React.RefObject<HTMLIFrameElement>;
  selectedRect: DOMRect | null;
  bumpStructural: () => void;
  enterLive: () => Promise<void>;
  toggleLive: () => void;
  closeLive: () => void;
  handleFrameLoad: () => void;
}
```
Takes `moveColumn`/`moveSection` (existing imports from `designerTree.ts`, unchanged) plus `removeAt`/`insertEl` from hook 4, and `undo`/`redo` from hook 1 — its `onMessage` handler calls `undo()`/`redo()`/`removeAt()`/`insertEl()`/`moveColumn()`/`moveSection()` directly, and its sync-out effect reads `typoStyle`/`colStyle`/`lengthValue`/`shadowToCss` (already-pure helpers imported from `designer/style.ts`, unchanged).

**Preserve exactly:** the `try { win.postMessage(...) } catch { /* transient cross-origin mismatch */ }` guard in the sync-out effect (a real, previously-hit bug, not defensive filler); the `lastNonTextSig` dedup guard that stops non-text-element style changes from re-triggering `bumpStructural()` in a loop; the debounced-reload effect keyed on `structuralTick` (500ms `setTimeout`, calls `enterLive()` again).

### 7. `usePageAndLanguage(page, setDirty)`

Owns: `pageSettings`, `siteMultilangEnabled`, `pageMultilangEnabled`, `siteLanguages`, `pageLanguage`, `activeLang`, `content`, `translating`, `themePresets`.

Returns: `pageSettings`, `setPageGap`, `setPageContentWidth`, `setPagePaddingX`, `setPageThemePreset`, `themePresets`, `siteMultilangEnabled`, `pageMultilangEnabled`, `setPageMultilangEnabled`, `siteLanguages`, `pageLanguage`, `setPageLanguage`, `activeLang`, `content`, `clickPageLanguagePill`, `translating`, `retranslatePageLanguage`.

All setters that mutate `pageSettings` (`setPageGap`/`setPageContentWidth`/`setPagePaddingX`/`setPageThemePreset`) also call the passed-in `setDirty(true)` — preserve this exactly, it's how the header's unsaved-changes indicator/Save-button-enable logic currently gets notified of a page-settings edit.

## Residual state in `Designer()`

Stays inline, not extracted — either too small to warrant its own hook, or is fetch/prop-derived data every hook above would otherwise need threaded through it as a parameter for no behavioral gain:

- `t`, `isSuper`, `tenantHost`, `token` — props/context passthrough.
- `sel`, `setSel` — owned directly by `Designer()` (a plain `useState<Sel>(null)`) since `LayersTree`, `ctxMenu`, and multiple hooks above all need to both read and drive it; threading ownership through one of the 7 hooks would make the others depend on that hook's internals.
- `dirty`, `busy`, `msg`, `error`, `uploading`, `dropHint`, `editingSlug`, `slugDraft`, `activeLeftTab`, `mobilePanel`, `expanded`/`toggleExpand`, `ctxMenu`, `iconSearch`, `hoverBand` — page-chrome/UI-only state, unchanged.
- `collapsedGroups`/`toggleGroup`, `inspectorTab`/`setInspectorTab`, `linkedPadding`-adjacent Inspector-only toggles already covered by hook 3.
- `siteTheme`, `sliderSlideIdx`/`setSliderSlideIdx`, `uploadImage`, `availableMenus`, `availableCategories` — existing fetch-on-mount state, unchanged.
- `editingText`, `editingSliderText`, `sliderPreviewRefs`, `sliderGuide`/`setSliderGuide`, `sliderEditingItem`/`setSliderEditingItem` — ElPreview-only canvas-edit refs/state with no real logic beyond passthrough; extracting them would add a hook with no behavior to test.
- `LayersTree`, `BlockControls`, `LiveEditToolbar`, `LiveEditGripHandle` — render sub-components, unchanged from Layer 1b.

`Designer()`'s body, after this phase, is: call the 7 hooks in dependency order, assemble `ctx: DesignerCtx` from their combined return values (identical field-for-field to what it builds today), and render.

## Call order (dependency-driven)

1. `useUndoRedo` (needs only `initialBlocks`)
2. `useClipboard` (no deps)
3. `useBpStyle(mutate, blocks)` — from (1)
4. `useLiveEditBridge(...)` — needs `mutate`/`undo`/`redo` from (1); needs `removeAt`/`insertEl` — see note below
5. `useBlockOps(mutate, setSel, clipboard, bumpStructural, isSuper, blocks)` — needs `mutate` from (1), `clipboard` from (2), `bumpStructural` from (4)
6. `useTemplateLibrary(mutate, tenantHost, token)` — needs `mutate` from (1)
7. `usePageAndLanguage(page, setDirty)` — independent, order-agnostic

**Circular-dependency note:** hook 4 (`useLiveEditBridge`)'s message handler calls `removeAt`/`insertEl`, which are defined in hook 5 (`useBlockOps`) — but hook 5 needs hook 4's `bumpStructural`. Resolve by extracting `removeAt`/`insertEl`/`section` as their own tiny standalone module-level functions (they're pure — take `bs`/`path`, no closure over hook state) in `designer/blockPath.ts` (new file, ~15 lines), imported directly by both hook 4 and hook 5, rather than being "owned" by either hook. This removes the circular dependency entirely and is a smaller diff than reordering hook construction.

## Playwright smoke test (added first, before any hook extraction)

Playwright is not installed anywhere in this repo yet. Add it as a new devDependency to `apps/admin` (`@playwright/test`). One test, `apps/admin/e2e/designer-smoke.spec.ts`:

1. Log in as a seeded test user (reuse whatever fixture/helper the existing `apps/admin/src/**/*.test.ts` suite or `apps/api`'s test seeding already provides for a tenant+user — if none exists, the plan's first task creates a minimal one: a script that hits `POST /api/setup` or seeds directly via `apps/api`'s db helpers against a disposable test tenant database).
2. Navigate to a page in Designer (`/content/pages/:id`).
3. Drag an element (or use the "+" add-element control, whichever is more stable to automate) onto the canvas.
4. Set one style property via the Inspector (e.g. background color).
5. Click Save.
6. Reload the page.
7. Assert the added element and the style change are both present after reload (query the canvas DOM, not the API directly — this is an end-to-end assertion that the whole save/reload round-trip preserved the layout).

This runs in CI/locally via `pnpm --filter @ucms/admin exec playwright test` and is the regression gate every hook-extraction task below must pass before being considered done, in addition to `tsc -b` and `pnpm --filter @ucms/admin test`.

## Migration & verification order

1. Add Playwright + the one smoke test (above). Get it green against current `Designer.tsx` before touching anything.
2. Extract `designer/blockPath.ts` (`removeAt`/`insertEl`/`section`) — pure, zero-risk, unblocks both hook 4 and hook 5.
3. `useClipboard` — zero dependency on blocks/mutate, safest first hook.
4. `useUndoRedo`.
5. `useBpStyle`.
6. `useLiveEditBridge`.
7. `useBlockOps`.
8. `useTemplateLibrary`.
9. `usePageAndLanguage`.
10. Final integration: `Designer()` calls all 7, assembles `ctx`, dead inline code deleted. Confirm `DesignerCtx`'s shape is byte-identical (a diff of the object literal that assembles `ctx` before/after should show only right-hand-side changes — e.g. `mutate` → `undoRedo.mutate` — never a field added/removed/renamed).
11. Full verification: `tsc -b` (admin), `pnpm --filter @ucms/admin test` (existing + new hook unit tests), Playwright smoke test, manual click-through of one section/row/column/element copy-paste-duplicate-delete cycle and one Live Edit session.

Each numbered step is its own reviewed task in the implementation plan — a regression in one hook's extraction doesn't block or contaminate the others.

## Risks

- **Live Edit bridge (hook 6) is the highest-risk extraction** — it's the most stateful, has the most subtle preserved behaviors (transient cross-origin postMessage guard, dedup signature, debounce), and its message handler reaches into hook 5's territory (`removeAt`/`insertEl`) and hook 1's (`undo`/`redo`). Do this one with extra care and a live manual Live Edit test (drag-reorder a section, an element; undo/redo from inside the iframe) in addition to the Playwright smoke test, which doesn't cover Live Edit specifically.
- **`useBlockOps` is the largest single diff** (~230 lines moving). Low logic-complexity per function (each is a small splice), but high count — the task reviewer should spot-check a sample of functions against the original rather than assume the mechanical move is correct throughout.
- Behavior-preservation, not redesign, is the entire point of this phase — any "while I'm in here" cleanup temptation (renaming, restructuring a function's internals) should be resisted; file a separate note instead of folding it into this diff.
