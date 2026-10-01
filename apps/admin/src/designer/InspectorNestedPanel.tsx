// Inspector's recursive-container nested-child panel (sel.length > 4, any
// depth) — split out of Inspector.tsx as part of the same God Component
// file-size refactor (see that file's own header comment). Holds no hooks of
// its own, called as a plain function the same way Inspector/ElPreview/
// FieldGroups already are. A deliberately SIMPLER panel than the top-level
// Element panel (no per-language override — see apps/admin/CLAUDE.md's
// recursive container notes) but real bp-aware Content/Style editing via the
// generic path (getNode) instead of a literal [b,r,c,e] tuple, so it works at
// any depth without a branch per level.
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import type { DesignerCtx } from "./context";
import { FieldGroups } from "./FieldGroups";
import { CSS_CLASS_FIELD, FIELD_GROUP_BY_KEY } from "./fields";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS } from "./style";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import type { El, Field } from "./types";
import { getNode, insertAt, moveWithin, removeAt } from "../designerTree";
import { BoxModel, ContainerChildrenPanel, VisibilityToggle } from "./InspectorControls";

export function InspectorNestedPanel({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, uploadImage, openMediaPicker,
    availableMenus, availableCategories, availableSymbols,
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
  const node = getNode(blocks, sel) as El | undefined;
  if (!node) return null;
  const parentPath = sel.slice(0, -1);
  const parent = getNode(blocks, parentPath) as El;
  const idx = sel[sel.length - 1];
  const siblingCount = parent.children?.length ?? 0;
  const def = ELS[node.type];
  const nodeFields = [...def.fields, CSS_CLASS_FIELD];
  const nodeHasContent = nodeFields.some((f) => (FIELD_GROUP_BY_KEY[f.key] ?? "content") === "content");
  const setValue = (key: string, v: string) =>
    mutate((bs) => {
      const target = getNode(bs, sel) as El;
      if (bp === "desktop") target.props[key] = v;
      else target.bp = { ...(target.bp ?? {}), [bpKey(key)]: v };
    });
  const toggleOverride = (keys: string[]) =>
    mutate((bs) => {
      const target = getNode(bs, sel) as El;
      target.bp = toggleBpKeys(target.bp, keys);
    });
  const nodeFieldGroupsProps = {
    fields: nodeFields,
    getValue: (f: Field) => bpGetValue(node.props[f.key], node.bp, f.key),
    setValue: (f: Field, v: string) => setValue(f.key, v),
    hasOverride: (f: Field) => bpKeysOverridden(node.bp, [f.key]),
    onToggleOverride: (f: Field) => toggleOverride([f.key]),
    collapsedGroups, toggleGroup, bp, t, iconSearch, setIconSearch, uploading, siteTheme,
    sel, blocks, sliderSlideIdx, setSliderSlideIdx, sliderInnerSel, setSliderInnerSel,
    uploadImage, openMediaPicker, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
    availableMenus, availableCategories, availableSymbols, ICONS,
  };
  return (
    <div className="space-y-3">
      <Breadcrumb />
      <p className="text-xs font-bold text-ink">{t(def.labelKey)}</p>
      <VisibilityToggle
        t={t}
        get={(k) => node.props[k] === "true"}
        set={(k, v) =>
          mutate((bs) => {
            (getNode(bs, sel) as El).props[k] = v ? "true" : "";
          })
        }
      />
      {nodeHasContent && (
        <div className="flex gap-1 rounded-full bg-canvas p-0.5">
          {(["content", "style"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setInspectorTab(tab)}
              className={`flex-1 rounded-full py-1 text-[11px] font-semibold ${
                inspectorTab === tab ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
              }`}
            >
              {t(tab === "content" ? "designer-inspector-tab-content" : "designer-inspector-tab-style")}
            </button>
          ))}
        </div>
      )}
      {(!nodeHasContent || inspectorTab === "style") && (
        <>
          <BoxModel
            padding={{
              labelKey: "designer-s-padding",
              linked: linkedPadding,
              onToggleLink: () => setLinkedPadding((v) => !v),
              getSide: (side) => sideValue(node.props, node.bp, PADDING_SIDE_KEYS[side], "padding"),
              setSide: (side, v) => setValue(PADDING_SIDE_KEYS[side], v),
              hasOverride: bpKeysOverridden(node.bp, Object.values(PADDING_SIDE_KEYS)),
              onToggleOverride: () => toggleOverride(Object.values(PADDING_SIDE_KEYS)),
            }}
            radius={
              node.type === "image" || node.type === "container"
                ? {
                    labelKey: "designer-f-radius",
                    linked: linkedRadius,
                    onToggleLink: () => setLinkedRadius((v) => !v),
                    getSide: (side) => sideValue(node.props, node.bp, RADIUS_CORNER_KEYS[side], "radius"),
                    setSide: (side, v) => setValue(RADIUS_CORNER_KEYS[side], v),
                    hasOverride: bpKeysOverridden(node.bp, Object.values(RADIUS_CORNER_KEYS)),
                    onToggleOverride: () => toggleOverride(Object.values(RADIUS_CORNER_KEYS)),
                  }
                : undefined
            }
            margin={{
              labelKey: "designer-f-marginy",
              linked: linkedMargin,
              onToggleLink: () => setLinkedMargin((v) => !v),
              getSide: (side) => sideValue(node.props, node.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]),
              setSide: (side, v) => setValue(MARGIN_SIDE_KEYS[side], v),
              hasOverride: bpKeysOverridden(node.bp, Object.values(MARGIN_SIDE_KEYS)),
              onToggleOverride: () => toggleOverride(Object.values(MARGIN_SIDE_KEYS)),
            }}
            bp={bp}
            t={t}
          />
          <FieldGroups {...nodeFieldGroupsProps} only={nodeHasContent ? "style" : undefined} />
        </>
      )}
      {nodeHasContent && inspectorTab === "content" && <FieldGroups {...nodeFieldGroupsProps} only="content" />}
      {node.type === "container" && <ContainerChildrenPanel ctx={ctx} path={sel} el={node} />}
      <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => mutate((bs) => moveWithin(bs, parentPath, idx, idx - 1))}
            disabled={idx === 0}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-element-up")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => mutate((bs) => moveWithin(bs, parentPath, idx, idx + 1))}
            disabled={idx === siblingCount - 1}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-element-down")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => mutate((bs) => insertAt(bs, parentPath, structuredClone(getNode(bs, sel)), idx + 1))}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent"
          >
            <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
          </button>
          <button
            onClick={() => {
              mutate((bs) => removeAt(bs, sel));
              setSel(parentPath);
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
