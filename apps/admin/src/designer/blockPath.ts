// Layer 2 of the God Component refactor (see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md and
// docs/superpowers/specs/2026-08-29-designer-layer2-hooks-design.md) —
// `section()` is the one path-indexing helper shared across multiple of the
// new designer/hooks/* modules (useBpStyle, useLiveEditBridge,
// useTemplateLibrary) and Designer()'s own render body, so it lives here
// rather than being owned by any single hook.
//
// removeAt/insertAt/moveWithin/getNode/childrenOf/moveSection/moveColumn
// (the other path-indexing primitives) already live in ../designerTree.ts as
// plain pure functions — that extraction (2026-09-11's "path refactor") pre-
// dates this file, so there is no circular-dependency concern between the
// new hooks importing them: designerTree.ts sits below all of them already.
import type { Block, SectionProps } from "./types";

export function section(bs: Block[], b: number): SectionProps {
  return bs[b].props as unknown as SectionProps;
}
