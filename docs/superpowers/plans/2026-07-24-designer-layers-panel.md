# Designer Layers Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Layers tree tab to Designer's left sidebar — read-only select sync first, then drag-reorder at section/column/element level.

**Architecture:** Pure `apps/admin` UI + one new pure-logic file (`designerTree.ts`) holding `moveSection`/`moveColumn`. No backend/schema change. Reuses existing `sel`/`blocks`/`drag.current`/`dropIntoColumn` machinery in `Designer.tsx`.

**Tech Stack:** React/TSX, native HTML5 drag-and-drop, `t()`/`Key` i18n dict (`i18n.ts`), Node's built-in TS type-stripping for the one self-check script (no test framework in `apps/admin`).

## Global Constraints
- `t(key)` takes no interpolation params — build labels with string concatenation, e.g. `` `${t("designer-layers-section")} ${b + 1}` ``.
- Every new i18n key needs both `ms` and `en` entries in `apps/admin/src/i18n.ts`.
- Spec: `docs/superpowers/specs/2026-07-24-designer-layers-panel-design.md`.

---

### Task 1: Extract move logic + self-check

**Files:**
- Modify: `apps/admin/src/Designer.tsx:174-208` (add `export` to `El`, `Col`, `Row`, `SectionProps`, `Block` interfaces — no other change)
- Create: `apps/admin/src/designerTree.ts`
- Create: `apps/admin/src/designerTree.selfcheck.ts`

**Interfaces:**
- Produces: `moveSection(blocks: Block[], from: number, to: number): void`, `moveColumn(blocks: Block[], b: number, r: number, from: number, to: number): void` — both mutate `blocks` in place (same convention as `mutate((bs) => bs.splice(...))` call sites already in `Designer.tsx`).

- [ ] **Step 1:** In `Designer.tsx`, prefix `interface El`, `interface Col`, `interface Row`, `interface SectionProps`, `interface Block` with `export`.

- [ ] **Step 2:** Create `apps/admin/src/designerTree.ts`:
```ts
import type { Block, SectionProps } from "./Designer";

export function moveSection(blocks: Block[], from: number, to: number): void {
  blocks.splice(to, 0, blocks.splice(from, 1)[0]);
}

export function moveColumn(blocks: Block[], b: number, r: number, from: number, to: number): void {
  const cols = (blocks[b].props as unknown as SectionProps).rows[r].columns;
  cols.splice(to, 0, cols.splice(from, 1)[0]);
}
```

- [ ] **Step 3:** Create `apps/admin/src/designerTree.selfcheck.ts`:
```ts
import assert from "node:assert";
import { moveSection, moveColumn } from "./designerTree.ts";
import type { Block } from "./Designer.ts";

function fixture(): Block[] {
  return [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              { span: 1, elements: [{ id: "e1", type: "text", props: {} }] },
              { span: 1, elements: [{ id: "e2", type: "text", props: {} }] },
            ],
          },
        ],
      },
    },
    { type: "section", props: { rows: [{ columns: [{ span: 1, elements: [] }] }] } },
    { type: "hero", props: {} },
  ] as unknown as Block[];
}

{
  const blocks = fixture();
  moveSection(blocks, 2, 0);
  assert.strictEqual(blocks[0].type, "hero");
  assert.strictEqual(blocks[1].type, "section");
  assert.strictEqual(blocks.length, 3);
}

{
  const blocks = fixture();
  moveColumn(blocks, 0, 0, 1, 0);
  const cols = (blocks[0].props as { rows: { columns: { elements: { id: string }[] }[] }[] }).rows[0].columns;
  assert.strictEqual(cols[0].elements[0].id, "e2");
  assert.strictEqual(cols[1].elements[0].id, "e1");
}

console.log("designerTree self-check passed");
```

- [ ] **Step 4:** Run: `node --experimental-strip-types apps/admin/src/designerTree.selfcheck.ts`
Expected: prints `designerTree self-check passed`, exit code 0. (Run it once *before* Step 2/3 exist too, if following strict red-green — it will fail with a module-not-found error first.)

- [ ] **Step 5:** Commit:
```bash
git add apps/admin/src/Designer.tsx apps/admin/src/designerTree.ts apps/admin/src/designerTree.selfcheck.ts
git commit -m "feat(admin): add moveSection/moveColumn logic with self-check"
```

---

### Task 2: Layers tab shell + read-only tree

**Files:**
- Modify: `apps/admin/src/i18n.ts` (add keys to both `ms` (near line 91) and `en` (near line 481) dicts)
- Modify: `apps/admin/src/Designer.tsx` (import `Layers` icon; add `activeLeftTab` state; tab header; tree render inside the existing `<aside className="w-44 ...">` at line 2099)

