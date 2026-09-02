import { useState } from "react";
import type React from "react";
import { lengthValue, shadowToCss, colStyle, PAD, RADIUS, BORDER, SPACE, PADDING_SIDE_KEYS, PADDING_SIDE_FALLBACK, MARGIN_SIDE_KEYS, MARGIN_SIDE_FALLBACK, RADIUS_CORNER_KEYS } from "../style";
import { COLUMN_FIELDS, COLUMN_SPACING_KEYS } from "../fields";
import { section } from "../blockPath";
import type { Bp, Block, Col, El, Row, SectionProps } from "../types";

function bpFns(bp: Bp) {
  function bpKey(key: string) {
    return `${bp}:${key}`;
  }
  // Whether ANY of `keys` has an override at the CURRENT bp — a FourSideControl
  // covers several side keys (paddingTop/Right/Bottom/Left) at once, so its own
  // toggle icon represents the group, not one key.
  function bpKeysOverridden(bag: Record<string, string> | undefined, keys: string[]): boolean {
    return !!bag && keys.some((k) => bag[bpKey(k)] !== undefined);
  }
  // Enabling an override seeds it at "" (falls through lengthValue's own
  // default-preset resolution until the author actually types a value) rather
  // than copying the resolved desktop value — simpler, and "no override yet
  // but the icon is now active" is itself a real, distinct state worth
  // showing. Disabling removes every one of `keys`' override entries.
  function toggleBpKeys(bag: Record<string, string> | undefined, keys: string[]): Record<string, string> {
    const has = bpKeysOverridden(bag, keys);
    const next = { ...(bag ?? {}) };
    for (const k of keys) {
      if (has) delete next[bpKey(k)];
      else next[bpKey(k)] = "";
    }
    return next;
  }
  // Whether a node's own Visibility toggle hides it on the CURRENT bp preview
  // — this is real (SectionBlock.astro renders the matching @media rule on
  // the published site), so the Blocks canvas ghosting it here isn't just
  // cosmetic, it's telling the truth about what a visitor at this breakpoint
  // would see. Never actually removed from the canvas though (best practice,
  // matches Elementor/Webflow): still fully visible-enough-to-click/edit,
  // just faded + labeled, since hiding it outright would make an author
  // unable to ever reach an element hidden on the bp they're currently
  // previewing.
  function hiddenAtBp(props: { hideDesktop?: string; hideTablet?: string; hideMobile?: string } | undefined): boolean {
    if (!props) return false;
    const key = bp === "desktop" ? "hideDesktop" : bp === "tablet" ? "hideTablet" : "hideMobile";
    return props[key] === "true";
  }
  function bpGetValue(base: string | undefined, overrides: Record<string, string> | undefined, key: string) {
    if (bp !== "desktop") {
      const ov = overrides?.[bpKey(key)];
      if (ov !== undefined) return ov;
    }
    return base ?? "";
  }
  // Canvas-preview equivalents of bpGetValue — resolve the active
  // breakpoint's overrides into the same style objects colStyle()/the
  // section wrapper/element margin already compute from desktop props.
  // Resolves one side/corner of a four-side control: its own override (bp-
  // aware) if set, else the shared axis/preset field's value (also bp-aware).
  // Generic version of fourSideValue()/setFourSideValue() below — same
  // fallback-chain resolution, but for any props/bp bag (Section, Column, or
  // Element), not just SectionProps.
  function sideValue(props: Record<string, string> | undefined, bpBag: Record<string, string> | undefined, perSideKey: string, fallbackKey: string): string {
    const raw = bpGetValue(props?.[perSideKey], bpBag, perSideKey);
    return raw || bpGetValue(props?.[fallbackKey], bpBag, fallbackKey);
  }
  function fourSideValue(sp: SectionProps, perSideKey: string, fallbackKey: string): string {
    return sideValue(sp as unknown as Record<string, string>, sp.bp, perSideKey, fallbackKey);
  }
  return { bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue };
}

export function __testOnly_bpFns(bp: Bp) {
  return bpFns(bp);
}

