# Designer.tsx Layer 0 — Pure Helper Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a well-bounded, zero-behavior-risk slice of `apps/admin/src/Designer.tsx`'s module-scope pure helpers (slide/geometry types, style-computation functions, slide/pairs parsers) into four new files under `apps/admin/src/designer/`, re-importing them back into `Designer.tsx`, with unit tests added as a regression net where the file has none today.

**Architecture:** Four new leaf modules (`designer/types.ts`, `designer/style.ts`, `designer/geometry.ts`, `designer/parsers.ts`) that depend only on each other and on existing `@/lib/utils` — never on `Designer.tsx` — so there is no circular import. `Designer.tsx` becomes a consumer that imports these instead of declaring them locally. Each module's exported functions are copied **verbatim** (same logic, same comments) from their current location; only import/export wiring changes.

**Tech Stack:** TypeScript, Node's built-in `node:test`/`node:assert/strict` run via `tsx` (already a monorepo dependency, used identically by `apps/api`'s `pnpm --filter @ucms/api test` — no new heavy dependency).

**Spec:** `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md` (Layer 0 section)

## Global Constraints

- Avoid heavy dependencies; prefer stdlib/already-installed packages (`architecture.md`/`CLAUDE.md`) — this plan adds `tsx` to `apps/admin` devDependencies, mirroring `apps/api`'s existing test setup, not a new library.
- `apps/admin` uses `moduleResolution: "Bundler"` (`tsconfig.base.json`) — relative imports stay **extensionless** (no `.js` suffix), unlike `apps/api`'s `NodeNext` convention.
- Zero behavior change: every moved function's logic, defaults, and comments are copied verbatim. The only edits are `export` keywords and import statements.
- No manual browser click-through is required to consider this plan done — `pnpm typecheck` + `pnpm build` is the project's established bar for this kind of change; only do a live check if explicitly asked.

## Scope note (read before starting)

The design doc describes Layer 0 as moving "~25 pure helper functions (lines 1–1,424)" and estimates a ~1,400-line reduction. A literal count of `function` declarations in that range is 25, but only 18 of them were given concrete file assignments in the design doc (`parseSlides`, `parseSlideText`, `parseSlideButtons`, `parsePairs`, `stringifySlides` → parsers; `dragPosition`, `nudgePosition`, `edgeGap`, `fitTextBox`, `fluidPreviewPx` → geometry; `colStyle`, `elRadius`, `typoStyle`, `shadowToCss`, `hexToRgba`, `overlayColors`, `lengthValue`, `gapPx` → style). This plan implements exactly those 18, plus the handful of types/constants they actually depend on (verified below) — the smallest slice that is fully mechanical and independently verifiable.

`→ skipped: FieldLabel, spacingBand, escapeHtml, safeHref, renderInline, headingFontFamily, pxLabel, and the large ELS/ICONS/FIELD_ICONS/SECTION_FIELDS/COLUMN_FIELDS/GROUP_META data tables — none were named in the design doc's file groupings, several return JSX or are entangled with other still-in-place tables, and moving them isn't needed to unblock Layer 1. Add a Layer 0b pass for these if the file size still warrants it after this lands.`

## File Structure

