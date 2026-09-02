import { useEffect, useRef, useState } from "react";
import type React from "react";
import * as api from "../../lib/api";
import { typoStyle, colStyle, lengthValue, shadowToCss, PAD, BORDER, RADIUS } from "../style";
import { moveColumn, moveSection } from "../../designerTree";
import { removeAt, insertEl } from "../blockPath";
import type { Block, Sel, SectionProps } from "../types";

// Resolves both reload paths' onLoad: a pending hot-swap for this exact slot
// flips it to active (the actual, blink-free "reveal"); a cold mount just
// clears the skeleton once its own slot (already active) has painted.
// Extracted as a standalone factory so it can be unit-tested without a real
// React render (see useLiveEditBridge.test.ts).
export function __testOnly_handleFrameLoad(deps: {
  swapPending: { current: "a" | "b" | null };
  setActiveSlot: (s: "a" | "b") => void;
  setReloading: (v: boolean) => void;
  frameARef: { current: HTMLIFrameElement | null };
  frameBRef: { current: HTMLIFrameElement | null };
  liveSrcA: string | null;
  liveSrcB: string | null;
  pendingScrollRestore: { current: number | null };
  activeSlot: "a" | "b";
}) {
  return function handleFrameLoad(slot: "a" | "b") {
    if (deps.swapPending.current === slot) {
      deps.swapPending.current = null;
      deps.setActiveSlot(slot);
      deps.setReloading(false);
      const frame = (slot === "a" ? deps.frameARef : deps.frameBRef).current;
      const src = slot === "a" ? deps.liveSrcA : deps.liveSrcB;
      if (deps.pendingScrollRestore.current != null && frame?.contentWindow && src) {
        const targetOrigin = new URL(src, window.location.href).origin;
        frame.contentWindow.postMessage({ type: "designer:restoreScroll", y: deps.pendingScrollRestore.current }, targetOrigin);
        deps.pendingScrollRestore.current = null;
      }
      return;
    }
    if (slot === deps.activeSlot) deps.setReloading(false);
  };
}

