// Inspector's Column panel (sel.length === 3) — split out of Inspector.tsx
// as part of the same God Component file-size refactor (see that file's own
// header comment). Holds no hooks of its own, called as a plain function the
// same way Inspector/ElPreview/FieldGroups already are.
import { ArrowDown, ArrowUp, Clipboard, ClipboardPaste, LayoutTemplate, Paintbrush, Trash2 } from "lucide-react";
import { BASE_LANG, type DesignerCtx } from "./context";
import { BpToggle } from "./FieldControls";
import { FieldGroups } from "./FieldGroups";
import { COLUMN_FIELDS, FieldLabel } from "./fields";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS } from "./style";
import { ICONS } from "./icons";
import type { SectionProps } from "./types";
import { BoxModel, VisibilityToggle } from "./InspectorControls";

export function InspectorColumnPanel({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, setColSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, uploadImage, openMediaPicker,
    availableMenus, availableCategories, availableSymbols,
    activeLang, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    nudgeColumn, copyColumn, pasteColumn, copyStyleColumn, pasteStyleColumn, deleteColumn, saveAsTemplate, clipHas, styleHas,
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

  if (!sel) return null;
  const [b, r, c] = sel;
  const sp = blocks[b].props as unknown as SectionProps;
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
            const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
                const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
              const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
              const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
              const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
              const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
            const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
            const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c];
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
        availableSymbols={availableSymbols}
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