- **Create** `apps/admin/src/designer/types.ts` — pure type/interface declarations for the slider element and canvas smart-guide geometry (`SlideButton`, `SlideItem`, `Positionable`, `SlideText`, `EdgeRect`, `GapMark`). Zero runtime code.
- **Create** `apps/admin/src/designer/style.ts` — style-computation pure functions + the small lookup tables they resolve against (`PAD`, `RADIUS`, `BORDER`, `LEGACY_SHADOW`, `gapPx`, `hexToRgba`, `overlayColors`, `shadowToCss`, `lengthValue`, `colStyle`, `elRadius`, `typoStyle`). Imports `bestTextColor` from `@/lib/utils`.
- **Create** `apps/admin/src/designer/geometry.ts` — canvas drag/nudge/smart-guide math (`dragPosition`, `nudgePosition`, `edgeGap`, `fitTextBox`, `fluidPreviewPx`) + the two constants they need (`BP_REFERENCE_PX`, `POSITION_NUDGE_STEP`). Imports types from `./types`.
- **Create** `apps/admin/src/designer/parsers.ts` — slide/pairs parsing + serialization (`parsePairs`, `parseSlideText`, `parseSlideButtons`, `parseSlides`, `stringifySlides`) + the three default-value objects they use (`TEXT_DEFAULTS`, `SLIDE_DEFAULTS`, `BUTTON_DEFAULTS`). Imports types from `./types`.
- **Create** `apps/admin/src/designer/style.test.ts`, `apps/admin/src/designer/geometry.test.ts`, `apps/admin/src/designer/parsers.test.ts` — `node:test` unit tests for the above.
- **Modify** `apps/admin/src/Designer.tsx` — delete the now-duplicated declarations (exact blocks listed in Task 5), add four import lines in their place.
- **Modify** `apps/admin/package.json` — add `tsx` devDependency + a `test` script.
- **Modify** `CLAUDE.md` — one-paragraph note under `apps/admin` documenting the new `designer/` directory (per this project's convention of keeping CLAUDE.md in sync with structural changes).

**Interfaces (shared across every task below):**
- `designer/types.ts` exports: `SlideButton`, `SlideItem`, `Positionable`, `SlideText`, `EdgeRect`, `GapMark` (all `interface`/`type`, no values).
- `designer/style.ts` exports: `PAD: Record<string,string>`, `RADIUS: Record<string,string>`, `BORDER: Record<string,string>`, `LEGACY_SHADOW: Record<string,string|undefined>`, `gapPx(v: string|undefined): number|""`, `hexToRgba(hex: string, alpha: number): string`, `overlayColors(bg: string): {line:string; text:string}`, `shadowToCss(raw: string|undefined): string|undefined`, `lengthValue(v: string|undefined, table: Record<string,string>, fallback: string): string`, `colStyle(cp?: Record<string,string>): React.CSSProperties`, `elRadius(p: Record<string,string>): string`, `typoStyle(p: Record<string,string>): React.CSSProperties`.
- `designer/geometry.ts` exports: `dragPosition(e: React.PointerEvent<HTMLDivElement>, onMove: (x:string,y:string)=>void): void`, `nudgePosition<T extends Positionable>(item: T, key: string): Partial<T>|null`, `edgeGap(a: EdgeRect, b: EdgeRect, boxRect: EdgeRect, axis: "v"|"h"): GapMark|null`, `fitTextBox(node: HTMLElement|null): void`, `fluidPreviewPx(px: number, bp: "desktop"|"tablet"|"mobile"): number`.
- `designer/parsers.ts` exports: `parsePairs(raw: string|undefined): {a:string;b:string}[]`, `parseSlideText(raw: unknown): SlideText`, `parseSlideButtons(raw: unknown): SlideButton[]`, `parseSlides(raw: string|undefined): SlideItem[]`, `stringifySlides(items: SlideItem[]): string`.

---

## Task 1: Shared types module

**Files:**
- Create: `apps/admin/src/designer/types.ts`

**Interfaces:**
- Produces: `SlideButton`, `SlideItem`, `Positionable`, `SlideText`, `EdgeRect`, `GapMark` — exact shapes below, copied verbatim from `Designer.tsx:953-1027` and `Designer.tsx:1197-1203`.

- [ ] **Step 1: Create the file**

```ts
// Shared type/interface declarations for the Designer's slider element and
// canvas smart-guide geometry — split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
// Pure type declarations only, no runtime code.

export interface SlideButton {
  label: string;
  href: string;
  variant: "primary" | "outline";
  color: string; // hex bg override, "" = theme default
  textColor: string; // hex text/border override, "" = theme default
  radius: string; // px number, "" = default pill radius
  size: "sm" | "md" | "lg";
  fontSize: string; // px number, "" = derive from size — set by the canvas resize handle
  // "flow" = original behavior, laid out inside the slide's text block
  // alongside heading/subtitle; "custom" = absolutely positioned anywhere
  // in the slide via x/y percent (drag-placed or preset-snapped).
  position: "flow" | "custom";
  x: string; // "0".."100", only meaningful when position === "custom"
  y: string;
}

export interface SlideItem {
  imageUrl: string;
  bgColor: string; // hex fallback fill behind the image (or the whole slide when there's no image) — "" = transparent
  heading: SlideText;
  subtitle: SlideText;
  textPosition: "left" | "center" | "right";
  overlayColor: string;
  overlayOpacity: string; // "0".."100"
  buttons: SlideButton[];
}

// Shared shape for heading/subtitle/button drag-position — dragPosition/
// nudgePosition/POSITION_PRESETS all operate on this generically so every
// item kind drives the same drag/nudge/preset code.
export interface Positionable {
  position: "flow" | "custom";
  x: string;
  y: string;
}

export interface SlideText extends Positionable {
  text: string;
  color: string; // hex text-color override, "" = inherit the slide's default
  fontSize: string; // px, "" = derive from TEXT_BASE_PX — set by canvas resize handle
  width: string; // px, "" = auto (shrink-to-fit the widest rendered line, see fitTextBox)
  align: "left" | "center" | "right";
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  fontStyle: string;
  textDecoration: string;
  // Same "tablet:<key>"/"mobile:<key>" bag shape as Section/Col/El's own
  // `bp` — but unlike those (admin-preview only), this one IS real on the
  // published site (SectionBlock.astro's slideTextStyleBp).
  bp?: Record<string, string>;
}

// Minimal DOMRect-shaped bag for the canvas smart-guide math — lets the
// dragged item's "virtual" rect (built from clientX/Y mid-drag, not a real
// live DOM node) be the same type as every real rect it's compared against.
export interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type GapMark = { top: number; left: number; length: number };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: PASS (this file has no consumers yet, so it can only fail on a syntax/type error within itself).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/designer/types.ts
git commit -m "refactor(admin): add designer/types.ts (Layer 0 extraction, part 1)"
```

---

## Task 2: Style helpers module + test tooling

**Files:**
- Create: `apps/admin/src/designer/style.ts`
- Create: `apps/admin/src/designer/style.test.ts`
- Modify: `apps/admin/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: see "designer/style.ts exports" in the File Structure section above.

- [ ] **Step 1: Add test tooling to apps/admin**

Edit `apps/admin/package.json`:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "tsx --test src/**/*.test.ts"
  },
```

Add to `devDependencies` (alphabetical, matches `apps/api`'s pinned version):

```json
    "tsx": "^4.19.2",
```

Then run: `pnpm install` (from repo root)

- [ ] **Step 2: Create designer/style.ts**

```ts
import { bestTextColor } from "@/lib/utils";

// Style-computation pure helpers split out of Designer.tsx (Layer 0 of the
// God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

export const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
export const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
export const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };
// Legacy preset keywords (existing pages' saved shadow="sm"/"md"/"lg" values)
// still resolve via this table. New edits store a pipe-delimited custom
// shadow instead — see shadowToCss() — no presets, a real X/Y/blur/spread/
// color/opacity panel (user: "saya taknak preset...letakkan option nombor").
export const LEGACY_SHADOW: Record<string, string | undefined> = {
  none: undefined,
  sm: "0 1px 3px rgba(0,0,0,.1)",
  md: "0 4px 12px rgba(0,0,0,.12)",
  lg: "0 12px 32px rgba(0,0,0,.16)",
};

// gapPx() round-trips a stored CSS length string to/from the <input
// type="number"> shown in the Inspector; assumes rem = 16px.
export function gapPx(v: string | undefined): number | "" {
  if (!v) return "";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return Math.round(v.endsWith("rem") ? n * 16 : n);
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number.isFinite(alpha) ? alpha : 1})`;
}

// Canvas overlay chrome (dashed guides, drop hints) is drawn straight on top
// of whatever bg color the section/column actually has, which the tenant
// can set to anything — flips the guide-line/hint-text color dark-on-light
// vs light-on-dark based on which reads better against that bg.
export function overlayColors(bg: string): { line: string; text: string } {
  const dark = bestTextColor(bg) === "#000000";
  return dark
    ? { line: hexToRgba("#000000", 0.35), text: hexToRgba("#000000", 0.55) }
    : { line: hexToRgba("#ffffff", 0.45), text: hexToRgba("#ffffff", 0.75) };
}

export function shadowToCss(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw in LEGACY_SHADOW) return LEGACY_SHADOW[raw];
  const [x, y, blur, spread, color, opacity] = raw.split("|");
  if (!x) return undefined;
  return `${x}px ${y}px ${blur ?? 0}px ${spread ?? 0}px ${hexToRgba(color, Number(opacity))}`;
}

