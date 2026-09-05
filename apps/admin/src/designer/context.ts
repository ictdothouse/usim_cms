// The shared bag of Designer() state/mutator functions that Inspector.tsx
// and ElPreview.tsx read from — Layer 1b of the God Component refactor (see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
//
// The design doc's own recommended shape for this layer is "each extracted
// piece takes an explicit props object bundling exactly what it needs" — for
// most of this codebase's extractions (FieldGroups, FieldInput) that meant
// one interface per component. Inspector/ElPreview each close over 45-55+
// values from Designer(), so the same approach here is ONE bundled context
// object (still an explicit, typed prop — not a custom hook moving the
// underlying useState/useRef calls out of Designer(), which is Layer 2) —
// bundling avoids a call site that has to spread 50+ individual props, and
// gives a single place to extend when a future element/field needs one more
// piece of Designer() state.
import type React from "react";
import type * as api from "@/lib/api";
import type { Key } from "@/i18n";
import type { Bp, Block, FieldGroupKey, PageSettings, Sel, SectionProps } from "./types";

export type ClipLevel = "section" | "row" | "column" | "element";

// i18n Phase 5 — sentinel key for the page's own base-language layout inside
// PageDesignerRoute's `content` map, mirroring PostEditorPage's own
// BASE_LANG. Never a real language code, so it can't collide with one.
// Single source of truth for both Designer.tsx and designer/Inspector.tsx.
export const BASE_LANG = "__base__";

export interface DesignerCtx {
  t: (k: Key) => string;
  bp: Bp;
  mode: "blocks" | "live";
  sel: Sel;
  setSel: (path: Sel) => void;
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;

  // Section lock (Page Blueprint deferred item) — a superadmin-only toggle
  // (props.locked === "true") that a non-superadmin can view but not edit.
  // isSuper gates the Inspector's own lock checkbox; isSectionLocked is the
  // read-only check every level below Section consults so nested Row/Column/
  // Element controls know to disable themselves too. The real enforcement is
  // server-side (apps/api's pagesBeforeChange) — this is UX only.
  isSuper: boolean;
  isSectionLocked: (b: number) => boolean;

  // bp-override helpers (Section/Column/Element style-override bag)
  bpKey: (key: string) => string;
  bpGetValue: (base: string | undefined, overrides: Record<string, string> | undefined, key: string) => string;
  bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[]) => Record<string, string>;
  sideValue: (props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string) => string;
  fourSideValue: (sp: SectionProps, perSideKey: string, fallbackKey: string) => string;
  setFourSideValue: (b: number, perSideKey: string, value: string) => void;
  setColSideValue: (b: number, r: number, c: number, perSideKey: string, value: string) => void;
  setElSideValue: (b: number, r: number, c: number, e: number, perSideKey: string, value: string) => void;

  // FourSideControl "linked" toggles — Inspector UI-only state
  linkedPadding: boolean;
  setLinkedPadding: (fn: (v: boolean) => boolean) => void;
  linkedRadius: boolean;
  setLinkedRadius: (fn: (v: boolean) => boolean) => void;
  linkedMargin: boolean;
  setLinkedMargin: (fn: (v: boolean) => boolean) => void;

  // Grouped Styles panel
  collapsedGroups: Set<FieldGroupKey>;
  toggleGroup: (g: FieldGroupKey) => void;
  inspectorTab: "content" | "style";
  setInspectorTab: (tab: "content" | "style") => void;

  // FieldGroups/FieldInput passthrough
  iconSearch: string;
  setIconSearch: (v: string) => void;
  uploading: boolean;
  siteTheme: Record<string, string> | null;
  sliderSlideIdx: Record<string, number>;
  setSliderSlideIdx: (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  // Nested selection inside the currently-previewed slide of each slider
  // element (keyed by slider El.id) — see designer/types.ts's SlideItem/Row
  // note. Separate from the global `sel` above, which never addresses
  // content inside a slide.
  sliderInnerSel: Record<string, { r: number; c: number; e: number } | null>;
  setSliderInnerSel: (
    v:
      | Record<string, { r: number; c: number; e: number } | null>
      | ((prev: Record<string, { r: number; c: number; e: number } | null>) => Record<string, { r: number; c: number; e: number } | null>),
  ) => void;
  uploadImage: (file: File, setValue: (v: string) => void) => Promise<void>;
  availableMenus: api.Menu[];
  availableCategories: api.Category[];

  // Page settings ("nothing selected" panel)
  pageSettings: PageSettings;
  setPageGap: (gap: string | undefined) => void;
  setPageContentWidth: (contentWidth: "contained" | "full" | undefined) => void;
  setPagePaddingX: (paddingX: string | undefined) => void;
  setPageThemePreset: (preset: api.ThemePreset | null) => void;
  themePresets: api.ThemePreset[];

  // Page language ("nothing selected" panel)
  siteMultilangEnabled: boolean;
  pageMultilangEnabled: boolean;
  setPageMultilangEnabled: (v: boolean) => void;
  setDirty: (v: boolean) => void;
  siteLanguages: api.SiteLanguage[];
  pageLanguage: string;
  setPageLanguage: (v: string) => void;
  activeLang: string;
  content: Record<string, unknown>;
  clickPageLanguagePill: (code: string) => void;
  translating: boolean;
  retranslatePageLanguage: (code: string) => Promise<void>;

  // Row-level actions
  setRowGap: (b: number, r: number, gap: string | undefined) => void;
  moveRow: (b: number, r: number, dir: -1 | 1) => void;
  duplicateRow: (b: number, r: number) => void;
  copyRow: (b: number, r: number) => void;
  pasteRow: (b: number, r: number) => void;
  copyStyleRow: (b: number, r: number) => void;
  pasteStyleRow: (b: number, r: number) => void;
  deleteRow: (b: number, r: number) => void;
  clipHas: (level: ClipLevel) => boolean;
  styleHas: (level: ClipLevel) => boolean;

  // Column-level actions
  nudgeColumn: (b: number, r: number, c: number, dir: -1 | 1) => void;
  copyColumn: (b: number, r: number, c: number) => void;
  pasteColumn: (b: number, r: number, c: number) => void;
  copyStyleColumn: (b: number, r: number, c: number) => void;
  pasteStyleColumn: (b: number, r: number, c: number) => void;
  deleteColumn: (b: number, r: number, c: number) => void;
  saveAsTemplate: (path: Sel) => void;

  // Element-level actions
  moveElement: (b: number, r: number, c: number, e: number, dir: -1 | 1) => void;
  copyElement: (b: number, r: number, c: number, e: number) => void;
  pasteElement: (b: number, r: number, c: number, e: number) => void;
  copyStyleElement: (b: number, r: number, c: number, e: number) => void;
  pasteStyleElement: (b: number, r: number, c: number, e: number) => void;
  duplicateElement: (b: number, r: number, c: number, e: number) => void;
  deleteElement: (b: number, r: number, c: number, e: number) => void;

  // ElPreview-only: canvas-direct text editing (heading/text inline edit)
  editingText: React.MutableRefObject<Record<string, string>>;
}
