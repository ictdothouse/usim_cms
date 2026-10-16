// The slider element's Navigation panel (Inspector Content tab, under the
// slides editor): arrows, pagination, autoplay, loop and speed as switches +
// picture grids — these used to be 14 raw <select>/length fields in one long
// list. SliderBlock.astro is the only renderer (real site, and Live Edit,
// which reloads on every change); none of these props has a per-breakpoint or
// per-language render path, so the panel always writes the base props.
import type { ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { Key } from "@/i18n";
import { DragNumber } from "./FieldControls";
import { FieldInput, type FieldInputProps } from "./FieldInput";
import { SLIDER_ARROW_STYLES, SLIDER_DOT_STYLES, SLIDER_NAV_ICONS } from "./elements";

type ArrowStyle = (typeof SLIDER_ARROW_STYLES)[number];
type DotStyle = (typeof SLIDER_DOT_STYLES)[number];
type NavIcon = (typeof SLIDER_NAV_ICONS)[number];

const ARROW_LABEL: Record<ArrowStyle, Key> = {
  arrows: "designer-slider-arrow-arrows",
  square: "designer-slider-arrow-square",
  outline: "designer-slider-arrow-outline",
  dark: "designer-slider-arrow-dark",
  minimal: "designer-slider-arrow-minimal",
  bar: "designer-slider-arrow-bar",
  corner: "designer-slider-arrow-corner",
};
const DOT_LABEL: Record<DotStyle, Key> = {
  dots: "designer-slider-dots-dots",
  pill: "designer-slider-dots-pill",
  lines: "designer-slider-dots-lines",
  numbers: "designer-slider-dots-numbers",
  fraction: "designer-slider-dots-fraction",
  progress: "designer-slider-dots-progress",
};
const SPEED_LABEL: Record<"slow" | "normal" | "fast", Key> = {
  slow: "designer-slider-speed-slow",
  normal: "designer-slider-speed-normal",
  fast: "designer-slider-speed-fast",
};

// Same 24×24 glyphs SliderBlock.astro draws; "prev" is the glyph mirrored.
const ICON_PATH: Record<NavIcon, ReactNode> = {
  chevron: <path d="m9 18 6-6-6-6" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  caret: <path d="M8 5.5v13l10-6.5z" fill="currentColor" />,
};
function Glyph({ icon, flip }: { icon: NavIcon; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`h-full w-full${flip ? " -scale-x-100" : ""}`}
    >
      {ICON_PATH[icon]}
    </svg>
  );
}

// A mid-tone "photo" so light and dark buttons both read in a thumbnail.
function Photo({ children }: { children: ReactNode }) {
  return <div className="relative aspect-video w-full overflow-hidden rounded bg-gradient-to-br from-slate-400 to-slate-600">{children}</div>;
}

// Each design drawn small — mirrors SliderBlock.astro's [data-nav] rules.
const ARROW_LOOK: Record<ArrowStyle, string> = {
  arrows: "h-4 w-4 rounded-full bg-white/90 p-[3px] text-ink",
  square: "h-4 w-4 rounded-[3px] bg-white/90 p-[3px] text-ink",
  outline: "h-4 w-4 rounded-full border-[1.5px] border-white p-[2px] text-white",
  dark: "h-4 w-4 rounded-full bg-black/55 p-[3px] text-white",
  minimal: "h-5 w-5 text-white",
  bar: "inset-y-0 flex w-3 items-center bg-black/35 text-white",
  corner: "bottom-1 h-3.5 w-3.5 rounded-[3px] bg-white/90 p-[2px] text-ink",
};
const ARROW_SIDES: Partial<Record<ArrowStyle, [string, string]>> = {
  bar: ["left-0", "right-0"],
  corner: ["right-[1.3rem]", "right-1"],
};
function ArrowThumb({ look, icon }: { look: ArrowStyle; icon: NavIcon }) {
  const [prev, next] = ARROW_SIDES[look] ?? ["left-1 top-1/2 -translate-y-1/2", "right-1 top-1/2 -translate-y-1/2"];
  return (
    <Photo>
      <span className={`absolute ${ARROW_LOOK[look]} ${prev}`}>
        <Glyph icon={icon} flip />
      </span>
      <span className={`absolute ${ARROW_LOOK[look]} ${next}`}>
        <Glyph icon={icon} />
      </span>
    </Photo>
  );
}