// Resolves a spacing value that may be either a legacy preset keyword
// ("sm"/"md"/"lg"/"xl"/"none") or a real CSS length the author typed
// ("42px", "2.5rem") — existing pages keep their preset look, new edits get
// free-form units. Duplicated in SectionBlock.astro like every other table.
export function lengthValue(v: string | undefined, table: Record<string, string>, fallback: string) {
  if (!v) return fallback;
  return table[v] ?? v;
}

export function typoStyle(p: Record<string, string>): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (p.fontFamily) s.fontFamily = p.fontFamily;
  if (p.color) s.color = p.color;
  if (p.lineHeight) s.lineHeight = p.lineHeight;
  if (p.letterSpacing) s.letterSpacing = p.letterSpacing;
  if (p.fontWeight) s.fontWeight = p.fontWeight;
  if (p.textTransform) s.textTransform = p.textTransform as React.CSSProperties["textTransform"];
  if (p.fontStyle) s.fontStyle = p.fontStyle;
  if (p.textDecoration) s.textDecoration = p.textDecoration;
  return s;
}

export function colStyle(cp?: Record<string, string>): React.CSSProperties {
  if (!cp) return {};
  const anyPadding = cp.padding || cp.paddingTop || cp.paddingRight || cp.paddingBottom || cp.paddingLeft;
  const padSide = (per: string) => lengthValue(cp[per] || cp.padding, PAD, "0");
  const anyRadius = cp.radius || cp.radiusTopLeft || cp.radiusTopRight || cp.radiusBottomRight || cp.radiusBottomLeft;
  const radCorner = (per: string) => lengthValue(cp[per] || cp.radius, RADIUS, RADIUS.none);
  const anyMargin = cp.marginY || cp.marginX || cp.marginTop || cp.marginRight || cp.marginBottom || cp.marginLeft;
  const marginSide = (per: string, axis: string) => lengthValue(cp[per] || cp[axis], PAD, "0");
  return {
    background: cp.bg || undefined,
    padding: anyPadding
      ? `${padSide("paddingTop")} ${padSide("paddingRight")} ${padSide("paddingBottom")} ${padSide("paddingLeft")}`
      : undefined,
    margin: anyMargin
      ? `${marginSide("marginTop", "marginY")} ${marginSide("marginRight", "marginX")} ${marginSide("marginBottom", "marginY")} ${marginSide("marginLeft", "marginX")}`
      : undefined,
    alignSelf: cp.valign === "top" ? "start" : cp.valign === "bottom" ? "end" : cp.valign === "center" ? "center" : undefined,
    border: cp.border ? BORDER[cp.border] : undefined,
    boxShadow: shadowToCss(cp.shadow),
    borderRadius: anyRadius
      ? `${radCorner("radiusTopLeft")} ${radCorner("radiusTopRight")} ${radCorner("radiusBottomRight")} ${radCorner("radiusBottomLeft")}`
      : undefined,
  };
}