**Interfaces:**
- Consumes: `Block`, `Col`, `El`, `Row`, `SectionProps` (Task 1), existing `blocks`, `sel`, `setSel`, `pick`, `ELS` map.
- Produces: local `expanded: Set<string>` state and a `LayersTree()` render function other tasks (Task 3) extend with drag handlers.

- [ ] **Step 1:** Add i18n keys — `ms` block:
```ts
"designer-tab-elements": "Elemen",
"designer-tab-layers": "Lapisan",
"designer-layers-section": "Seksyen",
"designer-layers-row": "Baris",
"designer-layers-column": "Kolum",
"designer-layers-locked": "Blok lama (dikunci)",
```
`en` block (same keys):
```ts
"designer-tab-elements": "Elements",
"designer-tab-layers": "Layers",
"designer-layers-section": "Section",
"designer-layers-row": "Row",
"designer-layers-column": "Column",
"designer-layers-locked": "Legacy block (locked)",
```

- [ ] **Step 2:** Add `Layers` to the `lucide-react` import list at the top of `Designer.tsx` (alongside the existing `ChevronDown, ChevronRight, GripVertical, Lock` imports).

- [ ] **Step 3:** Add state near the other `useState` declarations (~line 662):
```ts
const [activeLeftTab, setActiveLeftTab] = useState<"elements" | "layers">("elements");
const [expanded, setExpanded] = useState<Set<string>>(new Set());
```

- [ ] **Step 4:** Auto-expand ancestors of `sel` — add effect near the existing `sel`-driven effects:
```ts
useEffect(() => {
  if (!sel) return;
  setExpanded((prev) => {
    const next = new Set(prev);
    for (let i = 1; i <= sel.length; i++) next.add(sel.slice(0, i).join("."));
    return next;
  });
}, [sel]);
```

- [ ] **Step 5:** Replace the `<aside className="w-44 ...">` body (line 2099-2119) with a tab header + conditional body:
```tsx
<aside className="w-44 shrink-0 overflow-y-auto border-r border-line/30 bg-white p-3">
  <div className="mb-2 flex gap-1 rounded-lg bg-canvas p-0.5 text-[10px] font-semibold">
    <button
      onClick={() => setActiveLeftTab("elements")}
      className={`flex-1 rounded-md py-1 ${activeLeftTab === "elements" ? "bg-white shadow-sm" : "text-sub"}`}
    >
      {t("designer-tab-elements")}
    </button>
    <button
      onClick={() => setActiveLeftTab("layers")}
      className={`flex-1 rounded-md py-1 ${activeLeftTab === "layers" ? "bg-white shadow-sm" : "text-sub"}`}
    >
      {t("designer-tab-layers")}
    </button>
  </div>
  {activeLeftTab === "elements" ? (
    <div className="space-y-1.5">
      {/* existing designer-elements palette body, unchanged */}
    </div>
  ) : (
    <LayersTree />
  )}
</aside>
```
(Move the existing palette `.map((type) => ...)` block + drop-hint paragraph, currently lines 2100-2118, verbatim into the `elements` branch above — no logic change, just relocated one level deeper.)

