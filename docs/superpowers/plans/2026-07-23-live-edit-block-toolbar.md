# Live Edit Floating Block-Action Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Live Edit mode a floating toolbar (Duplicate/Copy/Paste/Copy style/Paste style/Delete) for the currently selected section/column/element, positioned over its on-screen location inside the iframe — matching exactly what Blocks mode already offers at each level, no more.

**Architecture:** `apps/frontend/src/layouts/BaseLayout.astro`'s existing selection-outline script gains a `ResizeObserver` + scroll listener on the selected node, reporting its bounding box to the parent via a new `designer:selectedRect` postMessage. `apps/admin/src/Designer.tsx` extracts its existing per-level action handlers (currently inline closures in `BlockControls`/`Inspector`) into named functions, then a new `LiveEditToolbar` component calls those same functions, positioned using the reported rect plus the iframe's own page position.

**Tech Stack:** React (admin), Astro inline `<script>` (frontend), no new dependencies.

## Global Constraints

- The toolbar's button set per selection level must match Blocks mode's existing capability exactly: section gets Duplicate/Copy/Paste/Copy style/Paste style/Delete; column gets Copy/Paste/Copy style/Paste style/Delete (no Duplicate); element gets Duplicate/Copy/Paste/Copy style/Paste style/Delete. Do not add a capability to any level Blocks mode doesn't already have there.
- Every extracted action function must produce byte-identical behavior to the inline closure it replaces — this is a refactor-then-extend, not a rewrite. `BlockControls` and `Inspector`'s existing buttons must keep working exactly as before, now calling the extracted functions instead of duplicating the logic inline.
- No new npm dependency — `ResizeObserver` and pointer events are already used elsewhere in this same file (`BaseLayout.astro`'s drag-reorder code) and are native browser APIs.
- The Inspector sidebar is unaffected — it keeps rendering and editing exactly as it does today, in both modes, alongside the new toolbar.

---

## Task 1: Extract shared per-level action functions in `Designer.tsx`

**Files:**
- Modify: `apps/admin/src/Designer.tsx` (`BlockControls`, `Inspector()`)

**Interfaces:**
- Produces: `duplicateSection(b)`, `copySection(b)`, `pasteSection(b)`, `copyStyleSection(b)`, `pasteStyleSection(b)`, `deleteSection(b)`; `copyColumn(b,r,c)`, `pasteColumn(b,r,c)`, `copyStyleColumn(b,r,c)`, `pasteStyleColumn(b,r,c)`, `deleteColumn(b,r,c)`; `duplicateElement(b,r,c,e)`, `copyElement(b,r,c,e)`, `pasteElement(b,r,c,e)`, `copyStyleElement(b,r,c,e)`, `pasteStyleElement(b,r,c,e)`, `deleteElement(b,r,c,e)` — all defined as inner functions of the `Designer` component (same scope as `mutate`/`section`/`clipCopy`/etc., which they call), consumed by Task 3's `LiveEditToolbar`.

These all close over `mutate`, `setSel`, `clipCopy`/`clipRead`/`clipHas`, `styleCopy`/`styleRead`/`styleHas`, `section`, `removeAt`, `insertEl`, `clone`, `uid`, `blocks` — all already defined in the `Designer` component (`apps/admin/src/Designer.tsx:648-946`). Place the new functions right after `insertEl` (`apps/admin/src/Designer.tsx:941-945`), before `dropIntoColumn`.

- [ ] **Step 1: Add the 6 section-level functions**

Insert after `insertEl`:

```ts
  function duplicateSection(b: number) {
    mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])));
  }
  function copySection(b: number) {
    clipCopy("section", blocks[b]);
  }
  function pasteSection(b: number) {
    const data = clipRead<Block>("section");
    if (data) mutate((bs) => bs.splice(b + 1, 0, clone(data)));
  }
  function copyStyleSection(b: number) {
    // rows is the section's content (children), never its "style" —
    // stripped so pasting style elsewhere can't overwrite content.
    const { rows: _rows, ...styleProps } = blocks[b].props as unknown as SectionProps;
    styleCopy("section", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleSection(b: number) {
    const style = styleRead("section");
    if (style) mutate((bs) => Object.assign(bs[b].props, style));
  }
  function deleteSection(b: number) {
    mutate((bs) => {
      bs.splice(b, 1);
    });
    setSel(null);
  }
```

- [ ] **Step 2: Add the 5 column-level functions**

Insert directly after the section-level functions:

```ts
  function copyColumn(b: number, r: number, c: number) {
    clipCopy("column", section(blocks, b).rows[r].columns[c]);
  }
  function pasteColumn(b: number, r: number, c: number) {
    const data = clipRead<Col>("column");
    if (data) mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
  }
  function copyStyleColumn(b: number, r: number, c: number) {
    styleCopy("column", section(blocks, b).rows[r].columns[c].props ?? {});
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
  }
```

- [ ] **Step 3: Add the 6 element-level functions**

Insert directly after the column-level functions:

```ts
  function duplicateElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => {
      const src = section(bs, b).rows[r].columns[c].elements[e];
      section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
    });
  }
  function copyElement(b: number, r: number, c: number, e: number) {
    clipCopy("element", section(blocks, b).rows[r].columns[c].elements[e]);
  }
  function pasteElement(b: number, r: number, c: number, e: number) {
    const data = clipRead<El>("element");
    if (data) mutate((bs) => insertEl(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
  }
  function copyStyleElement(b: number, r: number, c: number, e: number) {
    const el = section(blocks, b).rows[r].columns[c].elements[e];
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
    mutate((bs) => {
      removeAt(bs, [b, r, c, e]);
    });
    setSel(null);
  }
```

- [ ] **Step 4: Rewire `BlockControls` to call the extracted section-level functions**

Find (`apps/admin/src/Designer.tsx:1658-1713`):

```tsx
        <button
          onClick={() => mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])))}
          className="px-0.5 text-accent"
          title={t("designer-duplicate")}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => clipCopy("section", blocks[b])} className="px-0.5 text-accent" title={t("designer-copy")}>
          <Clipboard className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            const data = clipRead<Block>("section");
            if (data) mutate((bs) => bs.splice(b + 1, 0, clone(data)));
          }}
          disabled={!clipHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste")}
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            // rows is the section's content (children), never its "style" —
            // stripped so pasting style elsewhere can't overwrite content.
            const { rows: _rows, ...styleProps } = blocks[b].props as unknown as SectionProps;
            styleCopy("section", styleProps as unknown as Record<string, string>);
          }}
          className="px-0.5 text-accent"
          title={t("designer-copy-style")}
        >
          <Paintbrush className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            const style = styleRead("section");
            if (style) mutate((bs) => Object.assign(bs[b].props, style));
          }}
          disabled={!styleHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button
          onClick={() => {
            mutate((bs) => {
              bs.splice(b, 1);
            });
            setSel(null);
          }}
          className="px-0.5 text-red-500"
          title={t("designer-delete")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
```

Replace with:

```tsx
        <button onClick={() => duplicateSection(b)} className="px-0.5 text-accent" title={t("designer-duplicate")}>
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => copySection(b)} className="px-0.5 text-accent" title={t("designer-copy")}>
          <Clipboard className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteSection(b)}
          disabled={!clipHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste")}
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <button onClick={() => copyStyleSection(b)} className="px-0.5 text-accent" title={t("designer-copy-style")}>
          <Paintbrush className="h-3 w-3" />
        </button>
        <button
          onClick={() => pasteStyleSection(b)}
          disabled={!styleHas("section")}
          className="px-0.5 text-accent disabled:opacity-30"
          title={t("designer-paste-style")}
        >
          <Paintbrush className="h-3 w-3 opacity-50" />
        </button>
        <button onClick={() => deleteSection(b)} className="px-0.5 text-red-500" title={t("designer-delete")}>
          <Trash2 className="h-3 w-3" />
        </button>
```

- [ ] **Step 5: Rewire the Inspector's column-level buttons**

Find (`apps/admin/src/Designer.tsx:1322-1372`):

```tsx
          <div className="flex gap-3">
            <button
              onClick={() => clipCopy("column", col)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => {
                const data = clipRead<Col>("column");
                if (data) mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
              }}
              disabled={!clipHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button
              onClick={() => styleCopy("column", col.props ?? {})}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => {
                const style = styleRead("column");
                if (style)
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c];
                    target.props = { ...(target.props ?? {}), ...style };
                  });
              }}
              disabled={!styleHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <button
            onClick={() => {
              mutate((bs) => {
                const row = section(bs, b).rows[r];
                row.columns.splice(c, 1);
                if (row.columns.length === 0) section(bs, b).rows.splice(r, 1);
              });
              setSel(null);
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
```

Replace with:

```tsx
          <div className="flex gap-3">
            <button onClick={() => copyColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => pasteColumn(b, r, c)}
              disabled={!clipHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button onClick={() => copyStyleColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => pasteStyleColumn(b, r, c)}
              disabled={!styleHas("column")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <button onClick={() => deleteColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
```

- [ ] **Step 6: Rewire the Inspector's element-level buttons**

Find (`apps/admin/src/Designer.tsx:1415-1476`):

```tsx
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => clipCopy("element", el)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => {
                const data = clipRead<El>("element");
                if (data) mutate((bs) => insertEl(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
              }}
              disabled={!clipHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button
              onClick={() => styleCopy("element", el.props, el.type)}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => {
                const style = styleRead("element");
                if (style)
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.props = { ...target.props, ...style };
                  });
              }}
              disabled={!styleHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() =>
                mutate((bs) => {
                  const src = section(bs, b).rows[r].columns[c].elements[e];
                  section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
                })
              }
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button
              onClick={() => {
                mutate((bs) => {
                  removeAt(bs, sel);
                });
                setSel(null);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
            </button>
          </div>
```

Replace with:

```tsx
          <div className="flex flex-wrap gap-3">
            <button onClick={() => copyElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
            </button>
            <button
              onClick={() => pasteElement(b, r, c, e)}
              disabled={!clipHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
            </button>
            <button onClick={() => copyStyleElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
            </button>
            <button
              onClick={() => pasteStyleElement(b, r, c, e)}
              disabled={!styleHas("element")}
              className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            >
              <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={() => duplicateElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button onClick={() => deleteElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
              <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
            </button>
          </div>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: no errors.

- [ ] **Step 8: Manual smoke check (no test harness exists for `Designer.tsx` today)**

Run `pnpm dev:admin`, open a page's Designer in Blocks mode, and confirm section/column/element Duplicate/Copy/Paste/Copy style/Paste style/Delete all still work exactly as before (this step is a pure refactor — behavior must be unchanged).

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/Designer.tsx
git commit -m "refactor(admin): extract Designer's per-level block actions into named functions"
```

---

## Task 2: `designer:selectedRect` bridge message in `BaseLayout.astro`

**Files:**
- Modify: `apps/frontend/src/layouts/BaseLayout.astro:199-206`

**Interfaces:**
- Produces: a `designer:selectedRect` postMessage, `{ type: "designer:selectedRect", rect: { top: number, left: number, width: number, height: number } }`, sent to `document.referrer`'s origin whenever the selected node's box changes (resize) or the page scrolls. Consumed by Task 3.

- [ ] **Step 1: Track a `ResizeObserver` and scroll listener alongside the existing selection handling**

Find (`apps/frontend/src/layouts/BaseLayout.astro:182-206`):

```js
          let selectedNode = null;
          let hoveredNode = null;
          document.addEventListener("pointerover", (e) => {
            const node = e.target.closest("[data-designer-path]");
            if (node === hoveredNode) return;
            if (hoveredNode && hoveredNode !== selectedNode) visualTarget(hoveredNode).style.outline = "";
            hoveredNode = node;
            if (node && node !== selectedNode && !dragState) {
              visualTarget(node).style.outline = "1px dashed rgba(15,98,254,0.55)";
            }
          });
          document.addEventListener("pointerout", (e) => {
            if (e.target.closest("[data-designer-path]") !== hoveredNode) return;
            if (hoveredNode && hoveredNode !== selectedNode) visualTarget(hoveredNode).style.outline = "";
            hoveredNode = null;
          });

          window.addEventListener("message", (e) => {
            if (e.origin !== targetOrigin || !e.data) return;
            if (e.data.type === "designer:selected") {
              if (selectedNode) visualTarget(selectedNode).style.outline = "";
              selectedNode = e.data.path ? findByPath(e.data.path) : null;
              if (selectedNode) visualTarget(selectedNode).style.outline = "2px solid #0f62fe";
              return;
            }
```

Replace with (adds the observer/listener setup and teardown, and a `reportSelectedRect` helper reused by both triggers):

```js
          let selectedNode = null;
          let hoveredNode = null;
          document.addEventListener("pointerover", (e) => {
            const node = e.target.closest("[data-designer-path]");
            if (node === hoveredNode) return;
            if (hoveredNode && hoveredNode !== selectedNode) visualTarget(hoveredNode).style.outline = "";
            hoveredNode = node;
            if (node && node !== selectedNode && !dragState) {
              visualTarget(node).style.outline = "1px dashed rgba(15,98,254,0.55)";
            }
          });
          document.addEventListener("pointerout", (e) => {
            if (e.target.closest("[data-designer-path]") !== hoveredNode) return;
            if (hoveredNode && hoveredNode !== selectedNode) visualTarget(hoveredNode).style.outline = "";
            hoveredNode = null;
          });

          // Reports the selected node's on-screen box so Designer.tsx can
          // position a floating action toolbar over it — recomputed on
          // resize (ResizeObserver, covers a live style edit changing the
          // box, or the iframe's own container resizing) and on scroll
          // (position-only change, no size change, so ResizeObserver alone
          // wouldn't fire).
          function reportSelectedRect() {
            if (!selectedNode) return;
            const r = visualTarget(selectedNode).getBoundingClientRect();
            parent.postMessage(
              { type: "designer:selectedRect", rect: { top: r.top, left: r.left, width: r.width, height: r.height } },
              targetOrigin,
            );
          }
          const selectionResizeObserver = new ResizeObserver(reportSelectedRect);
          window.addEventListener("scroll", reportSelectedRect, true);

          window.addEventListener("message", (e) => {
            if (e.origin !== targetOrigin || !e.data) return;
            if (e.data.type === "designer:selected") {
              if (selectedNode) visualTarget(selectedNode).style.outline = "";
              selectionResizeObserver.disconnect();
              selectedNode = e.data.path ? findByPath(e.data.path) : null;
              if (selectedNode) {
                visualTarget(selectedNode).style.outline = "2px solid #0f62fe";
                selectionResizeObserver.observe(visualTarget(selectedNode));
                reportSelectedRect();
              }
              return;
            }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @usim-cms/frontend typecheck`
Expected: `0 errors`. (This is inline `<script is:inline>` plain JS, not type-checked by `astro check` beyond the surrounding `.astro` file parsing — the command still confirms the file itself parses.)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/layouts/BaseLayout.astro
git commit -m "feat(frontend): report selected block's bounding rect for Live Edit toolbar"
```

---

## Task 3: `LiveEditToolbar` component in `Designer.tsx`

**Files:**
- Modify: `apps/admin/src/Designer.tsx`

**Interfaces:**
- Consumes: Task 1's extracted functions; Task 2's `designer:selectedRect` message.
- Produces: a `LiveEditToolbar` component, rendered only in Live Edit mode.

- [ ] **Step 1: Add `selectedRect` state and clear it whenever the selection changes**

Find (`apps/admin/src/Designer.tsx:661-685`, the state block):

```ts
  const [blocks, setBlocks] = useState<Block[]>(() => clone((page.layout as Block[] | undefined) ?? []));
  const [sel, setSel] = useState<Sel>(null);
```

Add a new state var right after `sel`:

```ts
  const [blocks, setBlocks] = useState<Block[]>(() => clone((page.layout as Block[] | undefined) ?? []));
  const [sel, setSel] = useState<Sel>(null);
  // Reported by BaseLayout.astro's designer:selectedRect message — the
  // selected node's on-screen box inside the iframe, used to position
  // LiveEditToolbar. Cleared below whenever `sel` itself changes so a stale
  // rect never positions the toolbar over the wrong element while the new
  // one's first report is in flight.
  const [selectedRect, setSelectedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
```

Add a small effect right after the `mutate`/`undo`/`redo` block (after `apps/admin/src/Designer.tsx:713`, before the clipboard helpers):

```ts
  useEffect(() => {
    setSelectedRect(null);
  }, [sel]);
```

- [ ] **Step 2: Handle the new message and track iframe/window layout changes**

Find the existing message listener (`apps/admin/src/Designer.tsx:768-800`):

```ts
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
```

Add one more branch, right before the `designer:select` check (order doesn't matter, but this keeps rect handling visually grouped with its own early-return shape):

```ts
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (e.data?.type === "designer:selectedRect") {
        setSelectedRect(e.data.rect ?? null);
        return;
      }
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
```

- [ ] **Step 3: Add a resize tick so the toolbar's position recomputes on window resize**

Add right after the `selectedRect` effect from Step 1:

```ts
  // Forces a re-render on window resize so LiveEditToolbar's position (which
  // reads liveFrame.current.getBoundingClientRect() directly at render time,
  // not from state) picks up the iframe's new page position even when
  // selectedRect itself hasn't changed.
  const [, bumpLayoutTick] = useState(0);
  useEffect(() => {
    const onResize = () => bumpLayoutTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
```

- [ ] **Step 4: Add the `LiveEditToolbar` component**

Add it directly after `BlockControls` (`apps/admin/src/Designer.tsx:1716`, right before `// ---------- render ----------`):

```tsx
  // Floating action toolbar for Live Edit mode — same actions Blocks mode
  // already has at the matching selection level (see Task 1's extracted
  // functions), positioned over the selected block using selectedRect
  // (reported by BaseLayout.astro) plus the iframe's own page position.
  function LiveEditToolbar() {
    if (!sel || !selectedRect || !liveFrame.current) return null;
    const iframeRect = liveFrame.current.getBoundingClientRect();
    const top = iframeRect.top + selectedRect.top;
    const left = iframeRect.left + selectedRect.left;
    const toolbarHeight = 32;
    const showBelow = top < toolbarHeight + 8;
    const style: React.CSSProperties = {
      position: "fixed",
      left,
      top: showBelow ? top + selectedRect.height + 4 : top - toolbarHeight - 4,
      zIndex: 50,
    };
    const iconBtn = "flex items-center justify-center rounded p-1 text-accent hover:bg-canvas disabled:opacity-30";
    if (sel.length === 1) {
      const [b] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => duplicateSection(b)} className={iconBtn} title={t("designer-duplicate")}><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={() => copySection(b)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteSection(b)} disabled={!clipHas("section")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleSection(b)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleSection(b)} disabled={!styleHas("section")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteSection(b)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    if (sel.length === 3) {
      const [b, r, c] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => copyColumn(b, r, c)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteColumn(b, r, c)} disabled={!clipHas("column")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleColumn(b, r, c)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleColumn(b, r, c)} disabled={!styleHas("column")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteColumn(b, r, c)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    if (sel.length === 4) {
      const [b, r, c, e] = sel;
      return (
        <div style={style} className="flex items-center gap-0.5 rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          <button onClick={() => duplicateElement(b, r, c, e)} className={iconBtn} title={t("designer-duplicate")}><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyElement(b, r, c, e)} className={iconBtn} title={t("designer-copy")}><Clipboard className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteElement(b, r, c, e)} disabled={!clipHas("element")} className={iconBtn} title={t("designer-paste")}><ClipboardPaste className="h-3.5 w-3.5" /></button>
          <button onClick={() => copyStyleElement(b, r, c, e)} className={iconBtn} title={t("designer-copy-style")}><Paintbrush className="h-3.5 w-3.5" /></button>
          <button onClick={() => pasteStyleElement(b, r, c, e)} disabled={!styleHas("element")} className={iconBtn} title={t("designer-paste-style")}><Paintbrush className="h-3.5 w-3.5 opacity-50" /></button>
          <button onClick={() => deleteElement(b, r, c, e)} className={`${iconBtn} text-red-500`} title={t("designer-delete")}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    return null;
  }
```

- [ ] **Step 5: Render it next to the Live Edit iframe**

Find (`apps/admin/src/Designer.tsx:1855-1861`):

```tsx
        {mode === "live" ? (
          <iframe
            ref={liveFrame}
            src={liveSrc ?? undefined}
            className="min-w-0 flex-1 border-0 bg-white"
            title="live-view"
          />
        ) : (
```

Replace with:

```tsx
        {mode === "live" ? (
          <>
            <iframe
              ref={liveFrame}
              src={liveSrc ?? undefined}
              className="min-w-0 flex-1 border-0 bg-white"
              title="live-view"
            />
            <LiveEditToolbar />
          </>
        ) : (
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @usim-cms/admin typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke check**

Run `pnpm dev:admin` and `pnpm dev:frontend`, open a page's Designer, stay in (default) Live Edit mode, click a section/column/element in the iframe, and confirm:
- The toolbar appears positioned just above (or below, near the viewport top) the selected box.
- Each button produces the same result as the equivalent Blocks-mode/Inspector control (duplicate inserts a copy after the original, delete removes it and clears selection, paste/paste-style are disabled until something's been copied, etc.).
- Scrolling the iframe and resizing the browser window keep the toolbar aligned with the selected box.
- The Inspector sidebar still shows and edits the same selection's fields at the same time.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/Designer.tsx
git commit -m "feat(admin): add floating block-action toolbar to Live Edit mode"
```

---

## Final verification

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm typecheck`
Expected: all 3 packages report 0 errors.

- [ ] **Step 2: Push**

```bash
git push
```