// Element radius (image/embed/gallery): same per-corner freedom as Section/
// Column, but these elements default to a rounded "md" look out of the box,
// so the fallback is RADIUS.md, not RADIUS.none.
export function elRadius(p: Record<string, string>): string {
  const corner = (per: string) => lengthValue(p[per] || p.radius, RADIUS, RADIUS.md);
  return `${corner("radiusTopLeft")} ${corner("radiusTopRight")} ${corner("radiusBottomRight")} ${corner("radiusBottomLeft")}`;
}
```

Note: this file uses bare `React.CSSProperties` with no `import React` — exactly matching `Designer.tsx`'s own existing convention (it never imports a `React` binding either, relying on `@types/react`'s ambient global namespace). If typecheck reports `Cannot find name 'React'` for this file specifically, add `import type * as React from "react";` at the top — that's the one acceptable deviation from "verbatim copy" and is purely a type import, no runtime change.

- [ ] **Step 3: Create the test file**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAD, RADIUS, LEGACY_SHADOW, gapPx, hexToRgba, shadowToCss, lengthValue, colStyle, elRadius, typoStyle, overlayColors } from "./style";

test("lengthValue resolves a preset keyword, falls back when unset, passes through a literal", () => {
  assert.equal(lengthValue("md", PAD, "0"), PAD.md);
  assert.equal(lengthValue(undefined, PAD, "1rem"), "1rem");
  assert.equal(lengthValue("42px", PAD, "0"), "42px");
});

test("gapPx converts rem to px, passes through a bare number, guards bad input", () => {
  assert.equal(gapPx("2rem"), 32);
  assert.equal(gapPx("24"), 24);
  assert.equal(gapPx(undefined), "");
  assert.equal(gapPx("not-a-number"), "");
});

test("hexToRgba expands 3-char and 6-char hex, guards a non-finite alpha to 1", () => {
  assert.equal(hexToRgba("#fff", 0.5), "rgba(255, 255, 255, 0.5)");
  assert.equal(hexToRgba("#112233", 1), "rgba(17, 34, 51, 1)");
  assert.equal(hexToRgba("#000000", NaN), "rgba(0, 0, 0, 1)");
});

test("shadowToCss resolves a legacy preset, returns undefined for 'none', builds a custom pipe shadow", () => {
  assert.equal(shadowToCss("md"), LEGACY_SHADOW.md);
  assert.equal(shadowToCss("none"), undefined);
  assert.equal(shadowToCss(undefined), undefined);
  assert.equal(shadowToCss("2|4|8|0|#000000|0.5"), "2px 4px 8px 0px rgba(0, 0, 0, 0.5)");
});

test("colStyle returns {} with no props, sets background/padding/radius when present", () => {
  assert.deepEqual(colStyle(undefined), {});
  const s = colStyle({ bg: "#fff", padding: "sm", radius: "md" });
  assert.equal(s.background, "#fff");
  assert.equal(s.padding, `${PAD.sm} ${PAD.sm} ${PAD.sm} ${PAD.sm}`);
  assert.equal(s.borderRadius, `${RADIUS.md} ${RADIUS.md} ${RADIUS.md} ${RADIUS.md}`);
});

test("elRadius falls back to RADIUS.md (not RADIUS.none) when unset", () => {
  assert.equal(elRadius({}), `${RADIUS.md} ${RADIUS.md} ${RADIUS.md} ${RADIUS.md}`);
});

test("typoStyle only sets keys that are actually present", () => {
  assert.deepEqual(typoStyle({}), {});
  assert.deepEqual(typoStyle({ color: "#111827", fontWeight: "700" }), { color: "#111827", fontWeight: "700" });
});

test("overlayColors picks a black-based vs white-based line color depending on background", () => {
  const onWhite = overlayColors("#ffffff");
  const onBlack = overlayColors("#000000");
  assert.match(onWhite.line, /^rgba\(0, 0, 0,/);
  assert.match(onBlack.line, /^rgba\(255, 255, 255,/);
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @ucms/admin test`
Expected: all tests in `style.test.ts` PASS. If `overlayColors`' assertions fail because `bestTextColor`'s actual thresholds differ from this guess, adjust the two `assert.match` expectations to whatever `bestTextColor("#ffffff")`/`bestTextColor("#000000")` actually return (check `apps/admin/src/lib/utils.ts`) — the point of this test is regression coverage, not re-specifying `bestTextColor`'s behavior.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/package.json apps/admin/src/designer/style.ts apps/admin/src/designer/style.test.ts pnpm-lock.yaml
git commit -m "refactor(admin): add designer/style.ts + test tooling (Layer 0 extraction, part 2)"
```

---

## Task 3: Geometry helpers module

**Files:**
- Create: `apps/admin/src/designer/geometry.ts`
- Create: `apps/admin/src/designer/geometry.test.ts`

**Interfaces:**
- Consumes: `Positionable`, `EdgeRect`, `GapMark` from `./types` (Task 1).
- Produces: see "designer/geometry.ts exports" in the File Structure section above.

- [ ] **Step 1: Create designer/geometry.ts**

```ts
import type { Positionable, EdgeRect, GapMark } from "./types";

// Canvas drag/nudge/smart-guide geometry helpers split out of Designer.tsx
// (Layer 0 of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

// Baseline reference widths the Blocks canvas's "bp" preview simulates
// against — see fluidPreviewPx.
const BP_REFERENCE_PX: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 1000, tablet: 768, mobile: 384 };

// Mirrors SectionBlock.astro's fluidClamp/fluidFontSize math (real site:
// clamp(floor, vw, ceiling)) but evaluated in JS against a fixed reference
// width per breakpoint instead of an actual `vw` unit, since the admin's
// canvas preview can't measure a real viewport width.
export function fluidPreviewPx(px: number, bp: "desktop" | "tablet" | "mobile"): number {
  const floor = Math.max(14, Math.round(px * 0.55));
  const scaled = Math.round((px * BP_REFERENCE_PX[bp]) / 1000);
  return Math.min(px, Math.max(floor, scaled));
}

// Sizes the dashed resize box to the widest actually-rendered line of
// (possibly wrapped) text. No CSS value can do this: `width:fit-content`
// resolves to min(max-content, available), and the moment text wraps,
// max-content (its unwrapped width) exceeds available — so it collapses to
// the full container width and the box floats far past the glyphs.
// Range.getClientRects() returns one rect per rendered line box, so the
// widest of those is the true ink width. Called from an inline ref callback
// (a new function identity each render) rather than a layout effect, since
// the caller is a plain function, not a component that can hold hooks.
export function fitTextBox(node: HTMLElement | null): void {
  if (!node) return;
  node.style.width = "";
  const text = node.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) return;
  const widest = Math.max(...rects.map((r) => r.width));
  if (widest <= 0) return;
  // Tailwind sets box-sizing:border-box globally, so `width` has to include
  // the chip's own border/padding or the last glyph gets clipped.
  const cs = getComputedStyle(node);
  const extra =
    parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  node.style.width = `${Math.ceil(widest) + extra}px`;
}

