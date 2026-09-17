// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — owns the breakpoint-edit
// toggle (bp) and the FourSideControl "linked" UI toggles, plus the pure
// bp-override resolution helpers built on top of `bp`.
//
// Deliberately NARROWER than the Aug-29 spec's original useBpStyle design:
// that spec also assigned setFourSideValue/setColSideValue/setElSideValue
// here, but those 3 writers turned out (checking current main, which has
// grown a per-language STYLE-override system since that spec was written)
// to need mutate (useUndoRedo) AND langKeysOverridden/setLangValue
// (usePageAndLanguage) as well as bp — a genuine 3-hook cross-cut, not a bp
// concern alone. They stay in Designer() itself as composition-level
// functions, same as the `blocks` per-language view derivation.
import { useState } from "react";
import type React from "react";

export type Bp = "desktop" | "tablet" | "mobile";

// Pulled out of useBpStyle() so the resolution logic is unit-testable
// against a plain `bp` value, no React renderer needed.
function bpStyleFns(bp: Bp) {
  function bpKey(key: string) {
    return `${bp}:${key}`;
  }
  // Whether ANY of `keys` has an override at the CURRENT bp — a
  // FourSideControl covers several side keys (paddingTop/Right/Bottom/Left)
  // at once, so its own toggle icon represents the group, not one key.
  function bpKeysOverridden(bag: Record<string, string> | undefined, keys: string[]): boolean {
    return !!bag && keys.some((k) => bag[bpKey(k)] !== undefined);
  }
  // Enabling an override seeds it at "" (falls through lengthValue's own
  // default-preset resolution until the author actually types a value)
  // rather than copying the resolved desktop value — simpler, and "no
  // override yet but the icon is now active" is itself a real, distinct
  // state worth showing. Disabling removes every one of `keys`' entries.
  function toggleBpKeys(bag: Record<string, string> | undefined, keys: string[]): Record<string, string> {
    const has = bpKeysOverridden(bag, keys);
    const next = { ...(bag ?? {}) };
    for (const k of keys) {
      if (has) delete next[bpKey(k)];
      else next[bpKey(k)] = "";
    }
    return next;
  }
  function bpGetValue(base: string | undefined, overrides: Record<string, string> | undefined, key: string): string {
    if (bp !== "desktop") {
      const ov = overrides?.[bpKey(key)];
      if (ov !== undefined) return ov;
    }
    return base ?? "";
  }
  // Resolves one side/corner of a four-side control: its own override (bp-
  // aware) if set, else the shared axis/preset field's value (also bp-aware).
  function sideValue(props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string): string {
    const raw = bpGetValue(props?.[perSideKey], bpBag, perSideKey);
    return raw || bpGetValue(props?.[fallbackKey], bpBag, fallbackKey);
  }
  return { bpKey, bpKeysOverridden, toggleBpKeys, bpGetValue, sideValue };
}

export function __testOnly_bpStyleFns(bp: Bp) {
  return bpStyleFns(bp);
}

export interface BpStyleApi {
  bp: Bp;
  setBp: (b: Bp) => void;
  bpKey: (key: string) => string;
  bpGetValue: (base: string | undefined, overrides: Record<string, string> | undefined, key: string) => string;
  bpKeysOverridden: (bag: Record<string, string> | undefined, keys: string[]) => boolean;
  toggleBpKeys: (bag: Record<string, string> | undefined, keys: string[]) => Record<string, string>;
  sideValue: (props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string) => string;
  // fourSideValue needs SectionProps (designer/types.ts) — kept as a 2-line
  // composition in Designer() instead, built directly on this hook's own
  // sideValue, so this file has no reason to import designer/types.ts.
  linkedPadding: boolean;
  setLinkedPadding: React.Dispatch<React.SetStateAction<boolean>>;
  linkedRadius: boolean;
  setLinkedRadius: React.Dispatch<React.SetStateAction<boolean>>;
  linkedMargin: boolean;
  setLinkedMargin: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useBpStyle(): BpStyleApi {
  // FourSideControl "linked" toggles — Inspector UI-only state, one shared
  // input fans its value out to all 4 sides when true, independent per-side
  // when false. Not persisted — doesn't change what's already stored, only
  // which input(s) are shown.
  const [linkedPadding, setLinkedPadding] = useState(true);
  const [linkedRadius, setLinkedRadius] = useState(true);
  const [linkedMargin, setLinkedMargin] = useState(true);
  // Breakpoint edit mode — admin-preview only (Framer-style Desktop/Tablet/
  // Mobile toggle). Narrows the canvas width and routes Inspector field
  // edits into each node's `bp` override bag instead of its base props.
  // apps/frontend never reads `bp` — the real site is unaffected, this is
  // purely how the page looks/edits inside this Designer session.
  const [bp, setBp] = useState<Bp>("desktop");

  const { bpKey, bpKeysOverridden, toggleBpKeys, bpGetValue, sideValue } = bpStyleFns(bp);

  return {
    bp,
    setBp,
    bpKey,
    bpGetValue,
    bpKeysOverridden,
    toggleBpKeys,
    sideValue,
    linkedPadding,
    setLinkedPadding,
    linkedRadius,
    setLinkedRadius,
    linkedMargin,
    setLinkedMargin,
  };
}
