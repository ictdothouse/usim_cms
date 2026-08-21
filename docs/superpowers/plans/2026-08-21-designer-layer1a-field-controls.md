# Designer.tsx Layer 1a — Field Controls & Field/FieldGroups Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue the Designer.tsx God Component refactor by extracting the field-schema types/tables, the 5 leaf field-control components, and the `FieldInput`/`FieldGroups` render functions out of `apps/admin/src/Designer.tsx` into `apps/admin/src/designer/` modules — with zero behavior change.

**Architecture:** This is "Layer 1a" of the layered plan in the spec below: a narrower, lower-risk slice of the spec's full "Layer 1" (which also includes `Inspector` and `ElPreview` — deliberately deferred, see Scope Note). Extraction proceeds leaf-first, exactly mirroring Layer 0's already-proven pattern: (1) move the shared field-schema types/const tables both target functions need (so neither extracted file has to import anything back from `Designer.tsx` — a circular import that Layer 0 never needed and this plan avoids on purpose), (2) move the 5 small hook-bearing-but-closure-free UI controls `FieldInput` renders, (3) move `FieldInput` itself, (4) move `FieldGroups` (which calls `FieldInput`), (5) rewire `Designer.tsx` to import both, delete the old declarations, (6) verify + document.

**Tech Stack:** Same as the rest of `apps/admin` — Vite + React 18 + TypeScript, `node:test` via `tsx --test` for anything pure/non-DOM (established in Layer 0), Tailwind classes unchanged.

**Spec:** `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md` (this plan implements the "FieldInput/FieldGroups" portion of that spec's "Layer 1"; "Inspector"/"ElPreview" and the spec's "Testing gap" Playwright E2E task are explicitly OUT of scope here — see Scope Note below for why).

## Global Constraints