// Click-or-drag inside a position minimap: computes percent from the
// pointerdown target's own bounding box (captured once, cheap — the minimap
// doesn't resize mid-drag) and tracks the pointer on window until release.
// Plain function, not a hook — safe to call from inside a .map().
export function dragPosition(e: React.PointerEvent<HTMLDivElement>, onMove: (x: string, y: string) => void) {
  const rect = e.currentTarget.getBoundingClientRect();
  const set = (clientX: number, clientY: number) => {
    const x = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)));
    onMove(String(x), String(y));
  };
  set(e.clientX, e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientX, ev.clientY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// percent per arrow-key press
const POSITION_NUDGE_STEP = 2;
// Arrow-key nudge for whichever canvas chip (button, heading, or subtitle)
// currently has keyboard focus — same x/y percent space as
// dragPosition/POSITION_PRESETS, just a smaller fixed step instead of a
// pointer position. Generic over `Positionable` since a still-"flow" item
// of any of the three kinds has no x/y yet — the first nudge starts it from
// the shared 50/50 center and switches it to "custom", same as dragging does.
export function nudgePosition<T extends Positionable>(item: T, key: string): Partial<T> | null {
  const dx = key === "ArrowLeft" ? -POSITION_NUDGE_STEP : key === "ArrowRight" ? POSITION_NUDGE_STEP : 0;
  const dy = key === "ArrowUp" ? -POSITION_NUDGE_STEP : key === "ArrowDown" ? POSITION_NUDGE_STEP : 0;
  if (dx === 0 && dy === 0) return null;
  const baseX = item.position === "custom" ? Number(item.x) : 50;
  const baseY = item.position === "custom" ? Number(item.y) : 50;
  return {
    position: "custom",
    x: String(Math.min(100, Math.max(0, baseX + dx))),
    y: String(Math.min(100, Math.max(0, baseY + dy))),
  } as Partial<T>;
}

// Figma-style "nearest neighbor" spacing tick: only returns a mark when the
// two rects don't overlap on that axis AND do overlap on the other (so the
// line has a sensible perpendicular anchor point) — a vertical gap needs
// x-overlap, a horizontal gap needs y-overlap. `axis` picks which one to
// compute; callers run this once per axis per candidate and keep only the
// smallest (nearest) result.
export function edgeGap(a: EdgeRect, b: EdgeRect, boxRect: EdgeRect, axis: "v" | "h"): GapMark | null {
  if (axis === "v") {
    const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (xOverlap <= 0) return null;
    const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    if (a.bottom <= b.top) return { top: a.bottom - boxRect.top, left: midX - boxRect.left, length: b.top - a.bottom };
    if (b.bottom <= a.top) return { top: b.bottom - boxRect.top, left: midX - boxRect.left, length: a.top - b.bottom };
    return null;
  }
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (yOverlap <= 0) return null;
  const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  if (a.right <= b.left) return { top: midY - boxRect.top, left: a.right - boxRect.left, length: b.left - a.right };
  if (b.right <= a.left) return { top: midY - boxRect.top, left: b.right - boxRect.left, length: a.left - b.right };
  return null;
}
```

Same note as Task 2: `React.PointerEvent<HTMLDivElement>` relies on the ambient `@types/react` global namespace, matching `Designer.tsx`'s existing convention. If typecheck complains, add `import type * as React from "react";` at the top (do not import a bare `PointerEvent` binding — that would shadow the DOM global `PointerEvent` type used a few lines below in `move`).

- [ ] **Step 2: Create the test file**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fluidPreviewPx, fitTextBox, nudgePosition, edgeGap } from "./geometry";
import type { Positionable, EdgeRect } from "./types";

test("fluidPreviewPx never exceeds the ceiling and respects the 14px-ish floor", () => {
  assert.equal(fluidPreviewPx(20, "desktop"), 20);
  assert.ok(fluidPreviewPx(60, "mobile") < 60);
  assert.ok(fluidPreviewPx(60, "mobile") >= 14);
});

test("fitTextBox no-ops on a null node instead of throwing", () => {
  assert.doesNotThrow(() => fitTextBox(null));
});

test("nudgePosition starts a still-flow item from 50/50 and clamps to 0..100", () => {
  const flowItem: Positionable = { position: "flow", x: "50", y: "50" };
  const right = nudgePosition(flowItem, "ArrowRight");
  assert.equal(right?.position, "custom");
  assert.equal(right?.x, "52");
  const atEdge: Positionable = { position: "custom", x: "99", y: "0" };
  assert.equal(nudgePosition(atEdge, "ArrowRight")?.x, "100");
  assert.equal(nudgePosition(atEdge, "ArrowUp")?.y, "0");
});

test("nudgePosition returns null for a non-arrow key", () => {
  const item: Positionable = { position: "flow", x: "50", y: "50" };
  assert.equal(nudgePosition(item, "Enter"), null);
});

test("edgeGap finds a vertical gap only when the rects x-overlap and don't y-overlap", () => {
  const boxRect: EdgeRect = { left: 0, right: 100, top: 0, bottom: 100 };
  const a: EdgeRect = { left: 10, right: 30, top: 10, bottom: 20 };
  const b: EdgeRect = { left: 10, right: 30, top: 40, bottom: 50 };
  const mark = edgeGap(a, b, boxRect, "v");
  assert.ok(mark);
  assert.equal(mark?.length, 20);
});

test("edgeGap returns null when the rects don't overlap on the perpendicular axis", () => {
  const boxRect: EdgeRect = { left: 0, right: 100, top: 0, bottom: 100 };
  const a: EdgeRect = { left: 10, right: 20, top: 10, bottom: 20 };
  const b: EdgeRect = { left: 50, right: 60, top: 40, bottom: 50 };
  assert.equal(edgeGap(a, b, boxRect, "v"), null);
});
```

`dragPosition` is deliberately not unit-tested here — it's a thin `window.addEventListener`/`getBoundingClientRect` wiring function with no DOM available under plain `node:test`, and adding `jsdom` just for this one function would be a new dependency for a UI-wiring concern the design doc's own Layer 1 Playwright smoke test is better suited to cover. `→ skipped: dragPosition pointer-drag coverage, add a Playwright assertion in the Layer 1 E2E smoke test the design doc calls for.`

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @ucms/admin test`
Expected: all tests in both `style.test.ts` and `geometry.test.ts` PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/designer/geometry.ts apps/admin/src/designer/geometry.test.ts
git commit -m "refactor(admin): add designer/geometry.ts (Layer 0 extraction, part 3)"
```

---

## Task 4: Slide/pairs parsers module

**Files:**
- Create: `apps/admin/src/designer/parsers.ts`
- Create: `apps/admin/src/designer/parsers.test.ts`

**Interfaces:**
- Consumes: `SlideButton`, `SlideItem`, `SlideText` from `./types` (Task 1).
- Produces: see "designer/parsers.ts exports" in the File Structure section above.

- [ ] **Step 1: Create designer/parsers.ts**

```ts
import type { SlideButton, SlideItem, SlideText } from "./types";

// Slide/pairs parsing + serialization helpers split out of Designer.tsx
// (Layer 0 of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).

// Shared "one item per line, first `|` splits it in two" parser for
// accordion (question|answer) and tabs (label|content) — same simple
// delimited-line convention `list`'s items already uses. Duplicated in
// SectionBlock.astro like every other table.
export function parsePairs(raw: string | undefined): { a: string; b: string }[] {
  return (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("|");
      return i === -1 ? { a: line, b: "" } : { a: line.slice(0, i), b: line.slice(i + 1) };
    });
}

const TEXT_DEFAULTS: SlideText = {
  text: "",
  color: "",
  fontSize: "",
  width: "",
  align: "left",
  fontFamily: "",
  fontWeight: "",
  lineHeight: "",
  letterSpacing: "",
  textTransform: "",
  fontStyle: "",
  textDecoration: "",
  position: "flow",
  x: "50",
  y: "50",
};

// Heading/subtitle were plain strings before this upgrade — a string input
// here means legacy content, wrapped into TEXT_DEFAULTS with that string as
// `text` (same JSON-then-legacy-shape fallback convention as everywhere else
// in this file), so a page saved before this change keeps opening/saving
// and silently upgrades the next time its slider is edited.
export function parseSlideText(raw: unknown): SlideText {
  if (typeof raw === "string") return { ...TEXT_DEFAULTS, text: raw };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const str = (key: keyof SlideText): string => (typeof o[key] === "string" ? (o[key] as string) : (TEXT_DEFAULTS[key] as string));
    return {
      text: typeof o.text === "string" ? o.text : "",
      color: str("color"),
      fontSize: str("fontSize"),
      width: str("width"),
      align: o.align === "center" || o.align === "right" ? o.align : "left",
      fontFamily: str("fontFamily"),
      fontWeight: str("fontWeight"),
      lineHeight: str("lineHeight"),
      letterSpacing: str("letterSpacing"),
      textTransform: str("textTransform"),
      fontStyle: str("fontStyle"),
      textDecoration: str("textDecoration"),
      position: o.position === "custom" ? "custom" : "flow",
      x: typeof o.x === "string" ? o.x : TEXT_DEFAULTS.x,
      y: typeof o.y === "string" ? o.y : TEXT_DEFAULTS.y,
      bp: o.bp && typeof o.bp === "object" && !Array.isArray(o.bp) ? (o.bp as Record<string, string>) : undefined,
    };
  }
  return { ...TEXT_DEFAULTS };
}

const SLIDE_DEFAULTS = { bgColor: "", textPosition: "center" as const, overlayColor: "#000000", overlayOpacity: "35" };
const BUTTON_DEFAULTS: SlideButton = {
  label: "",
  href: "",
  variant: "primary",
  color: "",
  textColor: "",
  radius: "",
  size: "md",
  fontSize: "",
  position: "flow",
  x: "50",
  y: "50",
};

export function parseSlideButtons(raw: unknown): SlideButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const btn = (b ?? {}) as Record<string, unknown>;
    return {
      label: typeof btn.label === "string" ? btn.label : "",
      href: typeof btn.href === "string" ? btn.href : "",
      variant: btn.variant === "outline" ? "outline" : ("primary" as const),
      color: typeof btn.color === "string" ? btn.color : BUTTON_DEFAULTS.color,
      textColor: typeof btn.textColor === "string" ? btn.textColor : BUTTON_DEFAULTS.textColor,
      radius: typeof btn.radius === "string" ? btn.radius : BUTTON_DEFAULTS.radius,
      size: btn.size === "sm" || btn.size === "lg" ? btn.size : "md",
      fontSize: typeof btn.fontSize === "string" ? btn.fontSize : BUTTON_DEFAULTS.fontSize,
      position: btn.position === "custom" ? "custom" : "flow",
      x: typeof btn.x === "string" ? btn.x : BUTTON_DEFAULTS.x,
      y: typeof btn.y === "string" ? btn.y : BUTTON_DEFAULTS.y,
    };
  });
}

// Slider slide repeater. Storage is a JSON array (one object per slide).
// parseSlides() also accepts the legacy pipe-delimited single-line format
// (JSON.parse throws on it, falls through) so a page saved before the Embla
// Carousel rewrite keeps opening/saving — it silently upgrades to the JSON
// format the next time it's edited. SectionBlock.astro's render-side parser
// mirrors this same fallback, and validate-layout.ts's isSafeSlides()
// accepts both shapes on write.
export function parseSlides(raw: string | undefined): SlideItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const s = (item ?? {}) as Record<string, unknown>;
        return {
          imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
          bgColor: typeof s.bgColor === "string" ? s.bgColor : SLIDE_DEFAULTS.bgColor,
          heading: parseSlideText(s.heading),
          subtitle: parseSlideText(s.subtitle),
          textPosition: s.textPosition === "left" || s.textPosition === "right" ? s.textPosition : "center",
          overlayColor: typeof s.overlayColor === "string" ? s.overlayColor : SLIDE_DEFAULTS.overlayColor,
          overlayOpacity: typeof s.overlayOpacity === "string" ? s.overlayOpacity : SLIDE_DEFAULTS.overlayOpacity,
          buttons: parseSlideButtons(s.buttons),
        };
      });
    }
  } catch {
    // Not JSON — fall through to the legacy pipe-line format below.
  }
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [imageUrl = "", heading = "", subtitle = "", buttonLabel = "", buttonHref = ""] = line.split("|");
      return {
        imageUrl,
        heading: parseSlideText(heading),
        subtitle: parseSlideText(subtitle),
        ...SLIDE_DEFAULTS,
        buttons: buttonLabel ? [{ ...BUTTON_DEFAULTS, label: buttonLabel, href: buttonHref }] : [],
      };
    });
}

export function stringifySlides(items: SlideItem[]): string {
  return JSON.stringify(items);
}
```

- [ ] **Step 2: Create the test file**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePairs, parseSlideText, parseSlideButtons, parseSlides, stringifySlides } from "./parsers";

