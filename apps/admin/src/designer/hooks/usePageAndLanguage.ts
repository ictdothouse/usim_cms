// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — page settings + i18n
// Phase 5 (per-language content/style overrides). Also computes `blocks`
// (the per-language VIEW of rawBlocks) internally: its only two dependents
// beyond rawBlocks (activeLang, langOverrides) are both owned right here,
// so unlike the Aug-29 doc's assumption this doesn't need to be a separate
// Designer()-level cross-hook composition — it fits entirely inside this
// hook once activeLang/langOverrides exist.
import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { BASE_LANG } from "../context";
import { TRANSLATABLE_TEXT_KEYS, isTextKey, pathKey, applyLangOverrides, migrateOldTranslation } from "../lang";
import type { Block, ElType, PageSettings, SectionProps } from "../types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface PageAndLanguageDeps {
  rawBlocks: Block[];
  page: {
    id?: unknown;
    layout?: unknown;
    language?: unknown;
    multilangEnabled?: unknown;
    settings?: unknown;
    translations?: unknown;
  };
  tenantHost: string;
  token: string;
  bp: "desktop" | "tablet" | "mobile";
  bpKey: (key: string) => string;
  setDirty: (v: boolean) => void;
  setSel: (s: number[] | null) => void;
}

export function usePageAndLanguage(deps: PageAndLanguageDeps) {
  const { rawBlocks, page, tenantHost, token, bp, bpKey, setDirty, setSel } = deps;

  const [pageSettings, setPageSettings] = useState<PageSettings>(() => (page.settings as PageSettings) ?? {});
  // "Theme" picker in Page Settings — this user's saved presets, same list
  // ThemeForm's own collection reads (api.listThemePresets).
  const [themePresets, setThemePresets] = useState<api.ThemePreset[]>([]);
  useEffect(() => {
    api.listThemePresets(token).then(setThemePresets).catch(() => {});
  }, [token]);

  // i18n Phase 4 — same page-level, not-part-of-the-undo-stack treatment as
  // pageSettings above; persisted via save()'s `language` field.
  const [pageLanguage, setPageLanguage] = useState<string>((page.language as string | null) ?? "");
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  // i18n Phase 5 — site-wide master switch, plus this page's own opt-in;
  // the Translations block is only offered when both are true.
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);
  const [pageMultilangEnabled, setPageMultilangEnabled] = useState<boolean>(Boolean(page.multilangEnabled));
  // Per-language override bag — `langOverrides[code][pathKey][fieldKey]`.
  // TEXT fields (isTextKey) are always stored per-language here, auto-seeded
  // by machine translation the first time a language is opened (see
  // seedMissingTextOverrides). STYLE fields only ever land here when the
  // author explicitly turns on "different for this language" for that field
  // (Inspector's LangToggle) — otherwise a style edit always writes straight
  // into the shared rawBlocks tree (setFourSideValue/setColSideValue/
  // setElSideValue, Designer()'s own composition functions), regardless of
  // which language pill happens to be active. This REPLACES the old
  // `content: Record<string, Block[]>` full-tree-per-language fork, which is
  // exactly what caused the reported bug — style forked whole-tree the
  // first time a language was opened and then diverged from the base
  // forever (see migrateOldTranslation for how an existing page's old-shape
  // data is folded into this new shape).
  const [langOverrides, setLangOverrides] = useState<Record<string, Record<string, Record<string, string>>>>(() => {
    const base = clone((page.layout as Block[] | undefined) ?? []);
    const raw =
      (page.translations as Record<string, { layout?: Block[]; overrides?: Record<string, Record<string, string>> }> | null) ?? {};
    const out: Record<string, Record<string, Record<string, string>>> = {};
    for (const [code, v] of Object.entries(raw)) {
      if (!v) continue;
      if (v.overrides) out[code] = v.overrides;
      else if (v.layout) out[code] = migrateOldTranslation(base, v.layout);
    }
    return out;
  });
  const [activeLang, setActiveLang] = useState(BASE_LANG);
  const [translating, setTranslating] = useState(false);

  // The canvas/Inspector's actual driving view: the shared base tree
  // (rawBlocks) as-is while editing the default language, or that same tree
  // with the active language's own overrides layered on top otherwise.
  // Every read in Designer.tsx (canvas render, Inspector's current-value
  // display, ElPreview) goes through this — only mutate/startSpacingDrag/
  // undo/redo/save() ever touch rawBlocks directly.
  const blocks = useMemo(
    () => (activeLang === BASE_LANG ? rawBlocks : applyLangOverrides(rawBlocks, langOverrides[activeLang] ?? {})),
    [rawBlocks, activeLang, langOverrides],
  );

  useEffect(() => {
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
      // Only for a page that has never had its own language explicitly
      // chosen — same "never override an explicit pick" rule as posts'.
      if (!(page.language as string | null) && d.defaultLanguage) {
        setPageLanguage(d.defaultLanguage);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, token, page.id]);

  // Real auto-translate: walks the CURRENTLY-DISPLAYED tree (`blocks`, i.e.
  // whatever's on screen right now — "translate from what you're looking
  // at") translating only TRANSLATABLE_TEXT_KEYS' plain-prose fields that
  // `target` doesn't already have an override for, one /api/translate call
  // at a time (sequential await, never Promise.all — see CLAUDE.md's
  // deadlock note). A field that fails to translate is simply skipped —
  // falls back to the shared base value — rather than blocking the switch.
  async function seedMissingTextOverrides(target: string, source: string | undefined) {
    const additions: Record<string, Record<string, string>> = {};
    const existing = langOverrides[target] ?? {};
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      if (block.type !== "section") continue;
      const sp = block.props as unknown as SectionProps;
      for (let r = 0; r < (sp.rows ?? []).length; r++) {
        const row = sp.rows[r];
        for (let c = 0; c < (row.columns ?? []).length; c++) {
          const col = row.columns[c];
          for (let e = 0; e < (col.elements ?? []).length; e++) {
            const el = col.elements[e];
            const keys = TRANSLATABLE_TEXT_KEYS[el.type as ElType];
            if (!keys) continue;
            const path = pathKey(b, r, c, e);
            for (const key of keys) {
              if (existing[path]?.[key] !== undefined) continue;
              const val = el.props[key];
              if (typeof val === "string" && val.trim()) {
                try {
                  const translated = await api.translateText(tenantHost, token, val, target, { source });
                  (additions[path] ??= {})[key] = translated;
                } catch {
                  // keep untranslated (falls back to the shared base value) — don't block the switch
                }
              }
            }
          }
        }
      }
    }
    if (Object.keys(additions).length === 0) return;
    setLangOverrides((prev) => {
      const next = { ...prev, [target]: { ...(prev[target] ?? {}) } };
      for (const [path, kv] of Object.entries(additions)) {
        next[target][path] = { ...(next[target][path] ?? {}), ...kv };
      }
      return next;
    });
  }

  // Same "Language field doubles as the translation switcher, always the
  // SAME row" behavior as PostEditorPage's switchLanguage/clickLanguagePill.
  // Undo history no longer needs resetting on switch: rawBlocks (what undo/
  // redo actually operate on) never changes just from switching which
  // language pill is active.
  async function switchPageLanguage(target: string) {
    if (target === activeLang) return;
    if (target !== BASE_LANG) {
      const sourceCode = activeLang === BASE_LANG ? (pageLanguage || undefined) : activeLang;
      setTranslating(true);
      try {
        await seedMissingTextOverrides(target, sourceCode);
      } finally {
        setTranslating(false);
      }
    }
    setSel(null);
    setActiveLang(target);
  }
  function clickPageLanguagePill(code: string) {
    if (!pageLanguage) {
      setPageLanguage(code);
      setDirty(true);
      return;
    }
    void switchPageLanguage(code === pageLanguage ? BASE_LANG : code);
  }
  // Which language slots currently have ANY content of their own — drives
  // the "+"/pill-fill state in the Page Settings panel.
  function hasLangSlot(code: string): boolean {
    return code === BASE_LANG || Boolean(langOverrides[code] && Object.keys(langOverrides[code]).length);
  }
  function elTypeAtPath(path: string): string | undefined {
    const [b, r, c, e] = path.split(".").map(Number);
    if (e === undefined) return undefined;
    const sp = rawBlocks[b]?.props as unknown as SectionProps | undefined;
    return sp?.rows?.[r]?.columns?.[c]?.elements?.[e]?.type;
  }
  // Force-regenerate a language's TEXT — switchPageLanguage only fills in a
  // still-missing value, so a page whose translations were saved before
  // this real-translate fix existed (verbatim stub copies from the old
  // behavior) would otherwise stay stale forever, since opening that pill
  // just shows the existing (untranslated) content. Clears that language's
  // existing TEXT overrides first (any of its own per-language STYLE
  // overrides are left completely untouched — retranslating text was never
  // meant to also discard a deliberate style choice), then re-seeds from
  // the current base.
  async function retranslatePageLanguage(code: string) {
    setTranslating(true);
    try {
      const prevBag = langOverrides[code] ?? {};
      const styleOnly: Record<string, Record<string, string>> = {};
      for (const [path, kv] of Object.entries(prevBag)) {
        const elType = elTypeAtPath(path);
        const kept: Record<string, string> = {};
        for (const [key, value] of Object.entries(kv)) {
          const bare = key.startsWith("tablet:") || key.startsWith("mobile:") ? key.slice(key.indexOf(":") + 1) : key;
          if (!isTextKey(elType, bare)) kept[key] = value;
        }
        if (Object.keys(kept).length) styleOnly[path] = kept;
      }
      // Always translate FROM the shared base (rawBlocks), not whatever
      // language happens to be on screen right now — same "retranslate
      // always re-derives from the source of truth" rule the old
      // full-tree-fork version of this function already followed.
      const textAdditions: Record<string, Record<string, string>> = {};
      for (let b = 0; b < rawBlocks.length; b++) {
        const block = rawBlocks[b];
        if (block.type !== "section") continue;
        const sp = block.props as unknown as SectionProps;
        for (let r = 0; r < (sp.rows ?? []).length; r++) {
          const row = sp.rows[r];
          for (let c = 0; c < (row.columns ?? []).length; c++) {
            const col = row.columns[c];
            for (let e = 0; e < (col.elements ?? []).length; e++) {
              const el = col.elements[e];
              const keys = TRANSLATABLE_TEXT_KEYS[el.type as ElType];
              if (!keys) continue;
              const path = pathKey(b, r, c, e);
              for (const key of keys) {
                const val = el.props[key];
                if (typeof val === "string" && val.trim()) {
                  try {
                    const translated = await api.translateText(tenantHost, token, val, code, { source: pageLanguage || undefined });
                    (textAdditions[path] ??= {})[key] = translated;
                  } catch {
                    // keep this one key untranslated — don't block the rest
                  }
                }
              }
            }
          }
        }
      }
      const merged: Record<string, Record<string, string>> = { ...styleOnly };
      for (const [path, kv] of Object.entries(textAdditions)) {
        merged[path] = { ...(merged[path] ?? {}), ...kv };
      }
      setLangOverrides((prev) => ({ ...prev, [code]: merged }));
      setDirty(true);
    } finally {
      setTranslating(false);
    }
  }

  // Per-language STYLE override — "different for this language" (Inspector's
  // LangToggle), and, nested inside that, "also stack by breakpoint" (the
  // existing BpToggle, reused). langKeysOverridden/toggleLangKeys are the
  // outer opt-in: OFF means the field stays on the shared base value (edits
  // made under a non-base language pill still land on rawBlocks via the
  // plain mutate() path, exactly as if the base pill were active) — this is
  // the actual bug fix, style is shared by default. langStackKeysOverridden/
  // toggleLangStackKeys are the inner opt-in, only meaningful once the outer
  // one is on and only while previewing a non-desktop breakpoint: it
  // further splits that language's own override per-breakpoint, the same
  // "tablet:"/"mobile:"-prefixed-key convention the ordinary bp bag uses.
  function langKeysOverridden(path: string, keys: string[]): boolean {
    if (activeLang === BASE_LANG) return false;
    const bag = langOverrides[activeLang]?.[path];
    return !!bag && keys.some((k) => bag[k] !== undefined);
  }
  function toggleLangKeys(path: string, keys: string[]) {
    const has = langKeysOverridden(path, keys);
    setLangOverrides((prev) => {
      const next = { ...prev, [activeLang]: { ...(prev[activeLang] ?? {}) } };
      const bag = { ...(next[activeLang][path] ?? {}) };
      for (const k of keys) {
        if (has) {
          delete bag[k];
          delete bag[`tablet:${k}`];
          delete bag[`mobile:${k}`];
        } else {
          bag[k] = "";
        }
      }
      if (Object.keys(bag).length) next[activeLang][path] = bag;
      else delete next[activeLang][path];
      return next;
    });
    setDirty(true);
  }
  function langStackKeysOverridden(path: string, keys: string[]): boolean {
    if (activeLang === BASE_LANG || bp === "desktop") return false;
    const bag = langOverrides[activeLang]?.[path];
    return !!bag && keys.some((k) => bag[bpKey(k)] !== undefined);
  }
  function toggleLangStackKeys(path: string, keys: string[]) {
    if (bp === "desktop") return;
    const has = langStackKeysOverridden(path, keys);
    setLangOverrides((prev) => {
      const next = { ...prev, [activeLang]: { ...(prev[activeLang] ?? {}) } };
      const bag = { ...(next[activeLang][path] ?? {}) };
      for (const k of keys) {
        if (has) delete bag[bpKey(k)];
        else bag[bpKey(k)] = "";
      }
      next[activeLang][path] = bag;
      return next;
    });
    setDirty(true);
  }
  // Single-field write once a language style override is ON for that field
  // (see langKeysOverridden) — writes into the CURRENT breakpoint tier's
  // slot within that language's own bag: flat (desktop-tier-and-beyond)
  // unless the nested "stack by breakpoint" opt-in is also on for this key,
  // in which case it lands in that tier's own "tablet:"/"mobile:" sub-key
  // instead.
  function setLangValue(path: string, key: string, value: string) {
    const stacked = bp !== "desktop" && langStackKeysOverridden(path, [key]);
    const finalKey = stacked ? bpKey(key) : key;
    setLangOverrides((prev) => {
      const next = { ...prev, [activeLang]: { ...(prev[activeLang] ?? {}) } };
      next[activeLang][path] = { ...(next[activeLang][path] ?? {}), [finalKey]: value };
      return next;
    });
    setDirty(true);
  }

  function setPageGap(gap: string | undefined) {
    setPageSettings((s) => ({ ...s, gap }));
    setDirty(true);
  }
  function setPageContentWidth(contentWidth: "contained" | "full" | undefined) {
    setPageSettings((s) => ({ ...s, contentWidth }));
    setDirty(true);
  }
  function setPagePaddingX(paddingX: string | undefined) {
    setPageSettings((s) => ({ ...s, paddingX }));
    setDirty(true);
  }
  // Selecting a preset copies its settings in as a one-time snapshot (same
  // convention as every other "apply once, edit independently after" copy
  // in this codebase) — editing the preset later never retroactively
  // changes this page.
  function setPageThemePreset(preset: api.ThemePreset | null) {
    setPageSettings((s) => (preset ? { ...s, theme: preset.settings, themePresetName: preset.name } : { ...s, theme: undefined, themePresetName: undefined }));
    setDirty(true);
  }

  return {
    blocks,
    pageSettings, setPageSettings, setPageGap, setPageContentWidth, setPagePaddingX, setPageThemePreset, themePresets,
    siteMultilangEnabled, pageMultilangEnabled, setPageMultilangEnabled,
    siteLanguages, pageLanguage, setPageLanguage,
    activeLang, hasLangSlot, clickPageLanguagePill, translating, retranslatePageLanguage,
    langOverrides, isTextKey, pathKey, langKeysOverridden, toggleLangKeys, langStackKeysOverridden, toggleLangStackKeys, setLangValue,
  };
}
