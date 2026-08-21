// The Inspector's data-driven field renderer — one function that switches
// on `field.kind` and renders the right control (text/color/image/gallery/
// length/icon/shadow/pairs/slides/font/stepper/menu-select). Split out of
// Designer.tsx (Layer 1a of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) —
// FieldInput itself holds no hooks (verified during the Layer 1a closure
// audit), so it's still safe to call as a plain function `FieldInput({...})`
// from inside a .map() the same way it always was inside Designer.tsx.

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, Minus, Plus } from "lucide-react";
import type { Menu } from "@/lib/api";
import type { Key } from "@/i18n";
import { bestTextColor } from "@/lib/utils";
import type { Field, Bp, Positionable, SlideItem, SlideButton, SlideText } from "./types";
import { TYPOGRAPHY_FIELDS, TEXT_BASE_PX, SHADOW_DEFAULT_PARTS, POSITION_PRESETS } from "./fields";
import { BufferedInput, BufferedTextarea, FontPickerInput, NumberStepper, BpToggle } from "./FieldControls";
import {
  parsePairs,
  parseSlides,
  stringifySlides,
  TEXT_DEFAULTS,
  SLIDE_DEFAULTS,
  BUTTON_DEFAULTS,
} from "./parsers";
import { dragPosition, nudgePosition } from "./geometry";
import { LEGACY_SHADOW } from "./style";
import type { Block, SectionProps } from "../Designer";

// FieldInputProps was sketched in the Layer 1a plan from a closure audit
// that wasn't character-exact — several of the following were confirmed (and
// corrected) directly against Designer.tsx's actual declarations rather than
// the plan's sketch:
//   - `blocks` is `Block[]` (Designer()'s own useState<Block[]>), not `unknown[]`.
//   - `siteTheme` is `Record<string, string> | null` (Designer()'s own
//     useState<Record<string, string> | null>), not `{ primaryColor?: string }`.
//   - `uploading` is `boolean` (Designer()'s own useState(false)), not `string | null`.
//   - `bpKey` takes only `(key: string)` — it closes over Designer()'s own
//     `bp` state internally, it does not take `bp` as a parameter.
//   - `toggleBpKeys` takes `(bag, keys)` and RETURNS the next bag
//     (`Record<string, string>`) for the caller to assign — it does not take
//     a `setBag` callback or return void.
//   - `bpGetValue`'s `base` param is `string | undefined`, not `string`.
//   - `uploadImage` is `async`, so it returns `Promise<void>`.
// Two more closure values FieldInput's body actually reads that the plan's
// sketch didn't list at all: `availableMenus` (Designer()'s own
// useState<Menu[]>, used by the "menu-select" kind) and `ICONS` (a
// module-level lookup table in Designer.tsx, used by the "icon" kind) — both
// threaded through as explicit props, the same way every other Designer()-
// owned value FieldInput needs is threaded here, rather than importing
// `ICONS` back from Designer.tsx (which would be a real, non-type-only
// circular import since it's a runtime value, not just a type).
export interface FieldInputProps {
  field: Field;
  value: string;
  onChange: (v: string) => void;
  iconSearch: string;
  setIconSearch: (v: string) => void;
  uploading: boolean;
  siteTheme: Record<string, string> | null;
  sel: number[] | null;
  blocks: Block[];
  sliderSlideIdx: Record<string, number>;
  setSliderSlideIdx: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>),
  ) => void;
  bp: Bp;
  t: (k: Key) => string;
  uploadImage: (file: File, setValue: (v: string) => void) => Promise<void>;
  bpGetValue: (
    base: string | undefined,
    overrides: Record<string, string> | undefined,
    key: string,
  ) => string;
  bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[]) => Record<string, string>;
  bpKey: (key: string) => string;
  availableMenus: Menu[];
  ICONS: Record<string, typeof Check>;
}