test("parsePairs splits on the first pipe, defaults b to '', filters blank lines", () => {
  assert.deepEqual(parsePairs("Q1|A1\n\nno-pipe-line\n"), [{ a: "Q1", b: "A1" }, { a: "no-pipe-line", b: "" }]);
  assert.deepEqual(parsePairs(undefined), []);
});

test("parseSlideText wraps a legacy string, reads a full object, defaults a garbage input", () => {
  assert.deepEqual(parseSlideText("Hello").text, "Hello");
  const obj = parseSlideText({ text: "Hi", align: "center", fontSize: "20", bp: { "mobile:fontSize": "14" } });
  assert.equal(obj.text, "Hi");
  assert.equal(obj.align, "center");
  assert.equal(obj.fontSize, "20");
  assert.deepEqual(obj.bp, { "mobile:fontSize": "14" });
  assert.equal(parseSlideText(42).text, "");
});

test("parseSlideButtons rejects non-arrays, fills defaults, guards the variant/size enums", () => {
  assert.deepEqual(parseSlideButtons(null), []);
  const [btn] = parseSlideButtons([{ label: "Go", variant: "bogus", size: "xxl" }]);
  assert.equal(btn.label, "Go");
  assert.equal(btn.variant, "primary");
  assert.equal(btn.size, "md");
});