// The Live Edit iframe bridge: double-buffered iframe pair (blink-free
// reload), the postMessage sync in both directions (iframe click/reorder/
// undo/redo -> mutate()/undo()/redo(), and sel/blocks -> iframe style/text
// sync), and enterLive/toggleLive.
//
// `structuralTick`/`bumpStructural` are deliberately NOT owned by this hook
// — they stay as plain state in Designer() and are passed in here as params.
// Reason: useUndoRedo() (blocks/mutate/undo/redo, all consumed below) itself
// takes bumpStructural as a constructor arg (its onStructuralChange callback,
// fired by undo()/redo() too), so useUndoRedo() must be called BEFORE this
// hook — but this hook needs useUndoRedo's own blocks/mutate/undo/redo
// output. Having this hook also OWN bumpStructural would make the two hooks
// mutually dependent on each other's return value, which no call order can
// satisfy. Keeping structuralTick/bumpStructural local to Designer() (as
// they already were pre-Task-6) breaks that cycle without changing behavior.
export function useLiveEditBridge(params: {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  setSel: (s: Sel) => void;
  setCtxMenu: (v: { path: number[]; x: number; y: number } | null) => void;
  undo: () => void;
  redo: () => void;
  dirty: boolean;
  save: () => Promise<void>;
  tenantHost: string;
  token: string;
  pageId: string;
  pageSlug: string;
  structuralTick: number;
  bumpStructural: () => void;
  onError?: (message: string) => void;
}) {
  const {
    blocks, mutate, sel, setSel, setCtxMenu, undo, redo, dirty, save, tenantHost, token, pageId, pageSlug,
    structuralTick, bumpStructural, onError,
  } = params;

  const [mode, setMode] = useState<"blocks" | "live">("blocks");
  // Double-buffered iframe pair: the inactive slot loads a reload's new
  // content off-screen (opacity 0, pointer-events none) and only swaps to
  // visible once its onLoad fires, so the visible iframe is never
  // mid-navigation — that's the actual source of any reload "blink", not
  // skeleton speed. swapPending names which slot a hot-swap (not a cold
  // mount) is waiting on; handleFrameLoad() below is the single place that
  // resolves it.
  const [liveSrcA, setLiveSrcA] = useState<string | null>(null);
  const [liveSrcB, setLiveSrcB] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const swapPending = useRef<"a" | "b" | null>(null);
  const liveSrc = activeSlot === "a" ? liveSrcA : liveSrcB;
  // True from the moment any iframe (re)load starts (initial open, mode
  // toggle back into Live, or a debounced structural/style reload) until its
  // onLoad fires — covers the skeleton overlay so a reload never shows the
  // browser's own blank-frame flash, however brief.
  const [reloading, setReloading] = useState(true);
  // Reported by BaseLayout.astro's designer:selectedRect message — the
  // selected node's on-screen box inside the iframe, used to position
  // LiveEditToolbar. Cleared whenever `sel` itself changes so a stale rect
  // never positions the toolbar over the wrong element while the new one's
  // first report is in flight.
  const [selectedRect, setSelectedRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const lastScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  const lastNonTextSig = useRef<string | null>(null);
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const liveFrame = activeSlot === "a" ? frameARef : frameBRef;

  const handleFrameLoad = __testOnly_handleFrameLoad({
    swapPending, setActiveSlot, setReloading, frameARef, frameBRef, liveSrcA, liveSrcB, pendingScrollRestore, activeSlot,
  });

  // "Live Edit": same real-render iframe the Preview button opens in a new
  // tab, but embedded and augmented with a designerEdit=1 flag so
  // BaseLayout.astro's bridge script + SectionBlock.astro's
  // data-designer-path attributes activate — clicking an element there sets
  // `sel` exactly like clicking in the block canvas, so the existing
  // Inspector sidebar keeps working unmodified.
  //
  // Always mints a preview token, even for an already-published page — see
  // Designer.tsx's/apps/frontend's own comments on this.
  // cold=true means the live iframes were just unmounted (switching in from
  // Blocks mode) or this is the very first load — nothing is on screen to
  // keep showing, so skeleton + a fresh mount into slot "a" is correct.
  // cold=false (the debounced structural/style reload path, mode already
  // "live") loads into the *inactive* slot and hands off the actual swap to
  // handleFrameLoad, so the visible iframe never sees its own navigation.
  async function enterLive(cold = false) {
    if (dirty) await save();
    const previewToken = await api.getPagePreviewToken(tenantHost, token, pageId);
    const base = api.previewUrl(tenantHost, pageSlug, previewToken);
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

  function toggleLive() {
    setMode(mode === "live" ? "blocks" : "live");
  }

  useEffect(() => {
    setSelectedRect(null);
  }, [sel]);

  // Debounced reload for structural Live Edit changes — waits for a pause in
  // activity so a fast burst (e.g. several deletes in a row) reloads once.
  // enterLive() already saves when dirty and mints a fresh preview token,
  // which is what actually forces the iframe to reload; the scroll position
  // is restored once the reloaded iframe reports back in (handleFrameLoad).
  useEffect(() => {
    if (structuralTick === 0 || mode !== "live") return;
    const timer = setTimeout(() => {
      pendingScrollRestore.current = lastScrollY.current;
      void enterLive().catch((err) => onError?.((err as Error).message));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralTick]);

  // Live-view bridge: the iframe's window posts these (see BaseLayout.astro's
  // inline script) — a click there selects exactly like a click in the block
  // canvas (same `sel`, same Inspector), and typing in an editable text node
  // there commits through the same mutate() path the Inspector textarea uses.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
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
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
        const [b, r, c, el] = path;
        mutate((bs) => {
          (bs[b].props as unknown as SectionProps).rows[r].columns[c].elements[el].props.text = e.data.value ?? "";
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
          mutate((bs) => {
            const [tb, tr, tc, te] = to;
            let idx = te + (e.data.position === "after" ? 1 : 0);
            // same-column move: removing the source first shifts later
            // indexes down — same adjustment dropIntoColumn already makes
            // for the block-canvas drag.
            if (from[0] === tb && from[1] === tr && from[2] === tc && from[3] < idx) idx--;
            const el = removeAt(bs, from);
            insertEl(bs, [tb, tr, tc], el, idx);
          });
        } else if (from.length === 3) {
          // Column reorder is scoped to within its own row — a row's
          // grid-template-columns and each column's span are only meaningful
          // there, same restriction the Layers tree's drag-reorder applies.
          if (from[0] !== to[0] || from[1] !== to[1]) return;
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

  return { mode, liveSrc, frameARef, frameBRef, liveFrame, selectedRect, reloading, enterLive, handleFrameLoad, toggleLive };
}
