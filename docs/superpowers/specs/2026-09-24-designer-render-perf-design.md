# Designer.tsx render-perf — design

**Status:** (a) shipped 2026-09-24. (b) shipped and live-verified 2026-09-24:
added `immer` as a real dependency (small, single-purpose, exactly the
technique this doc already named — a hand-rolled proxy/draft tracker would be
much riskier for a content-corruption-adjacent change) and replaced every
`clone()` call in `useUndoRedo.ts`'s `mutate`/`undo`/`redo`/`startSpacingDrag`
with Immer's `produce()`. The manual browser smoke test this section called
for surfaced a real regression: ~12 `mutate((bs) => bs.push(...))`-shaped
call sites across Designer.tsx/Inspector.tsx/useBlockOps.ts/
useTemplateLibrary.ts had single-expression arrow bodies whose implicit
return value (`Array.push`/`splice`'s return, `Object.assign`'s return,
`removeAt`'s return) is non-void — the old `clone()`-based mutate silently
discarded that return value, but Immer's `produce()` throws
("returned a new value *and* modified its draft") when a recipe mutates AND
returns something other than undefined/the draft. Root-caused instead of
patched per-site: `mutate()` and `startSpacingDrag` in `useUndoRedo.ts` now
wrap the caller's fn in a block-bodied recipe (`(draft) => { fn(draft); }`)
so its return value is always discarded before reaching `produce()`,
regardless of what any past or future call site's fn body returns. Verified:
typecheck + build + full unit suite (239/239, including a new regression
test for this exact footgun) all pass, plus a live browser smoke pass in the
actual Designer (add section, add row preset, delete row, copy/paste style,
move section up, 5-deep undo/redo round-trip) — all clean, 0 console errors,
state matched exactly pre- and post- undo/redo.
(c) attempted 2026-09-24, **did not deliver the stated payoff** — real
finding, not a mistake in the mechanics, see below. Implemented exactly as
scoped: added `designer/hooks/useStableFn.ts` (`useStableFns`, a permanently-
stable ref-passthrough wrapper — the "useEvent" pattern, chosen over 51
hand-tracked `useCallback` dependency arrays because several of these
mutators chain through 2-3 layers of other unmemoized functions
`bumpStructural`/`isSectionLocked`, where a missed transitive dep would
silently reintroduce a stale closure; a ref-passthrough can't have that bug
by construction) applied to all 51 function fields of `designerCtx`, then
wrapped the whole `designerCtx` object itself in `useMemo`. Verified clean:
typecheck, build, 239/239 unit tests.
**Then the doc's own mandated payoff check (render-count log) falsified it
live**: instrumented `ElPreviewImpl`/`InspectorImpl` with a per-instance
render counter, edited a Page Settings field that touches neither `blocks`
nor `sel` (column gap) — `ElPreview`'s counter still jumped +8 and
`Inspector`'s +2, on an edit with zero relation to the rendered element.
**Root cause**: `designerCtx` is ONE object passed as a single `ctx` prop to
*every* `ElPreview`/`Inspector` call. `React.memo`'s shallow comparison
checks each prop's reference with `Object.is` — it does not look inside
`ctx` at which of its 90 fields actually changed. Since `blocks` (top-level
array reference always changes on any edit, by how Immer/React state works)
and `sel` (changes on every click) are both fields of that same shared
object, and virtually every user action touches at least one of the 90
fields, `designerCtx`'s `useMemo` recomputes on nearly every action —
producing a new `ctx` object that every single `ElPreview`/`Inspector`
instance receives identically, so `memo` sees `ctx` change and re-renders
ALL of them, regardless of whether `el`/`path` (each instance's own,
separately-compared props) stayed referentially stable. This also
retroactively means **(b)'s structural-sharing win has no observable effect
on Designer's actual render behavior today** — sibling `el` identity is
real and tested, but the shared `ctx` prop's own churn dominates `memo`'s
comparison regardless, so (a)+(b) alone don't pay off either, only (c) as
literally scoped exposed it because the render-count check was never done
before.
**The real fix is bigger than "wrap the object"**: it needs the *shape* of
what's shared to change — split `designerCtx` into per-consumer-frequency
pieces (e.g. an `ElPreview`-facing slice that excludes `blocks`/`sel`
entirely, with "is this instance selected" passed as its own per-instance
prop instead of a shared array to compare against) or move to React's actual
Context API with multiple providers split by update frequency. Both are a
materially larger, differently-shaped change than this doc scoped, touching
how `ElPreview`/`Inspector` read selection state internally (~14
`sel`/`path` comparison sites in `ElPreview.tsx` alone) — not attempted here
without a fresh go-ahead. Temp render-count instrumentation removed after
the check; the `useStableFns`/`useMemo(designerCtx)` code from this attempt
is left in place (harmless, verified, technically correct given the current
ctx-bundling architecture) pending the user's call on whether to pursue the
real fix as a new step (d), or revert this attempt since it earns no
measured benefit as shipped.
Pre-emptive hardening throughout (user's own framing: "bukan sbb lag... nk
setelkan awal2"), not a response to observed lag. Strict order (a)→(b)→(c),
each its own shippable step — (c) is the one that surfaced this.

**(d) designed 2026-09-24, not yet implemented — smaller fix than the "split
ctx" idea floated above.** A follow-up audit of exactly what `ElPreviewImpl`
reads (18 distinct `ctx` fields, never `blocks`) found the real fix doesn't
need to change `designerCtx`'s shape, Designer.tsx's JSX, or any call site
at all — it needs a **custom `React.memo` comparator** on `ElPreview` only
(`Inspector` stays default-compared: it's a singleton, always reflecting
whatever's selected, so re-rendering it on every edit is correct, not a
bug). Two independent defects, both fixable in the comparator alone:
1. `path` is a freshly-allocated array literal at BOTH real call sites
   (`Designer.tsx:2176`'s `[b, r, c, e]` and `ElPreview.tsx`'s own container-
   recursion `[...path, i]`) — a new reference every render regardless of
   whether `b/r/c/e` actually changed, so default `Object.is` comparison on
   `path` alone would already defeat memo even with a perfect ctx.
2. Selection must be compared as a DERIVED per-instance value, not by `sel`'s
   own identity — `sel` (inside the shared `ctx`) gets a new array on every
   click, but what actually matters to a given `ElPreview` instance is only
   whether `selEq(sel, path)` (already defined, `ElPreview.tsx:51`) flips
   for ITS OWN path, not whether the array happened to change somewhere.
   Same idea for the 3 slider-nested-selection maps (`sliderSlideIdx`/
   `sliderInnerSel`/`sliderInnerEditing`, all `Record<string, ...>` keyed by
   `el.id`) — compare `a.sliderInnerSel[el.id] !== b.sliderInnerSel[el.id]`
   (an unrelated slider's key keeps its old reference on a normal, immutable
   state update), not the whole record.

Sketch (goes in `ElPreview.tsx`, replacing `export const ElPreview =
memo(ElPreviewImpl);`):
```ts
function arePropsEqual(
  prev: { ctx: DesignerCtx; el: El; path?: number[] },
  next: { ctx: DesignerCtx; el: El; path?: number[] },
): boolean {
  if (prev.el !== next.el) return false;
  const p1 = prev.path, p2 = next.path;
  if (p1 !== p2) {
    if (!p1 || !p2 || p1.length !== p2.length || !p1.every((v, i) => v === p2[i])) return false;
  }
  const a = prev.ctx, b = next.ctx;
  if (
    a.mode !== b.mode || a.kind !== b.kind || a.t !== b.t || a.bp !== b.bp ||
    a.mutate !== b.mutate || a.setSel !== b.setSel || a.bpGetValue !== b.bpGetValue ||
    a.availableMenus !== b.availableMenus || a.availableCategories !== b.availableCategories ||
    a.availableSymbols !== b.availableSymbols || a.editingText !== b.editingText
  ) return false;
  if (p2 && selEq(a.sel, p2) !== selEq(b.sel, p2)) return false;
  const id = next.el.id;
  if (
    a.sliderSlideIdx[id] !== b.sliderSlideIdx[id] ||
    a.sliderInnerSel[id] !== b.sliderInnerSel[id] ||
    a.sliderInnerEditing[id] !== b.sliderInnerEditing[id]
  ) return false;
  return true;
}
export const ElPreview = memo(ElPreviewImpl, arePropsEqual);
```
Deliberately omits `blocks` and every other of `designerCtx`'s ~90 fields —
confirmed by the audit that `ElPreviewImpl` never reads them, directly or
through a helper. If a future field is added to `ElPreviewImpl`'s own top
destructure, this comparator must gain a matching line too — worth a code
comment at BOTH ends pointing at each other. Risk is low (this only changes
WHEN a re-render is skipped, never what renders — a wrong comparator means
a stale-looking canvas in a narrow case, not corrupted data), but still
needs the same live smoke pass (a-c) already used: edit one element, verify
siblings' console-instrumented render count does NOT increment this time,
undo/redo, then the same click-through smoke test. **Shipped and live-verified 2026-09-24.** Implemented as sketched above
(`arePropsEqual` + `export const ElPreview = memo(ElPreviewImpl,
arePropsEqual);`, no other file touched). Verified: typecheck, build,
239/239 unit tests, plus the actual payoff check with live render-count
instrumentation (added, exercised, removed) in the real Designer: edited
the same unrelated Page Settings field (column gap) that falsely bumped the
slider's render count during the pre-(d) check — count stayed flat this
time (6→6, no re-render). Then clicked to select that same slider element
— count correctly incremented (6→8), confirming the comparator isn't
over-suppressing: a change that actually matters to an instance (its own
selection state) still re-renders it. Both directions verified, not just
the negative case.
(a)-(d) all shipped and live-verified. This closes the render-perf work
this doc scoped; no further step planned unless new lag is actually
observed.

## Problem

Old react-reviewer finding: zero `useMemo`/`useCallback` despite deep
recursive tree renders and a large `DesignerCtx` (70+ fields,
`apps/admin/src/designer/context.ts:28`) binding `Inspector`/`ElPreview` to
nearly all of Designer's state.

Naive fix (wrap `designerCtx` in `useMemo`, wrap mutators in `useCallback`)
accomplishes **nothing** — two structural blockers below must be fixed
first, in order, or (c) alone is wasted effort (confirmed by investigation).

### Blocker 1 — Inspector/ElPreview are plain function calls, not JSX

- `Designer.tsx:2135` — `ElPreview({ ctx: designerCtx, el, path })`
- `Designer.tsx:2275` — `Inspector({ ctx: designerCtx })`
- `ElPreview.tsx:854, 978, 1223` — 3 more recursive plain-call sites inside
  `ElPreview` itself (nested/container/linked-element children)

React never sees these as components this way — no fiber, no reconciliation
identity, so `React.memo` can never apply regardless of props. Intentional
(`apps/admin/CLAUDE.md` Layer 1b: "ElPreview holds no hooks of its own and
is called as a plain function" — done to call it from `.map()`/recursion
without hook-rule issues), just not realized at the time that it also
forecloses memoization.

### Blocker 2 — mutate() deep-clones the whole tree on every edit

- `designer/hooks/useUndoRedo.ts:41` `mutate()`, `:46` `clone(prev)`
- `lib/utils.ts:11` — `clone = (v) => JSON.parse(JSON.stringify(v))`

Every node in the block tree gets a new object identity on every keystroke,
tree-wide — deliberate, for undo/redo simplicity. Even with Blocker 1 fixed,
`el`/`path` props would look "changed" on every edit anywhere on the page,
so `memo` would never bail out for any edit.

## Recommended approach — 3 parts, strict order, each independently verified

### (a) Real JSX + React.memo

Convert the 5 plain-call sites (`Designer.tsx:2135,2275`;
`ElPreview.tsx:854,978,1223`) to real JSX (`<ElPreview .../>`,
`<Inspector .../>`), wrap both components in `React.memo`. Every value
currently reached via closure must become an explicit prop — JSX itself
doesn't invoke hooks, so this is safe w.r.t. the original hook-rule concern.

**Verify:** typecheck + admin build + `pnpm --filter @ucms/admin test` +
Playwright (`apps/admin/e2e/designer-smoke.spec.ts`) + manual click-through
(drag an element, edit a slider) — this touches every render path.

### (b) Structural-sharing clone (highest risk)

Replace `mutate()`'s full-deep-clone with cloning only the path from root to
the mutated node, preserving sibling subtrees' object identity (the
Immer-`produce()` technique). Touches the one mechanism all ~90 mutator
functions (`deleteRow`/`moveElement`/`duplicateColumn`/etc.) go through, and
undo/redo's history stack depends on current clone semantics.

**Verify:** typecheck + build + full test suite, **plus** extend
`useUndoRedo.test.ts` with an object-identity assertion (sibling subtree
must stay `===` across an edit to an unrelated branch) — the existing 5
tests there don't check this today. Then a manual undo/redo smoke pass:
several edits across different tree branches, undo/redo through all of
them. Test coverage for this file is better than the original investigation
assumed (`blockPath.test.ts`, `elements.test.ts`, `useBlockOps.test.ts`,
`useBpStyle.test.ts`, `useClipboard.test.ts`, `useUndoRedo.test.ts`,
`lang.test.ts`, `parsers.test.ts`, `style.test.ts` + the e2e smoke test),
but none of it asserts identity/structural-sharing today — that gap is
exactly what this step needs to close first.

### (c) Memoize designerCtx + mutators

Only after (a) and (b) land: `useMemo` the `designerCtx` object, `useCallback`
the mutator functions passed through it.

**Verify (the actual payoff check):** React DevTools profiler or a quick
render-count log confirming sibling `ElPreview`/`Inspector` instances skip
re-render on an edit elsewhere in the tree. Don't skip this — it's the only
way to confirm (a)-(c) did anything.

## Risk

(b) is content-corruption-adjacent if done carelessly — shared mutation path
for every mutator + undo/redo's history stack. Cost scales with page size,
not feature count, so there's no growing-backlog urgency pushing this;
weigh (b)'s risk against a still-hypothetical benefit (no observed lag) at
implementation time, same as when this was first parked.

## Next step

Get this doc approved, then implement (a) alone, verify, ship. Then (b),
verify hard (including the new identity test). Then (c), verify the actual
payoff. Do not do (c) alone or skip the verification steps between layers.
