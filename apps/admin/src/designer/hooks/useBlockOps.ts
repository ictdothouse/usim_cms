// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — the largest single
// extraction: every section/row/column/element copy/paste/duplicate/
// delete/move/nudge function, plus isSectionLocked and the canvas
// drop-target handler (dropIntoColumn).
//
// removeAt/insertAt/getNode/childrenOf/moveWithin (the path-indexing
// primitives every function here calls) already live in ../../designerTree
// as plain pure functions — imported directly, not passed in as params.
import { useRef } from "react";
import { toast } from "sonner";
import type { Key } from "@/i18n";
import { getNode, childrenOf, insertAt, removeAt, moveWithin } from "../../designerTree";
import { ELS } from "../elements";
import type { Block, Col, Row, El, ElType, Sel, SectionProps, Drag } from "../types";
import type { ClipLevel } from "../context";
import { clone } from "@/lib/utils";

const uid = () => Math.random().toString(36).slice(2, 10);
const newEl = (type: ElType): El => ({ id: uid(), type, props: { ...ELS[type].defaults } });

export interface BlockOpsClipboard {
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
}

export interface BlockOpsDeps {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
  clipboard: BlockOpsClipboard;
  setDropHint: (v: string | null) => void;
}

// Pulled out of useBlockOps() so the actual mutate/clipboard/lock-check
// logic — everything worth testing — is callable with a plain injected
// `drag` ref object, no React renderer needed (useRef itself can't be
// called outside a component/hook context).
function blockOpsFns(deps: BlockOpsDeps, drag: { current: Drag | null }) {
  const { blocks, mutate, setSel, bumpStructural, isSuper, t, clipboard, setDropHint } = deps;
  const { clipCopy, clipRead, styleCopy, styleRead } = clipboard;

  // A superadmin can mark a Section `locked` (props.locked === "true") so it
  // survives edits by a non-superadmin unchanged — e.g. a blueprint's
  // mandated footer/CTA section that shouldn't be removable once cloned into
  // a real page. Only the functions below that actually mutate a locked
  // section's own content check this (duplicate/copy/paste-after/move/save-
  // as-template leave it untouched, so those stay enabled even on a locked
  // section) — this is UX only: the real gate is apps/api's
  // pagesBeforeChange, which rejects any save that changes or removes a
  // locked section regardless of what the client sends.
  function isSectionLocked(b: number): boolean {
    return !isSuper && (blocks[b]?.props as unknown as SectionProps | undefined)?.locked === "true";
  }

  function duplicateSection(b: number) {
    mutate((bs) => insertAt(bs, [], clone(getNode(bs, [b])), b + 1));
    bumpStructural();
  }
  function copySection(b: number) {
    clipCopy("section", blocks[b]);
  }
  function pasteSection(b: number) {
    const data = clipRead<Block>("section");
    if (data) {
      mutate((bs) => insertAt(bs, [], clone(data), b + 1));
      bumpStructural();
    }
  }
  function copyStyleSection(b: number) {
    // rows is the section's content (children), never its "style" —
    // stripped so pasting style elsewhere can't overwrite content.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring-omit: strips rows from the copied style props
    const { rows: _rows, ...styleProps } = blocks[b].props as unknown as SectionProps;
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
    mutate((bs) => {
      removeAt(bs, [b]);
    });
    setSel(null);
    bumpStructural();
  }

  function duplicateColumn(b: number, r: number, c: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => insertAt(bs, [b, r], clone(getNode(bs, [b, r, c]) as Col), c + 1));
    bumpStructural();
  }
  function copyColumn(b: number, r: number, c: number) {
    clipCopy("column", getNode(blocks, [b, r, c]) as Col);
  }
  function pasteColumn(b: number, r: number, c: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const data = clipRead<Col>("column");
    if (data) {
      mutate((bs) => insertAt(bs, [b, r], clone(data), c + 1));
      bumpStructural();
    }
  }
  function copyStyleColumn(b: number, r: number, c: number) {
    styleCopy("column", (getNode(blocks, [b, r, c]) as Col).props ?? {});
  }
  function pasteStyleColumn(b: number, r: number, c: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const style = styleRead("column");
    if (style)
      mutate((bs) => {
        const target = getNode(bs, [b, r, c]) as Col;
        target.props = { ...(target.props ?? {}), ...style };
      });
  }
  function deleteColumn(b: number, r: number, c: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => {
      removeAt(bs, [b, r, c]);
      if ((childrenOf(bs, [b, r]) as Col[]).length === 0) removeAt(bs, [b, r]);
    });
    setSel(null);
    bumpStructural();
  }
  // Named distinctly from designerTree.ts's imported `moveColumn` (a bulk
  // from/to array-mutation helper) — this one is the arrow-button single-step
  // nudge. They used to share a name, which let this local function
  // declaration (hoisted) shadow the import for the whole component body,
  // breaking the imported moveColumn's real call sites.
  function nudgeColumn(b: number, r: number, c: number, dir: -1 | 1) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const target = c + dir;
    if (target < 0 || target >= (childrenOf(blocks, [b, r]) as Col[]).length) return;
    mutate((bs) => moveWithin(bs, [b, r], c, target));
    setSel([b, r, target]);
    bumpStructural();
  }
  // A freshly added-row preset has columns but no elements in them yet — the
  // only way to remove it was previously to delete each of its columns one
  // at a time (deleteColumn only cascades to the row once its last column is
  // gone). This is the direct one-click equivalent.
  function deleteRow(b: number, r: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => removeAt(bs, [b, r]));
    setSel(null);
    bumpStructural();
  }
  function moveRow(b: number, r: number, dir: -1 | 1) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const target = r + dir;
    if (target < 0 || target >= (childrenOf(blocks, [b]) as Row[]).length) return;
    mutate((bs) => moveWithin(bs, [b], r, target));
    setSel([b, target]);
    bumpStructural();
  }
  function duplicateRow(b: number, r: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => insertAt(bs, [b], clone(getNode(bs, [b, r]) as Row), r + 1));
    bumpStructural();
  }
  function copyRow(b: number, r: number) {
    clipCopy("row", getNode(blocks, [b, r]) as Row);
  }
  function pasteRow(b: number, r: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const data = clipRead<Row>("row");
    if (data) {
      mutate((bs) => insertAt(bs, [b], clone(data), r + 1));
      bumpStructural();
    }
  }
  function copyStyleRow(b: number, r: number) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring-omit: strips columns from the copied style props
    const { columns: _columns, ...styleProps } = getNode(blocks, [b, r]) as Row;
    styleCopy("row", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleRow(b: number, r: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const style = styleRead("row");
    if (style) mutate((bs) => Object.assign(getNode(bs, [b, r]) as Row, style));
  }
  function setRowGap(b: number, r: number, gap: string | undefined) {
    mutate((bs) => {
      (getNode(bs, [b, r]) as Row).gap = gap;
    });
  }

  function duplicateElement(b: number, r: number, c: number, e: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => {
      const src = getNode(bs, [b, r, c, e]) as El;
      insertAt(bs, [b, r, c], { ...clone(src), id: uid() }, e + 1);
    });
    bumpStructural();
  }
  function copyElement(b: number, r: number, c: number, e: number) {
    clipCopy("element", getNode(blocks, [b, r, c, e]) as El);
  }
  function pasteElement(b: number, r: number, c: number, e: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const data = clipRead<El>("element");
    if (data) {
      mutate((bs) => insertAt(bs, [b, r, c], { ...clone(data), id: uid() }, e + 1));
      bumpStructural();
    }
  }
  function copyStyleElement(b: number, r: number, c: number, e: number) {
    const el = getNode(blocks, [b, r, c, e]) as El;
    styleCopy("element", el.props, el.type);
  }
  function pasteStyleElement(b: number, r: number, c: number, e: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const style = styleRead("element");
    if (style)
      mutate((bs) => {
        const target = getNode(bs, [b, r, c, e]) as El;
        target.props = { ...target.props, ...style };
      });
  }
  function deleteElement(b: number, r: number, c: number, e: number) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => {
      removeAt(bs, [b, r, c, e]);
    });
    setSel(null);
    bumpStructural();
  }
  function moveElement(b: number, r: number, c: number, e: number, dir: -1 | 1) {
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const target = e + dir;
    if (target < 0 || target >= (childrenOf(blocks, [b, r, c]) as El[]).length) return;
    mutate((bs) => moveWithin(bs, [b, r, c], e, target));
    setSel([b, r, c, target]);
    bumpStructural();
  }

  function dropIntoColumn(colPath: number[], index?: number) {
    const d = drag.current;
    drag.current = null;
    setDropHint(null);
    // Layers-tree section/column reorders are handled entirely by rowDragProps'
    // own onDrop — a stray drop onto a canvas column must not fall through to
    // the "move" (element) branch below, which would destructure this payload's
    // section/column path as if it were an element's [b, r, c, e] path.
    if (!d || d.kind === "tree-reorder") return;
    if (isSectionLocked(colPath[0]) || (d.kind !== "new" && isSectionLocked(d.path[0]))) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    mutate((bs) => {
      if (d.kind === "new") {
        insertAt(bs, colPath, newEl(d.type), index);
        return;
      }
      const [sb, sr, sc, se] = d.path;
      let idx = index;
      // same-column move: removing the source first shifts later indexes down
      if (idx !== undefined && sb === colPath[0] && sr === colPath[1] && sc === colPath[2] && se < idx) idx--;
      const el = removeAt(bs, d.path);
      insertAt(bs, colPath, el, idx);
    });
    setSel(null);
  }

  return {
    drag,
    isSectionLocked,
    duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
    duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
    deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
    dropIntoColumn,
  };
}

export function __testOnly_blockOpsFns(deps: BlockOpsDeps) {
  return blockOpsFns(deps, { current: null });
}

export function useBlockOps(deps: BlockOpsDeps) {
  // Canvas drag-in-progress descriptor — read/written by dropIntoColumn and
  // by Designer()'s own drag-start handlers (unchanged, still resident
  // there since those are render-event-handler plumbing, not a block-tree
  // operation).
  const drag = useRef<Drag | null>(null);
  return blockOpsFns(deps, drag);
}