- [ ] **Step 6:** Add `LayersTree` as a function inside the component (near `pick`, ~line 1385):
```tsx
function toggleExpand(key: string) {
  setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
}

function LayersTree() {
  return (
    <div className="space-y-0.5 text-xs">
      {blocks.map((block, b) => {
        if (block.type !== "section") {
          return (
            <div key={b} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sub">
              <Lock className="h-3 w-3" /> {t("designer-layers-locked")} ({block.type})
            </div>
          );
        }
        const sp = block.props as unknown as SectionProps;
        const key = `${b}`;
        const isOpen = expanded.has(key);
        const label = sp.anchorId || sp.cssClass || `${t("designer-layers-section")} ${b + 1}`;
        return (
          <div key={b}>
            <div
              className={`flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer ${selEq([b]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"}`}
              onClick={(e) => pick(e, [b])}
            >
              <button onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}>
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <span className="truncate">{label}</span>
            </div>
            {isOpen &&
              sp.rows.map((row, r) => (
                <div key={r} className="ml-3">
                  {sp.rows.length > 1 && (
                    <p className="px-1.5 py-0.5 text-[10px] font-semibold text-sub">
                      {t("designer-layers-row")} {r + 1}
                    </p>
                  )}
                  {row.columns.map((col, c) => {
                    const colKey = `${b}.${r}.${c}`;
                    const colOpen = expanded.has(colKey);
                    return (
                      <div key={c} className="ml-1.5">
                        <div
                          className={`flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer ${selEq([b, r, c]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"}`}
                          onClick={(e) => pick(e, [b, r, c])}
                        >
                          <button onClick={(e) => { e.stopPropagation(); toggleExpand(colKey); }}>
                            {colOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </button>
                          <span className="truncate">
                            {t("designer-layers-column")} {c + 1} ({col.span})
                          </span>
                        </div>
                        {colOpen &&
                          col.elements.map((el, e) => {
                            const Icon = ELS[el.type].icon;
                            return (
                              <div
                                key={el.id}
                                className={`ml-4 flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer ${selEq([b, r, c, e]) ? "bg-accent/10 text-accent" : "hover:bg-canvas"}`}
                                onClick={(ev) => pick(ev, [b, r, c, e])}
                              >
                                <Icon className="h-3 w-3" /> {t(ELS[el.type].labelKey)}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6:** Manual check — run `pnpm dev:admin`, open a page with 2+ sections/columns/elements in Designer, switch to Layers tab, click a section/column/element row, confirm the canvas (or Live Edit iframe) selection outline moves to match, and confirm it also works in reverse (click canvas → tree row highlights + expands).

- [ ] **Step 7:** Run `pnpm --filter @usim-cms/admin typecheck` (or root `pnpm typecheck`). Expected: no new errors.

- [ ] **Step 8:** Commit:
```bash
git add apps/admin/src/i18n.ts apps/admin/src/Designer.tsx
git commit -m "feat(admin): add read-only Layers tree tab to Designer sidebar"
```

---

### Task 3: Drag-reorder in the tree

**Files:**
- Modify: `apps/admin/src/Designer.tsx` (`LayersTree` from Task 2)

**Interfaces:**
- Consumes: `moveSection`, `moveColumn` (Task 1), existing `drag.current`, `dropIntoColumn`, `mutate`.

- [ ] **Step 1:** Add drag state for the insertion-line indicator, near `expanded`:
```ts
const [treeDropHint, setTreeDropHint] = useState<{ key: string; pos: "before" | "after" } | null>(null);
```

- [ ] **Step 2:** Add a shared helper above `LayersTree`:
```ts
function rowDragProps(kind: "section" | "column" | "element", path: number[], key: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      if (kind === "element") drag.current = { kind: "move", path };
      else drag.current = { kind: "tree-reorder", treeKind: kind, path };
    },
    onDragEnd: () => (drag.current = null),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      setTreeDropHint({ key, pos });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = drag.current;
      drag.current = null;
      const hint = treeDropHint;
      setTreeDropHint(null);
      if (!d || !hint) return;
      if (kind === "element" && d.kind === "move") {
        dropIntoColumn([path[0], path[1], path[2]], hint.pos === "before" ? path[3] : path[3] + 1);
        return;
      }
      if (d.kind !== "tree-reorder" || d.treeKind !== kind) return;
      const to = hint.pos === "before" ? path[path.length - 1] : path[path.length - 1] + 1;
      const from = d.path[d.path.length - 1];
      const adjustedTo = from < to ? to - 1 : to;
      if (kind === "section") mutate((bs) => moveSection(bs, from, adjustedTo));
      else mutate((bs) => moveColumn(bs, path[0], path[1], from, adjustedTo));
    },
  };
}
```

- [ ] **Step 3:** Extend `drag.current`'s ref type union (wherever it's declared, e.g. `useRef<{ kind: "new"; type: ElType } | { kind: "move"; path: number[] } | null>`) to also allow `{ kind: "tree-reorder"; treeKind: "section" | "column"; path: number[] }`.

- [ ] **Step 4:** Spread `rowDragProps(...)` onto each row's outer `<div>` in `LayersTree` (Task 2): section row gets `{...rowDragProps("section", [b], key)}`, column row gets `{...rowDragProps("column", [b, r, c], colKey)}`, element row gets `{...rowDragProps("element", [b, r, c, e], \`${b}.${r}.${c}.${e}\`)}`. Render a 1px accent-colored line above/below a row when `treeDropHint?.key === thatRow'sKey`.

- [ ] **Step 5:** Manual check — in Layers tab, drag a section row above another section, confirm order changes on canvas; drag a column within the same row, confirm reorder; drag an element to a different column, confirm it reparents (same as existing canvas element drag).

- [ ] **Step 6:** Run `node --experimental-strip-types apps/admin/src/designerTree.selfcheck.ts` again (still passes — logic untouched) and `pnpm --filter @usim-cms/admin typecheck`.

- [ ] **Step 7:** Commit:
```bash
git add apps/admin/src/Designer.tsx
git commit -m "feat(admin): drag-reorder sections/columns/elements from Layers tree"
```

---

## Self-Review Notes
- Spec coverage: A (placement) → Task 2 Step 5; B (labels/expand) → Task 2 Step 6; C (selection sync) → Task 2 Steps 4/6 (relies on existing effects, confirmed no new plumbing needed); D (drag-reorder, row-scoped column move) → Task 3; E (i18n) → Task 2 Step 1; F (verification) → Task 1.
- No placeholders — every step has real code or an exact command.
- `moveSection`/`moveColumn` signatures match between Task 1 (definition) and Task 3 (call sites).
