// The right-hand Inspector panel: page settings (nothing selected), or
// Section/Row/Column/Element style + actions for whatever `ctx.sel` points
// at. Split out of Designer.tsx as part of Layer 1b of the God Component
// refactor (see docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
//
// Holds no hooks of its own (verified during extraction — every piece of
// state it reads comes from `ctx`), so it's safe to call directly as a plain
// function, same as FieldGroups/FieldInput already are.
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
  Link2,
  Lock,
  Monitor,
  Move,
  Paintbrush,
  Plus,
  RefreshCw,
  Smartphone,
  SquareDashedBottom,
  StretchVertical,
  Tablet,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Key } from "@/i18n";
import type { Bp, Block, El, ElType, Field, Row, SectionProps } from "./types";
import { BASE_LANG, type DesignerCtx } from "./context";
import { BufferedInput, BpToggle, LangToggle } from "./FieldControls";
import { FieldGroups } from "./FieldGroups";
import { CSS_CLASS_FIELD, COLUMN_FIELDS, FIELD_GROUP_BY_KEY, FieldLabel, SECTION_FIELDS } from "./fields";
import { parseSlides, stringifySlides, updateSlideElementBp, updateSlideElementProps } from "./parsers";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_FALLBACK, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS, gapPx } from "./style";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import { getNode, insertAt, moveWithin, removeAt } from "../designerTree";

// Duplicated from Designer.tsx's own module-level `uid`/`newEl` (designer/
// files can't import back from Designer.tsx — see designer/types.ts's own
// note) — same tiny id generator + "new element with its type's defaults"
// factory, needed here only for the recursive container's "Add element"
// control.
const uid = () => Math.random().toString(36).slice(2, 10);
const newEl = (type: ElType): El => ({ id: uid(), type, props: { ...ELS[type].defaults } });
// Container children are curated to types that make sense freely nested and
// already render generically (no slider/menu/accordion-style special canvas
// wiring) — a deliberate v1 scope line, not every ElType. Expand this list
// once each additional type's container-child behavior has actually been
// checked, rather than opening the picker to all ~30 types up front.
const CONTAINER_CHILD_TYPES: ElType[] = [
  "heading", "text", "image", "button", "badge", "spacer", "divider", "icon", "container",
];

