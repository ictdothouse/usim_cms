// The Inspector's data-driven field renderer — one function that switches
// on `field.kind` and renders the right control (text/color/image/gallery/
// length/icon/shadow/pairs/slides/font/stepper/menu-select). Split out of
// Designer.tsx (Layer 1a of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) —
// FieldInput itself holds no hooks (verified during the Layer 1a closure
// audit), so it's still safe to call as a plain function `FieldInput({...})`
// from inside a .map() the same way it always was inside Designer.tsx.

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, Minus, Plus, Trash2 } from "lucide-react";
import type { Menu, Category } from "@/lib/api";
import type { Key } from "@/i18n";
import type { Field, Bp, SlideItem, Block, SectionProps } from "./types";
import { SHADOW_DEFAULT_PARTS } from "./fields";
import { BufferedInput, BufferedTextarea, FontPickerInput, NumberStepper, BpToggle } from "./FieldControls";
import {
  parsePairs,
  parseSlides,
  stringifySlides,
  parseCards,
  stringifyCards,
  parseRepeaterItems,
  stringifyRepeaterItems,
  CARD_DEFAULTS,
  newSlide,
  addSlideElement,
  addSlideRow,
  deleteSlideElement,
  deleteSlideRow,
} from "./parsers";
import { ELS } from "./elements";
import { LEGACY_SHADOW } from "./style";

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
  sliderInnerSel: Record<string, { r: number; c: number; e: number } | null>;
  setSliderInnerSel: (
    v:
      | Record<string, { r: number; c: number; e: number } | null>
      | ((prev: Record<string, { r: number; c: number; e: number } | null>) => Record<string, { r: number; c: number; e: number } | null>),
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
  // "postlist" element's categoryId picker (Sprint 5) — same live-fetched-
  // once-per-tenant shape as availableMenus above, not a static enum.
  availableCategories: Category[];
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
  sliderInnerSel,
  setSliderInnerSel,
  bp,
  t,
  uploadImage,
  bpGetValue,
  bpKeysOverridden,
  toggleBpKeys,
  bpKey,
  availableMenus,
  availableCategories,
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
    sliderInnerSel,
    setSliderInnerSel,
    bp,
    t,
    uploadImage,
    bpGetValue,
    bpKeysOverridden,
    toggleBpKeys,
    bpKey,
    availableMenus,
    availableCategories,
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
  if (field.kind === "category-select") {
    return (
      <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("designer-f-category-none")}</option>
        {availableCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
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
        <div className="flex flex-wrap gap-1.5">
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
          {/* Theme Settings' Branding logo/favicon (site_theme.settings) are
              just uploaded media URLs — reusing them here is a one-click copy
              into this element's own src, not a live binding, matching how
              logoUrl/faviconUrl are already plain strings everywhere else. */}
          {siteTheme?.logoUrl && (
            <button
              type="button"
              onClick={() => onChange(siteTheme.logoUrl!)}
              className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]"
            >
              {t("designer-use-site-logo")}
            </button>
          )}
          {siteTheme?.faviconUrl && (
            <button
              type="button"
              onClick={() => onChange(siteTheme.faviconUrl!)}
              className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]"
            >
              {t("designer-use-site-favicon")}
            </button>
          )}
        </div>
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
  if (field.kind === "cards") {
    const cards = parseCards(value);
    const setCards = (next: typeof cards) => onChange(stringifyCards(next));
    return (
      <div className="space-y-2">
        {cards.map((c, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-line/30 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-sub">#{i + 1}</span>
              <button
                onClick={() => setCards(cards.filter((_, j) => j !== i))}
                className="text-[10px] font-semibold text-red-500"
              >
                {t("designer-gallery-remove")}
              </button>
            </div>
            <BufferedInput
              className={base}
              value={c.image}
              placeholder="https://"
              onCommit={(v) => setCards(cards.map((x, j) => (j === i ? { ...x, image: v } : x)))}
            />
            <BufferedInput
              className={base}
              value={c.title}
              placeholder={t("designer-f-cardgrid-title")}
              onCommit={(v) => setCards(cards.map((x, j) => (j === i ? { ...x, title: v } : x)))}
            />
            <BufferedTextarea
              rows={2}
              className={base}
              value={c.description}
              placeholder={t("designer-f-text")}
              onCommit={(v) => setCards(cards.map((x, j) => (j === i ? { ...x, description: v } : x)))}
            />
            <BufferedInput
              className={base}
              value={c.href}
              placeholder={t("designer-f-href")}
              onCommit={(v) => setCards(cards.map((x, j) => (j === i ? { ...x, href: v } : x)))}
            />
            <BufferedInput
              className={base}
              value={c.buttonLabel}
              placeholder={t("designer-f-cardgrid-buttonlabel")}
              onCommit={(v) => setCards(cards.map((x, j) => (j === i ? { ...x, buttonLabel: v } : x)))}
            />
          </div>
        ))}
        <button onClick={() => setCards([...cards, { ...CARD_DEFAULTS }])} className="text-[11px] font-semibold text-accent">
          {t("designer-pairs-add")}
        </button>
      </div>
    );
  }
  if (field.kind === "repeater") {
    const itemFields = field.itemFields ?? [];
    const items = parseRepeaterItems(value);
    const setItems = (next: typeof items) => onChange(stringifyRepeaterItems(next));
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
            {itemFields.map((f) => {
              const v = it[f.key] ?? "";
              const commit = (nv: string) => setItems(items.map((x, j) => (j === i ? { ...x, [f.key]: nv } : x)));
              if (f.type === "image") {
                return (
                  <div key={f.key} className="flex items-center gap-2">
                    {v && <img src={v} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                    <BufferedInput className={base} value={v} placeholder={t(f.labelKey)} onCommit={commit} />
                    <label className="shrink-0 cursor-pointer text-[10px] font-semibold text-accent">
                      {uploading ? t("designer-uploading") : t("designer-upload")}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadImage(file, commit);
                        }}
                      />
                    </label>
                  </div>
                );
              }
              if (f.type === "icon") {
                return (
                  <div key={f.key} className="space-y-0.5">
                    <span className="text-[9px] text-sub">{t(f.labelKey)}</span>
                    {FieldInput({
                      ...passthroughProps,
                      field: { key: f.key, labelKey: f.labelKey, kind: "icon", options: Object.keys(ICONS) },
                      value: v,
                      onChange: commit,
                    })}
                  </div>
                );
              }
              if (f.type === "textarea")
                return <BufferedTextarea key={f.key} rows={2} className={base} value={v} placeholder={t(f.labelKey)} onCommit={commit} />;
              return <BufferedInput key={f.key} className={base} value={v} placeholder={t(f.labelKey)} onCommit={commit} />;
            })}
          </div>
        ))}
        <button
          onClick={() => setItems([...items, Object.fromEntries(itemFields.map((f) => [f.key, ""]))])}
          className="text-[11px] font-semibold text-accent"
        >
          {t("designer-pairs-add")}
        </button>
      </div>
    );
  }
  if (field.kind === "slides") {
    const items = parseSlides(value);
    // A slide's own card here is edited regardless of which slide the
    // Blocks canvas is currently previewing (sliderSlideIdx) — background/
    // overlay changes on an off-screen slide's card are real (same
    // `patchSlide` below every field here uses) but invisible until you
    // switch the canvas to that slide, which reads as "setting has no
    // effect". Focusing any field inside a slide's card, or selecting one of
    // its nested Text/Button/Image/Row layers, auto-switches the canvas
    // preview to that same slide, so what you're editing is always what
    // you're looking at.
    const activeSliderElId =
      sel && sel.length === 4
        ? (blocks[sel[0]]?.props as unknown as SectionProps)?.rows?.[sel[1]]?.columns?.[sel[2]]?.elements?.[
            sel[3]
          ]?.id
        : undefined;
    const setItems = (next: SlideItem[]) => onChange(stringifySlides(next));
    const replaceSlide = (i: number, next: SlideItem) => setItems(items.map((x, j) => (j === i ? next : x)));
    const patchSlide = (i: number, patch: Partial<SlideItem>) => replaceSlide(i, { ...items[i], ...patch });
    const previewSlide = (i: number) => {
      if (activeSliderElId) setSliderSlideIdx((m) => ({ ...m, [activeSliderElId]: i }));
    };
    const selectInner = (i: number, r: number, c: number, e: number) => {
      if (!activeSliderElId) return;
      previewSlide(i);
      setSliderInnerSel((m) => ({ ...m, [activeSliderElId]: { r, c, e } }));
    };
    const clearInner = () => {
      if (activeSliderElId) setSliderInnerSel((m) => ({ ...m, [activeSliderElId]: null }));
    };
    const innerSel = activeSliderElId ? (sliderInnerSel[activeSliderElId] ?? null) : null;
    return (
      <div className="space-y-2">
        {items.map((s, i) => {
          const isPreviewing = activeSliderElId != null && (sliderSlideIdx[activeSliderElId] ?? 0) === i;
          return (
            <div
              key={i}
              className={`space-y-1.5 rounded-lg border p-2 ${isPreviewing ? "border-accent" : "border-line/30"}`}
              onFocus={() => previewSlide(i)}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-sub">
                  #{i + 1} {isPreviewing ? `· ${t("designer-slide-previewing")}` : ""}
                </span>
                <button
                  onClick={() => {
                    setItems(items.filter((_, j) => j !== i));
                    clearInner();
                  }}
                  className="text-[10px] font-semibold text-red-500"
                >
                  {t("designer-gallery-remove")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {s.imageUrl && <img src={s.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                <BufferedInput
                  className={base}
                  value={s.imageUrl}
                  placeholder={t("designer-f-slider-image")}
                  onCommit={(v) => patchSlide(i, { imageUrl: v })}
                />
                <label className="shrink-0 cursor-pointer text-[10px] font-semibold text-accent">
                  {uploading ? t("designer-uploading") : t("designer-upload")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f, (v) => patchSlide(i, { imageUrl: v }));
                    }}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex w-fit items-center gap-1 text-[10px] text-sub" title={t("designer-f-slider-bgcolor")}>
                  <input
                    type="color"
                    value={s.bgColor || "#000000"}
                    onChange={(e) => patchSlide(i, { bgColor: e.target.value })}
                    className="h-6 w-8 cursor-pointer rounded border border-line/30"
                  />
                  {t("designer-f-slider-bgcolor")}
                  {s.bgColor && (
                    <button type="button" className="text-sub/70 hover:text-sub" onClick={() => patchSlide(i, { bgColor: "" })}>
                      ×
                    </button>
                  )}
                </label>
                {s.imageUrl && (
                  <select
                    className={`${base} flex-1`}
                    value={s.bgSize}
                    title={t("designer-f-slider-bgsize")}
                    onChange={(e) => patchSlide(i, { bgSize: e.target.value as SlideItem["bgSize"] })}
                  >
                    {(["", "cover", "contain", "repeat", "no-repeat", "auto"] as const).map((o) => (
                      <option key={o} value={o}>
                        {o || "cover"}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  className={`${base} w-1/2`}
                  value={s.textPosition}
                  onChange={(e) => patchSlide(i, { textPosition: e.target.value as SlideItem["textPosition"] })}
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
                  onChange={(e) => patchSlide(i, { overlayColor: e.target.value })}
                  title={t("designer-f-slider-overlaycolor")}
                  className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line/30"
                />
                <BufferedInput
                  type="number"
                  className={`${base} w-1/2`}
                  value={s.overlayOpacity}
                  placeholder={t("designer-f-slider-overlayopacity")}
                  onCommit={(v) => patchSlide(i, { overlayOpacity: v })}
                />
              </div>
              {/* This slide's own mini-canvas content — nothing by default,
                  just Text/Button/Image/Row add buttons, matching how
                  `buttons` was already opt-in before this rework. Clicking a
                  layer selects it for editing (Inspector shows that
                  element's own Content/Style fields — see Inspector.tsx's
                  slider-inner-selection branch); the × here deletes it
                  without needing to select it first. */}
              <div className="space-y-1 rounded-lg border border-line/20 p-1.5">
                {s.rows.length === 0 ? (
                  <p className="px-1 py-2 text-center text-[10px] italic text-sub">{t("designer-slide-empty")}</p>
                ) : (
                  s.rows.map((row, r) => (
                    <div key={r} className={s.rows.length > 1 ? "space-y-0.5 rounded border border-line/10 p-1" : "space-y-0.5"}>
                      {s.rows.length > 1 && (
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[9px] font-semibold text-sub">
                            {t("designer-row")} {r + 1}
                          </span>
                          <button
                            onClick={() => {
                              replaceSlide(i, deleteSlideRow(s, r));
                              if (innerSel?.r === r) clearInner();
                            }}
                            className="text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {row.columns.map((col, c) =>
                        col.elements.map((el, e) => {
                          const Icon = ELS[el.type].icon;
                          const selected = isPreviewing && innerSel?.r === r && innerSel?.c === c && innerSel?.e === e;
                          return (
                            <div
                              key={el.id}
                              onClick={() => selectInner(i, r, c, e)}
                              className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[10px] ${
                                selected ? "bg-accent/10 text-accent" : "hover:bg-canvas"
                              }`}
                            >
                              <Icon className="h-3 w-3 shrink-0" />
                              <span className="flex-1 truncate">{t(ELS[el.type].labelKey)}</span>
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  replaceSlide(i, deleteSlideElement(s, r, c, e));
                                  if (selected) clearInner();
                                }}
                                className="shrink-0 text-red-500"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        }),
                      )}
                    </div>
                  ))
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                  {(["text", "button", "image"] as const).map((t2) => (
                    <button
                      key={t2}
                      onClick={() => replaceSlide(i, addSlideElement(s, t2, { ...ELS[t2].defaults }))}
                      className="text-[10px] font-semibold text-accent"
                    >
                      {t(t2 === "text" ? "designer-slide-add-text" : t2 === "button" ? "designer-slide-add-button" : "designer-slide-add-image")}
                    </button>
                  ))}
                  <button onClick={() => replaceSlide(i, addSlideRow(s))} className="text-[10px] font-semibold text-accent">
                    {t("designer-slide-add-row")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <button onClick={() => setItems([...items, newSlide()])} className="text-[11px] font-semibold text-accent">
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
