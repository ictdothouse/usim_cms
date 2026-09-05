// The right-hand Inspector panel: page settings (nothing selected), or
// Section/Row/Column/Element style + actions for whatever `ctx.sel` points
// at. Split out of Designer.tsx as part of Layer 1b of the God Component
// refactor (see docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
//
// Holds no hooks of its own (verified during extraction — every piece of
// state it reads comes from `ctx`), so it's safe to call directly as a plain
// function, same as FieldGroups/FieldInput already are.
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardPaste,
  Copy,
  Frame,
  LayoutTemplate,
  Link2,
  Lock,
  Monitor,
  Paintbrush,
  RefreshCw,
  Smartphone,
  SquareDashedBottom,
  Tablet,
  Trash2,
} from "lucide-react";
import type { Key } from "@/i18n";
import type { Bp, Block, Field, SectionProps } from "./types";
import { BASE_LANG, type DesignerCtx } from "./context";
import { BufferedInput, BpToggle } from "./FieldControls";
import { FieldGroups } from "./FieldGroups";
import { CSS_CLASS_FIELD, COLUMN_FIELDS, FIELD_GROUP_BY_KEY, FieldLabel, SECTION_FIELDS } from "./fields";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_FALLBACK, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS, gapPx } from "./style";
import { ELS } from "./elements";
import { ICONS } from "./icons";

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
  // then simply never renders, same as being on desktop.
  hasOverride?: boolean;
  onToggleOverride?: () => void;
  bp: Bp;
  t: (k: Key) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-body">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
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
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx, uploadImage,
    availableMenus, availableCategories,
    pageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled, setDirty,
    siteLanguages, pageLanguage, setPageLanguage, activeLang, content,
    clickPageLanguagePill, translating, retranslatePageLanguage,
    setRowGap, moveRow, duplicateRow, copyRow, pasteRow, copyStyleRow, pasteStyleRow, deleteRow, clipHas, styleHas,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement,
    isSuper, isSectionLocked,
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
                const hasContent = Boolean(content[slotKey]);
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
        <FourSideControl
          labelKey="designer-s-padding"
          icon={Frame}
          linked={linkedPadding}
          onToggleLink={() => setLinkedPadding((v) => !v)}
          getSide={(side) => fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side])}
          setSide={(side, v) => setFourSideValue(b, PADDING_SIDE_KEYS[side], v)}
          hasOverride={bpKeysOverridden(sp.bp, Object.values(PADDING_SIDE_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const props = bs[b].props as unknown as SectionProps;
              props.bp = toggleBpKeys(props.bp, Object.values(PADDING_SIDE_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FourSideControl
          labelKey="designer-f-radius"
          icon={SquareDashedBottom}
          linked={linkedRadius}
          onToggleLink={() => setLinkedRadius((v) => !v)}
          getSide={(side) => fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius")}
          setSide={(side, v) => setFourSideValue(b, RADIUS_CORNER_KEYS[side], v)}
          hasOverride={bpKeysOverridden(sp.bp, Object.values(RADIUS_CORNER_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const props = bs[b].props as unknown as SectionProps;
              props.bp = toggleBpKeys(props.bp, Object.values(RADIUS_CORNER_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FourSideControl
          labelKey="designer-f-marginy"
          icon={Frame}
          linked={linkedMargin}
          onToggleLink={() => setLinkedMargin((v) => !v)}
          getSide={(side) => fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
          setSide={(side, v) => setFourSideValue(b, MARGIN_SIDE_KEYS[side], v)}
          hasOverride={bpKeysOverridden(sp.bp, Object.values(MARGIN_SIDE_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const props = bs[b].props as unknown as SectionProps;
              props.bp = toggleBpKeys(props.bp, Object.values(MARGIN_SIDE_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FieldGroups
          fields={SECTION_FIELDS}
          getValue={(f) => bpGetValue((sp as unknown as Record<string, string>)[f.key], sp.bp, f.key)}
          setValue={(f, v) =>
            mutate((bs) => {
              if (bp === "desktop") {
                (bs[b].props as Record<string, unknown>)[f.key] = v;
              } else {
                const props = bs[b].props as unknown as SectionProps;
                props.bp = { ...(props.bp ?? {}), [bpKey(f.key)]: v };
              }
            })
          }
          hasOverride={(f) => bpKeysOverridden(sp.bp, [f.key])}
          onToggleOverride={(f) =>
            mutate((bs) => {
              const props = bs[b].props as unknown as SectionProps;
              props.bp = toggleBpKeys(props.bp, [f.key]);
            })
          }
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
          uploadImage={uploadImage}
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
        <FourSideControl
          labelKey="designer-s-padding"
          icon={Frame}
          linked={linkedPadding}
          onToggleLink={() => setLinkedPadding((v) => !v)}
          getSide={(side) => sideValue(col.props, col.bp, PADDING_SIDE_KEYS[side], "padding")}
          setSide={(side, v) => setColSideValue(b, r, c, PADDING_SIDE_KEYS[side], v)}
          hasOverride={bpKeysOverridden(col.bp, Object.values(PADDING_SIDE_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FourSideControl
          labelKey="designer-f-radius"
          icon={SquareDashedBottom}
          linked={linkedRadius}
          onToggleLink={() => setLinkedRadius((v) => !v)}
          getSide={(side) => sideValue(col.props, col.bp, RADIUS_CORNER_KEYS[side], "radius")}
          setSide={(side, v) => setColSideValue(b, r, c, RADIUS_CORNER_KEYS[side], v)}
          hasOverride={bpKeysOverridden(col.bp, Object.values(RADIUS_CORNER_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FourSideControl
          labelKey="designer-f-marginy"
          icon={Frame}
          linked={linkedMargin}
          onToggleLink={() => setLinkedMargin((v) => !v)}
          getSide={(side) => sideValue(col.props, col.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
          setSide={(side, v) => setColSideValue(b, r, c, MARGIN_SIDE_KEYS[side], v)}
          hasOverride={bpKeysOverridden(col.bp, Object.values(MARGIN_SIDE_KEYS))}
          onToggleOverride={() =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
            })
          }
          bp={bp}
          t={t}
        />
        <FieldGroups
          fields={COLUMN_FIELDS}
          getValue={(f) => bpGetValue(col.props?.[f.key], col.bp, f.key)}
          setValue={(f, v) =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              if (bp === "desktop") {
                target.props = { ...(target.props ?? {}), [f.key]: v };
              } else {
                target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
              }
            })
          }
          hasOverride={(f) => bpKeysOverridden(col.bp, [f.key])}
          onToggleOverride={(f) =>
            mutate((bs) => {
              const target = section(bs, b).rows[r].columns[c];
              target.bp = toggleBpKeys(target.bp, [f.key]);
            })
          }
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
          uploadImage={uploadImage}
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
    const fieldGroupsProps = {
      fields: elFields,
      // "slides" is a structured JSON blob, not a simple style value — it
      // manages its own per-breakpoint overrides internally (each slide's
      // heading/subtitle has its own `SlideText.bp`, written by the
      // Text size/Alignment BpToggle inside the slides editor itself).
      // Routing it through the SAME generic bp mechanism as every other
      // field wrote a second, whole-array copy into `target.bp["mobile:
      // slides"]` on any edit made while previewing tablet/mobile — the
      // Inspector read that copy back (so it looked live), but the canvas
      // (ElPreview) reads `el.props.slides` directly and never checked
      // `el.bp`, so nothing ever appeared to change there. Bypassing bp
      // entirely for this one field/kind fixes both the data (edits land
      // in the one real `slides` string) and the ghost-toggle UI.
      // "image" (a logo/bgImage media picker) hit the same footgun from the
      // other direction: there's no legitimate per-breakpoint logo swap, so
      // the BpToggle sitting next to it just invited an accidental empty
      // override while previewing tablet/mobile — enabling it seeds "" (see
      // toggleBpKeys), which then out-ranked the real desktop src and made
      // the canvas show the no-image placeholder despite the real, saved
      // src being intact. Same bypass as slides fixes it the same way.
      getValue: (f: Field) =>
        f.kind === "slides" || f.kind === "image" ? el.props[f.key] ?? "" : bpGetValue(el.props[f.key], el.bp, f.key),
      setValue: (f: Field, v: string) =>
        mutate((bs) => {
          const target = section(bs, b).rows[r].columns[c].elements[e];
          if (bp === "desktop" || f.kind === "slides" || f.kind === "image") {
            target.props[f.key] = v;
          } else {
            target.bp = { ...(target.bp ?? {}), [bpKey(f.key)]: v };
          }
        }),
      hasOverride: (f: Field) => f.kind !== "slides" && f.kind !== "image" && bpKeysOverridden(el.bp, [f.key]),
      onToggleOverride: (f: Field) => {
        if (f.kind === "slides" || f.kind === "image") return;
        mutate((bs) => {
          const target = section(bs, b).rows[r].columns[c].elements[e];
          target.bp = toggleBpKeys(target.bp, [f.key]);
        });
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
      uploadImage,
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
            <FourSideControl
              labelKey="designer-s-padding"
              icon={Frame}
              linked={linkedPadding}
              onToggleLink={() => setLinkedPadding((v) => !v)}
              getSide={(side) => sideValue(el.props, el.bp, PADDING_SIDE_KEYS[side], "padding")}
              setSide={(side, v) => setElSideValue(b, r, c, e, PADDING_SIDE_KEYS[side], v)}
              hasOverride={bpKeysOverridden(el.bp, Object.values(PADDING_SIDE_KEYS))}
              onToggleOverride={() =>
                mutate((bs) => {
                  const target = section(bs, b).rows[r].columns[c].elements[e];
                  target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
                })
              }
              bp={bp}
              t={t}
            />
            {(el.type === "image" || el.type === "embed" || el.type === "gallery") && (
              <FourSideControl
                labelKey="designer-f-radius"
                icon={SquareDashedBottom}
                linked={linkedRadius}
                onToggleLink={() => setLinkedRadius((v) => !v)}
                getSide={(side) => sideValue(el.props, el.bp, RADIUS_CORNER_KEYS[side], "radius")}
                setSide={(side, v) => setElSideValue(b, r, c, e, RADIUS_CORNER_KEYS[side], v)}
                hasOverride={bpKeysOverridden(el.bp, Object.values(RADIUS_CORNER_KEYS))}
                onToggleOverride={() =>
                  mutate((bs) => {
                    const target = section(bs, b).rows[r].columns[c].elements[e];
                    target.bp = toggleBpKeys(target.bp, Object.values(RADIUS_CORNER_KEYS));
                  })
                }
                bp={bp}
                t={t}
              />
            )}
            <FourSideControl
              labelKey="designer-f-marginy"
              icon={Frame}
              linked={linkedMargin}
              onToggleLink={() => setLinkedMargin((v) => !v)}
              getSide={(side) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side])}
              setSide={(side, v) => setElSideValue(b, r, c, e, MARGIN_SIDE_KEYS[side], v)}
              hasOverride={bpKeysOverridden(el.bp, Object.values(MARGIN_SIDE_KEYS))}
              onToggleOverride={() =>
                mutate((bs) => {
                  const target = section(bs, b).rows[r].columns[c].elements[e];
                  target.bp = toggleBpKeys(target.bp, Object.values(MARGIN_SIDE_KEYS));
                })
              }
              bp={bp}
              t={t}
            />
            <FieldGroups {...fieldGroupsProps} only={hasContentFields ? "style" : undefined} />
          </>
        )}
        {hasContentFields && inspectorTab === "content" && <FieldGroups {...fieldGroupsProps} only="content" />}
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
        </div>
      </div>
    );
  }
  return null;
}