// A recursive container's own "Add element" + children list, shared by the
// top-level container panel (sel.length===4) and the nested-child panel
// below (sel.length>4, any depth) — both address the container the same
// way, by its own `path`. A real component (not a plain function call like
// ElPreview/FieldGroups) since it holds its own `addType` dropdown state.
function ContainerChildrenPanel({ ctx, path, el }: { ctx: DesignerCtx; path: number[]; el: El }) {
  const { t, mutate, setSel, sel } = ctx;
  const [addType, setAddType] = useState<ElType>("heading");
  const children = el.children ?? [];
  const pathEq = (a: number[]) => sel !== null && sel.length === a.length && a.every((v, i) => sel[i] === v);
  return (
    <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-sub">{t("designer-container-children")}</p>
      {children.length > 0 && (
        <div className="space-y-1">
          {children.map((child, i) => {
            const childPath = [...path, i];
            return (
              <div
                key={child.id}
                className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] ${pathEq(childPath) ? "bg-accent/10 text-accent" : "text-body"}`}
              >
                <button onClick={() => setSel(childPath)} className="flex-1 truncate text-left font-medium">
                  {t(ELS[child.type].labelKey)}
                </button>
                <button
                  onClick={() => mutate((bs) => moveWithin(bs, path, i, i - 1))}
                  disabled={i === 0}
                  className="disabled:opacity-30"
                  aria-label={t("designer-move-element-up")}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => mutate((bs) => moveWithin(bs, path, i, i + 1))}
                  disabled={i === children.length - 1}
                  className="disabled:opacity-30"
                  aria-label={t("designer-move-element-down")}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  onClick={() =>
                    mutate((bs) => {
                      const parent = getNode(bs, path) as El;
                      parent.children = parent.children ?? [];
                      insertAt(bs, path, structuredClone(parent.children[i]), i + 1);
                    })
                  }
                  aria-label={t("designer-duplicate")}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={() => {
                    mutate((bs) => removeAt(bs, childPath));
                    if (pathEq(childPath)) setSel(path);
                  }}
                  className="text-red-500"
                  aria-label={t("designer-delete")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-1.5">
        <select
          value={addType}
          onChange={(ev) => setAddType(ev.target.value as ElType)}
          className="min-w-0 flex-1 rounded-lg border border-line/30 bg-white px-2 py-1 text-[11px]"
        >
          {CONTAINER_CHILD_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(ELS[ty].labelKey)}
            </option>
          ))}
        </select>
        <button
          onClick={() => mutate((bs) => insertAt(bs, path, newEl(addType)))}
          className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-[11px] font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> {t("designer-add")}
        </button>
      </div>
    </div>
  );
}

// Small icon-button-group row used by the Row Layout panel below (Direction/
// Justify/Align) — mirrors the existing "align" FieldInput.tsx icon-button
// pattern (text-align left/center/right/justify), just generalized to take
// an arbitrary icon-per-option map since flex direction/justify/align each
// need their own icon set. Not exported/shared beyond this file — it's a
// one-panel control, not a general Field kind (Row isn't edited through the
// Field[]/FieldInput system at all, see the sel.length===2 branch's own
// setRowSide-based mutation instead of FieldInput's field/value/onChange).
function FlexIconGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; icon: typeof ArrowRight; title: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`flex-1 rounded-lg border p-1.5 ${
            value === o.value
              ? "border-accent bg-accent/10 text-accent"
              : "border-line/30 text-sub hover:border-accent/40"
          }`}
        >
          <o.icon className="mx-auto h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

function FourSideControl({
  labelKey,
  icon: Icon,
  linked,
  onToggleLink,
  getSide,
  setSide,
  sides = ["top", "right", "bottom", "left"],
  hasOverride,
  onToggleOverride,
  hasLangOverride,
  onToggleLangOverride,
  bp,
  t,
}: {
  labelKey: Key;
  icon: typeof Frame;
  linked: boolean;
  onToggleLink: () => void;
  getSide: (side: "top" | "right" | "bottom" | "left") => string;
  setSide: (side: "top" | "right" | "bottom" | "left", value: string) => void;
  // Defaults to all 4 (padding/radius); margin has no left/right concept
  // (block-flow spacing only), so it passes just ["top", "bottom"].
  sides?: readonly ("top" | "right" | "bottom" | "left")[];
  // Omitted entirely for a node with no `bp` bag at all (Row) — the toggle
  // then simply never renders, same as being on desktop. While a non-base
  // language is active, call sites repurpose this pair as the NESTED
  // "also stack by breakpoint" toggle (only meaningful once
  // `hasLangOverride` is on) rather than the ordinary bp override.
  hasOverride?: boolean;
  onToggleOverride?: () => void;
  // Per-language "different for this language" toggle — only ever passed by
  // call sites while a non-base language pill is active. Renders regardless
  // of `bp` tier (a language override is a real choice on its own).
  hasLangOverride?: boolean;
  onToggleLangOverride?: () => void;
  bp: Bp;
  t: (k: Key) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-body">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
          {hasLangOverride !== undefined && onToggleLangOverride && (
            <LangToggle active={hasLangOverride} onToggle={onToggleLangOverride} t={t} />
          )}
          {hasOverride !== undefined && onToggleOverride && (
            <BpToggle active={hasOverride} onToggle={onToggleOverride} bp={bp} t={t} />
          )}
        </span>
        <button
          type="button"
          onClick={onToggleLink}
          title={t("designer-f-link-sides")}
          className={`rounded p-1 ${linked ? "text-accent" : "text-sub hover:text-body"}`}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {linked ? (
        <BufferedInput
          className="w-full rounded-lg border border-line/30 bg-white px-2 py-1.5 text-[11px]"
          value={getSide(sides[0])}
          onCommit={(v) => sides.forEach((s) => setSide(s, v))}
        />
      ) : (
        <div className={`grid gap-1 ${sides.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
          {sides.map((s) => (
            <BufferedInput
              key={s}
              className="w-full rounded-lg border border-line/30 bg-white px-1 py-1.5 text-center text-[11px]"
              value={getSide(s)}
              placeholder={s[0].toUpperCase()}
              title={s}
              onCommit={(v) => setSide(s, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

// One ring's worth of wiring for BoxModel — same shape FourSideControl's own
// props already used (getSide/setSide/linked/hasOverride/hasLangOverride),
// just without the icon/labelKey-render bits BoxModel itself now owns so one
// ring config object can be built inline at each call site.
interface RingConfig {
  labelKey: Key;
  linked: boolean;
  onToggleLink: () => void;
  getSide: (side: Side) => string;
  setSide: (side: Side, v: string) => void;
  hasOverride?: boolean;
  onToggleOverride?: () => void;
  hasLangOverride?: boolean;
  onToggleLangOverride?: () => void;
}

function BoxModelRingHeader({ ring, icon: Icon, bp, t }: { ring: RingConfig; icon: typeof Frame; bp: Bp; t: (k: Key) => string }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-sub/70">
        <Icon className="h-3 w-3" /> {t(ring.labelKey)}
        {ring.hasLangOverride !== undefined && ring.onToggleLangOverride && (
          <LangToggle active={ring.hasLangOverride} onToggle={ring.onToggleLangOverride} t={t} />
        )}
        {ring.hasOverride !== undefined && ring.onToggleOverride && (
          <BpToggle active={ring.hasOverride} onToggle={ring.onToggleOverride} bp={bp} t={t} />
        )}
      </span>
      <button
        type="button"
        onClick={ring.onToggleLink}
        title={t("designer-f-link-sides")}
        className={`rounded p-0.5 ${ring.linked ? "text-accent" : "text-sub/50 hover:text-body"}`}
      >
        <Link2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function BoxModelInput({ ring, side, corner }: { ring: RingConfig; side: Side; corner?: boolean }) {
  return (
    <BufferedInput
      className={
        corner
          ? "w-7 rounded border border-line/40 bg-white px-0.5 py-0.5 text-center text-[9px] text-ink shadow-sm"
          : "w-9 rounded border border-line/30 bg-white px-0.5 py-0.5 text-center text-[10px] text-ink"
      }
      value={ring.getSide(side)}
      placeholder="0"
      title={side}
      onCommit={(v) => (ring.linked ? SIDES.forEach((s) => ring.setSide(s, v)) : ring.setSide(side, v))}
    />
  );
}

// Chrome-DevTools-style nested box-model diagram: a dashed Margin ring around
// a solid Padding ring around a Content box, with optional corner-radius
// handles floating on the content box's own 4 corners — replaces what used
// to be 2-3 separate FourSideControl rows (a flat stack of labeled 4-input
// grids) with one spatial diagram, so which number affects which side of the
// element reads visually instead of needing the label text to disambiguate.
function BoxModel({
  padding,
  margin,
  radius,
  bp,
  t,
}: {
  padding: RingConfig;
  margin: RingConfig;
  radius?: RingConfig;
  bp: Bp;
  t: (k: Key) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-dashed border-amber-300/60 bg-amber-50/40 p-1.5">
        <BoxModelRingHeader ring={margin} icon={Frame} bp={bp} t={t} />
        <div className="grid grid-cols-[2rem_1fr_2rem] grid-rows-[2rem_auto_2rem] items-center justify-items-center gap-1 pt-1">
          <div />
          <BoxModelInput ring={margin} side="top" />
          <div />
          <BoxModelInput ring={margin} side="left" />
          <div className="col-start-2 row-start-2 w-full rounded-lg border border-sky-300/60 bg-sky-50/50 p-1.5">
            <BoxModelRingHeader ring={padding} icon={SquareDashedBottom} bp={bp} t={t} />
            <div className="grid grid-cols-[1.75rem_1fr_1.75rem] grid-rows-[1.75rem_auto_1.75rem] items-center justify-items-center gap-1 pt-1">
              <div />
              <BoxModelInput ring={padding} side="top" />
              <div />
              <BoxModelInput ring={padding} side="left" />
              <div className="relative col-start-2 row-start-2 flex h-10 w-full items-center justify-center rounded bg-white text-[9px] font-medium text-sub/60">
                {t("designer-content")}
                {radius && (
                  <>
                    <div className="absolute -left-2 -top-2">
                      <BoxModelInput ring={radius} side="top" corner />
                    </div>
                    <div className="absolute -right-2 -top-2">
                      <BoxModelInput ring={radius} side="right" corner />
                    </div>
                    <div className="absolute -bottom-2 -right-2">
                      <BoxModelInput ring={radius} side="bottom" corner />
                    </div>
                    <div className="absolute -bottom-2 -left-2">
                      <BoxModelInput ring={radius} side="left" corner />
                    </div>
                  </>
                )}
              </div>
              <BoxModelInput ring={padding} side="right" />
              <div />
              <BoxModelInput ring={padding} side="bottom" />
              <div />
            </div>
          </div>
          <BoxModelInput ring={margin} side="right" />
          <div />
          <BoxModelInput ring={margin} side="bottom" />
          <div />
        </div>
      </div>
      {radius && <BoxModelRingHeader ring={radius} icon={SquareDashedBottom} bp={bp} t={t} />}
    </div>
  );
}

type VisKey = "hideDesktop" | "hideTablet" | "hideMobile";
const VIS_ITEMS: { key: VisKey; icon: typeof Monitor }[] = [
  { key: "hideDesktop", icon: Monitor },
  { key: "hideTablet", icon: Tablet },
  { key: "hideMobile", icon: Smartphone },
];
// Shared Section/Row/Column/Element visibility control — a real per-
// breakpoint hide, unlike the `bp` style-override bag above (admin-preview
// only): SectionBlock.astro renders these as actual @media display:none
// rules on the published site. "Active" (highlighted) means hidden on that
// screen, not shown — same on/off semantics as any other toggle button in
// this file, just inverted from "visible".
function VisibilityToggle({ get, set, t }: { get: (k: VisKey) => boolean; set: (k: VisKey, v: boolean) => void; t: (k: Key) => string }) {
  return (
    <label className="block text-[11px] font-medium text-body">
      {t("designer-visibility")}
      <div className="mt-1 flex gap-1">
        {VIS_ITEMS.map(({ key, icon: Icon }) => {
          const hidden = get(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => set(key, !hidden)}
              title={t(hidden ? "designer-vis-hidden" : "designer-vis-visible")}
              className={`flex-1 rounded-lg border p-1.5 ${
                hidden ? "border-red-300 bg-red-50 text-red-500" : "border-line/30 text-sub hover:border-accent/40"
              }`}
            >
              <Icon className="mx-auto h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </label>
  );
}

const section = (bs: Block[], b: number) => bs[b].props as unknown as SectionProps;

export function Inspector({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, kind, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, uploadImage, openMediaPicker,
    availableMenus, availableCategories,
    pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    pageHeaderId, pageFooterId, pageHideHeader, pageHideFooter, availableHeaders, availableFooters, patchPageChrome,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang, hasLangSlot,
    clickPageLanguagePill, translating, retranslatePageLanguage,
    isTextKey, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement,
    isSuper, isSectionLocked,
  } = ctx;

  // Shared per-STYLE-field language-override wiring for FourSideControl and
  // the generic FieldGroups getValue/setValue below — spread this AFTER a
  // block's own base/bp props so it wins while a non-base language is
  // active, and is a no-op ({}) while the base language pill is active
  // (leaving the ordinary bp-override wiring untouched). `hasOverride`/
  // `onToggleOverride` are repurposed here as the NESTED "also stack by
  // breakpoint" toggle (only shown once the outer per-language toggle is
  // on) — see Designer.tsx's own comment above setFourSideValue.
  function langOverrideProps(path: string, keys: string[]) {
    if (activeLang === BASE_LANG) return {};
    const has = langKeysOverridden(path, keys);
    return {
      hasLangOverride: has,
      onToggleLangOverride: () => toggleLangKeys(path, keys),
      hasOverride: has ? langStackKeysOverridden(path, keys) : undefined,
      onToggleOverride: has ? () => toggleLangStackKeys(path, keys) : undefined,
    };
  }

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

  if (!sel) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-ink">{t("designer-page-settings")}</p>
        <label className="block text-[11px] font-medium text-body">
          {t("designer-page-gap")}
          <BufferedInput
            type="number"
            placeholder="32"
            value={String(gapPx(pageSettings.gap))}
            onCommit={(v) => setPageGap(v === "" ? undefined : `${v}px`)}
            className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          />
        </label>
        <label className="block text-[11px] font-medium text-body">
          {t("designer-page-content-width")}
          <select
            value={pageSettings.contentWidth ?? "contained"}
            onChange={(e) => setPageContentWidth(e.target.value === "full" ? "full" : undefined)}
            className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="contained">contained</option>
            <option value="full">full</option>
          </select>
        </label>
        <label className="block text-[11px] font-medium text-body">
          {t("designer-page-padding-x")}
          <BufferedInput
            type="number"
            placeholder="24"
            value={String(gapPx(pageSettings.paddingX))}
            onCommit={(v) => setPagePaddingX(v === "" ? undefined : `${v}px`)}
            className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          />
        </label>
        <label className="block text-[11px] font-medium text-body">
          {t("designer-page-theme")}
          <select
            value={pageSettings.themePresetName ?? ""}
            onChange={(e) => setPageThemePreset(themePresets.find((p) => p.name === e.target.value) ?? null)}
            className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="">{t("designer-page-theme-default")}</option>
            {themePresets.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        {kind === "page" && (
          <div className="space-y-2 border-t border-line/30 pt-3">
            <p className="text-[11px] font-bold text-ink">{t("header-footer-page-assignment")}</p>
            <label className="block text-[11px] font-medium text-body">
              {t("designer-page-header")}
              <select
                value={pageHeaderId}
                onChange={(e) => void patchPageChrome({ headerId: e.target.value })}
                disabled={pageHideHeader}
                className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="">{t("designer-page-header-default")}</option>
                {availableHeaders.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-body">
              <input type="checkbox" checked={pageHideHeader} onChange={(e) => void patchPageChrome({ hideHeader: e.target.checked })} />
              {t("designer-page-hide-header")}
            </label>
            <label className="block text-[11px] font-medium text-body">
              {t("designer-page-footer")}
              <select
                value={pageFooterId}
                onChange={(e) => void patchPageChrome({ footerId: e.target.value })}
                disabled={pageHideFooter}
                className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="">{t("designer-page-header-default")}</option>
                {availableFooters.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-body">
              <input type="checkbox" checked={pageHideFooter} onChange={(e) => void patchPageChrome({ hideFooter: e.target.checked })} />
              {t("designer-page-hide-footer")}
            </label>
          </div>
        )}
        {siteMultilangEnabled && (
        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-body">{t("designer-page-language")}</label>
          <label className="flex items-center gap-2 text-[11px] font-medium text-body">
            <input
              type="checkbox"
              checked={pageMultilangEnabled}
              onChange={(e) => {
                setPageMultilangEnabled(e.target.checked);
                setDirty(true);
              }}
            />
            {t("designer-page-multilang-enable")}
          </label>
          {pageMultilangEnabled ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {siteLanguages.map((l) => {
                const slotKey = l.code === pageLanguage ? BASE_LANG : l.code;
                const isCurrent = activeLang === slotKey;
                const hasContent = hasLangSlot(slotKey);
                const isBase = l.code === pageLanguage;
                return (
                  <span key={l.code} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={isCurrent || translating}
                      onClick={() => clickPageLanguagePill(l.code)}
                      title={isBase ? t("posts-language-default-badge") : !pageLanguage || hasContent ? undefined : t("posts-translate-btn")}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                        isBase ? "ring-2 ring-amber-400 ring-offset-1" : ""
                      } ${
                        isCurrent
                          ? "bg-accent text-white"
                          : hasContent
                            ? "bg-canvas text-ink hover:bg-[#e8e8ed]"
                            : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
                      }`}
                    >
                      {isBase && "★ "}{l.label}{!isCurrent && !hasContent && (translating ? "…" : " +")}
                    </button>
                    {!isBase && hasContent && (
                      <button
                        type="button"
                        disabled={translating}
                        onClick={() => void retranslatePageLanguage(l.code)}
                        title={t("designer-page-retranslate")}
                        className="rounded p-1 text-sub hover:bg-canvas hover:text-accent disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <select
              value={pageLanguage || "__none"}
              onChange={(e) => {
                setPageLanguage(e.target.value === "__none" ? "" : e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full rounded-md border border-line/30 px-2 py-1 text-xs"
            >
              <option value="__none">{t("designer-page-language-none")}</option>
              {siteLanguages.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          )}
        </div>
        )}
        <p className="text-[10px] text-sub">{t("designer-none-selected")}</p>
      </div>
    );
  }
  if (blocks[sel[0]]?.type !== "section") {
    return <p className="text-xs text-sub">{t("designer-none-selected")}</p>;
  }
  const [b, r, c, e] = sel;
  const sp = blocks[b].props as unknown as SectionProps;

  // Section lock (Page Blueprint deferred item) — a non-superadmin gets a
  // read-only notice instead of editable fields at every level under a
  // locked section (Section/Row/Column/Element all share this one gate,
  // since editing any of them mutates the same locked section subtree). The
  // real enforcement is server-side (apps/api's pagesBeforeChange); this
  // just avoids presenting fields whose Save would be silently rejected.
  if (isSectionLocked(b)) {
    return (
      <div className="space-y-3">
        <Breadcrumb />
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-800">
          <div className="flex items-center gap-1.5 font-semibold">
            <Lock className="h-3.5 w-3.5" /> {t("designer-section-locked-title")}
          </div>
          <p className="mt-1">{t("designer-section-locked-body")}</p>
        </div>
      </div>
    );
  }

  if (sel.length === 1) {
    return (
      <div className="space-y-3">
        <Breadcrumb />
        <p className="text-xs font-bold text-ink">{t("designer-section")}</p>
        {isSuper && (
          <label className="flex items-center gap-2 text-[11px] font-medium text-body">
            <input
              type="checkbox"
              checked={sp.locked === "true"}
              onChange={(e) =>
                mutate((bs) => {
                  (bs[b].props as Record<string, string>).locked = e.target.checked ? "true" : "";
                })
              }
            />
            <Lock className="h-3.5 w-3.5" /> {t("designer-section-lock-toggle")}
          </label>
        )}
        <VisibilityToggle
          t={t}
          get={(k) => (sp as unknown as Record<string, string>)[k] === "true"}
          set={(k, v) =>
            mutate((bs) => {
              (bs[b].props as Record<string, string>)[k] = v ? "true" : "";
            })
          }
        />
        <BoxModel
          padding={{
            labelKey: "designer-s-padding",
            linked: linkedPadding,
            onToggleLink: () => setLinkedPadding((v) => !v),
            getSide: (side) => fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]),
            setSide: (side, v) => setFourSideValue(b, PADDING_SIDE_KEYS[side], v),
            hasOverride: bpKeysOverridden(sp.bp, Object.values(PADDING_SIDE_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(PADDING_SIDE_KEYS));
              }),
            ...langOverrideProps(pathKey(b), Object.values(PADDING_SIDE_KEYS)),
          }}
          radius={{
            labelKey: "designer-f-radius",
            linked: linkedRadius,
            onToggleLink: () => setLinkedRadius((v) => !v),
            getSide: (side) => fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius"),
            setSide: (side, v) => setFourSideValue(b, RADIUS_CORNER_KEYS[side], v),
            hasOverride: bpKeysOverridden(sp.bp, Object.values(RADIUS_CORNER_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(RADIUS_CORNER_KEYS));
              }),
            ...langOverrideProps(pathKey(b), Object.values(RADIUS_CORNER_KEYS)),
          }}
          margin={{
            labelKey: "designer-f-marginy",
            linked: linkedMargin,
            onToggleLink: () => setLinkedMargin((v) => !v),
            getSide: (side) => fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]),
            setSide: (side, v) => setFourSideValue(b, MARGIN_SIDE_KEYS[side], v),
            hasOverride: bpKeysOverridden(sp.bp, Object.values(MARGIN_SIDE_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = toggleBpKeys(props.bp, Object.values(MARGIN_SIDE_KEYS));
              }),
            ...langOverrideProps(pathKey(b), Object.values(MARGIN_SIDE_KEYS)),
          }}
          bp={bp}
          t={t}
        />
        <FieldGroups
          fields={SECTION_FIELDS}
          getValue={(f) => bpGetValue((sp as unknown as Record<string, string>)[f.key], sp.bp, f.key)}
          setValue={(f, v) => {
            const path = pathKey(b);
            if (activeLang !== BASE_LANG && langKeysOverridden(path, [f.key])) {
              setLangValue(path, f.key, v);
              return;
            }
            mutate((bs) => {
              if (bp === "desktop") {
                (bs[b].props as Record<string, unknown>)[f.key] = v;
              } else {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = { ...(props.bp ?? {}), [bpKey(f.key)]: v };
              }
            });
          }}
          hasOverride={(f) => bpKeysOverridden(sp.bp, [f.key])}
          onToggleOverride={(f) =>
            mutate((bs) => {
              const props = bs[b].props as unknown as SectionProps;
              props.bp = toggleBpKeys(props.bp, [f.key]);
            })
          }
          hasLangOverride={activeLang === BASE_LANG ? undefined : (f) => langKeysOverridden(pathKey(b), [f.key])}
          onToggleLangOverride={activeLang === BASE_LANG ? undefined : (f) => toggleLangKeys(pathKey(b), [f.key])}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          bp={bp}
          t={t}
          iconSearch={iconSearch}
          setIconSearch={setIconSearch}
          uploading={uploading}
          siteTheme={siteTheme}
          sel={sel}
          blocks={blocks}
          sliderSlideIdx={sliderSlideIdx}
          setSliderSlideIdx={setSliderSlideIdx}
          sliderInnerSel={sliderInnerSel}
          setSliderInnerSel={setSliderInnerSel}
          uploadImage={uploadImage}
          openMediaPicker={openMediaPicker}
          bpGetValue={bpGetValue}
          bpKeysOverridden={bpKeysOverridden}
          toggleBpKeys={toggleBpKeys}
          bpKey={bpKey}
          availableMenus={availableMenus}
          availableCategories={availableCategories}
          ICONS={ICONS}
        />
      </div>
    );
  }
  if (sel.length === 2) {
    const row = sp.rows[r];
    if (!row) return null;
    const setRowSide = (key: string, v: string) =>
      mutate((bs) => {
        (section(bs, b).rows[r] as unknown as Record<string, string>)[key] = v;
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
                        const target = section(bs, b).rows[r];
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
                        const target = section(bs, b).rows[r];
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
  if (sel.length === 3) {
    const col = sp.rows[r]?.columns[c];
    if (!col) return null;
    return (
      <div className="space-y-3">
        <Breadcrumb />
        <p className="text-xs font-bold text-ink">{t("designer-column")}</p>
        <VisibilityToggle
          t={t}
          get={(k) => col.props?.[k] === "true"}
          set={(k, v) =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.props = { ...(target.props ?? {}), [k]: v ? "true" : "" };
            })
          }
        />
        <label className="block text-[11px] font-medium text-body">
          <span className="inline-flex items-center gap-1">
            {FieldLabel("designer-col-span", t)}: {bpGetValue(String(col.span), col.bp, "span")}
            <BpToggle
              active={bpKeysOverridden(col.bp, ["span"])}
              onToggle={() =>
                mutate((bs) => {
                  const target = section(bs, b).rows[r].columns[c];
                  target.bp = toggleBpKeys(target.bp, ["span"]);
                })
              }
              bp={bp}
              t={t}
            />
          </span>
          <input
            type="range"
            min={1}
            max={6}
            value={Number(bpGetValue(String(col.span), col.bp, "span"))}
            className="mt-1 w-full accent-accent"
            onChange={(ev) =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                if (bp === "desktop") target.span = Number(ev.target.value);
                else target.bp = { ...(target.bp ?? {}), [bpKey("span")]: ev.target.value };
              })
            }
          />
        </label>
        <BoxModel
          padding={{
            labelKey: "designer-s-padding",
            linked: linkedPadding,
            onToggleLink: () => setLinkedPadding((v) => !v),
            getSide: (side) => sideValue(col.props, col.bp, PADDING_SIDE_KEYS[side], "padding"),
            setSide: (side, v) => setColSideValue(b, r, c, PADDING_SIDE_KEYS[side], v),
            hasOverride: bpKeysOverridden(col.bp, Object.values(PADDING_SIDE_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
              }),
            ...langOverrideProps(pathKey(b, r, c), Object.values(PADDING_SIDE_KEYS)),
          }}
          radius={{
            labelKey: "designer-f-radius",
            linked: linkedRadius,
            onToggleLink: () => setLinkedRadius((v) => !v),
            getSide: (side) => sideValue(col.props, col.bp, RADIUS_CORNER_KEYS[side], "radius"),
            setSide: (side, v) => setColSideValue(b, r, c, RADIUS_CORNER_KEYS[side], v),
            hasOverride: bpKeysOverridden(col.bp, Object.values(RADIUS_CORNER_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
              }),
            ...langOverrideProps(pathKey(b, r, c), Object.values(RADIUS_CORNER_KEYS)),
          }}
          margin={{
            labelKey: "designer-f-marginy",
            linked: linkedMargin,
            onToggleLink: () => setLinkedMargin((v) => !v),
            getSide: (side) => sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]),
            setSide: (side, v) => setColSideValue(b, r, c, MARGIN_SIDE_KEYS[side], v),
            hasOverride: bpKeysOverridden(col.bp, Object.values(MARGIN_SIDE_KEYS)),
            onToggleOverride: () =>
              mutate((bs) => {
                const target = section(bs, b).rows[r].columns[c];
                target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
              }),
            ...langOverrideProps(pathKey(b, r, c), Object.values(MARGIN_SIDE_KEYS)),
          }}
          bp={bp}
          t={t}
        />
        <FieldGroups
          fields={COLUMN_FIELDS}
          getValue={(f) => bpGetValue(col.props?.[f.key], col.bp, f.key)}
          setValue={(f, v) => {
            const path = pathKey(b, r, c);
            if (activeLang !== BASE_LANG && langKeysOverridden(path, [f.key])) {
              setLangValue(path, f.key, v);
              return;
            }
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              if (bp === "desktop") {
                target.props = { ...(target.props ?? {}), [f.key]: v };
              } else {
                target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
              }
            });
          }}
          hasOverride={(f) => bpKeysOverridden(col.bp, [f.key])}
          onToggleOverride={(f) =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.bp = toggleBpKeys(target.bp, [f.key]);
            })
          }
          hasLangOverride={activeLang === BASE_LANG ? undefined : (f) => langKeysOverridden(pathKey(b, r, c), [f.key])}
          onToggleLangOverride={activeLang === BASE_LANG ? undefined : (f) => toggleLangKeys(pathKey(b, r, c), [f.key])}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          bp={bp}
          t={t}
          iconSearch={iconSearch}
          setIconSearch={setIconSearch}
          uploading={uploading}
          siteTheme={siteTheme}
          sel={sel}
          blocks={blocks}
          sliderSlideIdx={sliderSlideIdx}
          setSliderSlideIdx={setSliderSlideIdx}
          sliderInnerSel={sliderInnerSel}
          setSliderInnerSel={setSliderInnerSel}
          uploadImage={uploadImage}
          openMediaPicker={openMediaPicker}
          bpGetValue={bpGetValue}
          bpKeysOverridden={bpKeysOverridden}
          toggleBpKeys={toggleBpKeys}
          bpKey={bpKey}
          availableMenus={availableMenus}
          availableCategories={availableCategories}
          ICONS={ICONS}
        />
        <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
        <div className="flex gap-3">
          <button
            onClick={() => nudgeColumn(b, r, c, -1)}
            disabled={c === 0}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-column-up")}
            title={t("designer-move-column-up")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => nudgeColumn(b, r, c, 1)}
            disabled={c === sp.rows[r].columns.length - 1}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-column-down")}
            title={t("designer-move-column-down")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
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
        <button
          onClick={() => saveAsTemplate([b, r, c])}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent"
        >
          <LayoutTemplate className="h-3.5 w-3.5" /> {t("designer-templates-save")}
        </button>
        <button onClick={() => deleteColumn(b, r, c)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
          <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
        </button>
        </div>
      </div>
    );
  }
  if (sel.length === 4) {
    const el = sp.rows[r]?.columns[c]?.elements[e];
    if (!el) return null;
    const def = ELS[el.type];
    const elFields = [...def.fields, CSS_CLASS_FIELD];
    const hasContentFields = elFields.some((f) => (FIELD_GROUP_BY_KEY[f.key] ?? "content") === "content");
    // A slider element with a nested element selected (clicked inside its
    // currently-previewed slide's mini-canvas, see ElPreview.tsx's slider
    // case) shows THAT element's own Content/Style fields instead of the
    // slider's own — same FieldGroups/FieldInput renderer every other
    // element uses, just reading/writing through the slide's own
    // rows/columns/elements tree (parseSlides/stringifySlides round trip,
    // one level deeper than a normal element's `props`) rather than
    // `el.props` directly. Real per-breakpoint override now works the same
    // way as any top-level element — nested El already carries its own `bp`
    // bag (the type never excluded it, this was just unwired until now);
    // childSetValue below writes into it via updateSlideElementBp instead of
    // updateSlideElementProps whenever the Inspector's own `bp` isn't desktop.
    const innerSel = el.type === "slider" ? (sliderInnerSel[el.id] ?? null) : null;
    if (innerSel) {
      const slideIdx = sliderSlideIdx[el.id] ?? 0;
      const childEl = parseSlides(el.props.slides)[slideIdx]?.rows[innerSel.r]?.columns[innerSel.c]?.elements[innerSel.e];
      if (childEl) {
        const childDef = ELS[childEl.type];
        const childFields = [...childDef.fields, CSS_CLASS_FIELD];
        const childHasContent = childFields.some((f) => (FIELD_GROUP_BY_KEY[f.key] ?? "content") === "content");
        const withChildSlide = (apply: (s0: ReturnType<typeof parseSlides>[number]) => ReturnType<typeof parseSlides>[number]) =>
          mutate((bs) => {
            const target = section(bs, b).rows[r].columns[c].elements[e];
            const currentSlides = parseSlides(target.props.slides);
            const s0 = currentSlides[slideIdx];
            if (!s0) return;
            currentSlides[slideIdx] = apply(s0);
            target.props.slides = stringifySlides(currentSlides);
          });
        const childSetValue = (key: string, v: string) =>
          withChildSlide((s0) =>
            bp === "desktop"
              ? updateSlideElementProps(s0, innerSel.r, innerSel.c, innerSel.e, { [key]: v })
              : updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, { ...(childEl.bp ?? {}), [`${bp}:${key}`]: v }),
          );
        const childToggleOverride = (keys: string[]) =>
          withChildSlide((s0) => updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, toggleBpKeys(childEl.bp, keys)));
        const childFieldGroupsProps = {
          fields: childFields,
          getValue: (f: Field) => bpGetValue(childEl.props[f.key], childEl.bp, f.key),
          setValue: (f: Field, v: string) => childSetValue(f.key, v),
          hasOverride: (f: Field) => bpKeysOverridden(childEl.bp, [f.key]),
          onToggleOverride: (f: Field) => childToggleOverride([f.key]),
          collapsedGroups,
          toggleGroup,
          bp,
          t,
          iconSearch,
          setIconSearch,
          uploading,
          siteTheme,
          sel,
          blocks,
          sliderSlideIdx,
          setSliderSlideIdx,
          sliderInnerSel,
          setSliderInnerSel,
          uploadImage,
          openMediaPicker,
          bpGetValue,
          bpKeysOverridden,
          toggleBpKeys,
          bpKey,
          availableMenus,
          availableCategories,
          ICONS,
        };
        const childIsFree = bpGetValue(childEl.props.position, childEl.bp, "position") === "custom";
        return (
          <div className="space-y-3">
            <Breadcrumb />
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{t(childDef.labelKey)}</p>
              <button
                onClick={() => setSliderInnerSel((m) => ({ ...m, [el.id]: null }))}
                className="text-[10px] font-semibold text-accent"
              >
                {t("designer-slide-back")}
              </button>
            </div>
            {childHasContent && (
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
            {(!childHasContent || inspectorTab === "style") && (
              <>
                <div className="space-y-1.5 rounded-lg border border-line/20 bg-canvas/40 p-2">
                  <div className="flex items-center justify-between text-[11px] font-medium text-body">
                    <span className="flex items-center gap-1.5">
                      <Move className="h-3.5 w-3.5" /> {t("designer-slide-free-position")}
                    </span>
                    <button
                      type="button"
                      onClick={() => childSetValue("position", childIsFree ? "" : "custom")}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        childIsFree ? "bg-accent text-white" : "bg-white text-sub"
                      }`}
                    >
                      {t(childIsFree ? "designer-slide-free-on" : "designer-slide-free-off")}
                    </button>
                  </div>
                  {childIsFree && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {(["x", "y", "posWidth", "posHeight"] as const).map((key) => (
                        <label key={key} className="space-y-0.5 text-[10px] text-sub">
                          <span className="inline-flex items-center gap-1">
                            {key === "x" ? "X %" : key === "y" ? "Y %" : t(key === "posWidth" ? "designer-f-width" : "designer-f-height")}
                            <BpToggle active={bpKeysOverridden(childEl.bp, [key])} onToggle={() => childToggleOverride([key])} bp={bp} t={t} />
                          </span>
                          <BufferedInput
                            className="w-full rounded-lg border border-line/30 bg-white px-2 py-1 text-[11px]"
                            value={bpGetValue(childEl.props[key], childEl.bp, key)}
                            placeholder={key === "x" || key === "y" ? "10" : "auto"}
                            onCommit={(v) => childSetValue(key, v)}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {childIsFree && (
                    <p className="text-[10px] italic text-sub/70">{t("designer-align-inert-free")}</p>
                  )}
                </div>
                <BoxModel
                  padding={{
                    labelKey: "designer-s-padding",
                    linked: linkedPadding,
                    onToggleLink: () => setLinkedPadding((v) => !v),
                    getSide: (side) => sideValue(childEl.props, childEl.bp, PADDING_SIDE_KEYS[side], "padding"),
                    setSide: (side, v) => childSetValue(PADDING_SIDE_KEYS[side], v),
                    hasOverride: bpKeysOverridden(childEl.bp, Object.values(PADDING_SIDE_KEYS)),
                    onToggleOverride: () => childToggleOverride(Object.values(PADDING_SIDE_KEYS)),
                  }}
                  radius={
                    childEl.type === "image" || childEl.type === "embed" || childEl.type === "gallery"
                      ? {
                          labelKey: "designer-f-radius",
                          linked: linkedRadius,
                          onToggleLink: () => setLinkedRadius((v) => !v),
                          getSide: (side) => sideValue(childEl.props, childEl.bp, RADIUS_CORNER_KEYS[side], "radius"),
                          setSide: (side, v) => childSetValue(RADIUS_CORNER_KEYS[side], v),
                          hasOverride: bpKeysOverridden(childEl.bp, Object.values(RADIUS_CORNER_KEYS)),
                          onToggleOverride: () => childToggleOverride(Object.values(RADIUS_CORNER_KEYS)),
                        }
                      : undefined
                  }
                  margin={{
                    labelKey: "designer-f-marginy",
                    linked: linkedMargin,
                    onToggleLink: () => setLinkedMargin((v) => !v),
                    getSide: (side) => sideValue(childEl.props, childEl.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]),
                    setSide: (side, v) => childSetValue(MARGIN_SIDE_KEYS[side], v),
                    hasOverride: bpKeysOverridden(childEl.bp, Object.values(MARGIN_SIDE_KEYS)),
                    onToggleOverride: () => childToggleOverride(Object.values(MARGIN_SIDE_KEYS)),
                  }}
                  bp={bp}
                  t={t}
                />
                <FieldGroups {...childFieldGroupsProps} only={childHasContent ? "style" : undefined} />
              </>
            )}
            {childHasContent && inspectorTab === "content" && <FieldGroups {...childFieldGroupsProps} only="content" />}
          </div>
        );
      }
    }
    const fieldGroupsProps = {
      fields: elFields,
      // "slides" is a structured JSON blob, not a simple style value — its
      // own content (the rows/columns/elements tree above) is edited via
      // FieldInput's dedicated "slides" kind UI and the nested-selection
      // branch above, not through this generic bp mechanism. Routing it
      // through the SAME generic bp mechanism as every other field wrote a
      // second, whole-array copy into `target.bp["mobile:slides"]` on any
      // edit made while previewing tablet/mobile — the Inspector read that
      // copy back (so it looked live), but the canvas (ElPreview) reads
      // `el.props.slides` directly and never checked `el.bp`, so nothing
      // ever appeared to change there. Bypassing bp entirely for this one
      // field/kind fixes both the data (edits land in the one real
      // `slides` string) and the ghost-toggle UI.
      // "image" (a logo/bgImage media picker) hit the same footgun from the
      // other direction: there's no legitimate per-breakpoint logo swap, so
      // the BpToggle sitting next to it just invited an accidental empty
      // override while previewing tablet/mobile — enabling it seeds "" (see
      // toggleBpKeys), which then out-ranked the real desktop src and made
      // the canvas show the no-image placeholder despite the real, saved
      // src being intact. Same bypass as slides fixes it the same way.
      getValue: (f: Field) =>
        f.kind === "slides" || f.kind === "image" ? el.props[f.key] ?? "" : bpGetValue(el.props[f.key], el.bp, f.key),
      setValue: (f: Field, v: string) => {
        const path = pathKey(b, r, c, e);
        if (activeLang !== BASE_LANG && f.kind !== "slides" && f.kind !== "image") {
          // A TEXT field is always per-language, no opt-in needed — see
          // isTextKey. A STYLE field only routes here once the author has
          // explicitly turned on "different for this language" for it.
          if (isTextKey(el.type, f.key) || langKeysOverridden(path, [f.key])) {
            setLangValue(path, f.key, v);
            return;
          }
        }
        mutate((bs) => {
          const target = section(bs, b).rows[r].columns[c].elements[e];
          if (bp === "desktop" || f.kind === "slides" || f.kind === "image") {
            target.props[f.key] = v;
          } else {
            target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
          }
        });
      },
      hasOverride: (f: Field) => f.kind !== "slides" && f.kind !== "image" && bpKeysOverridden(el.bp, [f.key]),
      onToggleOverride: (f: Field) => {
        if (f.kind === "slides" || f.kind === "image") return;
        mutate((bs) => {
          const target = section(bs, b).rows[r].columns[c].elements[e];
          target.bp = toggleBpKeys(target.bp, [f.key]);
        });
      },
      hasLangOverride:
        activeLang === BASE_LANG
          ? undefined
          : (f: Field) => f.kind !== "slides" && f.kind !== "image" && langKeysOverridden(pathKey(b, r, c, e), [f.key]),
      onToggleLangOverride:
        activeLang === BASE_LANG
          ? undefined
          : (f: Field) => {
              if (f.kind === "slides" || f.kind === "image") return;
              toggleLangKeys(pathKey(b, r, c, e), [f.key]);
            },
      collapsedGroups,
      toggleGroup,
      bp,
      t,
      iconSearch,
      setIconSearch,
      uploading,
      siteTheme,
      sel,
      blocks,
      sliderSlideIdx,
      setSliderSlideIdx,
      sliderInnerSel,
      setSliderInnerSel,
      uploadImage,
      openMediaPicker,
      bpGetValue,
      bpKeysOverridden,
      toggleBpKeys,
      bpKey,
      availableMenus,
      availableCategories,
      ICONS,
    };
    return (
      <div className="space-y-3">
        <Breadcrumb />
        <p className="text-xs font-bold text-ink">{t(def.labelKey)}</p>
        <VisibilityToggle
          t={t}
          get={(k) => el.props[k] === "true"}
          set={(k, v) =>
            mutate((bs) => {
              section(bs, b).rows[r].columns[c].elements[e].props[k] = v ? "true" : "";
            })
          }
        />
        {hasContentFields && (
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
        {(!hasContentFields || inspectorTab === "style") && (
          <>
            <BoxModel
              padding={{
                labelKey: "designer-s-padding",
                linked: linkedPadding,
                onToggleLink: () => setLinkedPadding((v) => !v),
                getSide: (side) => sideValue(el.props, el.bp, PADDING_SIDE_KEYS[side], "padding"),
                setSide: (side, v) => setElSideValue(b, r, c, e, PADDING_SIDE_KEYS[side], v),
                hasOverride: bpKeysOverridden(el.bp, Object.values(PADDING_SIDE_KEYS)),
                onToggleOverride: () =>
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
                  }),
                ...langOverrideProps(pathKey(b, r, c, e), Object.values(PADDING_SIDE_KEYS)),
              }}
              radius={
                el.type === "image" || el.type === "embed" || el.type === "gallery"
                  ? {
                      labelKey: "designer-f-radius",
                      linked: linkedRadius,
                      onToggleLink: () => setLinkedRadius((v) => !v),
                      getSide: (side) => sideValue(el.props, el.bp, RADIUS_CORNER_KEYS[side], "radius"),
                      setSide: (side, v) => setElSideValue(b, r, c, e, RADIUS_CORNER_KEYS[side], v),
                      hasOverride: bpKeysOverridden(el.bp, Object.values(RADIUS_CORNER_KEYS)),
                      onToggleOverride: () =>
                        mutate((bs) => {
                          const target = section(bs, b).rows[r].columns[c].elements[e];
                          target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
                        }),
                      ...langOverrideProps(pathKey(b, r, c, e), Object.values(RADIUS_CORNER_KEYS)),
                    }
                  : undefined
              }
              margin={{
                labelKey: "designer-f-marginy",
                linked: linkedMargin,
                onToggleLink: () => setLinkedMargin((v) => !v),
                getSide: (side) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]),
                setSide: (side, v) => setElSideValue(b, r, c, e, MARGIN_SIDE_KEYS[side], v),
                hasOverride: bpKeysOverridden(el.bp, Object.values(MARGIN_SIDE_KEYS)),
                onToggleOverride: () =>
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
                  }),
                ...langOverrideProps(pathKey(b, r, c, e), Object.values(MARGIN_SIDE_KEYS)),
              }}
              bp={bp}
              t={t}
            />
            <FieldGroups {...fieldGroupsProps} only={hasContentFields ? "style" : undefined} />
          </>
        )}
        {hasContentFields && inspectorTab === "content" && <FieldGroups {...fieldGroupsProps} only="content" />}
        {el.type === "container" && (
          <ContainerChildrenPanel ctx={ctx} path={[b, r, c, e]} el={el} />
        )}
        <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => moveElement(b, r, c, e, -1)}
            disabled={e === 0}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-element-up")}
            title={t("designer-move-element-up")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => moveElement(b, r, c, e, 1)}
            disabled={e === sp.rows[r].columns[c].elements.length - 1}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent disabled:opacity-30"
            aria-label={t("designer-move-element-down")}
            title={t("designer-move-element-down")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
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
          {el.type !== "slider" && (
            <>
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
            </>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={() => duplicateElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
            <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
          </button>
          <button onClick={() => deleteElement(b, r, c, e)} className="flex items-center gap-1 text-[11px] font-semibold text-red-500">
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
        </div>
        </div>
      </div>
    );
  }
  // Recursive container's own children — sel one (or more) levels past a
  // container's own [b,r,c,e] path, addressing arbitrarily deep nesting.
  // A deliberately SIMPLER v1 panel than the top-level element branch above
  // (no per-language override — the same "not attempted" scope line the
  // codebase already draws elsewhere for nested content) but real bp-aware
  // Content/Style editing via the same generic path (getNode) instead of a
  // literal [b,r,c,e] tuple, so it works at any depth without a new branch
  // per level.
  if (sel.length > 4) {
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
      availableMenus, availableCategories, ICONS,
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
  return null;
}
