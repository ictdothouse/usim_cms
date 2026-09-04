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
  if (type === "heading") return "h-[4px] w-4/5 rounded-full";
  if (type === "button") return "h-[5px] w-1/3 rounded-full";
  if (type === "divider" || type === "spacer") return "h-px w-1/2 self-center bg-line";
  return "h-[3px] w-full rounded-full";
}

// One element's skeleton piece — a real icon (pulled straight from the
// Designer palette's own ELS registry, not a duplicated lookup table) so
// this preview stays in sync with whatever element types Designer knows
// about, plus a shape roughly matching that element's real footprint.
function ElementSkeleton({ el }: { el: El }) {
  const Icon = ELS[el.type]?.icon;
  if (BLOCK_TYPES.has(el.type)) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-line/40">
        {Icon && <Icon className="h-2.5 w-2.5 text-sub/60" />}
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-1">
      {Icon && <Icon className="h-2 w-2 shrink-0 text-sub/50" />}
      <div className={`${barShape(el.type)} bg-accent/40`} />
    </div>
  );
}

// Rough layout impression only ("susunan" — not a pixel-accurate render, no
// real colors/fonts/media) so a list of 100+ saved layouts (templates or
// blueprints) stays scannable without the cost/dependency of a real
// screenshot thumbnail (would need a headless-browser render pipeline just
// for this). Takes an already-normalized rows[] — callers with a
// section/row/column/element-shaped template, or a whole page's rows,
// normalize to this shape before rendering.
export function TemplatePreview({ rows }: { rows: Row[] }) {
  return (
    <div className="flex h-20 flex-col gap-0.5 overflow-hidden rounded-md border border-line/30 bg-canvas/40 p-1.5">
      {rows.slice(0, 4).map((row, i) => (
        <div key={i} className="flex flex-1 gap-1">
          {(row.columns ?? []).slice(0, 5).map((col, j) => (
            <div key={j} className="flex flex-1 flex-col justify-center gap-[3px] rounded-sm bg-white/70 p-1">
              {(col.elements ?? []).slice(0, 3).map((el, k) => (
                <ElementSkeleton key={k} el={el} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
