// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — the highest-risk extraction
// per that spec: the most stateful hook, with the most subtle preserved
// behaviors (the transient cross-origin postMessage guard, the
// skipNextReload text-typing guard, the debounced-reload effect), and its message
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
import {
  deleteSlideElement,
  duplicateSlideElement,
  parseSlides,
  stringifySlides,
  updateSlideElementProps,
  updateSlideElementBp,
} from "../parsers";
import { scaledFreeFont } from "../style";
import { writeDragSideKeys, applySectionSpacingWrite } from "../spacingDrag";
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
  sliderSlideIdx: Record<string, number>;
  setSliderSlideIdx: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  // Read too, not just set: designer:selected re-sends the selected slide
  // child so the iframe's Canva-style chrome survives every reload.
  sliderInnerSel: Record<string, { r: number; c: number; e: number } | null>;
  setSliderInnerSel: React.Dispatch<React.SetStateAction<Record<string, { r: number; c: number; e: number } | null>>>;
  // Live Edit frames the real page at this device's exact viewport (see
  // DeviceViewport) — also decides which bp bag a free-position drag in the
  // iframe writes to, same rule ElPreview.tsx's own drag commit follows.
  bp: "desktop" | "tablet" | "mobile";
  // Inspector FourSideControl's "linked" chain-icon toggles (useBpStyle) —
  // forwarded to the iframe (designer:selected) so its padding/margin drag
  // handles fan a drag out to all 4 sides when linked; the iframe's own
  // floating lock pill flips them back here (designer:spacingLink).
  linkedPadding: boolean;
  linkedMargin: boolean;
  setLinkedPadding: React.Dispatch<React.SetStateAction<boolean>>;
  setLinkedMargin: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface LiveEditBridgeApi {
  mode: "blocks" | "live";
  liveSrc: string | null;
  liveSrcA: string | null;
  liveSrcB: string | null;
  activeSlot: "a" | "b";
  frameARef: React.RefObject<HTMLIFrameElement>;
  frameBRef: React.RefObject<HTMLIFrameElement>;
  liveFrame: React.RefObject<HTMLIFrameElement>;
  selectedRect: { top: number; left: number; width: number; height: number } | null;
  enterLive: (cold?: boolean) => Promise<void>;
  toggleLive: () => Promise<void>;
  handleFrameLoad: (slot: "a" | "b") => void;
}

