// Inspector's Element panel (sel.length === 4) — split out of Inspector.tsx
// as part of the same God Component file-size refactor (see that file's own
// header comment). Holds no hooks of its own, called as a plain function the
// same way Inspector/ElPreview/FieldGroups already are. Covers both a normal
// top-level element AND, when a slider's own nested child is selected
// (ctx.sliderInnerSel), that child's own Content/Style fields — see
// apps/admin/CLAUDE.md's slider/banner rework notes for why this lives here
// rather than as a separate sel shape.
import { ArrowDown, ArrowUp, Clipboard, ClipboardPaste, Copy, Move, Paintbrush, Trash2 } from "lucide-react";
import { BASE_LANG, type DesignerCtx } from "./context";
import { BpToggle, BufferedInput } from "./FieldControls";
import { FieldGroups } from "./FieldGroups";
import { CSS_CLASS_FIELD, FIELD_GROUP_BY_KEY } from "./fields";
import { parseSlides, stringifySlides, updateSlideElementBp, updateSlideElementProps } from "./parsers";
import { MARGIN_SIDE_FALLBACK, MARGIN_SIDE_KEYS, PADDING_SIDE_KEYS, RADIUS_CORNER_KEYS } from "./style";
import { ELS } from "./elements";
import { ICONS } from "./icons";
import type { Field, SectionProps } from "./types";
import { BoxModel, ContainerChildrenPanel, VisibilityToggle } from "./InspectorControls";

