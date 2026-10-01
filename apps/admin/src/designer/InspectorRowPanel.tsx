// Inspector's Row panel (sel.length === 2) — split out of Inspector.tsx as
// part of the same God Component file-size refactor (see that file's own
// header comment). Holds no hooks of its own, called as a plain function the
// same way Inspector/ElPreview/FieldGroups already are.
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clipboard,
  ClipboardPaste,
  Copy,
  Frame,
  LayoutGrid,
  LayoutTemplate,
  Paintbrush,
  StretchVertical,
  Trash2,
} from "lucide-react";
import type { DesignerCtx } from "./context";
import { BpToggle, BufferedInput } from "./FieldControls";
import { MARGIN_SIDE_KEYS, PADDING_SIDE_KEYS, gapPx } from "./style";
import type { Row, SectionProps } from "./types";
import { FlexIconGroup, FourSideControl, VisibilityToggle } from "./InspectorControls";

export function InspectorRowPanel({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys,
    linkedPadding, setLinkedPadding, linkedMargin, setLinkedMargin,
    pageSettings,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
  } = ctx;

  function Breadcrumb() {
    if (!sel || blocks[sel[0]]?.type !== "section") return null;
    const crumbs: { label: string; path: number[] }[] = [{ label: t("designer-section"), path: [sel[0]] }];
    if (sel.length >= 2) crumbs.push({ label: t("designer-row"), path: sel.slice(0, 2) });
    if (sel.length >= 3) crumbs.push({ label: t("designer-column"), path: sel.slice(0, 3) });
    if (sel.length >= 4) crumbs.push({ label: t("designer-element"), path: sel.slice(0, 4) });
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium text-sub">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-line">/</span>}
            <button
              type="button"
              onClick={() => setSel(crumb.path)}
              disabled={i === crumbs.length - 1}
              className={i === crumbs.length - 1 ? "text-ink" : "text-accent hover:underline"}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>
    );
  }

  if (!sel) return null;
  const [b, r] = sel;
  const sp = blocks[b].props as unknown as SectionProps;
  const row = sp.rows[r];
  if (!row) return null;
  const setRowSide = (key: string, v: string) =>
    mutate((bs) => {
      ((bs[b].props as unknown as SectionProps).rows[r] as unknown as Record<string, string>)[key] = v;
    });
  return (
    <div className="space-y-3">
      <Breadcrumb />
      <p className="text-xs font-bold text-ink">{t("designer-row")}</p>
      <VisibilityToggle
        t={t}
        get={(k) => (row as unknown as Record<string, string>)[k] === "true"}
        set={(k, v) => setRowSide(k, v ? "true" : "")}
      />
      <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-sub">{t("designer-row-layout")}</p>
        <FlexIconGroup
          value={row.layoutMode === "flex" ? "flex" : "grid"}
          onChange={(v) => setRowSide("layoutMode", v)}
          options={[
            { value: "grid", icon: LayoutGrid, title: t("designer-row-layout-grid") },
            { value: "flex", icon: LayoutTemplate, title: t("designer-row-layout-flex") },
          ]}
        />
        {row.layoutMode === "flex" && (
          <>
            <label className="block text-[11px] font-medium text-body">
              <span className="inline-flex items-center gap-1">
                {t("designer-row-direction")}
                <BpToggle
                  active={bpKeysOverridden(row.bp, ["flexDirection"])}
                  onToggle={() =>
                    mutate((bs) => {
                      const target = (bs[b].props as unknown as SectionProps).rows[r];
                      target.bp = toggleBpKeys(target.bp, ["flexDirection"]);
                    })
                  }
                  bp={bp}
                  t={t}
                />
              </span>
              <div className="mt-1">
                <FlexIconGroup
                  value={bpGetValue(row.flexDirection ?? "row", row.bp, "flexDirection")}
                  onChange={(v) =>
                    mutate((bs) => {
                      const target = (bs[b].props as unknown as SectionProps).rows[r];
                      if (bp === "desktop") target.flexDirection = v as Row["flexDirection"];
                      else target.bp = { ...(target.bp ?? {}), [bpKey("flexDirection")]: v };
                    })
                  }
                  options={[
                    { value: "row", icon: ArrowRight, title: "row" },
                    { value: "column", icon: ArrowDown, title: "column" },
                    { value: "row-reverse", icon: ArrowLeft, title: "row-reverse" },
                    { value: "column-reverse", icon: ArrowUp, title: "column-reverse" },
                  ]}
                />
              </div>
            </label>
            <label className="block text-[11px] font-medium text-body">
              {t("designer-row-justify")}
              <div className="mt-1">
                <FlexIconGroup
                  value={row.justifyContent ?? "flex-start"}
                  onChange={(v) => setRowSide("justifyContent", v)}
                  options={[
                    { value: "flex-start", icon: AlignHorizontalJustifyStart, title: "flex-start" },
                    { value: "center", icon: AlignHorizontalJustifyCenter, title: "center" },
                    { value: "flex-end", icon: AlignHorizontalJustifyEnd, title: "flex-end" },
                    { value: "space-between", icon: AlignHorizontalSpaceBetween, title: "space-between" },
                    { value: "space-around", icon: AlignHorizontalSpaceAround, title: "space-around" },
                  ]}
                />
              </div>
            </label>
            <label className="block text-[11px] font-medium text-body">
              {t("designer-row-align")}
              <div className="mt-1">
                <FlexIconGroup
                  value={row.alignItems ?? "stretch"}
                  onChange={(v) => setRowSide("alignItems", v)}
                  options={[
                    { value: "flex-start", icon: AlignVerticalJustifyStart, title: "flex-start" },
                    { value: "center", icon: AlignVerticalJustifyCenter, title: "center" },
                    { value: "flex-end", icon: AlignVerticalJustifyEnd, title: "flex-end" },
                    { value: "stretch", icon: StretchVertical, title: "stretch" },
                  ]}
                />
              </div>
            </label>
            <label className="block text-[11px] font-medium text-body">
              {t("designer-row-wrap")}
              <div className="mt-1 flex gap-1">
                {(["nowrap", "wrap"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setRowSide("flexWrap", w)}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${
                      (row.flexWrap ?? "wrap") === w
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line/30 text-sub hover:border-accent/40"
                    }`}
                  >
                    {t(w === "nowrap" ? "designer-row-wrap-nowrap" : "designer-row-wrap-wrap")}
                  </button>
                ))}
              </div>
            </label>
          </>
        )}
      </div>
      <label className="block text-[11px] font-medium text-body">
        {t("designer-row-gap")}
        <BufferedInput
          type="number"
          placeholder={String(gapPx(pageSettings.gap) || 32)}
          value={String(gapPx(row.gap))}
          onCommit={(v) => setRowGap(b, r, v === "" ? undefined : `${v}px`)}
          className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        />
      </label>
      <FourSideControl
        labelKey="designer-s-padding"
        icon={Frame}
        linked={linkedPadding}
        onToggleLink={() => setLinkedPadding((v) => !v)}
        getSide={(side) => (row as unknown as Record<string, string>)[PADDING_SIDE_KEYS[side]] ?? ""}
        setSide={(side, v) => setRowSide(PADDING_SIDE_KEYS[side], v)}
        bp={bp}
        t={t}
      />
      <FourSideControl
        labelKey="designer-f-marginy"
        icon={Frame}
        sides={["top", "bottom"]}
        linked={linkedMargin}
        onToggleLink={() => setLinkedMargin((v) => !v)}
        getSide={(side) => (row as unknown as Record<string, string>)[MARGIN_SIDE_KEYS[side as "top" | "bottom"]] ?? ""}
        setSide={(side, v) => setRowSide(MARGIN_SIDE_KEYS[side as "top" | "bottom"], v)}
        bp={bp}
        t={t}
      />
      <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
      <div className="flex gap-3">
        <button
          onClick={() => moveRow(b, r, -1)}
          disabled={r === 0}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
          aria-label={t("designer-move-row-up")}
          title={t("designer-move-row-up")}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => moveRow(b, r, 1)}
          disabled={r === sp.rows.length - 1}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
          aria-label={t("designer-move-row-down")}
          title={t("designer-move-row-down")}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex gap-3">
        <button onClick={() => duplicateRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
          <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
        </button>
        <button onClick={() => copyRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
          <Clipboard className="h-3.5 w-3.5" /> {t("designer-copy")}
        </button>
        <button
          onClick={() => pasteRow(b, r)}
          disabled={!clipHas("row")}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> {t("designer-paste")}
        </button>
      </div>
      <div className="flex gap-3">
        <button onClick={() => copyStyleRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
          <Paintbrush className="h-3.5 w-3.5" /> {t("designer-copy-style")}
        </button>
        <button
          onClick={() => pasteStyleRow(b, r)}
          disabled={!styleHas("row")}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
        >
          <Paintbrush className="h-3.5 w-3.5 opacity-50" /> {t("designer-paste-style")}
        </button>
      </div>
      <button onClick={() => deleteRow(b, r)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
        <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete-row")}
      </button>
      </div>
    </div>
  );
}
