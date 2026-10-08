// Owns the Live Edit drag-to-add gesture (see
// docs/superpowers/specs/2026-10-08-live-edit-drag-to-add-design.md): a
// palette item's pointerdown starts a pointer-captured drag that tracks the
// cursor even while it's visually over the cross-origin Live Edit iframe
// (Element.setPointerCapture keeps delivering pointermove/pointerup to the
// capturing element in THIS document regardless of what's under the
// cursor — the standard fix for "mouse events stop firing once the cursor
// enters an iframe"). The iframe never mutates the block tree; it only
// ever reports where the pointer resolved to (designer:dropTarget), and
// this hook commits through the exact same dropIntoColumn/dropIntoNewSection
// Blocks mode already uses.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { clientToIframeLocal, commitDropTarget, type DropTarget } from "../liveEditDropTarget";
import type { Drag } from "../types";

export interface LiveEditPaletteDragDeps {
  drag: MutableRefObject<Drag | null>;
  // frameARef/frameBRef are the two double-buffered Live Edit iframes
  // (Designer.tsx) and activeSlotRef tracks which one is currently visible.
  // Resolved FRESH on every pointer event via getActiveFrame() below,
  // deliberately NOT passed as a single already-resolved `liveFrame`
  // RefObject — a gesture's onMove/onUp closures are created once at
  // pointerdown and never recreated mid-drag, so if Live Edit hot-swaps
  // the active slot (a reload completing while the user is still
  // dragging — every drop triggers exactly this), a pre-resolved frame
  // reference would keep targeting the now-hidden buffer frame for the
  // rest of that gesture. frameARef/frameBRef/activeSlotRef are stable
  // ref objects whose `.current` is mutated in place by Designer.tsx, so
  // reading through them at call time always sees the live value (found
  // by the final branch review).
  frameARef: React.RefObject<HTMLIFrameElement>;
  frameBRef: React.RefObject<HTMLIFrameElement>;
  activeSlotRef: MutableRefObject<"a" | "b">;
  dropIntoColumn: (colPath: number[], index?: number) => void;
  dropIntoNewSection: (afterBlockIndex?: number) => void;
}

export interface LiveEditPaletteDragApi {
  ghost: { label: string; x: number; y: number } | null;
  startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void;
}

export function useLiveEditPaletteDrag(deps: LiveEditPaletteDragDeps): LiveEditPaletteDragApi {
  const { drag, frameARef, frameBRef, activeSlotRef, dropIntoColumn, dropIntoNewSection } = deps;
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const lastTarget = useRef<DropTarget | null>(null);
  const rafId = useRef<number | null>(null);
  const latestPoint = useRef<{ x: number; y: number } | null>(null);

  const getActiveFrame = useCallback((): HTMLIFrameElement | null => {
    return activeSlotRef.current === "a" ? frameARef.current : frameBRef.current;
  }, [activeSlotRef, frameARef, frameBRef]);

  // Mirrors useLiveEditBridge.ts's own onMessage guard exactly: only accept
  // messages that actually came from the currently-active Live Edit iframe.
  // The origin is read off that frame's OWN `src` at message-receipt time
  // (not a separately-threaded `liveSrc` prop) — it's always correct for
  // whichever frame is actually live, including right after a hot-swap.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = getActiveFrame();
      if (!frame || e.source !== frame.contentWindow || !frame.src) return;
      if (e.origin !== new URL(frame.src, window.location.href).origin) return;
      if (e.data?.type === "designer:dropTarget") {
        lastTarget.current = (e.data.target as DropTarget | null) ?? null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [getActiveFrame]);

  // Mirrors useLiveEditBridge.ts's own `post` helper: a transient
  // cross-origin mismatch right after a reload/slot-swap (navigation to
  // the new src hasn't completed yet) throws synchronously — harmless to
  // swallow, the next frame's postMessage call supersedes it anyway.
  const postToIframe = useCallback(
    (msg: unknown) => {
      const frame = getActiveFrame();
      if (!frame?.contentWindow || !frame.src) return;
      try {
        frame.contentWindow.postMessage(msg, new URL(frame.src, window.location.href).origin);
      } catch {
        /* transient cross-origin mismatch mid-reload */
      }
    },
    [getActiveFrame],
  );

  const startPaletteDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => {
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      drag.current = payload;
      lastTarget.current = null;
      latestPoint.current = null;
      setGhost({ label, x: e.clientX, y: e.clientY });
      // Resets the iframe's own dropTarget dedupe/overlay from any PRIOR
      // gesture that ended abnormally (e.g. its own final rAF tick landed
      // after that gesture's paletteDragEnd — see onMove's comment below) —
      // without this, a stuck overlay or a silently-ignored first move on
      // the next drag was possible (found by the final branch review).
      postToIframe({ type: "designer:paletteDragEnd" });

      function scheduleMoveFrame() {
        if (rafId.current !== null) return;
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          const p = latestPoint.current;
          const frame = getActiveFrame();
          if (!p || !frame) return;
          const rect = frame.getBoundingClientRect();
          const inside = p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
          if (!inside) {
            lastTarget.current = null;
            postToIframe({ type: "designer:paletteDragEnd" });
            return;
          }
          const { x, y } = clientToIframeLocal(p.x, p.y, rect, frame.offsetWidth);
          postToIframe({ type: "designer:paletteDragMove", x, y });
        });
      }

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        // Always the latest coordinates, read inside the rAF callback
        // itself rather than closed over from whichever move event
        // happened to schedule it — a coalesced pointermove right before
        // pointerup (common browser behavior) would otherwise let a stale
        // position win the race against the drag's own release (found by
        // the final branch review).
        latestPoint.current = { x: ev.clientX, y: ev.clientY };
        setGhost({ label, x: ev.clientX, y: ev.clientY });
        scheduleMoveFrame();
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        setGhost(null);
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        cleanup();
        postToIframe({ type: "designer:paletteDragEnd" });
        // Re-checks the pointer's OWN release position against the
        // currently-active frame, rather than trusting whatever
        // lastTarget happened to be reported last — if the release itself
        // is outside the iframe (or over a frame that hot-swapped after
        // the last resolved target), the drop must not silently commit a
        // stale target (found by the final branch review).
        const frame = getActiveFrame();
        const stillInside =
          !!frame &&
          (() => {
            const rect = frame.getBoundingClientRect();
            return ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
          })();
        const target = stillInside ? lastTarget.current : null;
        lastTarget.current = null;
        commitDropTarget(target, dropIntoColumn, dropIntoNewSection);
        if (!target) drag.current = null;
      }

      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        drag.current = null;
        lastTarget.current = null;
        postToIframe({ type: "designer:paletteDragEnd" });
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [drag, getActiveFrame, dropIntoColumn, dropIntoNewSection, postToIframe],
  );

  return { ghost, startPaletteDrag };
}
