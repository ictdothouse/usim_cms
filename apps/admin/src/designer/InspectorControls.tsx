// Shared, stateless, module-scope Inspector controls — split out of
// Inspector.tsx (2026-10-01) so the 6 InspectorXxxPanel.tsx files can import
// these directly instead of importing them back from Inspector.tsx (the
// dispatcher). That reverse-import worked (every one of these was a hoisted
// function, only ever called from inside a render/callback body, never at
// module-eval time) but left a needless circular module reference — this
// file has zero dependency on Inspector.tsx or any panel file, so the
// dependency graph is now one-directional: Inspector.tsx + panels -> here.
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Copy,
  Frame,
  Link2,
  Monitor,
  Plus,
  Smartphone,
  SquareDashedBottom,
  SquareRoundCorner,
  Tablet,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Key } from "@/i18n";
import type { Bp, Block, El, ElType, LiveSpacing, SectionProps } from "./types";
import type { DesignerCtx } from "./context";
import { BufferedInput, BpToggle, LangToggle } from "./FieldControls";
import { ELS } from "./elements";
import { getNode, insertAt, moveWithin, removeAt } from "../designerTree";
import { clone } from "@/lib/utils";

// Duplicated from Designer.tsx's own module-level `uid`/`newEl` (designer/
// files can't import back from Designer.tsx — see designer/types.ts's own
// note) — same tiny id generator + "new element with its type's defaults"
// factory, needed here only for the recursive container's "Add element"
// control.
const uid = () => Math.random().toString(36).slice(2, 10);
const newEl = (type: ElType): El => ({ id: uid(), type, props: { ...ELS[type].defaults } });
// A recursive container's own "Add element" + children list, shared by the
// top-level container panel (sel.length===4) and the nested-child panel
// below (sel.length>4, any depth) — both address the container the same
// way, by its own `path`. A real component (not a plain function call like
// ElPreview/FieldGroups) since it holds its own `addType` dropdown state.
export function ContainerChildrenPanel({ ctx, path, el }: { ctx: DesignerCtx; path: number[]; el: El }) {
  const { t, mutate, setSel, sel } = ctx;
  const [addType, setAddType] = useState<ElType>("heading");
  const children = el.children ?? [];
  const pathEq = (a: number[]) => sel !== null && sel.length === a.length && a.every((v, i) => sel[i] === v);
  return (
    <div className="space-y-2 rounded-lg border border-line/20 bg-canvas/40 p-2">
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{t("designer-container-children")}</p>
      {children.length > 0 && (
        <div className="space-y-1">
          {children.map((child, i) => {
            const childPath = [...path, i];
            return (
              <div
                key={child.id}
                className={`flex items-center gap-1 rounded px-1.5 py-1 text-sm ${pathEq(childPath) ? "bg-accent/10 text-accent" : "text-body"}`}
              >
                <button onClick={() => setSel(childPath)} className="flex-1 truncate text-left font-medium">
                  {t(ELS[child.type].labelKey)}
                </button>
                <button
                  onClick={() => mutate((bs) => moveWithin(bs, path, i, i - 1))}
                  disabled={i === 0}
                  className="disabled:opacity-30"
                  aria-label={t("designer-move-element-up")}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => mutate((bs) => moveWithin(bs, path, i, i + 1))}
                  disabled={i === children.length - 1}
                  className="disabled:opacity-30"
                  aria-label={t("designer-move-element-down")}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  onClick={() =>
                    mutate((bs) => {
                      const parent = getNode(bs, path) as El;
                      parent.children = parent.children ?? [];
                      insertAt(bs, path, clone(parent.children[i]), i + 1);
                    })
                  }
                  aria-label={t("designer-duplicate")}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={() => {
                    mutate((bs) => removeAt(bs, childPath));
                    if (pathEq(childPath)) setSel(path);
                  }}
                  className="text-red-500"
                  aria-label={t("designer-delete")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-1.5">
        <select
          value={addType}
          onChange={(ev) => setAddType(ev.target.value as ElType)}
          className="min-w-0 flex-1 rounded-lg border border-line/30 bg-white px-2 py-1 text-sm"
        >
          {(Object.keys(ELS) as ElType[]).map((ty) => (
            <option key={ty} value={ty}>
              {t(ELS[ty].labelKey)}
            </option>
          ))}
        </select>
        <button
          onClick={() => mutate((bs) => insertAt(bs, path, newEl(addType)))}
          className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-sm font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> {t("designer-add")}
        </button>
      </div>
    </div>
  );
}

// Small icon-button-group row used by the Row Layout panel (Direction/
// Justify/Align) — mirrors the existing "align" FieldInput.tsx icon-button
// pattern (text-align left/center/right/justify), just generalized to take
// an arbitrary icon-per-option map since flex direction/justify/align each
// need their own icon set. Not a general Field kind (Row isn't edited through
// the Field[]/FieldInput system at all — InspectorRowPanel.tsx's own
// setRowSide-based mutation instead of FieldInput's field/value/onChange).
export function FlexIconGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; icon: typeof ArrowRight; title: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`flex-1 rounded-lg border p-1.5 ${
            value === o.value
              ? "border-accent bg-accent/10 text-accent"
              : "border-line/30 text-sub hover:border-accent/40"
          }`}
        >
          <o.icon className="mx-auto h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

export function FourSideControl({
  labelKey,
  icon: Icon,
  linked,
  onToggleLink,
  getSide,
  setSide,
  sides = ["top", "right", "bottom", "left"],
  hasOverride,
  onToggleOverride,
  hasLangOverride,
  onToggleLangOverride,
  bp,
  t,
}: {
  labelKey: Key;
  icon: typeof Frame;
  linked: boolean;
  onToggleLink: () => void;
  getSide: (side: "top" | "right" | "bottom" | "left") => string;
  setSide: (side: "top" | "right" | "bottom" | "left", value: string) => void;
  // Defaults to all 4 (padding/radius); margin has no left/right concept
  // (block-flow spacing only), so it passes just ["top", "bottom"].
  sides?: readonly ("top" | "right" | "bottom" | "left")[];
  // Omitted entirely for a node with no `bp` bag at all (Row) — the toggle
  // then simply never renders, same as being on desktop. While a non-base
  // language is active, call sites repurpose this pair as the NESTED
  // "also stack by breakpoint" toggle (only meaningful once
  // `hasLangOverride` is on) rather than the ordinary bp override.
  hasOverride?: boolean;
  onToggleOverride?: () => void;
  // Per-language "different for this language" toggle — only ever passed by
  // call sites while a non-base language pill is active. Renders regardless
  // of `bp` tier (a language override is a real choice on its own).
  hasLangOverride?: boolean;
  onToggleLangOverride?: () => void;
  bp: Bp;
  t: (k: Key) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm font-medium text-body">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
          {hasLangOverride !== undefined && onToggleLangOverride && (
            <LangToggle active={hasLangOverride} onToggle={onToggleLangOverride} t={t} />
          )}
          {hasOverride !== undefined && onToggleOverride && (
            <BpToggle active={hasOverride} onToggle={onToggleOverride} bp={bp} t={t} />
          )}
        </span>
        <button
          type="button"
          onClick={onToggleLink}
          title={t("designer-f-link-sides")}
          className={`rounded p-1 ${linked ? "text-accent" : "text-sub hover:text-body"}`}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {linked ? (
        <BufferedInput
          className="w-full rounded-lg border border-line/30 bg-white px-2 py-1.5 text-sm"
          value={getSide(sides[0])}
          onCommit={(v) => sides.forEach((s) => setSide(s, withPx(v)))}
        />
      ) : (
        <div className={`grid gap-1 ${sides.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
          {sides.map((s) => (
            <BufferedInput
              key={s}
              className="w-full rounded-lg border border-line/30 bg-white px-1 py-1.5 text-center text-sm"
              value={getSide(s)}
              placeholder={s[0].toUpperCase()}
              title={s}
              onCommit={(v) => setSide(s, withPx(v))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

// Padding can't be negative in CSS (one negative side voids the whole
// shorthand and every side drops), so a typed "-10" commits as 0. Margin keeps
// its sign: a negative margin is how boxes are made to overlap.
export const nonNegative = (v: string) => (v.trim().startsWith("-") ? "0" : v);
// A bare number typed into a side input ("10") means px — stored with its unit
// so the Inspector shows what renders, and so no renderer that forgets
// lengthValue() can emit it as invalid unitless CSS.
export const withPx = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v);

// One ring's worth of wiring for BoxModel — same shape FourSideControl's own
// props already used (getSide/setSide/linked/hasOverride/hasLangOverride),
// just without the icon/labelKey-render bits BoxModel itself now owns so one
// ring config object can be built inline at each call site.
interface RingConfig {
  labelKey: Key;
  linked: boolean;
  onToggleLink: () => void;
  getSide: (side: Side) => string;
  setSide: (side: Side, v: string) => void;
  hasOverride?: boolean;
  onToggleOverride?: () => void;
  hasLangOverride?: boolean;
  onToggleLangOverride?: () => void;
}

function BoxModelRingHeader({ ring, icon: Icon, bp, t }: { ring: RingConfig; icon: typeof Frame; bp: Bp; t: (k: Key) => string }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-sub/70">
        <Icon className="h-3 w-3" /> {t(ring.labelKey)}
        {ring.hasLangOverride !== undefined && ring.onToggleLangOverride && (
          <LangToggle active={ring.hasLangOverride} onToggle={ring.onToggleLangOverride} t={t} />
        )}
        {ring.hasOverride !== undefined && ring.onToggleOverride && (
          <BpToggle active={ring.hasOverride} onToggle={ring.onToggleOverride} bp={bp} t={t} />
        )}
      </span>
      <button
        type="button"
        onClick={ring.onToggleLink}
        title={t("designer-f-link-sides")}
        className={`rounded p-0.5 ${ring.linked ? "text-accent" : "text-sub/50 hover:text-body"}`}
      >
        <Link2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// Radius rides the same Side keys in CSS shorthand order (style.ts's
// RADIUS_CORNER_KEYS: top=top-left ... left=bottom-left); the glyph draws
// which corner each input sets.
const CORNERS: Record<Side, { title: string; glyph: string }> = {
  top: { title: "top-left", glyph: "rounded-tl-[3px] border-l-2 border-t-2" },
  right: { title: "top-right", glyph: "rounded-tr-[3px] border-r-2 border-t-2" },
  bottom: { title: "bottom-right", glyph: "rounded-br-[3px] border-b-2 border-r-2" },
  left: { title: "bottom-left", glyph: "rounded-bl-[3px] border-b-2 border-l-2" },
};

function BoxModelInput({ ring, side, corner, live }: { ring: RingConfig; side: Side; corner?: boolean; live?: Record<Side, number> }) {
  return (
    <BufferedInput
      className={
        corner
          ? "w-full min-w-0 rounded-md border border-line/30 bg-white px-1 py-0.5 text-center text-xs text-ink"
          : "w-10 rounded-md border border-transparent bg-white/70 px-0.5 py-0.5 text-center text-xs text-ink hover:border-line/40 focus:bg-white"
      }
      value={ring.getSide(side)}
      // Unset side: show what Live Edit actually renders (a section's
      // default padding, an element's CSS default), not a misleading "0".
      placeholder={live ? `${live[side]}px` : "0"}
      title={corner ? CORNERS[side].title : side}
      onCommit={(raw) => {
        const v = withPx(raw);
        if (ring.linked) SIDES.forEach((s) => ring.setSide(s, v));
        else ring.setSide(side, v);
      }}
    />
  );
}

// Chrome-DevTools-style nested box-model diagram: a dashed Margin ring around
// a solid Padding ring around a Content box — replaces what used to be 2-3
// separate FourSideControl rows with one spatial diagram, so which number
// affects which side of the element reads visually. Side columns are exactly
// one input wide and rows size to the input (index.css gives Inspector inputs
// a 2.25rem+ min-height): fixed rows smaller than that, plus radius handles
// floating on the content box's corners, overlapped each other in the 18rem
// panel. Radius gets its own row of corner inputs under the diagram instead.
export function BoxModel({
  padding,
  margin,
  radius,
  live,
  bp,
  t,
}: {
  padding: RingConfig;
  margin: RingConfig;
  radius?: RingConfig;
  // Live Edit's measured px for this node (DesignerCtx.liveSpacing).
  live?: LiveSpacing | null;
  bp: Bp;
  t: (k: Key) => string;
}) {
  const livePad = live?.padding;
  const liveMargin = live?.margin;
  const pad: RingConfig = { ...padding, setSide: (s, v) => padding.setSide(s, nonNegative(v)) };
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50/50 p-1">
        <BoxModelRingHeader ring={margin} icon={Frame} bp={bp} t={t} />
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center justify-items-center gap-0.5">
          <div />
          <BoxModelInput ring={margin} side="top" live={liveMargin} />
          <div />
          <BoxModelInput ring={margin} side="left" live={liveMargin} />
          <div className="w-full rounded-lg border border-sky-300/70 bg-sky-50/70 p-1">
            <BoxModelRingHeader ring={pad} icon={SquareDashedBottom} bp={bp} t={t} />
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center justify-items-center gap-0.5">
              <div />
              <BoxModelInput ring={pad} side="top" live={livePad} />
              <div />
              <BoxModelInput ring={pad} side="left" live={livePad} />
              <div className="flex h-8 w-full items-center justify-center overflow-hidden rounded-md border border-line/30 bg-white text-[9px] font-medium text-sub/60">
                {t("designer-content")}
              </div>
              <BoxModelInput ring={pad} side="right" live={livePad} />
              <div />
              <BoxModelInput ring={pad} side="bottom" live={livePad} />
              <div />
            </div>
          </div>
          <BoxModelInput ring={margin} side="right" live={liveMargin} />
          <div />
          <BoxModelInput ring={margin} side="bottom" live={liveMargin} />
          <div />
        </div>
      </div>
      {radius && (
        <div className="rounded-xl border border-line/30 p-1">
          <BoxModelRingHeader ring={radius} icon={SquareRoundCorner} bp={bp} t={t} />
          <div className="grid grid-cols-4 gap-1">
            {SIDES.map((side) => (
              <label key={side} className="flex min-w-0 items-center gap-1">
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 border-sub/50 ${CORNERS[side].glyph}`} />
                <BoxModelInput ring={radius} side={side} corner />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type VisKey = "hideDesktop" | "hideTablet" | "hideMobile";
const VIS_ITEMS: { key: VisKey; icon: typeof Monitor }[] = [
  { key: "hideDesktop", icon: Monitor },
  { key: "hideTablet", icon: Tablet },
  { key: "hideMobile", icon: Smartphone },
];
// Shared Section/Row/Column/Element visibility control — a real per-
// breakpoint hide, unlike the `bp` style-override bag above (admin-preview
// only): SectionBlock.astro renders these as actual @media display:none
// rules on the published site. "Active" (highlighted) means hidden on that
// screen, not shown — same on/off semantics as any other toggle button in
// this file, just inverted from "visible".
export function VisibilityToggle({ get, set, t }: { get: (k: VisKey) => boolean; set: (k: VisKey, v: boolean) => void; t: (k: Key) => string }) {
  return (
    <label className="block text-sm font-medium text-body">
      {t("designer-visibility")}
      <div className="mt-1 flex gap-1">
        {VIS_ITEMS.map(({ key, icon: Icon }) => {
          const hidden = get(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => set(key, !hidden)}
              title={t(hidden ? "designer-vis-hidden" : "designer-vis-visible")}
              className={`flex-1 rounded-lg border p-1.5 ${
                hidden ? "border-red-300 bg-red-50 text-red-500" : "border-line/30 text-sub hover:border-accent/40"
              }`}
            >
              <Icon className="mx-auto h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </label>
  );
}

export function section(bs: Block[], b: number) {
  return bs[b].props as unknown as SectionProps;
}
