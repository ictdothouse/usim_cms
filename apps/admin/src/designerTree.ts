import type { Block, El, SectionProps } from "./designer/types";

// Generic, depth-agnostic path primitives for the Section->Row->Column->
// Element tree — added so Designer.tsx's ~40 delete/move/duplicate/copy/
// paste/copy-style/paste-style functions can delegate to ONE shared walker
// instead of each hand-writing its own `blocks[b].props.rows[r].columns[c]
// .elements[e]`-style indexing chain. This is the ONLY place that shape is
// hardcoded now — a future recursive container element only needs to extend
// childrenOf()'s own if/else, not every call site across Designer.tsx.
//
// Every function here takes a `path`/`parentPath: number[]` of whatever
// length actually addresses a real node today (0-4), exactly like the `sel`
// state these paths come from — no change to `sel`'s own type or to any
// mutation function's external signature (still `deleteRow(b, r)` etc, see
// Designer.tsx). Deliberately untyped node values (`unknown`) rather than a
// discriminated union: every existing call site in this codebase already
// casts through `as unknown as SectionProps`/etc at the point of use (see
// `section()` in Designer.tsx), so this matches the established convention
// instead of introducing a new one.

/** The list of children living AT `parentPath` — `[]` is the top-level
 * `blocks` array itself, `[b]` is that section's rows, `[b,r]` that row's
 * columns, `[b,r,c]` that column's elements, `[b,r,c,e]` a container
 * element's own `children` (and each further index one more container level
 * deep — a container's children can include another container). Throws only
 * if some ancestor along the path isn't actually a container (no `children`
 * to descend into), not on depth alone. */
export function childrenOf(blocks: Block[], parentPath: number[]): unknown[] {
  if (parentPath.length === 0) return blocks;
  const [b, r, c] = parentPath;
  if (parentPath.length === 1) return (blocks[b].props as unknown as SectionProps).rows;
  if (parentPath.length === 2) return (blocks[b].props as unknown as SectionProps).rows[r].columns;
  if (parentPath.length === 3) return (blocks[b].props as unknown as SectionProps).rows[r].columns[c].elements;
  let el = (blocks[b].props as unknown as SectionProps).rows[r].columns[c].elements[parentPath[3]] as unknown as El;
  for (let i = 4; i < parentPath.length; i++) {
    if (el.type !== "container") throw new Error(`designerTree: ${JSON.stringify(parentPath.slice(0, i))} is not a container, has no children`);
    el.children = el.children ?? [];
    el = el.children[parentPath[i]];
  }
  if (el.type !== "container") throw new Error(`designerTree: ${JSON.stringify(parentPath)} is not a container, has no children`);
  el.children = el.children ?? [];
  return el.children;
}

/** `path`'s own containing list + index within it — the shared shape
 * get/remove/move all reduce to. */
export function locate(blocks: Block[], path: number[]): { list: unknown[]; index: number } {
  if (path.length === 0) throw new Error("designerTree: locate() needs a non-empty path");
  return { list: childrenOf(blocks, path.slice(0, -1)), index: path[path.length - 1] };
}

export function getNode(blocks: Block[], path: number[]): unknown {
  const { list, index } = locate(blocks, path);
  return list[index];
}

export function removeAt(blocks: Block[], path: number[]): unknown {
  const { list, index } = locate(blocks, path);
  return list.splice(index, 1)[0];
}

export function insertAt(blocks: Block[], parentPath: number[], node: unknown, index?: number): void {
  const list = childrenOf(blocks, parentPath);
  list.splice(index ?? list.length, 0, node);
}

export function moveWithin(blocks: Block[], parentPath: number[], from: number, to: number): void {
  const list = childrenOf(blocks, parentPath);
  list.splice(to, 0, list.splice(from, 1)[0]);
}

// Kept as thin wrappers (rather than migrating their 4 call sites in
// Designer.tsx directly to moveWithin) so this refactor's diff stays
// minimal there — same names, same signatures, same behavior as before.
export function moveSection(blocks: Block[], from: number, to: number): void {
  moveWithin(blocks, [], from, to);
}

export function moveColumn(blocks: Block[], b: number, r: number, from: number, to: number): void {
  moveWithin(blocks, [b, r], from, to);
}
