// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — the highest-risk extraction
// per that spec: the most stateful hook, with the most subtle preserved
// behaviors (the transient cross-origin postMessage guard, the
// lastNonTextSig dedup guard, the debounced-reload effect), and its message
// handler reaches into useBlockOps' territory (removeAt/insertAt/
// moveColumn/moveSection — all plain pure imports from ../../designerTree,
// not owned by any hook) and useUndoRedo's (undo/redo).
//
// Deps grouped into one object rather than ~15 positional params — this
// hook genuinely needs pieces of blocks/mutate/sel/undo-redo/section-lock/
// i18n/save/slider-canvas-state, and positional params that numerous risk
// two same-typed args getting silently swapped.
import { useEffect, useRef, useState } from "react";
import type React from "react";
import * as api from "@/lib/api";
import { toast } from "sonner";
import type { Key } from "@/i18n";
import { moveSection, moveColumn, removeAt, insertAt } from "../../designerTree";
import { section } from "../blockPath";
import { PAD, RADIUS, BORDER, colStyle, shadowToCss, lengthValue, typoStyle } from "../style";
import type { Block, Sel, SectionProps } from "../types";

export interface LiveEditBridgeDeps {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  setSel: (s: Sel) => void;
  undo: () => void;
  redo: () => void;
  // Owned by Designer() itself, not this hook — useUndoRedo also needs
  // bumpStructural (undo/redo call it) and is called BEFORE this hook, so
  // this can't own it without a circular dependency between the two hooks.
  structuralTick: number;
  bumpStructural: () => void;
  isSectionLocked: (b: number) => boolean;
  t: (k: Key) => string;
  tenantHost: string;
  token: string;
  pageId: string;
  pageSlug: string;
  kind: "page" | "blueprint" | "siteChrome" | "symbol";
  dirty: boolean;
  save: () => Promise<unknown>;
  saveBlueprint: () => Promise<unknown>;
  setError: (msg: string | null) => void;
  // Skeleton-overlay flag shown during any iframe (re)load — Designer()'s
  // own residual UI state (see reloading's own comment there), set here.
  setReloading: (v: boolean) => void;
  setCtxMenu: (v: { path: number[]; x: number; y: number } | null) => void;
  setSliderSlideIdx: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setSliderInnerSel: React.Dispatch<React.SetStateAction<Record<string, { r: number; c: number; e: number } | null>>>;
}

export interface LiveEditBridgeApi {
  mode: "blocks" | "live";
  liveSrc: string | null;
  frameARef: React.RefObject<HTMLIFrameElement>;
  frameBRef: React.RefObject<HTMLIFrameElement>;
  liveFrame: React.RefObject<HTMLIFrameElement>;
  selectedRect: { top: number; left: number; width: number; height: number } | null;
  enterLive: (cold?: boolean) => Promise<void>;
  toggleLive: () => void;
  handleFrameLoad: (slot: "a" | "b") => void;
}

