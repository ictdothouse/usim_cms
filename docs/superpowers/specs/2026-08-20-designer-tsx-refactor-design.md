# Designer.tsx refactor — design

**Status:** design only, not yet implemented. Deliberately deferred to a fresh
session (see "Why deferred" below) — implement via the `writing-plans` skill
from this doc, not by editing straight from this file.

## Problem

`apps/admin/src/Designer.tsx` is 6,998 lines. Structurally:

- Lines 1–1,424: ~25 pure helper functions (parsers, geometry math, style
  builders — `parseSlides`, `fitTextBox`, `sectionBpStyle`, etc). Already
  module-scope, zero closure dependency on component state. **Safe to move
  today, mechanically, with no behavior risk.**
- Lines 1,425–6,998 (~5,570 lines): **one single component**,
  `export default function Designer(...)`. Inside it:
  - 50+ `useState`/`useRef` hooks (block tree, selection path, undo/redo
    stacks, clipboard, drag state, slider-specific refs, language/
    translation state, template library state, Live Edit iframe refs — see
    lines 1438–2075 for the full list).
  - 100+ nested functions (`mutate`, `undo`, `redo`, `duplicateSection`,
    `copyColumn`, `pasteRow`, `saveAsTemplate`, `insertTemplate`, ~40 more
    copy/paste/duplicate/delete variants per block level, plus drag/resize
    handlers) — all closing over the hooks above by reference, not by
    prop or explicit parameter.
  - 4 giant nested render sub-functions that are themselves each bigger
    than most files in this repo: `FieldInput` (2,993–4,075, ~1,082
    lines), `FieldGroups` (4,075–4,222), `Inspector` (4,222–4,755, ~533
    lines), `ElPreview` (4,755–5,801, ~1,046 lines).

This is a God Component at a scale where the audit's "hard to maintain
past one engineer" concern is already real, not speculative.

## Why this can't be a naive file-split

Every nested function/render-helper reads and writes the SAME closure-
captured `useState`/`useRef` values. Moving `ElPreview` to its own file
verbatim would break the moment it tries to read `sel`, `bp`,
`sliderPreviewRefs`, etc. — those only exist as local variables inside
`Designer()`. A safe split has to either:

(a) turn each extracted piece into a function that takes an explicit props
object bundling exactly what it needs, or
(b) turn the shared state itself into a custom hook that both `Designer()`
and the extracted pieces call.

Both are legitimate; (b) is the standard React answer for a component this
size and is the approach recommended below.

## Recommended approach — layered extraction, verified at each layer

Do NOT attempt this in one pass. Each layer below is independently
shippable and independently revertable.

### Layer 0 — pure helpers (do this first, lowest risk, quick win)

Move the ~25 module-scope helper functions (lines 1–1,424) into a small
number of plain `.ts` utility modules, grouped by what they operate on:

- `designer/parsers.ts` — `parseSlides`, `parseSlideText`, `parseSlideButtons`,
  `parsePairs`, `stringifySlides`
- `designer/geometry.ts` — `dragPosition`, `nudgePosition`, `edgeGap`,
  `fitTextBox`, `fluidPreviewPx`
- `designer/style.ts` — `sectionBpStyle`-adjacent pure helpers that don't
  close over component state (`colStyle`, `elRadius`, `typoStyle`,
  `shadowToCss`, `hexToRgba`, `overlayColors`, `lengthValue`, `gapPx`)

Zero behavior risk — these are pure functions already. This alone removes
~1,400 lines (20%) from the file with a mechanical, easily-reviewed diff
(import statements + `export` keywords, nothing else changes).

**Verification**: typecheck + `pnpm build` (admin) + one manual click
through Designer in a browser (open a page, edit a slider, drag a button)
since there's no existing automated test for this file at all — see
"Testing gap" below.

### Layer 1 — extract the 4 giant render sub-functions

`FieldInput`, `FieldGroups`, `Inspector`, `ElPreview` together are ~2,660
lines (38% of the file). Each becomes its own file, taking an explicit
props object instead of reading the closure directly. This requires
enumerating exactly which outer variables each one currently reads/calls —
a careful, mechanical audit (search each function's body for identifiers
not declared inside it), not a design decision, but it takes real time to
do correctly and should be its own reviewed step, not bundled with Layer 2.

### Layer 2 — extract state + mutation logic into a custom hook

Everything else inside `Designer()` — the 50+ hooks and 100+ mutate/copy/
paste/duplicate/undo functions — becomes `useDesignerState(page)`, a
custom hook returning `{ blocks, sel, setSel, mutate, undo, redo,
duplicateSection, copyColumn, ...everything }`. `Designer()` itself
shrinks to something like:

```tsx
export default function Designer({ page, ... }) {
  const state = useDesignerState(page);
  return (
    <DesignerCanvas {...state} />
    <Inspector {...state} />
    ...
  );
}
```

This is the highest-value, highest-risk layer — get Layer 0 and Layer 1
landed and stable first before attempting it.

### Layer 3 (optional, only if Layer 2's hook is still too big)

Split `useDesignerState` further by concern: `useClipboard`,
`useUndoRedo`, `useSliderDrag`, `useLanguageState`, `useTemplateLibrary`.
Only do this if Layer 2's single hook is still unwieldy in practice —
don't pre-split speculatively.

## Testing gap (address before Layer 1)

There is currently **no automated test at all** for Designer.tsx — it's
pure UI, historically verified by manual click-through only. Before
Layer 1 (the first layer with real behavior-preservation risk), write one
Playwright E2E smoke test: create a page, drag in an element, set a style
property, save, reload, assert the layout persisted correctly. This is
the safety net that lets Layers 1–3 be verified by more than "typecheck
passed and it looked fine when I clicked around."

## Why deferred to a fresh session

This design was produced mid-session after an already very large amount
of unrelated work (blue-green deploy pipeline, infra rename, MFA/rate-
limit/audit-log security hardening) had already run up significant cost
and context in one continuous conversation. A refactor of this size and
risk — touching the page builder every tenant's site depends on —
deserves a session with full budget and a clean context window, not the
tail end of an already-long one. The user explicitly chose this option
when asked.

## Next step

Start a new session/conversation with this file as context, and invoke
the `writing-plans` skill against it to produce a concrete, step-by-step
implementation plan for Layer 0 first.
