// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — the first and safest hook to
// extract: zero dependency on blocks/mutate, just localStorage-backed
// copy/paste storage (survives reload/switching pages), namespaced per
// block level so copying a section doesn't clobber a copied element.
import { useEffect, useState } from "react";
import type { ClipLevel } from "../context";
import type { ElType } from "../types";
import { CONTENT_KEYS } from "../elements";

const CLIP_KEYS: Record<ClipLevel, string> = {
  section: "designer:clip:section",
  row: "designer:clip:row",
  column: "designer:clip:column",
  element: "designer:clip:element",
};
const CLIPSTYLE_KEYS: Record<ClipLevel, string> = {
  section: "designer:clipstyle:section",
  row: "designer:clipstyle:row",
  column: "designer:clipstyle:column",
  element: "designer:clipstyle:element",
};

export interface ClipboardApi {
  clipCopy: (level: ClipLevel, data: unknown) => void;
  clipRead: <T = unknown>(level: ClipLevel) => T | null;
  clipHas: (level: ClipLevel) => boolean;
  styleCopy: (level: ClipLevel, props: Record<string, string>, elType?: ElType) => void;
  styleRead: (level: ClipLevel) => Record<string, string> | null;
  styleHas: (level: ClipLevel) => boolean;
}

// Pulled out of useClipboard() itself so the read/write logic — the only
// part with real behavior worth locking down — can be unit-tested directly
// against a fake localStorage, with no React renderer involved. clipTick is
// a pure re-render trigger with no observable effect outside React, so it
// has nothing worth testing on its own.
function clipboardFns(bumpTick: () => void): ClipboardApi {
  function clipCopy(level: ClipLevel, data: unknown) {
    localStorage.setItem(CLIP_KEYS[level], JSON.stringify(data));
    bumpTick();
  }
  function clipRead<T = unknown>(level: ClipLevel): T | null {
    const raw = localStorage.getItem(CLIP_KEYS[level]);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  function clipHas(level: ClipLevel) {
    return localStorage.getItem(CLIP_KEYS[level]) !== null;
  }
  function styleCopy(level: ClipLevel, props: Record<string, string>, elType?: ElType) {
    const clean = { ...props };
    (elType ? CONTENT_KEYS[elType] : []).forEach((k) => delete clean[k]);
    localStorage.setItem(CLIPSTYLE_KEYS[level], JSON.stringify(clean));
    bumpTick();
  }
  function styleRead(level: ClipLevel): Record<string, string> | null {
    const raw = localStorage.getItem(CLIPSTYLE_KEYS[level]);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  }
  function styleHas(level: ClipLevel) {
    return localStorage.getItem(CLIPSTYLE_KEYS[level]) !== null;
  }
  return { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas };
}

export function __testOnly_clipboardFns(): ClipboardApi {
  return clipboardFns(() => {});
}

export function useClipboard(): ClipboardApi {
  // Bumped on every clipboard write, to re-render Paste button enabled-state
  // — clipHas/styleHas read localStorage directly (not React state), so
  // without this tick nothing would tell React a paste target just became
  // available.
  const [clipTick, setClipTick] = useState(0);
  const fns = clipboardFns(() => setClipTick((x) => x + 1));

  useEffect(() => {
    const onStorage = () => setClipTick((x) => x + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  void clipTick; // read so `fns` (rebuilt every render) is understood to depend on it
  return fns;
}
