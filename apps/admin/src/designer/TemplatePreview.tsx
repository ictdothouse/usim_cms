import type { Row } from "./types";

// Rough layout impression only ("susunan" — not a pixel-accurate render, no
// real colors/fonts/media) so a list of 100+ saved layouts (templates or
// blueprints) stays scannable without the cost/dependency of a real
// screenshot thumbnail (would need a headless-browser render pipeline just
// for this). Takes an already-normalized rows[] — callers with a
// section/row/column/element-shaped template, or a whole page's rows,
// normalize to this shape before rendering.
export function TemplatePreview({ rows }: { rows: Row[] }) {
  return (
    <div className="flex h-14 flex-col gap-0.5 overflow-hidden rounded-md border border-line/30 bg-canvas/40 p-1">
      {rows.slice(0, 4).map((row, i) => (
        <div key={i} className="flex flex-1 gap-0.5">
          {(row.columns ?? []).slice(0, 5).map((col, j) => (
            <div key={j} className="flex flex-1 flex-col justify-center gap-[1px] rounded-sm bg-white/70 p-[1px]">
              {(col.elements ?? []).slice(0, 3).map((_, k) => (
                <div key={k} className="h-[3px] w-full rounded-full bg-accent/40" />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