test("parseSlides accepts the JSON shape and the legacy pipe-line shape", () => {
  const jsonForm = parseSlides(JSON.stringify([{ imageUrl: "a.jpg", heading: "H", subtitle: "S", buttons: [] }]));
  assert.equal(jsonForm.length, 1);
  assert.equal(jsonForm[0].imageUrl, "a.jpg");
  assert.equal(jsonForm[0].heading.text, "H");

  const legacyForm = parseSlides("a.jpg|Heading|Subtitle|Click me|https://example.com");
  assert.equal(legacyForm.length, 1);
  assert.equal(legacyForm[0].buttons[0]?.label, "Click me");

  assert.deepEqual(parseSlides(undefined), []);
});

test("stringifySlides round-trips through parseSlides for the JSON shape", () => {
  const original = parseSlides(JSON.stringify([{ imageUrl: "x.jpg", heading: "H1", subtitle: "S1", buttons: [] }]));
  const roundTripped = parseSlides(stringifySlides(original));
  assert.deepEqual(roundTripped, original);
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @ucms/admin test`
Expected: all tests across `style.test.ts`, `geometry.test.ts`, `parsers.test.ts` PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/designer/parsers.ts apps/admin/src/designer/parsers.test.ts
git commit -m "refactor(admin): add designer/parsers.ts (Layer 0 extraction, part 4)"
```

---

## Task 5: Rewire Designer.tsx

**Files:**
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1-4.
- Produces: nothing new — `Designer.tsx`'s own behavior/exports (`El`, `Col`, `Row`, `SectionProps`, `Block`, `export default function Designer`) are unchanged.

None of the symbols being removed in this task are exported from `Designer.tsx` today (only `El`/`Col`/`Row`/`SectionProps`/`Block` are `export`ed, and none of those are touched), so no other file in the repo needs updating.

- [ ] **Step 1: Add the four import lines**

Edit `apps/admin/src/Designer.tsx`. Find this existing line (near the top, after the lucide-react import block):

```ts
import { moveSection, moveColumn } from "./designerTree";
```

Replace it with:

```ts
import { moveSection, moveColumn } from "./designerTree";
import type { SlideButton, SlideItem, Positionable, SlideText, EdgeRect, GapMark } from "./designer/types";
import { parsePairs, parseSlideText, parseSlideButtons, parseSlides, stringifySlides } from "./designer/parsers";
import { dragPosition, nudgePosition, edgeGap, fitTextBox, fluidPreviewPx } from "./designer/geometry";
import { PAD, RADIUS, BORDER, LEGACY_SHADOW, gapPx, hexToRgba, overlayColors, shadowToCss, lengthValue, colStyle, elRadius, typoStyle } from "./designer/style";
```

- [ ] **Step 2: Delete the now-duplicated declarations**

Remove each of the following blocks from `Designer.tsx` (each is now defined in one of the four new files — leave everything else, including `SPACE`, `TEXT_SIZE`, `H_SIZE`, `ICON_SIZE`, `SHADOW_DEFAULT_PARTS`, `SIZE_PX`, `TEXT_BASE_PX`, `SLIDER_HEIGHT`, `POSITION_PRESETS`, exactly where they are — those are out of scope for this pass):

1. `const PAD: Record<string, string> = { none: "0", sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };` — one line, right before the `gapPx` comment/function.
2. The `gapPx` comment + function (originally lines 867-874).
3. `const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };` — one line.
4. `const BORDER: Record<string, string> = { none: "none", thin: "1px solid currentColor", thick: "3px solid currentColor" };` — one line.
5. The `LEGACY_SHADOW` comment + const (originally lines 880-890).
6. The `hexToRgba` function (originally lines 894-899).
7. The `overlayColors` comment + function (originally lines 900-911).
8. The `shadowToCss` function (originally lines 912-918).
9. The `lengthValue` comment + function (originally lines 920-927).
10. The `parsePairs` comment + function (originally lines 929-942).
11. The `SlideButton` interface (originally lines 953-968) — leave the comment block right above it that explains the design ("Slider slide repeater...") since it also documents `SlideItem`/`SlideText` which are also being removed as a unit; leave `SIZE_PX` (line 971) in place.
12. The `SlideItem` interface (originally lines 972-981).
13. The `Positionable` interface (originally lines 986-990) — leave the surrounding narrative comments (983-985, 991-1007) in place; they document design history that's still relevant to readers of `Designer.tsx` even after the interface itself moves. (Optional cleanup: if these comments read oddly once they no longer sit directly above the type they describe, trimming them is fine — not required for this task.)
14. The `SlideText` interface (originally lines 1008-1027).
15. `const TEXT_DEFAULTS: SlideText = { ... };` (originally lines 1028-1044) — leave `TEXT_BASE_PX` (line 1048) in place.
16. `const BP_REFERENCE_PX: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 1000, tablet: 768, mobile: 384 };` (originally line 1058) — leave the comment above it (1049-1057) since it documents `fluidPreviewPx`'s approach and reads fine standalone; leave `SLIDER_HEIGHT` (line 1068) in place.
17. The `fluidPreviewPx` function (originally lines 1059-1063).
18. The `fitTextBox` function + its preceding comment (originally lines 1069-1097).
19. The `parseSlideText` function + its preceding comment (originally lines 1098-1128).
20. `const SLIDE_DEFAULTS = { bgColor: "", textPosition: "center" as const, overlayColor: "#000000", overlayOpacity: "35" };` (originally line 1129).
21. `const BUTTON_DEFAULTS: SlideButton = { ... };` (originally lines 1130-1142) — leave `POSITION_PRESETS` (1143-1152) in place.
22. The `dragPosition` function + its preceding comment (originally lines 1153-1172).
23. `const POSITION_NUDGE_STEP = 2;` (originally line 1173).
24. The `nudgePosition` function + its preceding comment (originally lines 1174-1191).
25. The `EdgeRect` interface + its preceding comment (originally lines 1192-1202).
26. `type GapMark = { top: number; left: number; length: number };` (originally line 1203).
27. The `edgeGap` function + its preceding comment (originally lines 1204-1225).
28. The `parseSlideButtons` function (originally lines 1226-1244).
29. The `parseSlides` function + its preceding comment (originally lines 1243-1281).
30. The `stringifySlides` function (originally lines 1282-1284).
31. The `typoStyle` function (originally lines 1353-1364) — leave `pxLabel` (1289-1296), `escapeHtml`/`safeHref`/`renderInline` (1316-1335), and `headingFontFamily` (1337-1351) in place; they're out of scope for this pass.
32. The `colStyle` function (originally lines 1366-1389).
33. The `elRadius` function + its preceding comment (originally lines 1391-1397).

Each of these is a self-contained block (a comment+declaration, or a bare declaration) — remove the whole block including any comment lines directly attached to it, per the list above. Leave surrounding blank lines tidy (no more than one blank line where a block used to be).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ucms/admin typecheck`
Expected: PASS. If it reports an unresolved name, it means step 2 removed something still referenced under a different call site, or step 1's import list is missing an entry — cross-reference against the "Interfaces" export lists in Tasks 1-4.

- [ ] **Step 4: Build**

Run: `pnpm --filter @ucms/admin build`
Expected: PASS (this also catches anything `tsc --noEmit` might miss via Vite's own bundling).

- [ ] **Step 5: Run the full admin test suite once more**

Run: `pnpm --filter @ucms/admin test`
Expected: PASS (unaffected by this task, but cheap to reconfirm after touching `Designer.tsx`).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/Designer.tsx
git commit -m "refactor(admin): rewire Designer.tsx to import Layer 0 helpers from designer/"
```

---

## Task 6: Repo-wide verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full workspace typecheck and build**

Run: `pnpm typecheck` (repo root, runs `pnpm -r typecheck`)
Expected: PASS across every workspace package.

Run: `pnpm build` (repo root, runs `pnpm -r build`)
Expected: PASS across every workspace package.

Per this project's own convention (skip live browser verification unless asked), no manual click-through is required to close out this task — `typecheck` + `build` is the established bar.

- [ ] **Step 2: Document the new directory in CLAUDE.md**

Add a short paragraph under the existing `apps/admin` bullet describing `Designer.tsx` (right after the paragraph that currently describes the slider/Embla Carousel work, before `ThemeForm`), so the God Component refactor's Layer 0 is discoverable the next time someone reads this file:

```markdown
  `Designer.tsx`'s pure helpers (types + style/geometry/slide-parsing functions with no
  dependency on the component's own state) live in `src/designer/` (`types.ts`, `style.ts`,
  `geometry.ts`, `parsers.ts`) — Layer 0 of the God Component refactor described in
  `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md`. Each has its own
  `node:test` unit test (`pnpm --filter @ucms/admin test`, mirroring `apps/api`'s existing
  `tsx --test` convention) — the first automated coverage this file has ever had. The
  4 giant nested render sub-functions (`FieldInput`/`FieldGroups`/`Inspector`/`ElPreview`)
  and the 50+ hooks/100+ mutation functions inside `Designer()` itself are still in
  `Designer.tsx` — later layers in the same design doc, not yet started.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document designer/ directory split in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage**: the design doc's Layer 0 section names 18 functions across 3 files — all 18 are covered (Tasks 2-4), plus the `types.ts` module the doc didn't spell out but is required to avoid a circular import between `Designer.tsx` and the new files. The doc's broader "~25 functions / ~1,400 lines" framing is only partially covered by design — see the "Scope note" above for exactly what's deferred and why.
- **Placeholder scan**: every step has real, complete code — no "add validation"/"similar to Task N" placeholders.
- **Type consistency**: `SlideButton`/`SlideItem`/`Positionable`/`SlideText`/`EdgeRect`/`GapMark` are defined once (Task 1) and imported by name, unchanged, in Tasks 2-5; function signatures in the "Interfaces" blocks match their implementations verbatim.