function DotThumb({ look }: { look: DotStyle }) {
  const marks =
    look === "fraction" ? (
      <span className="rounded-full bg-black/45 px-1.5 text-[8px] font-semibold leading-3 text-white">1 / 3</span>
    ) : look === "progress" ? (
      <span className="h-[3px] w-10 overflow-hidden rounded-full bg-white/35">
        <span className="block h-full w-1/3 bg-white" />
      </span>
    ) : (
      [0, 1, 2].map((i) =>
        look === "numbers" ? (
          <span key={i} className={`rounded-full px-1 text-[7px] font-semibold leading-[10px] text-ink ${i === 0 ? "bg-white" : "bg-white/60"}`}>
            {i + 1}
          </span>
        ) : (
          <span
            key={i}
            className={`${look === "lines" ? "h-[3px] w-3 rounded-sm" : look === "pill" && i === 0 ? "h-1.5 w-4 rounded-full" : "h-1.5 w-1.5 rounded-full"} ${i === 0 ? "bg-white" : "bg-white/50"}`}
          />
        ),
      )
    );
  return (
    <Photo>
      <span className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-[3px]">{marks}</span>
    </Photo>
  );
}

function Tile({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-0 rounded-lg border p-1 ${active ? "border-accent ring-1 ring-accent" : "border-line/30 hover:border-accent/40"}`}
    >
      {children}
      <span className="mt-1 block truncate text-center text-xs font-medium text-body">{label}</span>
    </button>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-body"
    >
      {label}
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left] ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: ReactNode; title?: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg border px-1 text-xs font-semibold ${
            value === o.value ? "border-accent bg-accent/10 text-accent" : "border-line/30 text-sub hover:border-accent/40"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-sub">{label}</p>
      {children}
    </div>
  );
}

const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function SliderNavPanel({
  p,
  set,
  t,
  inputProps,
}: {
  p: Record<string, string>;
  set: (patch: Record<string, string>) => void;
  t: (k: Key) => string;
  // FieldInput's own color/length controls, reused for the "More settings" knobs.
  inputProps: Omit<FieldInputProps, "field" | "value" | "onChange">;
}) {
  const arrowsOn = p.navStyle !== "none";
  const navStyle = pick(SLIDER_ARROW_STYLES, p.navStyle, "arrows");
  const navIcon = pick(SLIDER_NAV_ICONS, p.navIcon, "chevron");
  const dotsOn = p.dotsStyle !== "none";
  const dotsStyle = pick(SLIDER_DOT_STYLES, p.dotsStyle, "dots");
  const autoplayOn = Number(p.autoplay) > 0;
  const field = (key: string, labelKey: Key, kind: "color" | "length") => (
    <Labeled label={t(labelKey)}>
      {FieldInput({ ...inputProps, field: { key, labelKey, kind }, value: p[key] ?? "", onChange: (v) => set({ [key]: v }) })}
    </Labeled>
  );
  const placement = (key: "navPlacement" | "paginationPlacement", labelKey: Key) => (
    <Labeled label={t(labelKey)}>
      <Segmented
        value={p[key] === "outside" ? "outside" : "inside"}
        onChange={(v) => set({ [key]: v })}
        options={[
          { value: "inside", label: t("designer-slider-inside") },
          { value: "outside", label: t("designer-slider-outside") },
        ]}
      />
    </Labeled>
  );
  const more = (children: ReactNode) => (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-accent">{t("designer-slider-more")}</summary>
      <div className="space-y-2 pt-1.5">{children}</div>
    </details>
  );
  const group = "space-y-2 border-t border-line/20 pt-2";
  return (
    <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{t("designer-slider-navigation")}</p>

      <div className="space-y-2">
        <Switch label={t("designer-f-slider-nav")} on={arrowsOn} onChange={(on) => set({ navStyle: on ? "arrows" : "none" })} />
        {arrowsOn && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {SLIDER_ARROW_STYLES.map((s) => (
                <Tile key={s} active={navStyle === s} label={t(ARROW_LABEL[s])} onClick={() => set({ navStyle: s })}>
                  <ArrowThumb look={s} icon={navIcon} />
                </Tile>
              ))}
            </div>
            <Labeled label={t("designer-f-slider-navicon")}>
              <Segmented
                value={navIcon}
                onChange={(v) => set({ navIcon: v })}
                options={SLIDER_NAV_ICONS.map((i) => ({
                  value: i,
                  title: i,
                  label: (
                    <span className="h-3.5 w-3.5">
                      <Glyph icon={i} />
                    </span>
                  ),
                }))}
              />
            </Labeled>
            <Switch label={t("designer-slider-hide-mobile")} on={p.navHideMobile === "true"} onChange={(on) => set({ navHideMobile: on ? "true" : "false" })} />
            {more(
              <>
                {field("navColor", "designer-f-slider-navcolor", "color")}
                {field("navSize", "designer-f-slider-navsize", "length")}
                {field("navOffset", "designer-f-slider-navoffset", "length")}
                {placement("navPlacement", "designer-f-slider-navplacement")}
              </>,
            )}
          </>
        )}
      </div>

      <div className={group}>
        <Switch label={t("designer-f-slider-pagination")} on={dotsOn} onChange={(on) => set({ dotsStyle: on ? "dots" : "none" })} />
        {dotsOn && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {SLIDER_DOT_STYLES.map((s) => (
                <Tile key={s} active={dotsStyle === s} label={t(DOT_LABEL[s])} onClick={() => set({ dotsStyle: s })}>
                  <DotThumb look={s} />
                </Tile>
              ))}
            </div>
            <Labeled label={t("designer-f-slider-paginationposition")}>
              <Segmented
                value={pick(["start", "center", "end"], p.paginationPosition, "center")}
                onChange={(v) => set({ paginationPosition: v })}
                options={[
                  { value: "start", title: t("designer-align-left"), label: <AlignLeft className="h-3.5 w-3.5" /> },
                  { value: "center", title: t("designer-align-center"), label: <AlignCenter className="h-3.5 w-3.5" /> },
                  { value: "end", title: t("designer-align-right"), label: <AlignRight className="h-3.5 w-3.5" /> },
                ]}
              />
            </Labeled>
            {more(
              <>
                {field("paginationColor", "designer-f-slider-paginationcolor", "color")}
                {field("paginationBulletSize", "designer-f-slider-paginationbulletsize", "length")}
                {field("paginationBulletGap", "designer-f-slider-paginationbulletgap", "length")}
                {field("paginationOffset", "designer-f-slider-paginationoffset", "length")}
                {placement("paginationPlacement", "designer-f-slider-paginationplacement")}
              </>,
            )}
          </>
        )}
      </div>

      <div className={group}>
        <Switch label={t("designer-f-slider-autoplay")} on={autoplayOn} onChange={(on) => set({ autoplay: on ? "5" : "0" })} />
        {autoplayOn && (
          <>
            <Labeled label={t("designer-slider-autoplay-seconds")}>
              <DragNumber value={p.autoplay} min={1} max={20} step={0.5} unit="s" onCommit={(v) => set({ autoplay: v })} />
            </Labeled>
            <Switch label={t("designer-slider-pause-hover")} on={p.pauseOnHover !== "false"} onChange={(on) => set({ pauseOnHover: on ? "true" : "false" })} />
            <p className="text-xs italic text-sub/70">{t("designer-slider-autoplay-hint")}</p>
          </>
        )}
      </div>

      <div className={group}>
        <Switch label={t("designer-slider-loop")} on={p.loop !== "false"} onChange={(on) => set({ loop: on ? "true" : "false" })} />
        <Labeled label={t("designer-slider-speed")}>
          <Segmented
            value={pick(["slow", "normal", "fast"], p.speed, "normal")}
            onChange={(v) => set({ speed: v })}
            options={(["slow", "normal", "fast"] as const).map((v) => ({ value: v, label: t(SPEED_LABEL[v]) }))}
          />
        </Labeled>
      </div>
    </div>
  );
}