export function useLiveEditBridge(deps: LiveEditBridgeDeps): LiveEditBridgeApi {
  const {
    blocks, mutate, sel, setSel, undo, redo, isSectionLocked, t,
    tenantHost, token, pageId, pageSlug, kind, dirty, save, saveBlueprint,
    setError, setReloading, setCtxMenu, sliderSlideIdx, setSliderSlideIdx, sliderInnerSel, setSliderInnerSel,
    linkedPadding, linkedMargin, setLinkedPadding, setLinkedMargin,
    structuralTick, bumpStructural, bp,
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
    const url = new URL(base, window.location.href);
    url.searchParams.set("designerEdit", "1");
    // Same deviceFrame param Preview's withDeviceFrame() sets (usePersist),
    // so BaseLayout hides the scrollbar identically for tablet/mobile — a
    // visible scrollbar here but not in Preview would make the page's real
    // layout width ~15px narrower in Live Edit than in Preview.
    if (bp !== "desktop") url.searchParams.set("deviceFrame", bp);
    const src = url.toString();
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
    const frame = (slot === "a" ? frameARef : frameBRef).current;
    const src = slot === "a" ? liveSrcA : liveSrcB;
    if (swapPending.current === slot) {
      swapPending.current = null;
      setActiveSlot(slot);
      setReloading(false);
      postShowSlides(frame, src);
      if (pendingScrollRestore.current != null && frame?.contentWindow && src) {
        const targetOrigin = new URL(src, window.location.href).origin;
        frame.contentWindow.postMessage({ type: "designer:restoreScroll", y: pendingScrollRestore.current }, targetOrigin);
        pendingScrollRestore.current = null;
      }
      return;
    }
    if (slot === activeSlot) {
      setReloading(false);
      postShowSlides(frame, src);
    }
  }

  // Entering Live Edit mounts the REAL server-rendered page (cold load into
  // slot "a") — it used to only restyle the in-app Blocks canvas, which is
  // an approximation of the real render (vw-based font sizes and @media
  // rules there evaluate against the admin window, not the device; no
  // Swiper), so "Live" and Preview could visibly disagree.
  async function toggleLive() {
    if (mode === "live") {
      setMode("blocks");
      return;
    }
    try {
      await enterLive(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Switching Desktop/Tablet/Mobile while live re-frames the page at the new
  // device's viewport — a fresh URL (deviceFrame differs), hot-swapped so
  // the visible frame never blanks. Scroll isn't carried across: the same y
  // offset means a different spot on a differently-laid-out page.
  const lastBp = useRef(bp);
  useEffect(() => {
    if (lastBp.current === bp) return;
    lastBp.current = bp;
    if (mode !== "live") return;
    void enterLive().catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp]);

  // Every edit made while live (Inspector field, Layers, undo/redo, block
  // ops) re-renders the real page — the only way what Live Edit shows can be
  // guaranteed to be exactly what Preview/the published site render. The
  // old shortcut (posting admin-computed inline styles into the iframe for
  // text elements) used the BASE props even at tablet/mobile, so a per-
  // breakpoint override was shown at its desktop value. Edits that
  // originate INSIDE the iframe and are already visible there (typing into
  // a contentEditable heading/text) skip the reload so the caret survives;
  // that text is re-rendered once selection moves away (pendingTextReload).
  const skipNextReload = useRef(false);
  const pendingTextReload = useRef(false);
  const lastBlocks = useRef(blocks);
  useEffect(() => {
    if (lastBlocks.current === blocks) return;
    lastBlocks.current = blocks;
    if (mode !== "live") return;
    if (skipNextReload.current) {
      skipNextReload.current = false;
      return;
    }
    bumpStructural();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // Keeps every slider in the iframe on the slide being edited (Swiper
  // resets to slide 0 on each reload).
  function postShowSlides(frame: HTMLIFrameElement | null, src: string | null) {
    if (!frame?.contentWindow || !src) return;
    try {
      frame.contentWindow.postMessage({ type: "designer:showSlides", map: sliderSlideIdx }, new URL(src, window.location.href).origin);
    } catch {
      /* transient cross-origin mismatch mid-navigation — next load re-sends */
    }
  }
  useEffect(() => {
    if (mode === "live") postShowSlides(liveFrame.current, liveSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderSlideIdx]);

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
        // The iframe is drawn at its true device size then CSS-scaled to
        // fit (DeviceViewport) — its own clientX/Y are in unscaled px.
        const scale = liveFrame.current.offsetWidth ? rect.width / liveFrame.current.offsetWidth : 1;
        setSel(p);
        setCtxMenu({ path: p, x: rect.left + Number(e.data.x ?? 0) * scale, y: rect.top + Number(e.data.y ?? 0) * scale });
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
      if (e.data?.type === "designer:slideElDrag" || e.data?.type === "designer:slideElAction") {
        // Posted by BaseLayout.astro's Canva-style slide-element chrome: a
        // drag/resize/rotate/align (slideElDrag, once on pointerup — the
        // gesture itself runs natively in the iframe's real DOM) or a
        // toolbar action (slideElAction: lock/duplicate/delete/href). Same
        // writes ElPreview.tsx's commitFree/toolbar make in Blocks mode; the
        // blocks change then reloads the iframe through the real renderer.
        const sliderPath = String(e.data.sliderPath ?? "")
          .split(".")
          .map(Number);
        const slideSel = String(e.data.slideSel ?? "")
          .split(".")
          .map(Number);
        if (sliderPath.length !== 4 || slideSel.length !== 4) return;
        const [b, r, c, elIdx] = sliderPath;
        const [slideIdx, sr, sc, se] = slideSel;
        const sliderId = (blocks[b]?.props as unknown as SectionProps | undefined)?.rows?.[r]?.columns?.[c]?.elements?.[elIdx]?.id;
        const action = e.data.type === "designer:slideElAction" ? String(e.data.action ?? "") : "drag";
        mutate((bs) => {
          const target = (bs[b]?.props as unknown as SectionProps | undefined)?.rows?.[r]?.columns?.[c]?.elements?.[elIdx];
          if (!target || target.type !== "slider") return;
          const currentSlides = parseSlides(target.props.slides);
          const s0 = currentSlides[slideIdx];
          const child = s0?.rows[sr]?.columns[sc]?.elements[se];
          if (!s0 || !child) return;
          if (action === "duplicate") {
            currentSlides[slideIdx] = duplicateSlideElement(s0, sr, sc, se);
          } else if (action === "delete") {
            currentSlides[slideIdx] = deleteSlideElement(s0, sr, sc, se);
          } else if (action === "lock" || action === "href") {
            // Neither is per-breakpoint (lock is editor-only, href is content).
            currentSlides[slideIdx] = updateSlideElementProps(s0, sr, sc, se, { [action === "lock" ? "locked" : "href"]: String(e.data.value ?? "") });
          } else if (action === "drag") {
            const get = (k: string) => (bp !== "desktop" ? child.bp?.[`${bp}:${k}`] : undefined) ?? child.props[k] ?? "";
            const { fontScale, ...rest } = (e.data.patch ?? {}) as Record<string, string>;
            const ratio = Number(fontScale);
            // The iframe only knows the live px it previewed; the stored
            // value (rem/em/preset) is scaled here, same as Blocks mode.
            const patch = ratio && ratio !== 1 ? { ...rest, ...scaledFreeFont(child.type, get, ratio) } : rest;
            // Tablet/mobile drags write that tier's own override ("mobile:x"),
            // never the desktop base — same rule as ElPreview.tsx's commitFree.
            if (bp === "desktop") {
              currentSlides[slideIdx] = updateSlideElementProps(s0, sr, sc, se, patch);
            } else {
              const nextBp = { ...(child.bp ?? {}) };
              for (const [k, v] of Object.entries(patch)) nextBp[`${bp}:${k}`] = v;
              currentSlides[slideIdx] = updateSlideElementBp(s0, sr, sc, se, nextBp);
            }
          } else {
            return;
          }
          target.props.slides = stringifySlides(currentSlides);
        });
        if (sliderId && action === "duplicate") setSliderInnerSel((m) => ({ ...m, [sliderId]: { r: sr, c: sc, e: se + 1 } }));
        if (sliderId && action === "delete") setSliderInnerSel((m) => ({ ...m, [sliderId]: null }));
        return;
      }
      if (e.data?.type === "designer:spacingLink") {
        if (e.data.kind === "padding") setLinkedPadding((v) => !v);
        else if (e.data.kind === "margin") setLinkedMargin((v) => !v);
        return;
      }
      if (e.data?.type === "designer:spacingDrag") {
        // Posted once on pointerup by BaseLayout.astro's own padding/margin
        // drag handles — the gesture (live visual feedback, linked fan-out)
        // already ran entirely inside the iframe; this just commits the
        // final value through the same write functions DesignerCanvas.tsx's
        // Blocks-mode handles use (spacingDrag.ts), one mutate() per drag.
        const spacingPath = String(e.data.path ?? "")
          .split(".")
          .map(Number);
        const fields = Array.isArray(e.data.fields) ? e.data.fields.map(String) : [];
        const px = Number(e.data.px);
        if (![1, 3, 4].includes(spacingPath.length) || !fields.length || !Number.isFinite(px)) return;
        if (isSectionLocked(spacingPath[0])) {
          toast.error(t("designer-section-locked-toast"));
          return;
        }
        const bpKeyFn = (k: string) => `${bp}:${k}`;
        const linked = fields.length > 1;
        mutate((bs) => {
          if (spacingPath.length === 1) {
            applySectionSpacingWrite(bs[spacingPath[0]].props as unknown as SectionProps, fields, fields[0], px, linked, bp, bpKeyFn);
          } else if (spacingPath.length === 3) {
            const [b, r, c] = spacingPath;
            writeDragSideKeys(section(bs, b).rows[r].columns[c], fields, fields[0], px, linked, bp, bpKeyFn);
          } else {
            const [b, r, c, elIdx] = spacingPath;
            writeDragSideKeys(section(bs, b).rows[r].columns[c].elements[elIdx], fields, fields[0], px, linked, bp, bpKeyFn);
          }
        });
        return;
      }
      const path = String(e.data?.path ?? "")
        .split(".")
        .map(Number);
      if (e.data?.type === "designer:select" && path.length >= 1) {
        setSel(path);
      } else if (e.data?.type === "designer:textInput" && path.length === 4) {
        const [b, r, c, el] = path;
        // Already on screen (the author is typing into it) — see
        // skipNextReload's own comment.
        skipNextReload.current = true;
        pendingTextReload.current = true;
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

  // Keeps the live iframe's selection highlight + text editability in sync
  // with `sel` (style changes reach it via a real reload — see
  // skipNextReload's comment above). Moving selection off a text node the
  // author typed into re-renders it once through the real renderer.
  useEffect(() => {
    if (mode !== "live") return;
    if (pendingTextReload.current) {
      pendingTextReload.current = false;
      bumpStructural();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
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
    const selEl =
      sel?.length === 4 ? (blocks[sel[0]]?.props as unknown as SectionProps)?.rows?.[sel[1]]?.columns?.[sel[2]]?.elements?.[sel[3]] : undefined;
    const inner = selEl?.type === "slider" ? sliderInnerSel[selEl.id] : null;
    post({
      type: "designer:selected",
      path: sel?.join(".") ?? null,
      // "slideIdx.r.c.e" of the selected slide child, so the iframe re-attaches
      // its handles/toolbar after a reload (BaseLayout.astro's bridge).
      slideSel: inner && selEl ? `${sliderSlideIdx[selEl.id] ?? 0}.${inner.r}.${inner.c}.${inner.e}` : null,
      // So the iframe's own padding/margin drag handles (BaseLayout.astro)
      // fan a drag out to all 4 sides live when linked — same flags
      // DesignerCanvas.tsx's Blocks-mode handles already read.
      spacing: { linkedPadding, linkedMargin },
      // The iframe has no i18n of its own — its slide toolbar uses these.
      labels: {
        editLink: t("designer-edit-link"),
        lock: t("designer-lock"),
        unlock: t("designer-unlock"),
        duplicate: t("designer-duplicate"),
        delete: t("designer-delete"),
        rotate: t("designer-rotate"),
        move: t("designer-move"),
        alignToSlide: t("designer-align-to-slide"),
        left: t("designer-align-left"),
        center: t("designer-align-center"),
        right: t("designer-align-right"),
        top: t("designer-align-top"),
        middle: t("designer-align-middle"),
        bottom: t("designer-align-bottom"),
        linkSides: t("designer-f-link-sides"),
      },
    });
    if (sel && selEl && (selEl.type === "heading" || selEl.type === "text")) {
      post({ type: "designer:text", path: sel.join("."), editable: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sel, liveSrc, sliderInnerSel, sliderSlideIdx, linkedPadding, linkedMargin]);

  return { mode, liveSrc, liveSrcA, liveSrcB, activeSlot, frameARef, frameBRef, liveFrame, selectedRect, enterLive, toggleLive, handleFrameLoad };
}
