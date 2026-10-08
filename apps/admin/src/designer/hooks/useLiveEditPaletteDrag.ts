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
  liveFrame: React.RefObject<HTMLIFrameElement>;
  liveSrc: string | null;
  dropIntoColumn: (colPath: number[], index?: number) => void;
  dropIntoNewSection: (afterBlockIndex?: number) => void;
}

export interface LiveEditPaletteDragApi {
  ghost: { label: string; x: number; y: number } | null;
  startPaletteDrag: (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => void;
}

export function useLiveEditPaletteDrag(deps: LiveEditPaletteDragDeps): LiveEditPaletteDragApi {
  const { drag, liveFrame, liveSrc, dropIntoColumn, dropIntoNewSection } = deps;
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const lastTarget = useRef<DropTarget | null>(null);
  const rafPending = useRef(false);

  // Mirrors useLiveEditBridge.ts's own onMessage guard exactly: only accept
  // messages that actually came from the currently-active Live Edit iframe,
  // from the origin that iframe's own src resolves to.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!liveFrame.current || e.source !== liveFrame.current.contentWindow) return;
      if (!liveSrc || e.origin !== new URL(liveSrc, window.location.href).origin) return;
      if (e.data?.type === "designer:dropTarget") {
        lastTarget.current = (e.data.target as DropTarget | null) ?? null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [liveFrame, liveSrc]);

  // Mirrors useLiveEditBridge.ts's own `post` helper: a transient
  // cross-origin mismatch right after a reload/slot-swap (navigation to
  // targetOrigin hasn't completed yet) throws synchronously — harmless to
  // swallow, the next frame's postMessage call supersedes it anyway.
  const postToIframe = useCallback(
    (msg: unknown) => {
      if (!liveSrc || !liveFrame.current?.contentWindow) return;
      try {
        liveFrame.current.contentWindow.postMessage(msg, new URL(liveSrc, window.location.href).origin);
      } catch {
        /* transient cross-origin mismatch mid-reload */
      }
    },
    [liveFrame, liveSrc],
  );

  const startPaletteDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, payload: Drag, label: string) => {
      e.preventDefault();
      const el = e.currentTarget;
      const pointerId = e.pointerId;
      el.setPointerCapture(pointerId);
      drag.current = payload;
      lastTarget.current = null;
      setGhost({ label, x: e.clientX, y: e.clientY });

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        setGhost({ label, x: ev.clientX, y: ev.clientY });
        if (rafPending.current) return;
        const frame = liveFrame.current;
        if (!frame) return;
        rafPending.current = true;
        requestAnimationFrame(() => {
          rafPending.current = false;
          const rect = frame.getBoundingClientRect();
          const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
          if (!inside) {
            lastTarget.current = null;
            postToIframe({ type: "designer:paletteDragEnd" });
            return;
          }
          const { x, y } = clientToIframeLocal(ev.clientX, ev.clientY, rect, frame.offsetWidth);
          postToIframe({ type: "designer:paletteDragMove", x, y });
        });
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        setGhost(null);
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        cleanup();
        postToIframe({ type: "designer:paletteDragEnd" });
        const target = lastTarget.current;
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
    [drag, liveFrame, dropIntoColumn, dropIntoNewSection, postToIframe],
  );

  return { ghost, startPaletteDrag };
}