export function useLiveEditBridge(deps: LiveEditBridgeDeps): LiveEditBridgeApi {
  const {
    blocks, mutate, sel, setSel, undo, redo, isSectionLocked, t,
    tenantHost, token, pageId, pageSlug, kind, dirty, save, saveBlueprint,
    setError, setReloading, setCtxMenu, setSliderSlideIdx, setSliderInnerSel,
    structuralTick, bumpStructural,
  } = deps;

  const [mode, setMode] = useState<"blocks" | "live">("blocks");
  // Double-buffered iframe pair: the inactive slot loads a reload's new
  // content off-screen (opacity 0, pointer-events none) and only swaps to
  // visible once its onLoad fires, so the visible iframe is never mid-
  // navigation — that's the actual source of any reload "blink", not skeleton
  // speed. swapPending names which slot a hot-swap (not a cold mount) is
  // waiting on; handleFrameLoad() below is the single place that resolves it.
  const [liveSrcA, setLiveSrcA] = useState<string | null>(null);
  const [liveSrcB, setLiveSrcB] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const swapPending = useRef<"a" | "b" | null>(null);
  const liveSrc = activeSlot === "a" ? liveSrcA : liveSrcB;
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const liveFrame = activeSlot === "a" ? frameARef : frameBRef;

  // Reported by BaseLayout.astro's designer:selectedRect message — the
  // selected node's on-screen box inside the iframe, used to position
  // LiveEditToolbar. Cleared whenever `sel` itself changes so a stale rect
  // never positions the toolbar over the wrong element while the new one's
  // first report is in flight.
  const [selectedRect, setSelectedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    setSelectedRect(null);
  }, [sel]);

  const lastScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  const lastNonTextSig = useRef<string | null>(null);

  // cold=true means the live iframes were just unmounted (switching in from
  // Blocks mode) or this is the very first load — nothing is on screen to
  // keep showing, so skeleton + a fresh mount into slot "a" is correct.
  // cold=false (the debounced structural/style reload path, mode already
  // "live") loads into the *inactive* slot and hands off the actual swap to
  // handleFrameLoad, so the visible iframe never sees its own navigation.
  //
  // Always mints a preview token, even for an already-published page: a
  // published page's public GET already includes the content, but
  // [...slug].astro only turns designerEdit on when a token is present —
  // skipping the mint for "published" used to leave the bridge script/
  // data-designer-path attributes never activated, so clicks in Live Edit
  // silently did nothing.
  async function enterLive(cold = false) {
    if (dirty) await (kind === "blueprint" ? saveBlueprint() : save());
    const previewToken =
      kind === "blueprint"
        ? await api.getBlueprintPreviewToken(tenantHost, token, pageId)
        : await api.getPagePreviewToken(tenantHost, token, pageId);
    const base =
      kind === "blueprint"
        ? api.blueprintPreviewUrl(tenantHost, pageId, previewToken)
        : api.previewUrl(tenantHost, pageSlug, previewToken);
    const src = `${base}${base.includes("?") ? "&" : "?"}designerEdit=1`;
    if (cold || (liveSrcA === null && liveSrcB === null)) {
      setReloading(true);
      swapPending.current = null;
      setActiveSlot("a");
      setLiveSrcA(src);
      setLiveSrcB(null);
      setMode("live");
      return;
    }
    const targetSlot = activeSlot === "a" ? "b" : "a";
    swapPending.current = targetSlot;
    if (targetSlot === "a") setLiveSrcA(src);
    else setLiveSrcB(src);
    setMode("live");
  }

  // Debounced reload for structural Live Edit changes — waits for a pause in
  // activity so a fast burst (e.g. several deletes in a row) reloads once.
  // enterLive() already saves when dirty and mints a fresh preview token,
  // which is what actually forces the iframe to reload; the scroll position
  // is restored once the reloaded iframe reports back in (handleFrameLoad).
  useEffect(() => {
    if (structuralTick === 0 || mode !== "live") return;
    const timer = setTimeout(() => {
      pendingScrollRestore.current = lastScrollY.current;
      void enterLive().catch((err) => setError((err as Error).message));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralTick]);

  // Resolves both reload paths' onLoad: a pending hot-swap for this exact
  // slot flips it to active (the actual, blink-free "reveal"); a cold mount
  // just clears the skeleton once its own slot (already active) has painted.
  function handleFrameLoad(slot: "a" | "b") {
    if (swapPending.current === slot) {
      swapPending.current = null;
      setActiveSlot(slot);
      setReloading(false);
      const frame = (slot === "a" ? frameARef : frameBRef).current;
      const src = slot === "a" ? liveSrcA : liveSrcB;
      if (pendingScrollRestore.current != null && frame?.contentWindow && src) {
        const targetOrigin = new URL(src, window.location.href).origin;
        frame.contentWindow.postMessage({ type: "designer:restoreScroll", y: pendingScrollRestore.current }, targetOrigin);
        pendingScrollRestore.current = null;
      }
      return;
    }
    if (slot === activeSlot) setReloading(false);
  }

  function toggleLive() {
    setMode(mode === "live" ? "blocks" : "live");
  }

  // Live-view bridge: the iframe's window posts these (see BaseLayout.astro's
  // inline script) — a click there selects exactly like a click in the block
  // canvas (same `sel`, same Inspector), and typing in an editable text node
  // there commits through the same mutate() path the Inspector textarea uses.
  // No dependency array on purpose — re-subscribes every render so the
  // closure always sees the current sel/blocks/liveSrc rather than listing
  // ~10 dependencies here.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (!liveSrc || e.origin !== new URL(liveSrc, window.location.href).origin) return;
      if (e.data?.type === "designer:selectedRect") {
        setSelectedRect(e.data.rect ?? null);
        return;
      }
      if (e.data?.type === "designer:iframeClick") {
        setCtxMenu(null);
        return;
      }
      if (e.data?.type === "designer:scroll") {
        lastScrollY.current = Number(e.data.y ?? 0);
        return;
      }
      if (e.data?.type === "designer:undo") {
        undo();
        return;
      }
      if (e.data?.type === "designer:redo") {
        redo();
        return;
      }
      if (e.data?.type === "designer:contextmenu") {
        const p = String(e.data.path ?? "")
          .split(".")
          .map(Number);
        // Row has no data-designer-path of its own in SectionBlock.astro (only
        // section/column/element do), so a live-mode right-click can only ever
        // resolve to one of those 3 depths — 2 (row) is unreachable here, Row
        // right-click only works in Blocks mode.
        if (![1, 3, 4].includes(p.length) || !liveFrame.current) return;
        const rect = liveFrame.current.getBoundingClientRect();
        setSel(p);
        setCtxMenu({ path: p, x: rect.left + Number(e.data.x ?? 0), y: rect.top + Number(e.data.y ?? 0) });
        return;
      }
      if (e.data?.type === "designer:selectSlideEl") {
        // Mirrors what a click inside apps/admin's own Blocks-mode slider
        // canvas already does (ElPreview.tsx's slider case) — select the
        // slider element itself so the Inspector switches into its context,
        // then point sliderInnerSel/sliderSlideIdx at the exact slide/row/
        // column/element the click landed on so Inspector shows THAT
        // nested element's own fields, not the slider's.
        const sliderPath = String(e.data.path ?? "")
          .split(".")
          .map(Number);
        const slideSel = String(e.data.slideSel ?? "")
          .split(".")
          .map(Number);
        if (sliderPath.length !== 4 || slideSel.length !== 4) return;
        const [b, r, c, elIdx] = sliderPath;
        const [slideIdx, sr, sc, se] = slideSel;
        const sliderEl = (blocks[b]?.props as unknown as SectionProps | undefined)?.rows?.[r]?.columns?.[c]?.elements?.[elIdx];
        if (!sliderEl || sliderEl.type !== "slider") return;
        setSel(sliderPath);
        setSliderSlideIdx((m) => ({ ...m, [sliderEl.id]: slideIdx }));
        setSliderInnerSel((m) => ({ ...m, [sliderEl.id]: { r: sr, c: sc, e: se } }));
        return;
      }
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
        const [b, r, c, el] = path;
        mutate((bs) => {
          section(bs, b).rows[r].columns[c].elements[el].props.text = e.data.value ?? "";
        });
      } else if (e.data?.type === "designer:reorder") {
        const from = String(e.data.from).split(".").map(Number);
        const to = String(e.data.to).split(".").map(Number);
        // Path depth is the drag's kind (1=section, 3=column, 4=element) — a
        // drag can only ever hover a same-depth target (BaseLayout.astro's
        // pointermove only sets hoverPath when the target's depth matches
        // dragState's), so a mismatch here means a stale/cross-kind message
        // and must be a no-op, never a guess at which branch to take.
        if (from.length !== to.length) return;
        if (from.length === 4) {
          if (isSectionLocked(from[0]) || isSectionLocked(to[0])) {
            toast.error(t("designer-section-locked-toast"));
            return;
          }
          mutate((bs) => {
            const [tb, tr, tc, te] = to;
            let idx = te + (e.data.position === "after" ? 1 : 0);
            // same-column move: removing the source first shifts later indexes
            // down — same adjustment dropIntoColumn already makes for the
            // block-canvas drag.
            if (from[0] === tb && from[1] === tr && from[2] === tc && from[3] < idx) idx--;
            const el = removeAt(bs, from);
            insertAt(bs, [tb, tr, tc], el, idx);
          });
        } else if (from.length === 3) {
          // Column reorder is scoped to within its own row — a row's
          // grid-template-columns and each column's span are only meaningful
          // there, same restriction the Layers tree's drag-reorder applies.
          if (from[0] !== to[0] || from[1] !== to[1]) return;
          if (isSectionLocked(from[0])) {
            toast.error(t("designer-section-locked-toast"));
            return;
          }
          let idx = to[2] + (e.data.position === "after" ? 1 : 0);
          if (from[2] < idx) idx--;
          mutate((bs) => moveColumn(bs, from[0], from[1], from[2], idx));
        } else if (from.length === 1) {
          let idx = to[0] + (e.data.position === "after" ? 1 : 0);
          if (from[0] < idx) idx--;
          mutate((bs) => moveSection(bs, from[0], idx));
        } else {
          return;
        }
        setSel(null);
        bumpStructural();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  // Keeps the live iframe's selection highlight/editability/inline style in
  // sync with the Inspector — reuses the exact same style helpers the block
  // canvas preview uses (typoStyle/colStyle/lengthValue), so style logic
  // isn't computed a third time.
  useEffect(() => {
    if (mode !== "live" || !liveSrc || !liveFrame.current?.contentWindow) return;
    const win = liveFrame.current.contentWindow;
    const targetOrigin = new URL(liveSrc, window.location.href).origin;
    // Right after a reload/slot-swap sets a new src, this iframe's
    // contentWindow briefly still belongs to the admin's own origin (the
    // navigation to targetOrigin hasn't completed yet) — postMessage throws
    // synchronously on that transient mismatch instead of silently no-op'ing.
    // Harmless to skip: the next render (once navigation completes, or once
    // sel/blocks changes again) re-sends the same sync.
    const post = (msg: unknown) => {
      try {
        win.postMessage(msg, targetOrigin);
      } catch {
        /* transient cross-origin mismatch during reload — see comment above */
      }
    };
    post({ type: "designer:selected", path: sel?.join(".") ?? null });
    if (!sel) return;
    const path = sel.join(".");
    if (sel.length === 4) {
      const [b, r, c, e] = sel;
      const el = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c]?.elements?.[e];
      if (!el) return;
      const textLike = el.type === "heading" || el.type === "text" || el.type === "list";
      if (!textLike) {
        // Non-text element types (button/image/icon/spacer/...) each render
        // bespoke CSS in ElPreview/SectionBlock.astro — there's no single
        // props-to-CSS mapping to reuse here, so a style change (paste
        // style, or an Inspector field edit) falls back to the same
        // debounced reload structural edits use instead of silently posting
        // no visible change. Guarded by a signature so the reload this
        // itself triggers (liveSrc changing re-runs this effect against the
        // same still-selected element) doesn't bump again and loop forever.
        const sig = `${path}:${JSON.stringify(el.props)}`;
        if (lastNonTextSig.current !== sig) {
          lastNonTextSig.current = sig;
          bumpStructural();
        }
        return;
      }
      const style = typoStyle(el.props);
      post({ type: "designer:style", path, style });
      post({ type: "designer:text", path, editable: el.type === "heading" || el.type === "text" });
    } else if (sel.length === 3) {
      const [b, r, c] = sel;
      const col = (blocks[b]?.props as unknown as SectionProps)?.rows?.[r]?.columns?.[c];
      if (!col) return;
      post({ type: "designer:style", path, style: colStyle(col.props) });
    } else if (sel.length === 1) {
      const sp = blocks[sel[0]]?.props as unknown as SectionProps;
      if (!sp) return;
      const style: React.CSSProperties = {
        background: sp.bgImage ? undefined : sp.bg || undefined,
        color: sp.textColor || undefined,
        padding: `${lengthValue(sp.paddingY, PAD, PAD.md)} ${lengthValue(sp.paddingX, PAD, "1.5rem")}`,
        margin: `${lengthValue(sp.marginY, PAD, "0")} 0`,
        ...(sp.border ? { border: BORDER[sp.border] } : {}),
        boxShadow: shadowToCss(sp.shadow),
        ...(sp.radius ? { borderRadius: RADIUS[sp.radius] } : {}),
      };
      post({ type: "designer:style", path, style });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sel, blocks, liveSrc]);

  return { mode, liveSrc, frameARef, frameBRef, liveFrame, selectedRect, enterLive, toggleLive, handleFrameLoad };
}