export function useBpStyle(mutate: (fn: (next: Block[]) => void) => void) {
  // Breakpoint edit mode — admin-preview only (Framer-style Desktop/Tablet/
  // Mobile toggle). Narrows the canvas width and routes Inspector field
  // edits into each node's `bp` override bag instead of its base props.
  // apps/frontend never reads `bp` — the real site is unaffected, this is
  // purely how the page looks/edits inside this Designer session.
  const [bp, setBp] = useState<Bp>("desktop");
  // Four-side padding/radius controls (section Inspector): linked = one input
  // sets all 4 sides/corners equal; unlinked = Top/Right/Bottom/Left edited
  // independently. UI-only toggle, not persisted — doesn't change what's
  // already stored, only which input(s) are shown.
  const [linkedPadding, setLinkedPadding] = useState(true);
  const [linkedRadius, setLinkedRadius] = useState(true);
  const [linkedMargin, setLinkedMargin] = useState(true);

  const { bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue } = bpFns(bp);

  function setFourSideValue(b: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const block = bs[b];
      if (bp === "desktop") {
        (block.props as Record<string, unknown>)[perSideKey] = value;
      } else {
        const props = block.props as unknown as SectionProps;
        props.bp = { ...(props.bp ?? {}), [bpKey(perSideKey)]: value };
      }
    });
  }
  function setColSideValue(b: number, r: number, c: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c];
      if (bp === "desktop") target.props = { ...(target.props ?? {}), [perSideKey]: value };
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  function setElSideValue(b: number, r: number, c: number, e: number, perSideKey: string, value: string) {
    mutate((bs) => {
      const target = section(bs, b).rows[r].columns[c].elements[e];
      if (bp === "desktop") target.props[perSideKey] = value;
      else target.bp = { ...(target.bp ?? {}), [bpKey(perSideKey)]: value };
    });
  }
  // Canvas drag-to-resize write for a four-side control: when `linked` is on
  // (the chain-icon toggle), one dragged handle must move all sides together
  // — same rule as the Inspector's linked input, which fans the same value
  // out to every side key. `target` is already the cloned-next-state node
  // (from startSpacingDrag's `apply` callback), mutated in place.
  function writeDragSideKeys(
    target: { props?: Record<string, string>; bp?: Record<string, string> },
    keys: readonly string[],
    activeKey: string,
    px: number,
    linked: boolean,
  ) {
    const touched = linked ? keys : [activeKey];
    if (bp === "desktop") {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[k] = `${px}px`;
      target.props = { ...(target.props ?? {}), ...patch };
    } else {
      const patch: Record<string, string> = {};
      for (const k of touched) patch[bpKey(k)] = `${px}px`;
      target.bp = { ...(target.bp ?? {}), ...patch };
    }
  }
  function sectionBpStyle(sp: SectionProps): React.CSSProperties {
    const v = (key: string) => bpGetValue((sp as unknown as Record<string, string>)[key], sp.bp, key);
    const bgImage = v("bgImage");
    const border = v("border");
    const borderWidth = v("borderWidth");
    const borderColor = v("borderColor");
    const borderStyle = v("borderStyle");
    const shadow = v("shadow");
    const opacity = v("opacity");
    const side = (side: keyof typeof PADDING_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, PADDING_SIDE_KEYS[side], PADDING_SIDE_FALLBACK[side]), PAD, side === "top" || side === "bottom" ? PAD.md : "1.5rem");
    const corner = (side: keyof typeof RADIUS_CORNER_KEYS) => {
      const raw = fourSideValue(sp, RADIUS_CORNER_KEYS[side], "radius");
      return lengthValue(raw, RADIUS, RADIUS.none);
    };
    const marginSide = (side: keyof typeof MARGIN_SIDE_KEYS) =>
      lengthValue(fourSideValue(sp, MARGIN_SIDE_KEYS[side], MARGIN_SIDE_FALLBACK[side]), PAD, "0");
    return {
      background: bgImage ? `url(${bgImage}) center/cover` : v("bg") || "var(--color-bg, #ffffff)",
      color: v("textColor") || "inherit",
      padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}`,
      margin: `${marginSide("top")} ${marginSide("right")} ${marginSide("bottom")} ${marginSide("left")}`,
      // borderWidth set = the new real stroke fields win; otherwise fall
      // back to the legacy none/thin/thick preset so old pages don't move.
      ...(borderWidth
        ? { border: `${borderWidth}px ${borderStyle || "solid"} ${borderColor || "currentColor"}` }
        : border
          ? { border: BORDER[border] }
          : {}),
      boxShadow: shadowToCss(shadow),
      borderRadius: `${corner("top")} ${corner("right")} ${corner("bottom")} ${corner("left")}`,
      opacity: opacity ? Math.max(0, Math.min(100, Number(opacity))) / 100 : undefined,
    };
  }
  function bpColStyle(col: Col): React.CSSProperties {
    if (bp === "desktop" || !col.bp) return colStyle(col.props);
    const merged: Record<string, string> = { ...(col.props ?? {}) };
    for (const key of [...COLUMN_FIELDS.map((f) => f.key), ...COLUMN_SPACING_KEYS]) {
      const ov = col.bp[bpKey(key)];
      if (ov !== undefined) merged[key] = ov;
    }
    return colStyle(merged);
  }
  function bpMarginStyle(el: El): React.CSSProperties | undefined {
    const side = (s: keyof typeof MARGIN_SIDE_KEYS) => sideValue(el.props, el.bp, MARGIN_SIDE_KEYS[s], MARGIN_SIDE_FALLBACK[s]);
    const top = side("top");
    const right = side("right");
    const bottom = side("bottom");
    const left = side("left");
    if (!top && !right && !bottom && !left) return undefined;
    return {
      margin: `${lengthValue(top, SPACE, "0")} ${lengthValue(right, SPACE, "0")} ${lengthValue(bottom, SPACE, "0")} ${lengthValue(left, SPACE, "0")}`,
    };
  }
  // Universal per-element padding — every element type gets it (unlike
  // radius, which only makes visual sense on image/embed/gallery), same
  // per-side/fallback convention as Column's padding.
  function bpPaddingStyle(el: El): React.CSSProperties | undefined {
    const has = (k: string) => bpGetValue(el.props[k], el.bp, k);
    if (!has("padding") && !has("paddingTop") && !has("paddingRight") && !has("paddingBottom") && !has("paddingLeft")) {
      return undefined;
    }
    const side = (s: keyof typeof PADDING_SIDE_KEYS) => lengthValue(sideValue(el.props, el.bp, PADDING_SIDE_KEYS[s], "padding"), PAD, "0");
    return { padding: `${side("top")} ${side("right")} ${side("bottom")} ${side("left")}` };
  }
  // Row's own margin/padding — no `bp` breakpoint bag on Row (desktop-only
  // for now, unlike Section/Column/Element), so this skips bpGetValue's
  // fallback chain and reads row.marginTop/paddingTop etc directly.
  // marginTop's default replaces the old fixed space-y-* gap between rows
  // (see the rows container below) — row 0 never got a leading gap under
  // that either, so it defaults to "0" instead.
  function rowMarginStyle(row: Row, isFirst: boolean, mode: "blocks" | "live"): React.CSSProperties {
    return {
      marginTop: lengthValue(row.marginTop, SPACE, isFirst ? "0" : mode === "live" ? "2.5rem" : "1.25rem"),
      marginBottom: lengthValue(row.marginBottom, SPACE, "0"),
    };
  }
  function rowPaddingStyle(row: Row): React.CSSProperties | undefined {
    if (!row.paddingTop && !row.paddingRight && !row.paddingBottom && !row.paddingLeft) return undefined;
    const v = (x?: string) => lengthValue(x, PAD, "0");
    return { padding: `${v(row.paddingTop)} ${v(row.paddingRight)} ${v(row.paddingBottom)} ${v(row.paddingLeft)}` };
  }

  return {
    bp, setBp, bpKey, bpKeysOverridden, toggleBpKeys, hiddenAtBp, bpGetValue, sideValue, fourSideValue,
    setFourSideValue, setColSideValue, setElSideValue, writeDragSideKeys,
    sectionBpStyle, bpColStyle, bpMarginStyle, bpPaddingStyle, rowMarginStyle, rowPaddingStyle,
    linkedPadding, setLinkedPadding, linkedRadius, setLinkedRadius, linkedMargin, setLinkedMargin,
  };
}
