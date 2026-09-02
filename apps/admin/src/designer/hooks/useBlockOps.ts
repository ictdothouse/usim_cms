import { section } from "../blockPath";
import type { Key } from "../../i18n";
import { toast } from "sonner";
import type { Block, Col, El, ElType, Row, Sel, SectionProps } from "../types";
import type { ClipLevel } from "./useClipboard";

// Designer.tsx keeps its own copy of this same one-liner for its remaining
// (non-extracted) mutate-adjacent call sites — not shared via an import,
// same convention useUndoRedo.ts already established (see its own comment).
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uid = () => Math.random().toString(36).slice(2, 10);

type ClipboardOps = {
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
};

// Section/row/column/element duplicate/copy/paste/copy-style/paste-style/
// delete(/move/nudge) actions — extracted from BlockControls/Inspector's
// inline closures so both those and LiveEditToolbar (Live Edit mode) call
// one shared implementation per action+level instead of re-deriving the same
// splice/clip logic. Stateless — a plain bundle of closures over its params,
// same pattern as blockPath.ts, recreated fresh every render by useBlockOps
// below (no internal useState/useRef of its own).
function blockOpsFns(params: {
  getBlocks: () => Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  clipboard: ClipboardOps;
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
}) {
  const { getBlocks, mutate, setSel, clipboard, bumpStructural, isSuper, t } = params;
  const { clipCopy, clipRead, styleCopy, styleRead } = clipboard;

  // Section lock (Page Blueprint deferred item) — a superadmin can mark a
  // section `locked` (props.locked === "true", toggled in the Inspector) so
  // a non-superadmin can view it but never mutate it. Only delete and
  // paste-style actually overwrite the locked section's own content (every
  // other section action — duplicate, copy, paste-after, move, save-as-
  // template — leaves it untouched, so those stay enabled). This is UX
  // only: the real gate is apps/api's pagesBeforeChange, which rejects any
  // save that changes or removes a locked section regardless of what the
  // client sends.
  function isSectionLocked(b: number): boolean {
    return !isSuper && (getBlocks()[b]?.props as unknown as SectionProps | undefined)?.locked === "true";
  }
  function duplicateSection(b: number) {
    mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])));
    bumpStructural();
  }
  function copySection(b: number) {
    clipCopy("section", getBlocks()[b]);
  }
  function pasteSection(b: number) {
    const data = clipRead<Block>("section");
    if (data) {
      mutate((bs) => bs.splice(b + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleSection(b: number) {
    // rows is the section's content (children), never its "style" —
    // stripped so pasting style elsewhere can't overwrite content.
    const { rows: _rows, ...styleProps } = getBlocks()[b].props as unknown as SectionProps;
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
      bs.splice(b, 1);
    });
    setSel(null);
    bumpStructural();
  }

  function duplicateColumn(b: number, r: number, c: number) {
    mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(section(bs, b).rows[r].columns[c])));
    bumpStructural();
  }
  function copyColumn(b: number, r: number, c: number) {
    clipCopy("column", section(getBlocks(), b).rows[r].columns[c]);
  }
  function pasteColumn(b: number, r: number, c: number) {
    const data = clipRead<Col>("column");
    if (data) {
      mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleColumn(b: number, r: number, c: number) {
    styleCopy("column", section(getBlocks(), b).rows[r].columns[c].props ?? {});
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
    bumpStructural();
  }
  // Named distinctly from designerTree.ts's imported `moveColumn` (a bulk
  // from/to array-mutation helper) — this one is the arrow-button single-step
  // nudge.
  function nudgeColumn(b: number, r: number, c: number, dir: -1 | 1) {
    const target = c + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows[r].columns.length) return;
    mutate((bs) => {
      const cols = section(bs, b).rows[r].columns;
      cols.splice(target, 0, cols.splice(c, 1)[0]);
    });
    setSel([b, r, target]);
    bumpStructural();
  }
  // A freshly added-row preset has columns but no elements in them yet — the
  // only way to remove it was previously to delete each of its columns one
  // at a time (deleteColumn only cascades to the row once its last column is
  // gone). This is the direct one-click equivalent.
  function deleteRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r, 1));
    setSel(null);
    bumpStructural();
  }
  function moveRow(b: number, r: number, dir: -1 | 1) {
    const target = r + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows.length) return;
    mutate((bs) => {
      const rows = section(bs, b).rows;
      rows.splice(target, 0, rows.splice(r, 1)[0]);
    });
    setSel([b, target]);
    bumpStructural();
  }
  function duplicateRow(b: number, r: number) {
    mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(section(bs, b).rows[r])));
    bumpStructural();
  }
  function copyRow(b: number, r: number) {
    clipCopy("row", section(getBlocks(), b).rows[r]);
  }
  function pasteRow(b: number, r: number) {
    const data = clipRead<Row>("row");
    if (data) {
      mutate((bs) => section(bs, b).rows.splice(r + 1, 0, clone(data)));
      bumpStructural();
    }
  }
  function copyStyleRow(b: number, r: number) {
    const { columns: _columns, ...styleProps } = section(getBlocks(), b).rows[r];
    styleCopy("row", styleProps as unknown as Record<string, string>);
  }
  function pasteStyleRow(b: number, r: number) {
    const style = styleRead("row");
    if (style) mutate((bs) => Object.assign(section(bs, b).rows[r], style));
  }
  function setRowGap(b: number, r: number, gap: string | undefined) {
    mutate((bs) => {
      section(bs, b).rows[r].gap = gap;
    });
  }

  function duplicateElement(b: number, r: number, c: number, e: number) {
    mutate((bs) => {
      const src = section(bs, b).rows[r].columns[c].elements[e];
      section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
    });
    bumpStructural();
  }
  function copyElement(b: number, r: number, c: number, e: number) {
    clipCopy("element", section(getBlocks(), b).rows[r].columns[c].elements[e]);
  }
  function pasteElement(b: number, r: number, c: number, e: number) {
    const data = clipRead<El>("element");
    if (data) {
      mutate((bs) => {
        const list = section(bs, b).rows[r].columns[c].elements;
        list.splice(e + 1, 0, { ...clone(data), id: uid() });
      });
      bumpStructural();
    }
  }
  function copyStyleElement(b: number, r: number, c: number, e: number) {
    const el = section(getBlocks(), b).rows[r].columns[c].elements[e];
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
      section(bs, b).rows[r].columns[c].elements.splice(e, 1);
    });
    setSel(null);
    bumpStructural();
  }
  function moveElement(b: number, r: number, c: number, e: number, dir: -1 | 1) {
    const target = e + dir;
    if (target < 0 || target >= section(getBlocks(), b).rows[r].columns[c].elements.length) return;
    mutate((bs) => {
      const els = section(bs, b).rows[r].columns[c].elements;
      els.splice(target, 0, els.splice(e, 1)[0]);
    });
    setSel([b, r, c, target]);
    bumpStructural();
  }

  return {
    isSectionLocked, duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection,
    duplicateColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, nudgeColumn,
    deleteRow, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, setRowGap,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement, moveElement,
  };
}

export function __testOnly_blockOpsFns(params: Parameters<typeof blockOpsFns>[0]) {
  return blockOpsFns(params);
}

export function useBlockOps(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  setSel: (s: Sel) => void;
  clipboard: ClipboardOps;
  bumpStructural: () => void;
  isSuper: boolean;
  t: (k: Key) => string;
}) {
  return blockOpsFns({ getBlocks: () => params.blocks, ...params });
}
