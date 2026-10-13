// Live Edit's one page scrollbar, at the canvas column's own right edge
// instead of inside the framed device box. The iframe keeps its real device
// viewport (so vh units, sticky headers and position:fixed all still behave
// exactly as on a real screen — an iframe stretched to its content height
// would break all three, and loop forever on a 100vh slider) and only hides
// its own scrollbar (BaseLayout.astro's designerEdit style); this column
// scrolls a spacer as tall as the page's scroll range instead, synced both
// ways with the active iframe's window scroll (designer:scrollMax/
// designer:scroll in, designer:restoreScroll out). Scroll px map 1:1 to the
// page's own unscaled px, so no dependency on DeviceViewport's scale.
import { useEffect, useRef, type ReactNode } from "react";

type Metrics = { y: number; max: number };

export function LiveScrollStage({ activeKey, children }: { activeKey: string; children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // Per iframe window (both double-buffer slots report, including the hidden
  // one while it loads), so a swap can apply the new frame's numbers at once.
  const metrics = useRef(new WeakMap<object, Metrics>());
  // Set while the author drives the scroll from this column — the frame's
  // own echoes lag a frame behind and would otherwise drag it backwards.
  const outerDrivingUntil = useRef(0);

  const activeFrame = () => outerRef.current?.querySelector<HTMLIFrameElement>('iframe[data-live-active="true"]') ?? null;

  function apply(m: Metrics) {
    const outer = outerRef.current;
    if (!outer || !spacerRef.current) return;
    spacerRef.current.style.height = `${Math.max(0, m.max)}px`;
    if (performance.now() < outerDrivingUntil.current) return;
    if (Math.abs(outer.scrollTop - m.y) > 1) outer.scrollTop = m.y;
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const type = e.data?.type;
      if ((type !== "designer:scroll" && type !== "designer:scrollMax") || !e.source) return;
      const frames = outerRef.current?.querySelectorAll("iframe") ?? [];
      if (![...frames].some((f) => f.contentWindow === e.source)) return;
      const prev = metrics.current.get(e.source) ?? { y: 0, max: 0 };
      const next = { y: Number(e.data.y ?? prev.y), max: type === "designer:scrollMax" ? Number(e.data.max ?? 0) : prev.max };
      metrics.current.set(e.source, next);
      if (e.source === activeFrame()?.contentWindow) apply(next);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const win = activeFrame()?.contentWindow;
    const m = win && metrics.current.get(win);
    if (m) apply(m);
  }, [activeKey]);

  function onScroll() {
    const frame = activeFrame();
    const win = frame?.contentWindow;
    const outer = outerRef.current;
    if (!frame || !win || !outer) return;
    const m = metrics.current.get(win);
    // Our own apply() landing — not the author scrolling.
    if (m && Math.abs(outer.scrollTop - m.y) <= 1) return;
    outerDrivingUntil.current = performance.now() + 150;
    try {
      win.postMessage({ type: "designer:restoreScroll", y: outer.scrollTop }, new URL(frame.src).origin);
    } catch {
      /* mid-navigation — the next scroll re-sends */
    }
  }

  return (
    <div ref={outerRef} role="region" aria-label="Live Edit" data-testid="designer-live-stage" onScroll={onScroll} className="relative min-w-0 flex-1 overflow-y-auto bg-canvas">
      <div className="sticky top-0 h-full p-4">{children}</div>
      <div ref={spacerRef} aria-hidden="true" />
    </div>
  );
}
