import { ELS } from "./elements";
import type { El, ElType, Row } from "./types";

// Element types that read as a media/visual block rather than a line of
// text — rendered as a small icon-centered box instead of an icon+bar, so
// the skeleton roughly reads as "picture here" vs "text here".
const BLOCK_TYPES = new Set<ElType>([
  "image",
  "gallery",
  "embed",
  "icon",
  "slider",
  "cardgrid",
  "logocloud",
  "googlemap",
  "peoplegrid",
  "postlist",
  "eventlist",
  "menu",
  "testimonial",
]);

// A heading reads wide+thick, a button reads short+pill-shaped — every other
// text-ish element (text/list/accordion/tabs/etc) falls back to a plain
// medium bar. Rough shape only, not a real per-type design.
function barShape(type: ElType): string {
  if (type === "heading") return "h-[6px] w-4/5 rounded-full bg-slate-500";
  if (type === "button") return "h-[7px] w-1/3 rounded-full bg-orange-400";
  if (type === "divider" || type === "spacer") return "h-px w-1/2 self-center bg-slate-300";
  return "h-[5px] w-full rounded-full bg-slate-300";
}

// Fixed, deliberately non-theme palette (mockup convention, like the
// reference component-library thumbnails, not the tenant's own brand colors)
// — a block-type element cycles through these so a grid of cards reads as
// distinct colored swatches at a glance instead of flat gray boxes.
const BLOCK_PALETTE = ["bg-orange-400", "bg-teal-400", "bg-amber-400", "bg-slate-600", "bg-sky-400"];

// One element's skeleton piece — a real icon (pulled straight from the
// Designer palette's own ELS registry, not a duplicated lookup table) so
// this preview stays in sync with whatever element types Designer knows
// about, plus a shape roughly matching that element's real footprint.
function ElementSkeleton({ el, colorIdx }: { el: El; colorIdx: number }) {
  const Icon = ELS[el.type]?.icon;
  if (BLOCK_TYPES.has(el.type)) {
    const color = BLOCK_PALETTE[colorIdx % BLOCK_PALETTE.length];
    return (
      <div className={`flex aspect-square w-full items-center justify-center rounded ${color}`}>
        {Icon && <Icon className="h-4 w-4 text-white/90" />}
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
      <div className={barShape(el.type)} />
    </div>
  );
}

// Rough layout impression only ("susunan" — not a pixel-accurate render, no
// real fonts/media) so a list of 100+ saved layouts (templates or
// blueprints) stays scannable without the cost/dependency of a real
// screenshot thumbnail (would need a headless-browser render pipeline just
// for this). Solid-color swatches (BLOCK_PALETTE) stand in for images/media
// so the shape reads like a real component-library mockup rather than a
// low-contrast skeleton. Takes an already-normalized rows[] — callers with a
// section/row/column/element-shaped template, or a whole page's rows,
// normalize to this shape before rendering.
export function TemplatePreview({ rows }: { rows: Row[] }) {
  let colorIdx = 0;
  return (
    <div className="flex h-32 flex-col gap-1.5 overflow-hidden rounded-md border border-line/40 bg-white p-2">
      {rows.slice(0, 4).map((row, i) => (
        <div key={i} className="flex flex-1 gap-1.5">
          {(row.columns ?? []).slice(0, 5).map((col, j) => (
            <div key={j} className="flex flex-1 flex-col justify-center gap-1 rounded border border-slate-200 bg-slate-50 p-1.5">
              {(col.elements ?? []).slice(0, 3).map((el, k) => (
                <ElementSkeleton key={k} el={el} colorIdx={colorIdx++} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
