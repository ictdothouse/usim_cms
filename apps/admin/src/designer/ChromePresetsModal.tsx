// Header/Footer Designer's Presets picker — a gallery of chromePresets.ts's
// starting layouts. Each thumbnail is drawn from the preset's own Block[]
// (section colors, logo/menu/button/social glyphs, the menu effect), so a
// preset and its picture can't drift apart.
import { X } from "lucide-react";
import type { Key } from "@/i18n";
import { DesignerDialog } from "./DesignerDialog";
import { CHROME_PRESETS, type ChromePresetCtx } from "./chromePresets";
import { parseRepeaterItems } from "./parsers";
import { SocialGlyph } from "./SocialPicker";
import type { Block, El, SectionProps } from "./types";

const JUSTIFY: Record<string, string> = { center: "center", right: "flex-end" };

function Glyph({ el }: { el: El }) {
  const p = el.props;
  switch (el.type) {
    case "container":
      return (
        <span
          className={`flex min-w-0 flex-1 items-center gap-2 ${p.radius === "full" ? "rounded-full px-2.5 py-1" : ""}`}
          style={{ background: p.bg, justifyContent: p.justifyContent === "space-between" ? "space-between" : "flex-start", boxShadow: p.shadow ? "0 2px 6px rgba(0,0,0,.12)" : undefined }}
        >
          {(el.children ?? []).map((c) => (
            <Glyph key={c.id} el={c} />
          ))}
        </span>
      );
    case "image":
    case "heading":
      return el.type === "image" || p.text === "Logo" ? (
        <span className="flex shrink-0 items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-current" />
          <span className="h-1.5 w-6 rounded-sm bg-current opacity-80" />
        </span>
      ) : (
        <span className="h-1.5 w-10 shrink-0 rounded-sm opacity-90" style={{ background: p.color || "currentColor" }} />
      );
    case "menu": {
      const fx = p.menuEffect;
      const vertical = p.layout === "vertical";
      return (
        <span className={`flex shrink-0 ${vertical ? "flex-col gap-1" : "items-center gap-1.5"}`} style={{ color: p.color || "currentColor" }}>
          {[0, 1, 2, 3].map((i) => {
            const current = i === 0 && fx && fx !== "none";
            return (
              <span
                key={i}
                className={`block ${current && (fx === "pill" || fx === "box") ? `px-1 py-0.5 ${fx === "pill" ? "rounded-full" : ""}` : ""}`}
                style={{
                  background: current && (fx === "pill" || fx === "box") ? p.accentColor || "rgb(59 130 246 / .2)" : undefined,
                  borderBottom: current && fx === "underline" ? `1.5px solid ${p.accentColor || "rgb(59 130 246)"}` : undefined,
                  borderTop: current && fx === "overline" ? `1.5px solid ${p.accentColor || "rgb(59 130 246)"}` : undefined,
                  paddingBlock: current && (fx === "underline" || fx === "overline") ? 2 : undefined,
                }}
              >
                <span className="block h-1 w-4 rounded-full" style={{ background: current && p.hoverColor ? p.hoverColor : "currentColor", opacity: current ? 1 : 0.6 }} />
              </span>
            );
          })}
        </span>
      );
    }
    case "button":
      return (
        <span
          className={`h-3 w-9 shrink-0 rounded-full ${p.variant === "outline" ? "border" : "bg-accent"}`}
          style={p.variant === "outline" ? { borderColor: p.color || "currentColor" } : undefined}
        />
      );
    case "socialicons":
      return (
        <span className="flex shrink-0 gap-1">
          {parseRepeaterItems(p.socials).map((it, i) => (
            <SocialGlyph key={i} platform={it.platform ?? ""} brand={p.socialStyle === "brand"} className="h-2.5 w-2.5" />
          ))}
        </span>
      );
    case "icon":
      return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />;
    case "divider":
      return <span className="block h-px w-full bg-current opacity-30" />;
    default:
      return <span className="h-1 w-12 shrink-0 rounded-full bg-current opacity-50" />;
  }
}

function ChromePresetThumb({ blocks }: { blocks: Block[] }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-lg border border-line/30 bg-zinc-100 p-2">
      {blocks.map((b, i) => {
        const sp = b.props as unknown as SectionProps;
        return (
          <div key={i} className="space-y-1.5 px-3 py-2" style={{ background: sp.bg, color: sp.textColor || "#1f2937" }}>
            {sp.rows.map((r, ri) => (
              <div key={ri} className="flex items-center gap-3">
                {r.columns.map((c, ci) => (
                  <div
                    key={ci}
                    className={`flex min-w-0 gap-1.5 ${c.elements.length > 1 && !c.elements.some((e) => e.type === "container") ? "flex-col" : "items-center"}`}
                    style={{
                      flex: `${c.span} 1 0%`,
                      justifyContent: JUSTIFY[c.elements.find((e) => e.props.align)?.props.align ?? ""],
                      alignItems: c.elements.length > 1 ? (JUSTIFY[c.elements[0].props.align ?? ""] ?? "flex-start") : undefined,
                    }}
                  >
                    {c.elements.map((e) => (
                      <Glyph key={e.id} el={e} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function ChromePresetsModal({ kind, presetCtx, t, onPick, onClose }: {
  kind: "header" | "footer";
  presetCtx: ChromePresetCtx;
  t: (k: Key) => string;
  onPick: (blocks: Block[]) => void;
  onClose: () => void;
}) {
  const title = t(kind === "header" ? "chrome-presets-header" : "chrome-presets-footer");
  return (
    <DesignerDialog title={title} onClose={onClose}>
      <div className="flex max-h-[85vh] w-[min(92vw,60rem)] flex-col overflow-hidden rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-bold text-ink">{title}</p>
          <button onClick={onClose} className="text-body hover:text-ink" aria-label={t("designer-close")} title={t("designer-close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm text-sub">{t("chrome-presets-hint")}</p>
        <div className="grid gap-3 overflow-y-auto sm:grid-cols-2">
          {CHROME_PRESETS.filter((p) => p.kind === kind).map((p) => {
            const blocks = p.build(presetCtx);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(blocks)}
                className="rounded-xl border border-line/40 p-2 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ChromePresetThumb blocks={blocks} />
                <span className="mt-2 block px-1 text-sm font-semibold text-ink">{t(p.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </DesignerDialog>
  );
}
