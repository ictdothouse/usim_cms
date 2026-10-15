// One device "screen" shared by Preview (DesignerDevicePreviewModal) and Live
// Edit (Designer.tsx's live mode), so both always frame the real page at the
// exact same CSS-pixel viewport. The screen box is ALWAYS the device's true
// width (393 etc.) — @media breakpoints and every fixed-px free-position
// element inside the iframe are judged against that real width — and only a
// visual transform:scale() shrinks it to fit the space available. Height is
// the device's true height too, except under `fill` (Live Edit desktop). The old Preview sized its iframe off CSS aspect-ratio plus a
// 46rem height cap plus bezel padding, which on a normal laptop left the
// "mobile" iframe ~315px wide instead of 393px (and Live Edit, the Blocks
// canvas and a real phone each at a different width again).
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type Device = "desktop" | "tablet" | "mobile";

// Real device logical-pixel viewports (iPhone 14/15, iPad Air). Desktop is a
// fixed 1440×900 reference (a common laptop/design width, safely inside the
// frontend's ≥1025px desktop tier) rather than "whatever room is left",
// which on a laptop with both Designer side panels open dropped below
// 1025px and silently rendered the TABLET tier under a "desktop" label.
export const DEVICE_DIMS: Record<Device, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  tablet: { w: 820, h: 1180 },
  mobile: { w: 393, h: 852 },
};

// Bezel padding per side (px) — outside the screen box, so it never eats
// into the 393px the page itself gets.
const BEZEL_PAD: Record<Device, number> = { desktop: 0, tablet: 10, mobile: 12 };

export function DeviceViewport({
  device,
  landscape = false,
  fill = false,
  children,
}: {
  device: Device;
  landscape?: boolean;
  // Fit the width alone and give the screen whatever height that leaves, so
  // the page fills the space instead of letterboxing a fixed-height screen.
  // The width, the only thing @media tiers read, stays the device's own.
  fill?: boolean;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setAvail({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const dims = DEVICE_DIMS[device];
  const pad = BEZEL_PAD[device];
  let screen = landscape && device !== "desktop" ? { w: dims.h, h: dims.w } : dims;
  let scale = 0;
  if (avail) {
    scale = Math.min(1, avail.w / (screen.w + pad * 2));
    if (!fill) scale = Math.min(scale, avail.h / (screen.h + pad * 2));
    else if (scale) screen = { w: screen.w, h: Math.max(0, avail.h / scale - pad * 2) };
  }
  const frame = { w: screen.w + pad * 2, h: screen.h + pad * 2 };

  // clip, not hidden: a screen still one render behind a resize stays
  // contained, but 1rem out (both callers' p-4 gutter), so the screen's
  // shadow isn't cut off where it fills the space — always, under fill.
  // Safari ignores the margin and clips at the edge, as before.
  return (
    <div ref={hostRef} className="flex h-full w-full items-center justify-center overflow-clip [overflow-clip-margin:1rem]">
      {/* Outer box takes the SCALED size so flex centering works; inner box
          is the true size, scaled from its top-left corner. */}
      <div className="relative shrink-0" style={{ width: frame.w * scale, height: frame.h * scale, visibility: avail ? undefined : "hidden" }}>
        <div
          className={`absolute left-0 top-0 ${
            device === "mobile" ? "rounded-[2.5rem] bg-ink shadow-xl" : device === "tablet" ? "rounded-[1.5rem] bg-ink shadow-xl" : ""
          }`}
          style={{ width: frame.w, height: frame.h, padding: pad, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        >
          {device === "mobile" && !landscape && (
            <div className="absolute left-1/2 top-[3px] h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/25" />
          )}
          <div
            className={`relative overflow-hidden bg-white ${
              // ring, not border: a border would sit inside this exact-size
              // box (border-box) and steal 2px from the page's viewport.
              device === "mobile" ? "rounded-[1.75rem]" : device === "tablet" ? "rounded-xl" : "rounded-lg shadow-[0_4px_20px_rgb(0_0_0/0.15)] ring-1 ring-line/30"
            }`}
            style={{ width: screen.w, height: screen.h }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
