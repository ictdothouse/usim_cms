// Designer's device-preview modal (Desktop/Tablet/Mobile bezel + rotate) AND
// the right-click quick-action context menu — split out of Designer.tsx as
// part of the same God Component file-size refactor Inspector.tsx already
// went through (see Designer.tsx's own header comment).
//
// The context menu is folded into this same file rather than its own
// DesignerContextMenu.tsx: at ~130 lines it's smaller than the other 5
// extracted regions, shares no state with the device-preview modal but
// shares the same "small, self-contained, Designer-tsx-local UI overlay"
// character, and splitting it out would mean a 7th file for a sliver of
// JSX — not worth it per this split's own "fewest files possible" framing.
//
// Holds no hooks of its own — deliberately NOT wrapped in React.memo (this
// region wasn't memoized before the split either).
import {
  Clipboard,
  ClipboardPaste,
  Component,
  Copy,
  ExternalLink,
  LayoutTemplate,
  Monitor,
  Paintbrush,
  Pencil,
  RotateCw,
  Smartphone,
  Tablet,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type { Key } from "@/i18n";
import { section } from "./blockPath";
import type { DesignerCtx } from "./context";
import type { usePersist } from "./hooks/usePersist";
import type { useTemplateLibrary } from "./hooks/useTemplateLibrary";
import type { useBlockOps } from "./hooks/useBlockOps";

type PreviewModalState = { src: string; device: "desktop" | "tablet" | "mobile"; orientation: "portrait" | "landscape" } | null;
type CtxMenuState = { path: number[]; x: number; y: number } | null;

export interface DesignerDevicePreviewModalProps {
  t: (k: Key) => string;
  previewModal: PreviewModalState;
  setPreviewModal: (v: PreviewModalState | ((prev: PreviewModalState) => PreviewModalState)) => void;
  withDeviceFrame: ReturnType<typeof usePersist>["withDeviceFrame"];
  ctxMenu: CtxMenuState;
  setCtxMenu: (v: CtxMenuState) => void;
  ctx: DesignerCtx;
  templateKind: ReturnType<typeof useTemplateLibrary>["templateKind"];
  makeComponent: ReturnType<typeof useTemplateLibrary>["makeComponent"];
  detachSymbolInstance: ReturnType<typeof useTemplateLibrary>["detachSymbolInstance"];
  duplicateSection: ReturnType<typeof useBlockOps>["duplicateSection"];
  copySection: ReturnType<typeof useBlockOps>["copySection"];
  pasteSection: ReturnType<typeof useBlockOps>["pasteSection"];
  copyStyleSection: ReturnType<typeof useBlockOps>["copyStyleSection"];
  pasteStyleSection: ReturnType<typeof useBlockOps>["pasteStyleSection"];
  deleteSection: ReturnType<typeof useBlockOps>["deleteSection"];
  duplicateColumn: ReturnType<typeof useBlockOps>["duplicateColumn"];
}

// Real device logical-pixel viewports (iPhone 14/15, iPad Air) instead of an
// arbitrary ratio — width still shrinks to fit the modal (via the max-
// height/max-width cap below), only the SHAPE now matches an actual
// phone/tablet.
const DEVICE_DIMS: Record<"mobile" | "tablet", { w: number; h: number }> = {
  mobile: { w: 393, h: 852 },
  tablet: { w: 820, h: 1180 },
};

export function DesignerDevicePreviewModal({
  t, previewModal, setPreviewModal, withDeviceFrame,
  ctxMenu, setCtxMenu, ctx, templateKind, makeComponent, detachSymbolInstance,
  duplicateSection, copySection, pasteSection, copyStyleSection, pasteStyleSection, deleteSection, duplicateColumn,
}: DesignerDevicePreviewModalProps) {
  const {
    isSuper, blocks, setSel, saveAsTemplate,
    duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow,
    copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn,
    duplicateElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, deleteElement,
    clipHas, styleHas,
  } = ctx;

  return (
    <>
      {previewModal &&
        (() => {
          const landscape = previewModal.orientation === "landscape";
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
              onClick={() => setPreviewModal(null)}
            >
              <div
                className="flex h-[95vh] w-[min(97vw,120rem)] flex-col overflow-hidden rounded-xl bg-white shadow-xl"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-line/30 px-4 py-2.5">
                  <p className="text-xs font-bold text-ink">{t("designer-preview")}</p>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5 rounded-full bg-canvas p-0.5">
                      {(
                        [
                          { key: "desktop", icon: Monitor, labelKey: "designer-bp-desktop" },
                          { key: "tablet", icon: Tablet, labelKey: "designer-bp-tablet" },
                          { key: "mobile", icon: Smartphone, labelKey: "designer-bp-mobile" },
                        ] as const
                      ).map(({ key, icon: Icon, labelKey }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setPreviewModal((m) =>
                              m ? { ...m, device: key, src: withDeviceFrame(m.src, key), orientation: "portrait" } : m,
                            )
                          }
                          title={t(labelKey)}
                          className={`rounded-full p-1.5 ${
                            previewModal.device === key ? "bg-white text-accent shadow-sm" : "text-sub hover:text-body"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </div>
                    {previewModal.device !== "desktop" && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewModal((m) =>
                            m ? { ...m, orientation: m.orientation === "portrait" ? "landscape" : "portrait" } : m,
                          )
                        }
                        title={t("designer-bp-rotate")}
                        className="rounded-full p-1.5 text-sub hover:bg-canvas hover:text-body"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setPreviewModal(null)}
                    className="rounded-full p-1.5 text-body hover:bg-canvas"
                    title={t("designer-close")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-auto bg-canvas/60 p-4">
                  {previewModal.device === "desktop" ? (
                    <iframe
                      key={previewModal.src}
                      src={previewModal.src}
                      className="h-full w-full rounded-lg border border-line/30 bg-white shadow-sm"
                      title={t("designer-preview")}
                    />
                  ) : (
                    // Device bezel so tablet/mobile preview reads as an actual
                    // phone/tablet instead of a plain narrowed box — the
                    // iframe itself is unchanged, just wrapped. Portrait is
                    // height-driven (h-full, capped by max-height, width auto
                    // from the aspect ratio); landscape mirrors that on the
                    // other axis (w-full capped by max-width, height auto) —
                    // same mechanism, just transposed, rather than the
                    // trickier "both axes auto" approach.
                    // The cross-axis also gets a hard cap at the device's own
                    // true pixel size (dims.w) — without it, on a tall browser
                    // window h-full can grow past 393px before the 46rem
                    // height cap kicks in (measured ~440px wide instead of a
                    // real iPhone's 393px), so a free-position element sized
                    // here for "mobile" doesn't match a real phone.
                    (() => {
                      const dims = DEVICE_DIMS[previewModal.device];
                      const ratio = landscape ? `${dims.h} / ${dims.w}` : `${dims.w} / ${dims.h}`;
                      const cap = previewModal.device === "mobile" ? "46rem" : "56rem";
                      const sizeStyle: React.CSSProperties = landscape
                        ? { aspectRatio: ratio, maxWidth: cap, maxHeight: `${dims.w}px` }
                        : { aspectRatio: ratio, maxHeight: cap, maxWidth: `${dims.w}px` };
                      return (
                        <div
                          className={`flex shrink-0 flex-col gap-1.5 bg-ink shadow-xl ${
                            previewModal.device === "mobile" ? "rounded-[2.5rem] p-3" : "rounded-[1.5rem] p-2.5"
                          } ${landscape ? "h-auto w-full" : "h-full w-auto"}`}
                          style={sizeStyle}
                        >
                          {previewModal.device === "mobile" && !landscape && (
                            <div className="mx-auto h-1.5 w-16 shrink-0 rounded-full bg-white/25" />
                          )}
                          <iframe
                            key={previewModal.src}
                            src={previewModal.src}
                            className={`w-full flex-1 bg-white ${previewModal.device === "mobile" ? "rounded-[1.75rem]" : "rounded-xl"}`}
                            title={t("designer-preview")}
                          />
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {ctxMenu &&
        (() => {
          const path = ctxMenu.path;
          const kind = templateKind(path);
          if (!kind) return null;
          const item = (icon: React.ReactNode, label: string, onClick: () => void, disabled?: boolean) => (
            <button
              onClick={() => {
                onClick();
                setCtxMenu(null);
              }}
              disabled={disabled}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-ink hover:bg-canvas disabled:opacity-30"
            >
              {icon}
              {label}
            </button>
          );
          const deleteItem = (label: string, onClick: () => void) => (
            <button
              onClick={() => {
                onClick();
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-red-500 hover:bg-canvas"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {label}
            </button>
          );
          const divider = <div className="my-1 border-t border-line/20" />;
          // Same set of actions at every depth (section/row/column/element) —
          // each level already has its own duplicate/copy/paste/copy-style/
          // paste-style/delete function (BlockControls/Inspector/
          // LiveEditToolbar already call these), so the menu just reuses them
          // instead of re-deriving the same splice/clip logic per depth.
          let body: React.ReactNode;
          if (kind === "section") {
            const [b] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateSection(b))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copySection(b))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteSection(b), !clipHas("section"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleSection(b))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleSection(b), !styleHas("section"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b]))}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteSection(b))}
              </>
            );
          } else if (kind === "row") {
            const [b, r] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateRow(b, r))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyRow(b, r))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteRow(b, r), !clipHas("row"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleRow(b, r))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleRow(b, r), !styleHas("row"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r]))}
                {divider}
                {deleteItem(t("designer-delete-row"), () => deleteRow(b, r))}
              </>
            );
          } else if (kind === "column") {
            const [b, r, c] = path;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r, c]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateColumn(b, r, c))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyColumn(b, r, c))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteColumn(b, r, c), !clipHas("column"))}
                {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleColumn(b, r, c))}
                {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleColumn(b, r, c), !styleHas("column"))}
                {divider}
                {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r, c]))}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteColumn(b, r, c))}
              </>
            );
          } else {
            const [b, r, c, e] = path;
            const el = section(blocks, b).rows[r]?.columns[c]?.elements[e];
            if (!el) return null;
            body = (
              <>
                {item(<Pencil className="h-3.5 w-3.5" />, t("designer-edit"), () => setSel([b, r, c, e]))}
                {item(<Copy className="h-3.5 w-3.5" />, t("designer-duplicate"), () => duplicateElement(b, r, c, e))}
                {item(<Clipboard className="h-3.5 w-3.5" />, t("designer-copy"), () => copyElement(b, r, c, e))}
                {item(<ClipboardPaste className="h-3.5 w-3.5" />, t("designer-paste"), () => pasteElement(b, r, c, e), !clipHas("element"))}
                {el.type !== "slider" && (
                  <>
                    {item(<Paintbrush className="h-3.5 w-3.5" />, t("designer-copy-style"), () => copyStyleElement(b, r, c, e))}
                    {item(<Paintbrush className="h-3.5 w-3.5 opacity-50" />, t("designer-paste-style"), () => pasteStyleElement(b, r, c, e), !styleHas("element"))}
                  </>
                )}
                {divider}
                {el.type === "symbol" ? (
                  <>
                    {item(<ExternalLink className="h-3.5 w-3.5" />, t("designer-symbols-edit-master"), () =>
                      window.open(`${isSuper ? "/content/symbols" : "/symbols"}/${el.props.symbolId}`, "_blank"),
                    )}
                    {item(<Unlink className="h-3.5 w-3.5" />, t("designer-symbols-detach"), () => detachSymbolInstance(b, r, c, e))}
                  </>
                ) : (
                  <>
                    {item(<LayoutTemplate className="h-3.5 w-3.5" />, t("designer-templates-save"), () => saveAsTemplate([b, r, c, e]))}
                    {item(<Component className="h-3.5 w-3.5" />, t("designer-symbols-make"), () => makeComponent([b, r, c, e]))}
                  </>
                )}
                {divider}
                {deleteItem(t("designer-delete"), () => deleteElement(b, r, c, e))}
              </>
            );
          }
          return (
            <div
              className="fixed z-[70] w-44 overflow-hidden rounded-lg border border-line/30 bg-white py-1 shadow-xl"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(ev) => ev.stopPropagation()}
            >
              {body}
            </div>
          );
        })()}
    </>
  );
}