- No behavior change. Every task is a mechanical move: an existing function/type/const's body is copied byte-identical into its new file; only the enclosing signature (adding explicit params for what used to be closure reads) and import statements change. Never rename an existing local variable inside a moved body — choose new parameter names that match the closure variable names exactly, so bodies need zero internal edits.
- **One-directional import rule** (this plan's own addition to the Layer 0 convention): files under `apps/admin/src/designer/` may import from each other and from `Designer.tsx`-external modules (`@/lib/api`, `@/lib/utils`, `@/i18n`, `lucide-react`), but must **never** import anything from `apps/admin/src/Designer.tsx` itself. `Designer.tsx` imports from `designer/*`, never the reverse. This is why Task 1 exists: `FieldInput`/`FieldGroups` need `Field`/`FieldKind`/`FieldGroupKey`/`TYPOGRAPHY_FIELDS`/`TEXT_BASE_PX`/`SHADOW_DEFAULT_PARTS`/`POSITION_PRESETS`/`FIELD_GROUP_BY_KEY`/`GROUP_META`, all currently declared inside `Designer.tsx` — so those move out first.
- Verification per task: `pnpm --filter @ucms/admin typecheck`, `pnpm --filter @ucms/admin build`, `pnpm --filter @ucms/admin test` (must stay at 19/19 passing, growing only if a task adds a test). React-component tasks (2, 3, 4) have no meaningful `node:test` coverage of their own (they're JSX-returning, hook-bearing, DOM-dependent) — for those, verification is typecheck + build + a manual Live-Edit/Blocks-canvas click-through (open a page in Designer, edit a text field, a color field, a font field, a shadow/number-stepper field, and — for Task 4 — expand/collapse a Grouped Styles card) confirming no visual/behavioral change. This mirrors exactly how Layer 0 verified its own non-pure-helper risk.
- Every new file gets the same top-of-file provenance comment style Layer 0 used in `designer/types.ts`/`style.ts`/`geometry.ts`/`parsers.ts` (one sentence naming what was split out and pointing at the spec).
- Commit after each task, following this repo's existing commit-message convention (`refactor(admin): ...`, `docs(admin): ...` — see `git log --oneline -10` for examples).

## Scope Note (read before objecting to what's missing)

The spec's "Layer 1" names 4 functions: `FieldInput`, `FieldGroups`, `Inspector`, `ElPreview`. This plan covers only the first two. A closure audit (done before writing this plan) found:

- `FieldInput` (~30 closure deps) and `FieldGroups` (~10 closure deps) are both **hook-free** — every stateful value they touch is read from `Designer()`'s closure, never created by a hook of their own — and neither one owns any of `Designer()`'s heavy mutation machinery (`mutate`, `undo`/`redo`, the ~40 copy/paste/duplicate functions). They're the same risk class Layer 0's pure helpers were: bigger, but mechanically the same kind of move.
- `Inspector` (~55+ closure deps, including `mutate`/`section` called dozens of times and 25 other Designer()-nested mutator functions) and `ElPreview` (~45 closure deps including 3 refs and the slider drag/resize/smart-guide logic) are a different, much higher risk class — extracting either means threading dozens of props, several of which are themselves large function references, and the spec's own "Testing gap" section explicitly calls for a Playwright E2E smoke test before attempting this tier ("the first layer with real behavior-preservation risk").

Narrowing this plan to the two hook-free, mutation-free functions — same kind of deliberate scope-narrowing Layer 0 already did (25 functions named in the spec → 18 actually moved) — keeps this slice mechanical and low-risk. `Inspector`/`ElPreview` extraction, plus the Playwright E2E smoke test the spec asks for first, is follow-up work for a **separate** "Layer 1b" plan — do not fold it into this one.

---

### Task 1: Move field-schema types and lookup tables into `designer/` modules

**Files:**
- Modify: `apps/admin/src/designer/types.ts` (add `Field`, `FieldKind`, `FieldGroupKey` type exports)
- Create: `apps/admin/src/designer/fields.ts` (the const lookup tables)
- Modify: `apps/admin/src/Designer.tsx` (delete the moved declarations, add imports)

**Interfaces:**
- Produces: `Field`, `FieldKind`, `FieldGroupKey` (types, from `designer/types.ts`); `TYPOGRAPHY_FIELDS: Field[]`, `TEXT_BASE_PX: {heading:number;subtitle:number}`, `SHADOW_DEFAULT_PARTS: readonly [string,string,string,string,string,string]`, `POSITION_PRESETS: {x:string;y:string}[]`, `FIELD_GROUP_BY_KEY: Record<string, FieldGroupKey>`, `GROUP_META: {key:FieldGroupKey; labelKey:Key; icon:typeof Type}[]` (consts, from `designer/fields.ts`). Tasks 2-4 consume all of these.

- [ ] **Step 1: Read the current exact text to move**

Run (from repo root):
```bash
grep -n "^type FieldKind\|^interface Field {\|^type FieldGroupKey\|^const TYPOGRAPHY_FIELDS\|^const FIELD_GROUP_BY_KEY\|^const GROUP_META\|^const SHADOW_DEFAULT_PARTS\|^const TEXT_BASE_PX\|^const POSITION_PRESETS" apps/admin/src/Designer.tsx
```
Confirm each still matches this plan's line numbers below (297, 312, 498, 832, 834, 857, 873, 882, 893) — if the file has drifted, use the grep output's line numbers instead; the text being moved does not change either way.

- [ ] **Step 2: Append the two types to `apps/admin/src/designer/types.ts`**

Add at the end of the file (after the existing `export type GapMark = ...` line):

```ts

// Field-schema types for the Inspector's data-driven field renderer
// (FieldInput/FieldGroups) — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) so
// FieldInput.tsx/FieldGroups.tsx/fields.ts can share them without importing
// back from Designer.tsx.
export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "color"
  | "image"
  | "gallery"
  | "length"
  | "icon"
  | "shadow"
  | "pairs"
  | "slides"
  | "font"
  | "stepper"
  | "menu-select";

export interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
  // "pairs" kind only: i18n keys for the two sub-field placeholders (e.g. Question/Answer vs Label/Content).
  subLabels?: [Key, Key];
  // "stepper" kind only: +/- nudge amount (default 1 if omitted).
  step?: number;
}

// Grouped Styles panel (Framer/Webflow-style) bucket key — keyed by
// field.key since that's stable across section/column/element, unlike
// labelKey which a few fields share for unrelated purposes.
export type FieldGroupKey = "content" | "typography" | "background" | "spacing" | "size" | "appearance" | "border" | "advanced";
```

Add this import at the top of `designer/types.ts` (the file currently has none — it's pure declarations with no external type refs yet):

```ts
import type { Key } from "@/i18n";
```

- [ ] **Step 3: Run typecheck to verify `types.ts` alone still compiles**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: still fails on `Designer.tsx` (the old declarations there are now duplicated — that's expected, fixed in Step 6) but `designer/types.ts` itself must show no error attributable to its own content.

- [ ] **Step 4: Create `apps/admin/src/designer/fields.ts`**

```ts
// Field-schema lookup tables for the Inspector's data-driven field renderer
// (FieldInput/FieldGroups) — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
import { Baseline, Blend, Frame, Hash, PaintBucket, RectangleHorizontal, Square, Type } from "lucide-react";
import type { Key } from "@/i18n";
import type { Field, FieldGroupKey } from "./types";

// Shared across heading/text/list — full typography control. fontFamily is
// any Google Font name; see the useEffect near Designer()'s own body that
// keeps a matching <link> synced into document.head for canvas preview.
export const TYPOGRAPHY_FIELDS: Field[] = [
  { key: "fontFamily", labelKey: "designer-f-fontfamily", kind: "font" },
  { key: "color", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "lineHeight", labelKey: "designer-f-lineheight", kind: "stepper", step: 0.1 },
  { key: "letterSpacing", labelKey: "designer-f-letterspacing", kind: "stepper", step: 0.5 },
  { key: "fontWeight", labelKey: "designer-f-fontweight", kind: "select", options: ["400", "500", "600", "700", "800"] },
  {
    key: "textTransform",
    labelKey: "designer-f-texttransform",
    kind: "select",
    options: ["none", "uppercase", "lowercase", "capitalize"],
  },
  { key: "fontStyle", labelKey: "designer-f-fontstyle", kind: "select", options: ["normal", "italic"] },
  {
    key: "textDecoration",
    labelKey: "designer-f-textdecoration",
    kind: "select",
    options: ["none", "underline", "line-through"],
  },
];

// Grouped Styles panel (Framer/Webflow-style): buckets the same flat Field
// lists (SECTION_FIELDS/COLUMN_FIELDS/ELS[type].fields, still in
// Designer.tsx) into collapsible sections by what the field actually
// controls, instead of one long form.
export const FIELD_GROUP_BY_KEY: Record<string, FieldGroupKey> = {
  text: "content", src: "content", alt: "content", href: "content", label: "content",
  url: "content", name: "content", items: "content", html: "content", images: "content",
  variant: "content", style: "content",
  // "menu" element only — menuId/dropdownTrigger/megaMenuWidth are new keys,
  // no collision with any other element's fields. `layout` is also new (no
  // other element uses that key name) but isn't listed here: the lookup
  // already falls back to "content" for any unmapped key (see the `?? "content"`
  // default in FieldGroups), so it lands in the same group either way.
  menuId: "content", dropdownTrigger: "content", megaMenuWidth: "content",
  fontFamily: "typography", color: "typography", lineHeight: "typography",
  letterSpacing: "typography", fontWeight: "typography", level: "typography", align: "typography",
  textTransform: "typography", fontStyle: "typography", textDecoration: "typography",
  bg: "background", bgImage: "background", textColor: "background",
  paddingY: "spacing", paddingX: "spacing", padding: "spacing", marginY: "spacing",
  width: "size", valign: "size", height: "size", ratio: "size", columns: "size", size: "size",
  // Figma-style split: Appearance (opacity/shadow/radius — visual effects)
  // vs Stroke (the actual border color/width/style), each its own card.
  opacity: "appearance", shadow: "appearance", radius: "appearance",
  border: "border", borderWidth: "border", borderColor: "border", borderStyle: "border",
  anchorId: "advanced", cssClass: "advanced",
};

export const GROUP_META: { key: FieldGroupKey; labelKey: Key; icon: typeof Type }[] = [
  { key: "content", labelKey: "designer-group-content", icon: Type },
  { key: "typography", labelKey: "designer-group-typography", icon: Baseline },
  { key: "background", labelKey: "designer-group-background", icon: PaintBucket },
  { key: "spacing", labelKey: "designer-group-spacing", icon: Frame },
  { key: "size", labelKey: "designer-group-size", icon: RectangleHorizontal },
  { key: "appearance", labelKey: "designer-group-appearance", icon: Blend },
  { key: "border", labelKey: "designer-group-border", icon: Square },
  { key: "advanced", labelKey: "designer-group-advanced", icon: Hash },
];

// Seed values a freshly-added shadow starts from — visually close to the old
// "md" preset, so switching a legacy preset into the new panel doesn't jump.
export const SHADOW_DEFAULT_PARTS = ["0", "4", "12", "0", "#000000", "0.12"] as const;

// Baseline px used as the canvas resize handle's starting point when
// heading/subtitle (slider element) have no explicit fontSize yet.
export const TEXT_BASE_PX = { heading: 20, subtitle: 13 };

// 3x3 anchor grid offered as one-click shortcuts for a slide button/heading/
// subtitle's custom x/y — clicking a dot just sets x/y to a canonical spot
// and switches position to "custom"; there's no separate named-preset enum
// to keep in sync between admin/frontend/validator, presets are purely a UI
// convenience over the same x/y percent every custom-dragged item already uses.
export const POSITION_PRESETS: { x: string; y: string }[] = [
  { x: "10", y: "15" }, { x: "50", y: "15" }, { x: "90", y: "15" },
  { x: "10", y: "50" }, { x: "50", y: "50" }, { x: "90", y: "50" },
  { x: "10", y: "85" }, { x: "50", y: "85" }, { x: "90", y: "85" },
];
```

- [ ] **Step 5: Fix the now-stale comment in `designer/types.ts`**

`SlideText`'s doc-comment currently says: `// Typography fields mirror TYPOGRAPHY_FIELDS' own keys/options exactly\n// (defined in Designer.tsx) so the Inspector can render them...`. Change `(defined in Designer.tsx)` to `(defined in designer/fields.ts)` — this is exactly the kind of stale cross-reference Layer 0's final review caught once already; fix it in the same commit that moves the const it refers to instead of leaving it to a future review pass.

- [ ] **Step 6: Delete the moved declarations from `Designer.tsx` and import them back**

Delete these blocks entirely from `apps/admin/src/Designer.tsx` (use the line numbers Step 1's grep reported):
- The `type FieldKind = ...;` union (originally lines 297-311) and the `interface Field { ... }` right after it (originally lines 312-321).
- The `type FieldGroupKey = ...;` line (originally line 832) and its preceding 6-line comment block.
- The `const FIELD_GROUP_BY_KEY: Record<string, FieldGroupKey> = { ... };` block (originally lines 834-855) and its preceding 6-line comment.
- The `const GROUP_META: ... = [ ... ];` block (originally lines 857-866).
- The `const SHADOW_DEFAULT_PARTS = [...] as const;` line (originally line 873) and its preceding comment line.
- The `const TEXT_BASE_PX = { heading: 20, subtitle: 13 };` line (originally line 882) and its preceding comment lines.
- The `const POSITION_PRESETS: ... = [ ... ];` block (originally lines 893-897) and its preceding comment block.
- The `const TYPOGRAPHY_FIELDS: Field[] = [ ... ];` block (originally lines 498-517) and its preceding comment line.

Do **not** delete `CSS_CLASS_FIELD` (line 825) — it stays in `Designer.tsx` (it's not needed by `FieldInput`/`FieldGroups`, only by `Inspector`, which is out of scope here).

Add to the top-of-file import block (after the existing `import { PAD, RADIUS, ... } from "./designer/style";` line):

```ts
import type { Field, FieldKind, FieldGroupKey } from "./designer/types";
import { TYPOGRAPHY_FIELDS, TEXT_BASE_PX, SHADOW_DEFAULT_PARTS, POSITION_PRESETS, FIELD_GROUP_BY_KEY, GROUP_META } from "./designer/fields";
```

`Designer.tsx` still uses all 6 of these consts (in `Inspector`/`ElPreview`/`FieldGroups`, all still physically in this file until Tasks 2-4 move them out) plus `Field`/`FieldGroupKey` as types throughout (`ELS`, `SECTION_FIELDS`, `COLUMN_FIELDS`, `CSS_CLASS_FIELD`, etc.) — importing them back is required, not optional.

Remove the now-orphaned lucide-react icon imports if `Baseline`/`Blend`/`Hash` are no longer referenced anywhere else in `Designer.tsx` after deleting `GROUP_META` (check with `grep -n "Baseline\|Blend\|Hash" apps/admin/src/Designer.tsx` — if any of the 3 still appears outside the deleted block, keep that one). `Type`/`PaintBucket`/`Frame`/`RectangleHorizontal`/`Square` are all still used elsewhere in the file (e.g. `FIELD_ICONS`, `FourSideControl` calls) — do not remove those.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @ucms/admin typecheck && pnpm --filter @ucms/admin build && pnpm --filter @ucms/admin test`
Expected: typecheck clean, build succeeds, test output still `# pass 19`.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/designer/types.ts apps/admin/src/designer/fields.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): move field-schema types/tables into designer/types.ts + designer/fields.ts"
```

---

### Task 2: Extract the 5 leaf field-control components to `designer/FieldControls.tsx`

**Files:**
- Create: `apps/admin/src/designer/FieldControls.tsx`
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 directly (these 5 components have no `Field`/`FieldGroupKey` dependency).
- Produces: `BufferedInput`, `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, `BpToggle` (all exported function components, from `designer/FieldControls.tsx`). `BpToggle`'s signature changes — see Step 2 — this is the one non-purely-mechanical edit in this task; every call site must be updated in the same commit (Step 4).

- [ ] **Step 1: Locate the current text to move**

Run: `grep -n "^  function BufferedInput\|^  function BufferedTextarea\|^  function FontPickerInput\|^  function NumberStepper\|^  function BpToggle" apps/admin/src/Designer.tsx`

These 5 are declared back-to-back inside `Designer()`'s body (originally lines 3364-3572, in this order: `BufferedInput`, `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, [FourSideControl, unrelated, stays], `BpToggle`). Note `BpToggle` is declared a little further down (originally line 3556), separated from the other 4 by `FourSideControl` (originally line 3574, which does **not** move — it stays in `Designer.tsx`, it's `Inspector`-only, Layer 1b scope) — move `BpToggle` on its own, leaving `FourSideControl` in place between where `NumberStepper` and `BpToggle` used to be.

- [ ] **Step 2: Create `apps/admin/src/designer/FieldControls.tsx`**

```tsx
// Small, closure-free leaf field-control components used by FieldInput and
// FourSideControl — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md). Each
// one holds its own useState/useRef and reads nothing from Designer()'s
// closure except BpToggle, which now takes `bp`/`t` as explicit props
// instead (see its signature below) — its 6 call sites in Designer.tsx were
// all updated in the same commit that created this file.
import { useEffect, useRef, useState } from "react";
import { Smartphone, Tablet } from "lucide-react";
import { GOOGLE_FONTS } from "@/lib/utils";
import type { Key } from "@/i18n";
import type { Bp } from "./types";

export function BufferedInput({
  value,
  onCommit,
  className,
  type,
  placeholder,
  title,
  step,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  type?: string;
  placeholder?: string;
  title?: string;
  step?: number;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      type={type}
      step={step}
      className={className}
      placeholder={placeholder}
      title={title}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

export function BufferedTextarea({
  value,
  onCommit,
  className,
  rows,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      rows={rows}
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

// Typeable/scrollable Google Font picker — mirrors App.tsx's ThemeForm
// FontField exactly (typing filters a dropdown of matches, each option
// rendered in its own font-family so it previews rather than just naming
// itself), but with no <label> of its own since FieldInput's other kinds
// are bare controls — FieldGroups/renderTypographyFields already render
// the field's label above it.
export function FontPickerInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const matches = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(value.toLowerCase()));
  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Poppins"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line/30 bg-white shadow-lg">
          {matches.map((f) => (
            <li key={f}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                style={{ fontFamily: f }}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "Volume up/down" style numeric stepper — a BufferedInput flanked by
// −/+ buttons, used by the shadow panel's X/Y/blur/spread fields (no
// preset dropdown; user explicitly asked for real numbers here).
export function NumberStepper({
  label,
  value,
  step = 1,
  min,
  onCommit,
}: {
  label: string;
  value: string;
  step?: number;
  min?: number;
  onCommit: (v: string) => void;
}) {
  const n = Number(value) || 0;
  const round = (x: number) => Math.round(x * 100) / 100;
  return (
    <label className="block text-[10px] font-medium text-sub">
      {label}
      <div className="mt-0.5 flex items-center rounded-lg border border-line/30 bg-canvas">
        <button
          type="button"
          onClick={() => onCommit(String(round(Math.max(min ?? -Infinity, n - step))))}
          className="px-2 py-1 text-sub hover:text-ink"
        >
          −
        </button>
        <BufferedInput
          type="number"
          step={step}
          value={value}
          onCommit={onCommit}
          className="w-full border-0 bg-transparent px-1 py-1 text-center text-[11px] outline-none"
        />
        <button type="button" onClick={() => onCommit(String(round(n + step)))} className="px-2 py-1 text-sub hover:text-ink">
          +
        </button>
      </div>
    </label>
  );
}

// Elementor/Webflow-style per-field responsive toggle: a small Tablet/
// Smartphone icon next to a setting's own label, filled/accent when THIS
// field (or, for FourSideControl, any of its side keys) actually has an
// override at the current bp, muted/outline when it's just inheriting the
// desktop value. Clicking toggles between the two — enabling seeds the
// override at "" (falls through to the normal default-preset resolution
// until typed over), disabling removes it. Renders nothing on desktop —
// there's nothing to override against on the base breakpoint itself.
// `bp`/`t` are explicit props (not read from a Designer() closure) since
// this component now lives outside Designer.tsx — every call site passes
// Designer()'s own `bp` state and `t` prop through unchanged.
export function BpToggle({
  active,
  onToggle,
  bp,
  t,
}: {
  active: boolean;
  onToggle: () => void;
  bp: Bp;
  t: (k: Key) => string;
}) {
  if (bp === "desktop") return null;
  const Icon = bp === "tablet" ? Tablet : Smartphone;
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onToggle();
      }}
      title={t(active ? "designer-bp-override-clear" : "designer-bp-override-set")}
      className={`inline-flex rounded p-0.5 ${active ? "text-accent" : "text-sub/40 hover:text-sub"}`}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
```

- [ ] **Step 3: Add the `Bp` type to `designer/types.ts`**

`Designer()`'s `bp` state (`const [bp, setBp] = useState<"desktop" | "tablet" | "mobile">("desktop")`) has no named type today — it's inline. Add one so `FieldControls.tsx` (and later `FieldInput.tsx`) can reference it without duplicating the literal union. Append to `apps/admin/src/designer/types.ts`:

```ts

// Designer()'s canvas breakpoint-preview state — named here so files split
// out of Designer.tsx can type a `bp` prop without duplicating the literal
// union `Designer()` itself still declares inline via `useState<Bp>(...)`.
export type Bp = "desktop" | "tablet" | "mobile";
```

- [ ] **Step 4: Delete the 5 declarations from `Designer.tsx`, import them, and update every `BpToggle` call site**

Delete `BufferedInput`, `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, and `BpToggle`'s function declarations from `Designer.tsx` (keep `FourSideControl`, which sits between `NumberStepper` and `BpToggle` today — it stays).

Add to the import block:
```ts
import { BufferedInput, BufferedTextarea, FontPickerInput, NumberStepper, BpToggle } from "./designer/FieldControls";
```

Update every `<BpToggle .../>` JSX call site in `Designer.tsx` to add the two new props — there are 6, find them with `grep -n "<BpToggle" apps/admin/src/Designer.tsx`:
- 3 inside `FieldInput`'s body (the slide heading/subtitle align + fontSize fields) — change `<BpToggle active={...} onToggle={...} />` to `<BpToggle active={...} onToggle={...} bp={bp} t={t} />` at each.
- 1 inside `FourSideControl`'s body (`<BpToggle active={hasOverride} onToggle={onToggleOverride} />`) — `FourSideControl` doesn't currently take `bp`/`t` as its own params either; add them: change `FourSideControl`'s destructured param list to also include `bp: Bp; t: (k: Key) => string;`, and update `FourSideControl`'s own call sites (11 of them, all inside `Inspector`, all still in `Designer.tsx`) to pass `bp={bp} t={t}` — `Inspector` already has both in scope via its own closure, so this is purely additive at each JSX call site. Then fix `FourSideControl`'s own `<BpToggle active={hasOverride} onToggle={onToggleOverride} />` to `<BpToggle active={hasOverride} onToggle={onToggleOverride} bp={bp} t={t} />` using its own new params.
- 1 inside `FieldGroups`'s body (`<BpToggle active={hasOverride(f)} onToggle={() => onToggleOverride(f)} />`) — same fix: `bp={bp} t={t}`. (`FieldGroups` still lives in `Designer.tsx` at this point — Task 4 moves it — so `bp`/`t` are still directly in scope here via the closure; no signature change needed for `FieldGroups` itself yet.)

Import `Bp` alongside the other `designer/types` imports already at the top of `Designer.tsx`: extend the existing `import type { SlideButton, SlideItem, Positionable, SlideText, EdgeRect, GapMark } from "./designer/types";` line to also include `Bp`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @ucms/admin typecheck && pnpm --filter @ucms/admin build && pnpm --filter @ucms/admin test`
Expected: clean typecheck (this step is where a missed `BpToggle` call site shows up as a TS error — "Property 'bp' is missing" — trust the compiler here), build succeeds, tests still 19/19.

- [ ] **Step 6: Manual smoke check**

Start the admin dev server (`pnpm --filter @ucms/admin dev`) and, in Designer, open any page, select an element with a color/text field (confirms `BufferedInput` unaffected), open the Typography section and check a font field (confirms `FontPickerInput`), open a shadow field's X/Y/blur/spread controls (confirms `NumberStepper`), and — with the canvas breakpoint switched to Tablet or Mobile — confirm the small Tablet/Smartphone override icon still appears next to an overridable field and still toggles (confirms `BpToggle`'s new props are wired correctly everywhere).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/designer/types.ts apps/admin/src/designer/FieldControls.tsx apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract BufferedInput/BufferedTextarea/FontPickerInput/NumberStepper/BpToggle to designer/FieldControls.tsx"
```

---

### Task 3: Extract `FieldInput` to `designer/FieldInput.tsx`

**Files:**
- Create: `apps/admin/src/designer/FieldInput.tsx`
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: `Field`, `FieldKind`, `Bp`, `Positionable`, `SlideItem`, `SlideButton`, `SlideText` (types, `designer/types`); `TYPOGRAPHY_FIELDS`, `TEXT_BASE_PX`, `SHADOW_DEFAULT_PARTS`, `POSITION_PRESETS` (`designer/fields`, Task 1); `BufferedInput`, `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, `BpToggle` (`designer/FieldControls`, Task 2); `parsePairs`, `parseSlides`, `stringifySlides`, `TEXT_DEFAULTS`, `SLIDE_DEFAULTS`, `BUTTON_DEFAULTS` (`designer/parsers`, Layer 0); `dragPosition`, `nudgePosition` (`designer/geometry`, Layer 0); `bestTextColor` (`@/lib/utils`).
- Produces: `export function FieldInput(props: FieldInputProps): JSX.Element` from `designer/FieldInput.tsx`, where:
  ```ts
  export interface FieldInputProps {
    field: Field;
    value: string;
    onChange: (v: string) => void;
    iconSearch: string;
    setIconSearch: (v: string) => void;
    uploading: string | null;
    siteTheme: { primaryColor?: string } | null | undefined;
    sel: number[] | null;
    blocks: unknown[]; // same `blocks` type Designer() itself uses — copy the exact type Designer() declares for its own `blocks` state instead of widening to unknown; see Step 2 note
    sliderSlideIdx: Record<string, number>;
    setSliderSlideIdx: (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
    bp: Bp;
    t: (k: Key) => string;
    uploadImage: (file: File, setValue: (v: string) => void) => void;
    bpGetValue: (base: string, bag: Record<string, string> | undefined, key: string) => string;
    bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
    toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[], setBag: (v: Record<string, string>) => void) => void;
    bpKey: (bp: Bp, key: string) => string;
  }
  ```
  Later tasks (4, 5) consume `FieldInput` and `FieldInputProps` by name.

- [ ] **Step 1: Confirm `FieldInput`'s exact current signatures**

Run: `grep -n "^  function FieldInput\|^  function uploadImage\|^  function bpGetValue\|^  function bpKeysOverridden\|^  function toggleBpKeys\|^  function bpKey" apps/admin/src/Designer.tsx`

Read the exact current parameter types for `uploadImage`, `bpGetValue`, `bpKeysOverridden`, `toggleBpKeys`, `bpKey`, and the exact declared types of the `blocks`/`sel`/`siteTheme`/`uploading`/`sliderSlideIdx` state (their `useState<...>` type arguments, or their inferred type from the initializer if no explicit type argument is given) directly from `Designer.tsx` before writing `FieldInputProps` — the shapes sketched in this task's Interfaces block above are a close approximation from the closure audit, not necessarily character-exact; match what `Designer.tsx` actually declares.

- [ ] **Step 2: Create `apps/admin/src/designer/FieldInput.tsx`**

Add this file header:
```tsx
// The Inspector's data-driven field renderer — one function that switches
// on `field.kind` and renders the right control (text/color/image/gallery/
// length/icon/shadow/pairs/slides/font/stepper/menu-select). Split out of
// Designer.tsx (Layer 1a of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) —
// FieldInput itself holds no hooks (verified during the Layer 1a closure
// audit), so it's still safe to call as a plain function `FieldInput({...})`
// from inside a .map() the same way it always was inside Designer.tsx.
```

Then the imports (Step 3) and the function body (Step 4) go below this header, in that order.

- [ ] **Step 3: Write the import block**

```tsx
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, Minus, Plus } from "lucide-react";
import type { Key } from "@/i18n";
import { bestTextColor } from "@/lib/utils";
import type { Field, Bp, Positionable, SlideItem, SlideButton, SlideText } from "./types";
import { TYPOGRAPHY_FIELDS, TEXT_BASE_PX, SHADOW_DEFAULT_PARTS, POSITION_PRESETS } from "./fields";
import { BufferedInput, BufferedTextarea, FontPickerInput, NumberStepper, BpToggle } from "./FieldControls";
import { parsePairs, parseSlides, stringifySlides, TEXT_DEFAULTS, SLIDE_DEFAULTS, BUTTON_DEFAULTS } from "./parsers";
import { dragPosition, nudgePosition } from "./geometry";
```
Cross-check this list against Step 1's actual read of `FieldInput`'s body (grep for every identifier this plan's closure audit named: `iconSearch`, `uploading`, `siteTheme`, `sel`, `blocks`, `sliderSlideIdx`, `setIconSearch`, `setSliderSlideIdx`, `uploadImage`, `bpGetValue`, `bpKeysOverridden`, `toggleBpKeys`, `bpKey`, `AlignLeft`, `AlignCenter`, `AlignRight`, `AlignJustify`, `Check`, `Minus`, `Plus`, `parsePairs`, `parseSlides`, `stringifySlides`, `TEXT_DEFAULTS`, `SLIDE_DEFAULTS`, `BUTTON_DEFAULTS`, `dragPosition`, `nudgePosition`, `bestTextColor`, `POSITION_PRESETS`, `TEXT_BASE_PX`, `TYPOGRAPHY_FIELDS`, `SHADOW_DEFAULT_PARTS`) — if any is missing from this import list, add it; this list is not allowed to drift from what the body in Step 1 actually uses.

- [ ] **Step 4: Move the function body verbatim, changing only its signature**

In `Designer.tsx`, `FieldInput`'s current declaration line is:
```ts
function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
```
Cut everything from this line through its matching closing `}` (immediately before whatever function declaration now follows it, per Task 2's edits — use the closing brace as the actual boundary, not a specific following declaration name, since Task 2 may have changed what's adjacent). Paste it into `designer/FieldInput.tsx`, then change **only** the signature line to:
```ts
export function FieldInput({
  field, value, onChange,
  iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
  bp, t, uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
}: FieldInputProps) {
```
and add the `FieldInputProps` interface (Step 1's confirmed types) directly above this function in the same file. The entire body between the old opening `{` and the closing `}` stays byte-for-byte identical — every closure identifier it references now resolves to a same-named parameter instead of a closure variable, so no reference inside the body needs editing.

- [ ] **Step 5: Delete `FieldInput` from `Designer.tsx` and update its call sites**

Delete the old `function FieldInput({ field, value, onChange }: {...}) { ... }` block from `Designer.tsx` (now moved).

Add to the import block: `import { FieldInput } from "./designer/FieldInput";` (do not import `FieldInputProps` — `Designer.tsx` never constructs that type by name, it just calls `FieldInput({...})` with an inline object literal same as before).

`FieldInput`'s 3 in-body-of-itself call sites (self-recursive, originally lines 2968/3081/3129) moved WITH it in Step 4 — they already only pass `{ field, value, onChange }` today; leave them exactly as-is, self-recursion doesn't need the extra closure props threaded through again since the recursive call is made from inside a function that already has all of them in scope as its own parameters now.

Update the ONE remaining call site still inside `Designer.tsx`: `FieldGroups`'s own body (still in `Designer.tsx` until Task 4) calls `FieldInput({ field: f, value: getValue(f), onChange: (v) => setValue(f, v) })` (originally line 3695). Change this call to pass every prop `FieldInputProps` now requires:
```ts
FieldInput({
  field: f, value: getValue(f), onChange: (v) => setValue(f, v),
  iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
  bp, t, uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
})
```
(`FieldGroups` is still inside `Designer()`'s closure at this point, so all of these are directly available to write inline here — no new params needed on `FieldGroups` itself yet; that comes in Task 4.)

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin typecheck && pnpm --filter @ucms/admin build && pnpm --filter @ucms/admin test`
Expected: clean typecheck, successful build, 19/19 tests.

- [ ] **Step 7: Manual smoke check**

In Designer, exercise every `field.kind` branch at least once: a text field, a color field, an image field (upload UI), a gallery field, a length field, an icon field, a shadow field, a pairs field (accordion/tabs items editor), a slides field (slider element — image upload, per-slide button add, heading/subtitle align+size), a font field, a stepper field, and a menu-select field. This is the one function in this plan with genuinely many branches — the point of clicking through all of them is confirming the signature change didn't silently drop a closure value in one specific branch that Task 3's Step 4 verbatim-body-copy should have preserved automatically, but is worth confirming by hand given how large this function is.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/designer/FieldInput.tsx apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract FieldInput to designer/FieldInput.tsx"
```

---

### Task 4: Extract `FieldGroups` to `designer/FieldGroups.tsx`

**Files:**
- Create: `apps/admin/src/designer/FieldGroups.tsx`
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: `Field`, `FieldGroupKey`, `Bp` (`designer/types`); `FIELD_GROUP_BY_KEY`, `GROUP_META` (`designer/fields`, Task 1); `BpToggle` (`designer/FieldControls`, Task 2); `FieldInput`, `FieldInputProps` (`designer/FieldInput`, Task 3) — `FieldGroups` needs every field the props-threading in Task 3 added, since it's the one that actually calls `FieldInput`.
- Produces: `export function FieldGroups(props: FieldGroupsProps): JSX.Element`, where:
  ```ts
  export interface FieldGroupsProps {
    fields: Field[];
    getValue: (f: Field) => string;
    setValue: (f: Field, v: string) => void;
    only?: "content" | "style";
    hasOverride?: (f: Field) => boolean;
    onToggleOverride?: (f: Field) => void;
    collapsedGroups: Set<FieldGroupKey>;
    toggleGroup: (g: FieldGroupKey) => void;
    bp: Bp;
    t: (k: Key) => string;
    // Every FieldInputProps field EXCEPT field/value/onChange (FieldGroups
    // supplies those 3 itself per-field from `fields`/`getValue`/`setValue`
    // above) — threaded through so FieldGroups can forward them into each
    // FieldInput call. bp/t are already listed once above; do not duplicate.
    iconSearch: string;
    setIconSearch: (v: string) => void;
    uploading: string | null;
    siteTheme: { primaryColor?: string } | null | undefined;
    sel: number[] | null;
    blocks: unknown[];
    sliderSlideIdx: Record<string, number>;
    setSliderSlideIdx: (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
    uploadImage: (file: File, setValue: (v: string) => void) => void;
    bpGetValue: (base: string, bag: Record<string, string> | undefined, key: string) => string;
    bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
    toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[], setBag: (v: Record<string, string>) => void) => void;
    bpKey: (bp: Bp, key: string) => string;
  }
  ```
  Task 5 (Inspector's 4 call sites, still in `Designer.tsx`) consumes `FieldGroups`/`FieldGroupsProps` by name.

- [ ] **Step 1: Confirm exact current signature**

Run: `grep -n "^  function FieldGroups\|^  function toggleGroup" apps/admin/src/Designer.tsx`, read `toggleGroup`'s exact signature and `collapsedGroups`'s exact `useState` type from `Designer.tsx`.

- [ ] **Step 2: Create `apps/admin/src/designer/FieldGroups.tsx`**

```tsx
// Buckets a flat Field[] list into the Grouped Styles panel's collapsible
// sections (content/typography/background/spacing/size/appearance/border/
// advanced) and renders each field via FieldInput. Split out of Designer.tsx
// (Layer 1a of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) —
// FieldGroups itself holds no hooks (verified during the Layer 1a closure
// audit), so it's still safe to call from Inspector exactly as before.
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Key } from "@/i18n";
import type { Field, FieldGroupKey, Bp } from "./types";
import { FIELD_GROUP_BY_KEY, GROUP_META, FieldLabel } from "./fields";
import { BpToggle } from "./FieldControls";
import { FieldInput, type FieldInputProps } from "./FieldInput";
```
(The `FieldLabel` import above assumes Step 3 has already moved it into `designer/fields.ts` — do Step 3 before relying on this line.)

- [ ] **Step 3: Resolve the `FieldLabel` dependency without a circular import**

`FieldGroups` calls `FieldLabel(f.labelKey, t)` (a small module-scope function in `Designer.tsx`, currently around line 372, that turns a `Key` + the `t` function into a label string — check with `grep -n "^function FieldLabel" apps/admin/src/Designer.tsx`). `Designer.tsx` cannot be imported from inside `designer/FieldGroups.tsx` (this plan's Global Constraints one-directional rule) — so `FieldLabel` must move too. Read its current body, then:
1. Add it, exported, to `apps/admin/src/designer/fields.ts` (it's a field-schema-label helper, the same concern that file already owns) — keep its body byte-identical, just add `export` in front of `function FieldLabel(...)`.
2. Delete it from `Designer.tsx`.
3. Add `import { FieldLabel } from "./designer/fields";` to `Designer.tsx`'s import block (it's still called elsewhere in `Designer.tsx` — `Inspector`'s own `FieldLabel("designer-col-span", t)` call — so the import is required there too, not just removed).

- [ ] **Step 4: Move the function body verbatim, changing only its signature**

Cut `FieldGroups`'s current body (from `function FieldGroups({ fields, getValue, setValue, only, hasOverride, onToggleOverride }: {...}) {` through its matching closing `}`) out of `Designer.tsx`, paste into `designer/FieldGroups.tsx`, and change only the signature to:
```ts
export function FieldGroups({
  fields, getValue, setValue, only, hasOverride, onToggleOverride,
  collapsedGroups, toggleGroup, bp, t,
  iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
  uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
}: FieldGroupsProps) {
```
Add the `FieldGroupsProps` interface (from this task's Interfaces block) directly above. Inside the body, the one line that calls `FieldInput` (`{FieldInput({ field: f, value: getValue(f), onChange: (v) => setValue(f, v) })}`) must be updated to forward every field-level prop through — change it to:
```tsx
{FieldInput({
  field: f, value: getValue(f), onChange: (v) => setValue(f, v),
  iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
  bp, t, uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
})}
```
This is the one line inside the moved body that is not byte-identical to the original — call it out explicitly in the implementer's self-review notes (every other line is an untouched move).

- [ ] **Step 5: Delete `FieldGroups` from `Designer.tsx` and update its 4 call sites**

Delete the old `function FieldGroups({...}) { ... }` block from `Designer.tsx`.

Add to the import block: `import { FieldGroups, type FieldGroupsProps } from "./designer/FieldGroups";`

Update all 4 `<FieldGroups .../>` JSX call sites inside `Inspector` (still in `Designer.tsx` — find them with `grep -n "<FieldGroups" apps/admin/src/Designer.tsx`) to add the newly-required props. Every one of these sites is inside `Inspector`, which still has direct closure access to everything needed, so this is purely additive — e.g. the Section panel's call:
```tsx
<FieldGroups
  fields={SECTION_FIELDS} getValue={...} setValue={...} hasOverride={...} onToggleOverride={...}
  collapsedGroups={collapsedGroups} toggleGroup={toggleGroup} bp={bp} t={t}
  iconSearch={iconSearch} setIconSearch={setIconSearch} uploading={uploading} siteTheme={siteTheme}
  sel={sel} blocks={blocks} sliderSlideIdx={sliderSlideIdx} setSliderSlideIdx={setSliderSlideIdx}
  uploadImage={uploadImage} bpGetValue={bpGetValue} bpKeysOverridden={bpKeysOverridden}
  toggleBpKeys={toggleBpKeys} bpKey={bpKey}
/>
```
Apply the same added-props block (everything from `collapsedGroups={collapsedGroups}` onward) to the other 3 call sites (Column panel, Element Style pane, Element Content tab) — those props don't vary by call site, only `fields`/`getValue`/`setValue`/`only`/`hasOverride`/`onToggleOverride` do (already correct at each site today).

- [ ] **Step 6: Verify**

Run: `pnpm --filter @ucms/admin typecheck && pnpm --filter @ucms/admin build && pnpm --filter @ucms/admin test`
Expected: clean typecheck, successful build, 19/19 tests. A missing prop at any of the 4 `<FieldGroups>` sites shows up here as a TS error — trust the compiler.

- [ ] **Step 7: Manual smoke check**

In Designer, select a Section, then a Column, then an Element with content fields (e.g. a heading) — for each, open the Grouped Styles panel and expand/collapse at least 2 different group cards (confirms `collapsedGroups`/`toggleGroup` wiring), and confirm a field inside one group (e.g. Typography's font-family) still renders and edits correctly (confirms the `FieldInput` prop-forwarding from Step 4).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/designer/FieldGroups.tsx apps/admin/src/designer/fields.ts apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract FieldGroups to designer/FieldGroups.tsx"
```

---

### Task 5: Final cleanup, unused-import sweep, and CLAUDE.md documentation

**Files:**
- Modify: `apps/admin/src/Designer.tsx` (unused-import sweep only, no logic changes)
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: the final state of all 4 preceding tasks. Produces nothing further — this is the plan's closing task, mirroring Layer 0's own final "workspace validation and docs" task.

- [ ] **Step 1: Sweep for now-unused imports/icons in `Designer.tsx`**

After Tasks 1-4, several `lucide-react` icons and module consts that used to be referenced only inside the now-moved functions may be unused in `Designer.tsx`. Check `apps/admin/tsconfig.json` for `"noUnusedLocals"` — if it's `true`, `pnpm --filter @ucms/admin typecheck` will fail on any leftover unused import, which is the fastest way to find them; if it's not set, instead run `grep -c "<IconName>\|IconName\b"` for each icon named in this plan's Task 1-4 "remove the now-orphaned import" notes and confirm zero remaining references before deleting. Do not remove any import you have not confirmed is actually unused — a false removal is a build break, not a cleanup.

- [ ] **Step 2: Update `CLAUDE.md`**

In the `apps/admin` section, find the paragraph Layer 0 added (search for `"designer/" directory split` or `Layer 0 of the` — it documents `types.ts`/`style.ts`/`geometry.ts`/`parsers.ts`). Add a new sentence immediately after it (same paragraph or a new one, whichever reads more naturally against the surrounding prose):

> Layer 1a extended this split with `designer/fields.ts` (the field-schema
> lookup tables `TYPOGRAPHY_FIELDS`/`FIELD_GROUP_BY_KEY`/`GROUP_META`/etc,
> plus the `FieldLabel` helper), `designer/FieldControls.tsx` (5 small
> hook-bearing-but-closure-free leaf controls: `BufferedInput`,
> `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, `BpToggle` — the
> last of these gained explicit `bp`/`t` props since it no longer has
> `Designer()`'s closure to read them from), and `designer/FieldInput.tsx`/
> `designer/FieldGroups.tsx` (the Inspector's data-driven field renderer and
> its Grouped Styles bucketing, both still hook-free and called as plain
> functions/JSX exactly as before). `Inspector`/`ElPreview` — the spec's
> remaining, much higher-risk "Layer 1" pieces (each closes over 45-55+
> `Designer()` state values/mutator functions, including the `mutate`/
> `section` machinery every block-tree edit goes through) — are deliberately
> deferred to a separate "Layer 1b" pass, along with the spec's own
> requested Playwright E2E smoke test that should land before attempting
> them; see
> `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md` and
> `docs/superpowers/plans/2026-08-21-designer-layer1a-field-controls.md`.

- [ ] **Step 3: Full verification**

Run from the repo root: `pnpm typecheck && pnpm build && pnpm --filter @ucms/admin test`
Expected: every workspace package typechecks and builds; admin's test suite still passes (19/19 — this plan adds no new `node:test` cases, since Tasks 2-4 extract React components with no pure/non-DOM logic to unit-test, consistent with this plan's Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/Designer.tsx CLAUDE.md
git commit -m "docs(admin): document designer/fields.ts + FieldControls/FieldInput/FieldGroups split in CLAUDE.md"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage**: this plan implements the `FieldInput`/`FieldGroups` half of the spec's Layer 1; `Inspector`/`ElPreview` and the spec's Playwright E2E task are explicitly deferred (Scope Note) — do not treat their absence as a gap in this plan.
- **Line numbers will drift**: every task after Task 1 references "original" line numbers from before Task 1's edits. Each task's Step 1 explicitly re-greps for the current signature text rather than trusting an absolute line number — follow that pattern; do not assume a later task's line numbers are still accurate.
- **The one non-mechanical edit is `BpToggle`'s new `bp`/`t` params** (Task 2) and its 6 ripple call sites, plus **`FieldGroups`' `FieldInput` call needing every prop forwarded** (Task 4, Step 4) — every other change in this plan is a pure move (signature line only) with a byte-identical body. Flag exactly these two spots for extra reviewer attention; everywhere else, the diff should look like Layer 0's own diffs (import statements + a signature line, nothing else).
