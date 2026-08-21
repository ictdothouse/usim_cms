// Buckets a flat Field[] list into the Grouped Styles panel's collapsible
// sections (content/typography/background/spacing/size/appearance/border/
// advanced) and renders each field via FieldInput. Split out of Designer.tsx
// (Layer 1a of the God Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) —
// FieldGroups itself holds no hooks (verified during the Layer 1a closure
// audit), so it's still safe to call from Inspector exactly as before.
//
// FieldGroupsProps was sketched in the Layer 1a plan before Task 3's own
// closure audit corrected FieldInputProps's exact shape (see the comment at
// the top of designer/FieldInput.tsx) — this mirrors those same corrections
// (`uploading` is `boolean`, `siteTheme` is `Record<string, string> | null`,
// `blocks` is `Block[]`, `bpKey`/`toggleBpKeys` take no `bp`/`setBag` param)
// plus 2 fields the plan's sketch omitted entirely: `availableMenus`/`ICONS`
// — FieldGroups forwards every FieldInputProps field (other than
// field/value/onChange, which it supplies itself per-field below) since it's
// the one place that actually calls FieldInput.
import { type Check, ChevronDown, ChevronRight } from "lucide-react";
import type { Menu } from "@/lib/api";
import type { Key } from "@/i18n";
import type { Field, FieldGroupKey, Bp, Block } from "./types";
import { FIELD_GROUP_BY_KEY, GROUP_META, FieldLabel } from "./fields";
import { BpToggle } from "./FieldControls";
import { FieldInput } from "./FieldInput";

export interface FieldGroupsProps {
  fields: Field[];
  getValue: (f: Field) => string;
  setValue: (f: Field, v: string) => void;
  // Element Inspector's Content/Style tabs (see hasContentFields in
  // Designer.tsx) reuse this same bucketing instead of a separate
  // content-vs-style split — "content" is its own tab, every other bucket is
  // "style".
  only?: "content" | "style";
  // Per-field bp-override toggle (BpToggle) — omitted for a node with no
  // `bp` bag (none currently omit it; Row doesn't use FieldGroups at all).
  hasOverride?: (f: Field) => boolean;
  onToggleOverride?: (f: Field) => void;
  collapsedGroups: Set<FieldGroupKey>;
  toggleGroup: (g: FieldGroupKey) => void;
  bp: Bp;
  t: (k: Key) => string;
  // Every other FieldInputProps field, threaded through so FieldGroups can
  // forward it into each FieldInput call below.
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
  uploadImage: (file: File, setValue: (v: string) => void) => Promise<void>;
  bpGetValue: (base: string | undefined, overrides: Record<string, string> | undefined, key: string) => string;
  bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[]) => Record<string, string>;
  bpKey: (key: string) => string;
  availableMenus: Menu[];
  ICONS: Record<string, typeof Check>;
}

// Grouped Styles panel body: buckets `fields` by FIELD_GROUP_BY_KEY and
// renders each non-empty bucket as a collapsible section (Advanced starts
// collapsed, everything else starts open — see collapsedGroups above).
export function FieldGroups({
  fields, getValue, setValue, only, hasOverride, onToggleOverride,
  collapsedGroups, toggleGroup, bp, t,
  iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
  uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey, availableMenus, ICONS,
}: FieldGroupsProps) {
  const buckets: Partial<Record<FieldGroupKey, Field[]>> = {};
  for (const f of fields) {
    const g = FIELD_GROUP_BY_KEY[f.key] ?? "content";
    (buckets[g] ??= []).push(f);
  }
  return (
    <>
      {GROUP_META.filter((g) => buckets[g.key] && (!only || (g.key === "content") === (only === "content"))).map((g) => {
        const groupFields = buckets[g.key]!;
        const isOpen = !collapsedGroups.has(g.key);
        const Icon = g.icon;
        return (
          <div key={g.key} className="border-b border-line/20 pb-2 last:border-b-0">
            <button
              type="button"
              onClick={() => toggleGroup(g.key)}
              className="flex w-full items-center justify-between py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-sub"
            >
              <span className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" /> {t(g.labelKey)}
              </span>
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {isOpen && (
              <div className="space-y-3 pb-1">
                {groupFields.map((f) => (
                  <label key={f.key} className="block text-[11px] font-medium text-body">
                    <span className="inline-flex items-center gap-1">
                      {FieldLabel(f.labelKey, t)}
                      {hasOverride && onToggleOverride && f.kind !== "slides" && (
                        <BpToggle active={hasOverride(f)} onToggle={() => onToggleOverride(f)} bp={bp} t={t} />
                      )}
                    </span>
                    <div className="mt-1">
                      {FieldInput({
                        field: f, value: getValue(f), onChange: (v) => setValue(f, v),
                        iconSearch, setIconSearch, uploading, siteTheme, sel, blocks, sliderSlideIdx, setSliderSlideIdx,
                        bp, t, uploadImage, bpGetValue, bpKeysOverridden, toggleBpKeys, bpKey,
                        availableMenus, ICONS,
                      })}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