export function InspectorElementPanel({ ctx }: { ctx: DesignerCtx }) {
  const {
    t, bp, sel, setSel, blocks, mutate,
    bpKey, bpGetValue, bpKeysOverridden, toggleBpKeys, sideValue, setElSideValue,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
    collapsedGroups, toggleGroup, inspectorTab, setInspectorTab,
    iconSearch, setIconSearch, uploading, siteTheme, sliderSlideIdx, setSliderSlideIdx,
    sliderInnerSel, setSliderInnerSel, uploadImage, openMediaPicker,
    availableMenus, availableCategories, availableSymbols,
    isTextKey, pathKey, activeLang, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
    moveElement, copyElement, pasteElement, copyStyleElement, pasteStyleElement, duplicateElement, deleteElement, clipHas, styleHas,
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
  const [b, r, c, e] = sel;
  const sp = blocks[b].props as unknown as SectionProps;

  const el = sp.rows[r]?.columns[c]?.elements[e];
  if (!el) return null;
  const def = ELS[el.type];
  const elFields = [...def.fields, CSS_CLASS_FIELD];
  const hasContentFields = elFields.some((f) => (FIELD_GROUP_BY_KEY[f.key] ?? "content") === "content");
  // A slider element with a nested element selected (clicked inside its
  // currently-previewed slide's mini-canvas, see ElPreview.tsx's slider
  // case) shows THAT element's own Content/Style fields instead of the
  // slider's own, just reading/writing through the slide's own
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
          const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
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
      // Same bp routing as childSetValue, batched into one mutate — used by
      // the free-position toggle below to write position+x+y atomically
      // (one undo step, and x/y never briefly resolve against a stale
      // "position" value mid-mutation).
      const childSetValues = (patch: Record<string, string>) =>
        withChildSlide((s0) =>
          bp === "desktop"
            ? updateSlideElementProps(s0, innerSel.r, innerSel.c, innerSel.e, patch)
            : updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, {
                ...(childEl.bp ?? {}),
                ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${bp}:${k}`, v])),
              }),
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
        availableSymbols,
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
                    onClick={() => {
                      if (childIsFree) {
                        childSetValue("position", "");
                        return;
                      }
                      // Measure the child's REAL rendered position AND size (relative
                      // to its slide's own canvas box) before switching it to
                      // position:absolute — whatever the canvas is currently
                      // previewing (desktop/tablet/mobile bp all resolve through the
                      // same real DOM rect), so unlocking never visibly moves it.
                      // Size matters too, not just x/y: a flow element with no
                      // explicit width renders at its column's full width, but an
                      // absolutely-positioned one with posWidth/posHeight left unset
                      // defaults to shrink-to-content — without capturing the
                      // pre-toggle pixel size into posWidth/posHeight here, the box
                      // (and any text alignment inside it) visibly snaps to a
                      // different size the instant free position turns on, reading
                      // as a jump even though x/y alone were correct. Falls back to
                      // dead-center/auto-size only if the canvas isn't mounted (e.g.
                      // Inspector open without a live canvas), same fallback
                      // ElPreview's own render already uses for an unset x/y.
                      const box = document.querySelector<HTMLElement>(`[data-slide-box="${el.id}:${slideIdx}"]`);
                      const node = box?.querySelector<HTMLElement>(`[data-child-el="${childEl.id}"]`);
                      let x = "50";
                      let y = "50";
                      let posWidth = "";
                      let posHeight = "";
                      if (box && node) {
                        const boxRect = box.getBoundingClientRect();
                        // heading/text renders as a plain block with no explicit
                        // width, so it stretches to its column's full width in flow
                        // regardless of how short the text actually is — capturing
                        // THAT as posWidth "preserves size" technically, but for a
                        // short heading/subheader it just freezes a box far wider
                        // than the text, with no way back to a content-fit size
                        // except a manual drag. Range's content-only bounding box
                        // (ignores the block's own layout width — the standard no-
                        // dependency text-measurement trick) gives the actual glyph
                        // extent instead, so a heading/text starts free-positioned
                        // already hugging its own text.
                        // button/image used to keep `node`'s own rect on the
                        // (once-true) assumption that "their rendered box IS the
                        // real thing to preserve" — no longer true for button since
                        // its flow wrapper became a deliberately full-width
                        // text-align div (matching SectionBlock.astro's own real
                        // render), so `node` here is column-width, not pill-width;
                        // the same full-width-wrapper reasoning applies to a flow
                        // image's own align wrapper. Measuring the actual rendered
                        // pill/picture (one level — or two, for button — further in)
                        // instead of the wrapper fixes the same "Free snaps to a
                        // much bigger box" jump Range already fixed for text.
                        const innerRect =
                          childEl.type === "button"
                            ? node.querySelector("span")?.getBoundingClientRect()
                            : childEl.type === "image"
                              ? node.querySelector("img")?.getBoundingClientRect()
                              : undefined;
                        // visualRect drives x/y too, not just size — the wrapper's
                        // own rect (node) spans the full column (left edge == column
                        // left edge) while the real pill/text sits centered inside
                        // it, so anchoring x/y off the wrapper snapped a centered
                        // button to the column's left edge instead of its own visible
                        // spot (reported live: locked-centered button jumped to
                        // x≈29% on toggling Free instead of staying ≈center).
                        const visualRect =
                          childEl.type === "heading" || childEl.type === "text"
                            ? (() => {
                                const range = document.createRange();
                                range.selectNodeContents(node);
                                return range.getBoundingClientRect();
                              })()
                            : (innerRect ?? node.getBoundingClientRect());
                        if (boxRect.width > 0 && boxRect.height > 0) {
                          x = String(Math.max(0, Math.min(100, Math.round(((visualRect.left - boxRect.left) / boxRect.width) * 1000) / 10)));
                          y = String(Math.max(0, Math.min(100, Math.round(((visualRect.top - boxRect.top) / boxRect.height) * 1000) / 10)));
                        }
                        if (visualRect.width > 0) posWidth = `${Math.round(visualRect.width)}px`;
                        if (visualRect.height > 0) posHeight = `${Math.round(visualRect.height)}px`;
                      }
                      childSetValues({ position: "custom", x, y, posWidth, posHeight });
                    }}
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
                          placeholder={key === "x" || key === "y" ? "50" : "auto"}
                          onCommit={(v) => childSetValue(key, v)}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {childIsFree && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        withChildSlide((s0) => {
                          const siblingZ = s0.rows.flatMap((rr) =>
                            rr.columns.flatMap((cc) =>
                              cc.elements
                                .filter((ee) => ee.id !== childEl.id && bpGetValue(ee.props.position, ee.bp, "position") === "custom")
                                .map((ee) => Number(bpGetValue(ee.props.zIndex, ee.bp, "zIndex") || "0")),
                            ),
                          );
                          const z = String(Math.max(0, ...siblingZ) + 1);
                          return bp === "desktop"
                            ? updateSlideElementProps(s0, innerSel.r, innerSel.c, innerSel.e, { zIndex: z })
                            : updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, { ...(childEl.bp ?? {}), [`${bp}:zIndex`]: z });
                        })
                      }
                      className="flex-1 rounded-lg border border-line/30 bg-white py-1 text-[10px] font-semibold text-body"
                    >
                      {t("designer-slide-bring-front")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        withChildSlide((s0) => {
                          const siblingZ = s0.rows.flatMap((rr) =>
                            rr.columns.flatMap((cc) =>
                              cc.elements
                                .filter((ee) => ee.id !== childEl.id && bpGetValue(ee.props.position, ee.bp, "position") === "custom")
                                .map((ee) => Number(bpGetValue(ee.props.zIndex, ee.bp, "zIndex") || "0")),
                            ),
                          );
                          const z = String(Math.min(0, ...siblingZ) - 1);
                          return bp === "desktop"
                            ? updateSlideElementProps(s0, innerSel.r, innerSel.c, innerSel.e, { zIndex: z })
                            : updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, { ...(childEl.bp ?? {}), [`${bp}:zIndex`]: z });
                        })
                      }
                      className="flex-1 rounded-lg border border-line/30 bg-white py-1 text-[10px] font-semibold text-body"
                    >
                      {t("designer-slide-send-back")}
                    </button>
                  </div>
                )}
                {childIsFree && bp !== "desktop" && (
                  <button
                    type="button"
                    onClick={() =>
                      withChildSlide((s0) =>
                        updateSlideElementBp(s0, innerSel.r, innerSel.c, innerSel.e, {
                          ...(childEl.bp ?? {}),
                          [`${bp}:x`]: childEl.props.x || "50",
                          [`${bp}:y`]: childEl.props.y || "50",
                          [`${bp}:posWidth`]: childEl.props.posWidth || "",
                          [`${bp}:posHeight`]: childEl.props.posHeight || "",
                        }),
                      )
                    }
                    className="w-full rounded-lg border border-dashed border-line/40 py-1 text-[10px] font-semibold text-accent"
                  >
                    {t("designer-slide-copy-desktop-pos")}
                  </button>
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
    // second, whole-array copy into `target.bp["mobile:slides"]`/
    // `target.bp["tablet:slides"]` on any edit made while previewing
    // tablet/mobile — the Inspector read that copy back (so it looked
    // live), but the canvas (ElPreview) reads `el.props.slides` directly
    // and never checked `el.bp`, so nothing ever appeared to change there.
    // Bypassing bp entirely for this one field/kind fixes both the data
    // (edits land in the one real `slides` string) and the ghost-toggle UI.
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
        const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
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
        const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
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
    availableSymbols,
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
            (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e].props[k] = v ? "true" : "";
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
                  const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
                  target.bp = toggleBpKeys(target.bp, Object.values(PADDING_SIDE_KEYS));
                }),
              ...langOverrideProps(pathKey(b, r, c, e), Object.values(PADDING_SIDE_KEYS)),
            }}
            radius={
              el.type === "image" || el.type === "embed" || el.type === "gallery" || el.type === "slider"
                ? {
                    labelKey: "designer-f-radius",
                    linked: linkedRadius,
                    onToggleLink: () => setLinkedRadius((v) => !v),
                    getSide: (side) => sideValue(el.props, el.bp, RADIUS_CORNER_KEYS[side], "radius"),
                    setSide: (side, v) => setElSideValue(b, r, c, e, RADIUS_CORNER_KEYS[side], v),
                    hasOverride: bpKeysOverridden(el.bp, Object.values(RADIUS_CORNER_KEYS)),
                    onToggleOverride: () =>
                      mutate((bs) => {
                        const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
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
                  const target = (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[e];
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
