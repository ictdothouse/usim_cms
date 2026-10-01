// Inspector's Section panel (sel.length === 1) — split out of Inspector.tsx
// as part of the same God Component file-size refactor (see that file's own
// header comment). Holds no hooks of its own, called as a plain function the
// same way Inspector/ElPreview/FieldGroups already are.
import { Lock } from "lucide-react";
import { BASE_LANG, type DesignerCtx } from "./context";
import { FieldGroups } from "./FieldGroups";
import { SECTION_FIELDS } from "./fields";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_FALLBACK, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS } from "./style";
import { ICONS } from "./icons";
import type { SectionProps } from "./types";
import { BoxModel, VisibilityToggle } from "./InspectorControls";

export function InspectorSectionPanel({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, fourSideValue, setFourSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, uploadImage, openMediaPicker,
    availableMenus, availableCategories, availableSymbols,
    activeLang, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    isSuper,
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
  const [b] = sel;
  const sp = blocks[b].props as unknown as SectionProps;

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
        availableSymbols={availableSymbols}
        ICONS={ICONS}
      />
    </div>
  );
}