export function FieldInput({
  field,
  value,
  onChange,
  iconSearch,
  setIconSearch,
  uploading,
  siteTheme,
  sel,
  blocks,
  sliderSlideIdx,
  setSliderSlideIdx,
  bp,
  t,
  uploadImage,
  bpGetValue,
  bpKeysOverridden,
  toggleBpKeys,
  bpKey,
  availableMenus,
  ICONS,
}: FieldInputProps) {
  // FieldInput calls itself recursively at 3 spots below (inside
  // renderTypographyFields, for the slider heading/subtitle's shared
  // Typography fields) — unlike the original `{ field, value, onChange }`
  // signature, FieldInputProps has no optional keys, so TypeScript requires
  // every one of them on each recursive call, not just field/value/onChange.
  // `passthroughProps` bundles the ones already in scope as this function's
  // own parameters so each recursive call site only needs to add its own
  // field/value/onChange on top, same values, zero new closures.
  const passthroughProps = {
    iconSearch,
    setIconSearch,
    uploading,
    siteTheme,
    sel,
    blocks,
    sliderSlideIdx,
    setSliderSlideIdx,
    bp,
    t,
    uploadImage,
    bpGetValue,
    bpKeysOverridden,
    toggleBpKeys,
    bpKey,
    availableMenus,
    ICONS,
  };
  const base =
    "w-full rounded-lg border border-line/30 bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-line";
  if (field.kind === "textarea")
    return <BufferedTextarea rows={4} className={base} value={value} onCommit={onChange} />;
  if (field.kind === "menu-select") {
    return (
      <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("designer-f-menu-none")}</option>
        {availableMenus.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "select" && field.key === "align") {
    const ALIGN_ICON: Record<string, typeof AlignLeft> = {
      left: AlignLeft,
      center: AlignCenter,
      right: AlignRight,
      justify: AlignJustify,
    };
    return (
      <div className="flex gap-1">
        {(field.options ?? []).map((o) => {
          const Icon = ALIGN_ICON[o] ?? AlignLeft;
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              title={o}
              className={`flex-1 rounded-lg border p-1.5 ${
                value === o
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line/30 text-sub hover:border-accent/40"
              }`}
            >
              <Icon className="mx-auto h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    );
  }
  if (field.kind === "select")
    return (
      <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (field.kind === "color")
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-line/30"
        />
        <BufferedInput className={base} value={value} placeholder="#" onCommit={onChange} />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-[10px] font-semibold text-sub hover:text-red-500"
          >
            ✕
          </button>
        )}
      </div>
    );
  if (field.kind === "image")
    return (
      <div className="space-y-1.5">
        <BufferedInput className={base} value={value} placeholder="https://" onCommit={onChange} />
        <label className="inline-block cursor-pointer rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]">
          {uploading ? t("designer-uploading") : t("designer-upload")}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f, onChange);
            }}
          />
        </label>
        {value && <img src={value} alt="" className="h-16 rounded-lg object-cover" />}
      </div>
    );
  if (field.kind === "length") {
    // vh/vw added alongside the original px/%/em/rem so a field like the
    // slider's height can express "50% of the viewport height" or "the
    // full viewport" (100vh) directly, not just a fixed/relative-to-parent
    // length — every other "length" kind field (padding, radius, etc)
    // simply never uses those two units, no behavior change for them.
    const m = value.match(/^(-?\d*\.?\d+)(px|%|em|rem|vh|vw)$/);
    const num = m ? m[1] : "";
    const unit = m ? m[2] : "px";
    return (
      <div className="flex gap-2">
        {/* `base` includes `w-full`, which as a flex item's basis (100%)
              plus the select's own 20-width sibling overflows any narrow
              sidebar (Inspector panels run ~240-280px) — the number input
              would refuse to shrink small enough to fit, squeezing/hiding it
              next to the unit dropdown. `min-w-0 flex-1` instead lets it
              actually share the row properly. */}
        <BufferedInput
          type="number"
          step={unit === "em" || unit === "rem" ? 0.05 : 1}
          className={base.replace("w-full", "min-w-0 flex-1")}
          value={num}
          onCommit={(v) => onChange(v === "" ? "" : `${v}${unit}`)}
        />
        <select
          className={`${base.replace("w-full", "w-16")} shrink-0 px-1`}
          value={unit}
          onChange={(e) => onChange(`${num || "0"}${e.target.value}`)}
        >
          {["px", "%", "em", "rem", "vh", "vw"].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (field.kind === "font") return <FontPickerInput value={value} onChange={onChange} className={base} />;
  if (field.kind === "stepper") {
    const step = field.step ?? 1;
    const n = Number(value) || 0;
    const round = (x: number) => Math.round(x * 100) / 100;
    return (
      <div className="flex items-center rounded-lg border border-line/30 bg-canvas">
        <button
          type="button"
          onClick={() => onChange(String(round(n - step)))}
          className="px-2 py-1.5 text-sub hover:text-ink"
        >
          <Minus className="h-3 w-3" />
        </button>
        <BufferedInput
          type="number"
          step={step}
          value={value}
          onCommit={onChange}
          className="w-full border-0 bg-transparent px-1 py-1.5 text-center text-xs outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(String(round(n + step)))}
          className="px-2 py-1.5 text-sub hover:text-ink"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    );
  }
  if (field.kind === "icon") {
    const q = iconSearch.trim().toLowerCase();
    const options = (field.options ?? []).filter((name) => !q || name.includes(q));
    return (
      <div className="space-y-1.5">
        <input
          className={base}
          value={iconSearch}
          onChange={(e) => setIconSearch(e.target.value)}
          placeholder={t("designer-icon-search")}
        />
        <div className="grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-line/30 bg-canvas p-1.5">
          {options.length === 0 && (
            <p className="col-span-4 py-2 text-center text-[10px] text-sub">{t("designer-icon-none")}</p>
          )}
          {options.map((name) => {
            const Icon = ICONS[name] ?? Check;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange(name)}
                title={name}
                className={`flex flex-col items-center gap-1 rounded-md p-1.5 text-[9px] ${
                  value === name ? "bg-accent/15 font-semibold text-accent" : "text-body hover:bg-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="w-full truncate text-center">{name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.kind === "gallery") {
    const urls = value ? value.split("\n").filter(Boolean) : [];
    const setUrls = (next: string[]) => onChange(next.join("\n"));
    return (
      <div className="space-y-2">
        {urls.map((u, i) => (
          <div key={i} className="flex items-center gap-2">
            {u && <img src={u} alt="" className="h-9 w-9 rounded object-cover" />}
            <BufferedInput
              className={base}
              value={u}
              placeholder="https://"
              onCommit={(v) => setUrls(urls.map((x, j) => (j === i ? v : x)))}
            />
            <label className="cursor-pointer text-[10px] font-semibold text-accent">
              {uploading ? t("designer-uploading") : t("designer-upload")}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f, (v) => setUrls(urls.map((x, j) => (j === i ? v : x))));
                }}
              />
            </label>
            <button
              onClick={() => setUrls(urls.filter((_, j) => j !== i))}
              className="text-[10px] font-semibold text-red-500"
            >
              {t("designer-gallery-remove")}
            </button>
          </div>
        ))}
        <button onClick={() => setUrls([...urls, ""])} className="text-[11px] font-semibold text-accent">
          {t("designer-gallery-add-image")}
        </button>
      </div>
    );
  }
  if (field.kind === "pairs") {
    const items = parsePairs(value);
    const setItems = (next: { a: string; b: string }[]) =>
      onChange(next.map((it) => `${it.a}|${it.b}`).join("\n"));
    const [labelAKey, labelBKey] = field.subLabels ?? [
      "designer-f-accordion-question",
      "designer-f-accordion-answer",
    ];
    return (
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-line/30 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-sub">#{i + 1}</span>
              <button
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-[10px] font-semibold text-red-500"
              >
                {t("designer-gallery-remove")}
              </button>
            </div>
            <BufferedInput
              className={base}
              value={it.a}
              placeholder={t(labelAKey)}
              onCommit={(v) => setItems(items.map((x, j) => (j === i ? { ...x, a: v } : x)))}
            />
            <BufferedTextarea
              rows={2}
              className={base}
              value={it.b}
              placeholder={t(labelBKey)}
              onCommit={(v) => setItems(items.map((x, j) => (j === i ? { ...x, b: v } : x)))}
            />
          </div>
        ))}
        <button
          onClick={() => setItems([...items, { a: "", b: "" }])}
          className="text-[11px] font-semibold text-accent"
        >
          {t("designer-pairs-add")}
        </button>
      </div>
    );
  }
  if (field.kind === "slides") {
    const items = parseSlides(value);
    // What an unset button colour actually resolves to, so the swatches can
    // preview the real default. Mirrors `.ds-btn-primary`'s
    // `var(--color-primary, #0f62fe)` fallback chain on the real site.
    const themePrimary = siteTheme?.primaryColor || "#0f62fe";
    // A slide's own card here is edited regardless of which slide the
    // Blocks canvas is currently previewing (sliderSlideIdx) — size/align/
    // color changes on an off-screen slide's card are real (same `update`
    // below every other field here uses) but invisible until you switch
    // the canvas to that slide, which reads as "setting has no effect".
    // Focusing any field inside a slide's card auto-switches the canvas
    // preview to that same slide, so what you're editing is always what
    // you're looking at.
    const activeSliderElId =
      sel && sel.length === 4
        ? (blocks[sel[0]]?.props as unknown as SectionProps)?.rows?.[sel[1]]?.columns?.[sel[2]]?.elements?.[
            sel[3]
          ]?.id
        : undefined;
    const setItems = (next: SlideItem[]) => onChange(stringifySlides(next));
    const update = (i: number, patch: Partial<SlideItem>) =>
      setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const updateButtons = (i: number, buttons: SlideButton[]) => update(i, { buttons });
    // Shared by the button card AND the heading/subtitle editors below —
    // same preset grid + drag-or-click minimap + keyboard nudge for
    // whichever `Positionable` is passed in, so all three item kinds edit
    // their x/y through identical UI.
    const renderPositionEditor = (
      pos: Positionable,
      onChange: (patch: Partial<Positionable>) => void,
      previewImage?: string,
    ) => (
      <div className="space-y-1 rounded border border-line/20 p-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-sub">{t("designer-f-slider-position")}</span>
          <button
            onClick={() => onChange({ position: "flow" })}
            className={`text-[10px] font-semibold ${pos.position === "flow" ? "text-accent" : "text-sub"}`}
          >
            {t("designer-f-slider-positionflow")}
          </button>
        </div>
        <div className="flex gap-2">
          <div className="grid w-16 shrink-0 grid-cols-3 gap-0.5">
            {POSITION_PRESETS.map((pp, pi) => (
              <button
                key={pi}
                onClick={() => onChange({ position: "custom", x: pp.x, y: pp.y })}
                className="h-4 w-4 rounded-sm border border-line/40 bg-canvas hover:bg-accent/20"
              />
            ))}
          </div>
          <div
            tabIndex={0}
            className="relative h-16 flex-1 overflow-hidden rounded border border-line/30 bg-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
            style={
              previewImage
                ? {
                    backgroundImage: `url(${previewImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
            onPointerDown={(ev) => dragPosition(ev, (x, y) => onChange({ position: "custom", x, y }))}
            onKeyDown={(ev) => {
              const patch = nudgePosition(pos, ev.key);
              if (patch) {
                ev.preventDefault();
                onChange(patch);
              }
            }}
          >
            {pos.position === "custom" && (
              <div
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-accent shadow"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              />
            )}
          </div>
        </div>
      </div>
    );
    // Heading/subtitle's align control — the same icon-button row
    // (left/center/right) FieldInput already renders for the standalone
    // heading/text element types' own "align" field (see the
    // `field.kind === "select" && field.key === "align"` branch above).
    // No minimap here and no manual fontSize input: position/resize for
    // heading/subtitle are canvas-drag-only, exactly like buttons.
    const ALIGN_ICONS: Record<SlideText["align"], typeof AlignLeft> = {
      left: AlignLeft,
      center: AlignCenter,
      right: AlignRight,
    };
    // bp-aware like every other field in this file now: on desktop, writes
    // `align` directly; on tablet/mobile, writes into `txt.bp` instead
    // (same "tablet:<key>"/"mobile:<key>" bag Section/Col/El use) — real on
    // the published site via SectionBlock.astro's slideTextStyleBp, not
    // just an admin-preview simulation.
    const renderTextAlign = (txt: SlideText, onChange: (patch: Partial<SlideText>) => void) => {
      const resolvedAlign = (bpGetValue(txt.align, txt.bp, "align") || "left") as SlideText["align"];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-sub">{t("designer-f-align")}</span>
            <BpToggle
              active={bpKeysOverridden(txt.bp, ["align"])}
              onToggle={() => onChange({ bp: toggleBpKeys(txt.bp, ["align"]) })}
              bp={bp}
              t={t}
            />
          </div>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((o) => {
              const Icon = ALIGN_ICONS[o];
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    onChange(
                      bp === "desktop" ? { align: o } : { bp: { ...(txt.bp ?? {}), [bpKey("align")]: o } },
                    )
                  }
                  title={o}
                  className={`flex-1 rounded-lg border p-1.5 ${
                    resolvedAlign === o
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line/30 text-sub hover:border-accent/40"
                  }`}
                >
                  <Icon className="mx-auto h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      );
    };
    // Heading/subtitle's font-family/weight/line-height/letter-spacing/
    // text-transform/italic/decoration controls — literally reuses
    // TYPOGRAPHY_FIELDS + FieldInput (the same field list/renderer the
    // standalone heading/text element types use for their own Style tab),
    // minus "color" since that already has its own dedicated swatch above.
    // FieldInput is a plain function (no hooks of its own), safe to call
    // directly in a .map() the same way ElPreview is called elsewhere here.
    // Canvas drag-to-resize is fast but imprecise — this gives an exact
    // numeric alternative for whoever wants a specific size instead of
    // eyeballing it. Reuses the standalone text element's own "Size" label
    // (same field name, no new i18n key) and the stepper kind already
    // built for lineHeight/letterSpacing above. Neither this nor the
    // canvas drag (startResize) clamps an upper bound — only a 1px floor.
    const SLIDE_TEXT_SIZE_FIELD: Field = {
      key: "fontSize",
      labelKey: "designer-f-size",
      kind: "stepper",
      step: 1,
    };
    const renderTypographyFields = (txt: SlideText, onChange: (patch: Partial<SlideText>) => void) => (
      <div className="space-y-1.5 rounded border border-line/20 p-2">
        <span className="text-[10px] font-semibold text-sub">{t("designer-group-typography")}</span>
        {TYPOGRAPHY_FIELDS.filter((f) => f.key !== "color").map((f) => (
          <div key={f.key} className="space-y-0.5">
            <span className="text-[9px] text-sub">{t(f.labelKey)}</span>
            {FieldInput({
              ...passthroughProps,
              field: f,
              value: (txt as unknown as Record<string, string>)[f.key] ?? "",
              onChange: (v) => onChange({ [f.key]: v } as Partial<SlideText>),
            })}
          </div>
        ))}
      </div>
    );
    return (
      <div className="space-y-2">
        {items.map((s, i) => (
          <div
            key={i}
            className={`space-y-1.5 rounded-lg border p-2 ${
              activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) === i
                ? "border-accent"
                : "border-line/30"
            }`}
            onFocus={() => {
              // Skip the state write entirely when this card is already
              // the previewed slide (the common case — most field edits
              // happen on the slide already showing) so focusing/clicking
              // a control here never fires a react-state update+re-render
              // interleaved with that same click's own onChange, which is
              // exactly the kind of thing that can make a click silently
              // never land (focus fires before click in the browser's own
              // event order).
              if (activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) !== i) {
                setSliderSlideIdx((m) => ({ ...m, [activeSliderElId]: i }));
              }
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-sub">
                #{i + 1}{" "}
                {activeSliderElId && (sliderSlideIdx[activeSliderElId] ?? 0) === i
                  ? `· ${t("designer-slide-previewing")}`
                  : ""}
              </span>
              <button
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-[10px] font-semibold text-red-500"
              >
                {t("designer-gallery-remove")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {s.imageUrl && (
                <img src={s.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              )}
              <BufferedInput
                className={base}
                value={s.imageUrl}
                placeholder={t("designer-f-slider-image")}
                onCommit={(v) => update(i, { imageUrl: v })}
              />
              <label className="shrink-0 cursor-pointer text-[10px] font-semibold text-accent">
                {uploading ? t("designer-uploading") : t("designer-upload")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f, (v) => update(i, { imageUrl: v }));
                  }}
                />
              </label>
            </div>
            <label
              className="flex w-fit items-center gap-1 text-[10px] text-sub"
              title={t("designer-f-slider-bgcolor")}
            >
              <input
                type="color"
                value={s.bgColor || "#000000"}
                onChange={(e) => update(i, { bgColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-line/30"
              />
              {t("designer-f-slider-bgcolor")}
              {s.bgColor && (
                <button
                  type="button"
                  className="text-sub/70 hover:text-sub"
                  onClick={() => update(i, { bgColor: "" })}
                >
                  ×
                </button>
              )}
            </label>
            <div className="space-y-1.5 rounded border border-line/20 p-2">
              <span className="text-[10px] font-semibold text-sub">{t("designer-f-slider-heading")}</span>
              {/* Textarea, not a single-line input: heading/subtitle never
                    auto-wrap on the canvas or the real site anymore (see
                    textChip/slideTextStyle's white-space:pre) — the ONLY way
                    to get a second line is a literal newline, so Enter has to
                    actually insert one instead of just committing/blurring. */}
              <BufferedTextarea
                rows={2}
                className={base}
                value={s.heading.text}
                placeholder={t("designer-f-slider-heading")}
                onCommit={(v) => update(i, { heading: { ...s.heading, text: v } })}
              />
              <label
                className="flex w-fit items-center gap-1 text-[10px] text-sub"
                title={t("designer-f-slider-textcolor")}
              >
                <input
                  type="color"
                  value={s.heading.color || "#ffffff"}
                  onChange={(e) => update(i, { heading: { ...s.heading, color: e.target.value } })}
                  className="h-6 w-8 cursor-pointer rounded border border-line/30"
                />
                {s.heading.color && (
                  <button
                    onClick={() => update(i, { heading: { ...s.heading, color: "" } })}
                    className="font-semibold text-red-500"
                  >
                    ×
                  </button>
                )}
              </label>
              <div className="space-y-0.5">
                <span className="inline-flex items-center gap-1 text-[9px] text-sub">
                  {t(SLIDE_TEXT_SIZE_FIELD.labelKey)}
                  <BpToggle
                    active={bpKeysOverridden(s.heading.bp, ["fontSize"])}
                    onToggle={() =>
                      update(i, { heading: { ...s.heading, bp: toggleBpKeys(s.heading.bp, ["fontSize"]) } })
                    }
                    bp={bp}
                    t={t}
                  />
                </span>
                {FieldInput({
                  ...passthroughProps,
                  field: SLIDE_TEXT_SIZE_FIELD,
                  value:
                    bpGetValue(s.heading.fontSize, s.heading.bp, "fontSize") || String(TEXT_BASE_PX.heading),
                  onChange: (v) =>
                    update(i, {
                      heading:
                        bp === "desktop"
                          ? { ...s.heading, fontSize: v }
                          : { ...s.heading, bp: { ...(s.heading.bp ?? {}), [bpKey("fontSize")]: v } },
                    }),
                })}
              </div>
              {renderTextAlign(s.heading, (patch) => update(i, { heading: { ...s.heading, ...patch } }))}
              {renderTypographyFields(s.heading, (patch) =>
                update(i, { heading: { ...s.heading, ...patch } }),
              )}
            </div>
            <div className="space-y-1.5 rounded border border-line/20 p-2">
              <span className="text-[10px] font-semibold text-sub">{t("designer-f-slider-subtitle")}</span>
              <BufferedTextarea
                rows={2}
                className={base}
                value={s.subtitle.text}
                placeholder={t("designer-f-slider-subtitle")}
                onCommit={(v) => update(i, { subtitle: { ...s.subtitle, text: v } })}
              />
              <label
                className="flex w-fit items-center gap-1 text-[10px] text-sub"
                title={t("designer-f-slider-textcolor")}
              >
                <input
                  type="color"
                  value={s.subtitle.color || "#ffffff"}
                  onChange={(e) => update(i, { subtitle: { ...s.subtitle, color: e.target.value } })}
                  className="h-6 w-8 cursor-pointer rounded border border-line/30"
                />
                {s.subtitle.color && (
                  <button
                    onClick={() => update(i, { subtitle: { ...s.subtitle, color: "" } })}
                    className="font-semibold text-red-500"
                  >
                    ×
                  </button>
                )}
              </label>
              <div className="space-y-0.5">
                <span className="inline-flex items-center gap-1 text-[9px] text-sub">
                  {t(SLIDE_TEXT_SIZE_FIELD.labelKey)}
                  <BpToggle
                    active={bpKeysOverridden(s.subtitle.bp, ["fontSize"])}
                    onToggle={() =>
                      update(i, {
                        subtitle: { ...s.subtitle, bp: toggleBpKeys(s.subtitle.bp, ["fontSize"]) },
                      })
                    }
                    bp={bp}
                    t={t}
                  />
                </span>
                {FieldInput({
                  ...passthroughProps,
                  field: SLIDE_TEXT_SIZE_FIELD,
                  value:
                    bpGetValue(s.subtitle.fontSize, s.subtitle.bp, "fontSize") ||
                    String(TEXT_BASE_PX.subtitle),
                  onChange: (v) =>
                    update(i, {
                      subtitle:
                        bp === "desktop"
                          ? { ...s.subtitle, fontSize: v }
                          : { ...s.subtitle, bp: { ...(s.subtitle.bp ?? {}), [bpKey("fontSize")]: v } },
                    }),
                })}
              </div>
              {renderTextAlign(s.subtitle, (patch) => update(i, { subtitle: { ...s.subtitle, ...patch } }))}
              {renderTypographyFields(s.subtitle, (patch) =>
                update(i, { subtitle: { ...s.subtitle, ...patch } }),
              )}
            </div>
            <div className="flex gap-2">
              <select
                className={`${base} w-1/2`}
                value={s.textPosition}
                onChange={(e) => update(i, { textPosition: e.target.value as SlideItem["textPosition"] })}
                title={t("designer-f-slider-textposition")}
              >
                {(["left", "center", "right"] as const).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <input
                type="color"
                value={s.overlayColor || "#000000"}
                onChange={(e) => update(i, { overlayColor: e.target.value })}
                title={t("designer-f-slider-overlaycolor")}
                className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line/30"
              />
              <BufferedInput
                type="number"
                className={`${base} w-1/2`}
                value={s.overlayOpacity}
                placeholder={t("designer-f-slider-overlayopacity")}
                onCommit={(v) => update(i, { overlayOpacity: v })}
              />
            </div>
            <div className="space-y-1.5 rounded-lg border border-line/20 p-1.5">
              {s.buttons.map((btn, bi) => {
                const updateBtn = (patch: Partial<SlideButton>) =>
                  updateButtons(
                    i,
                    s.buttons.map((x, j) => (j === bi ? { ...x, ...patch } : x)),
                  );
                return (
                  <div key={bi} className="space-y-1.5 rounded border border-line/20 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-sub">
                        {t("designer-f-slider-button")} #{bi + 1}
                      </span>
                      <button
                        onClick={() =>
                          updateButtons(
                            i,
                            s.buttons.filter((_, j) => j !== bi),
                          )
                        }
                        className="text-[10px] font-semibold text-red-500"
                      >
                        {t("designer-gallery-remove")}
                      </button>
                    </div>
                    <BufferedInput
                      className={base}
                      value={btn.label}
                      placeholder={t("designer-f-slider-buttonlabel")}
                      onCommit={(v) => updateBtn({ label: v })}
                    />
                    <BufferedInput
                      className={base}
                      value={btn.href}
                      placeholder={t("designer-f-slider-buttonhref")}
                      onCommit={(v) => updateBtn({ href: v })}
                    />
                    <div className="flex items-center gap-1.5">
                      <select
                        className={`${base} flex-1`}
                        value={btn.variant}
                        onChange={(e) => updateBtn({ variant: e.target.value as SlideButton["variant"] })}
                      >
                        <option value="primary">primary</option>
                        <option value="outline">outline</option>
                      </select>
                      <select
                        className={`${base} flex-1`}
                        value={btn.size}
                        onChange={(e) => updateBtn({ size: e.target.value as SlideButton["size"] })}
                        title={t("designer-f-slider-buttonsize")}
                      >
                        <option value="sm">sm</option>
                        <option value="md">md</option>
                        <option value="lg">lg</option>
                      </select>
                      <BufferedInput
                        type="number"
                        className={`${base} w-16 shrink-0`}
                        value={btn.radius}
                        placeholder={t("designer-f-slider-buttonradius")}
                        onCommit={(v) => updateBtn({ radius: v })}
                      />
                    </div>
                    {/* Both swatches preview the value that's ACTUALLY in
                          effect when nothing is overridden — the site theme's
                          primary and its computed label colour — rather than an
                          arbitrary blue/white. Previously the swatch showed
                          #2563eb for an unset colour, which read as "this
                          button is blue" when the real default is the theme's
                          own colour. The reset button (shown only when there IS
                          something to reset) puts it back to that default. */}
                    <div className="flex items-center gap-3">
                      <label
                        className="flex items-center gap-1 text-[10px] text-sub"
                        title={t("designer-f-slider-buttoncolor")}
                      >
                        <input
                          type="color"
                          value={btn.color || themePrimary}
                          onChange={(e) => updateBtn({ color: e.target.value })}
                          className="h-6 w-8 cursor-pointer rounded border border-line/30"
                        />
                        {btn.color && (
                          <button
                            onClick={() => updateBtn({ color: "" })}
                            title={t("designer-reset-default")}
                            className="font-semibold text-red-500"
                          >
                            ×
                          </button>
                        )}
                      </label>
                      <label
                        className="flex items-center gap-1 text-[10px] text-sub"
                        title={t("designer-f-slider-buttontextcolor")}
                      >
                        <input
                          type="color"
                          value={btn.textColor || bestTextColor(btn.color || themePrimary)}
                          onChange={(e) => updateBtn({ textColor: e.target.value })}
                          className="h-6 w-8 cursor-pointer rounded border border-line/30"
                        />
                        {btn.textColor && (
                          <button
                            onClick={() => updateBtn({ textColor: "" })}
                            title={t("designer-reset-default")}
                            className="font-semibold text-red-500"
                          >
                            ×
                          </button>
                        )}
                      </label>
                    </div>
                    {renderPositionEditor(btn, (patch) => updateBtn(patch), s.imageUrl)}
                  </div>
                );
              })}
              <button
                onClick={() => updateButtons(i, [...s.buttons, { ...BUTTON_DEFAULTS }])}
                className="text-[11px] font-semibold text-accent"
              >
                {t("designer-slides-add-button")}
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setItems([
              ...items,
              {
                imageUrl: "",
                heading: { ...TEXT_DEFAULTS },
                subtitle: { ...TEXT_DEFAULTS },
                ...SLIDE_DEFAULTS,
                buttons: [],
              },
            ])
          }
          className="text-[11px] font-semibold text-accent"
        >
          {t("designer-slides-add")}
        </button>
      </div>
    );
  }
  if (field.kind === "shadow") {
    const legacyDefault = value && value in LEGACY_SHADOW && value !== "none";
    const parts = value.includes("|") ? value.split("|") : legacyDefault ? SHADOW_DEFAULT_PARTS : null;
    if (!parts) {
      return (
        <button
          type="button"
          onClick={() => onChange(SHADOW_DEFAULT_PARTS.join("|"))}
          className="w-full rounded-lg border border-dashed border-line/40 py-1.5 text-[11px] font-semibold text-accent"
        >
          {t("designer-shadow-add")}
        </button>
      );
    }
    const [x, y, blur, spread, color, opacity] = parts;
    const commit = (i: number, v: string) => {
      const next = [x, y, blur, spread, color, opacity];
      next[i] = v;
      onChange(next.join("|"));
    };
    return (
      <div className="space-y-2 rounded-lg border border-line/30 p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberStepper label="X" value={x} onCommit={(v) => commit(0, v)} />
          <NumberStepper label="Y" value={y} onCommit={(v) => commit(1, v)} />
          <NumberStepper
            label={t("designer-shadow-blur")}
            value={blur}
            min={0}
            onCommit={(v) => commit(2, v)}
          />
          <NumberStepper label={t("designer-shadow-spread")} value={spread} onCommit={(v) => commit(3, v)} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color || "#000000"}
            onChange={(e) => commit(4, e.target.value)}
            className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line/30"
          />
          <div className="flex-1">
            <NumberStepper
              label={t("designer-shadow-opacity")}
              value={opacity}
              step={0.05}
              min={0}
              onCommit={(v) => commit(5, String(Math.min(1, Number(v))))}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-[10px] font-semibold text-sub hover:text-red-500"
        >
          {t("designer-shadow-remove")}
        </button>
      </div>
    );
  }
  return <BufferedInput className={base} value={value} onCommit={onChange} />;
}
