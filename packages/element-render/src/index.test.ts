import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFreePositionStyle,
  toCssText,
  typoStyle,
  elBorderShadowStyle,
  bestTextColor,
  zIndexValue,
  imgAlignStyle,
  elHoverClass,
  elEntranceClass,
  elEffectBpStyle,
  elVariantBpStyle,
  SOCIAL_ICONS,
} from "./index.js";

// A row hand-added later must still pass element-schema's icon-slug check and render as one path.
test("SOCIAL_ICONS rows have an icon slug, a brand hex and plain path data", () => {
  for (const [slug, icon] of Object.entries(SOCIAL_ICONS)) {
    assert.match(slug, /^[a-z0-9-]+$/);
    assert.match(icon.hex, /^[0-9A-F]{6}$/);
    assert.match(icon.path, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, slug);
  }
});

test("imgAlignStyle always sets the full margin shorthand, so a breakpoint can undo another's", () => {
  assert.deepEqual(imgAlignStyle("center"), { margin: "0 auto" });
  assert.deepEqual(imgAlignStyle("right"), { margin: "0 0 0 auto" });
  assert.deepEqual(imgAlignStyle("left"), { margin: "0" });
  assert.deepEqual(imgAlignStyle(undefined), { margin: "0" });
});

test("zIndexValue clamps to 0-10 and treats blank/non-numeric as unset", () => {
  assert.equal(zIndexValue(""), undefined);
  assert.equal(zIndexValue("abc"), undefined);
  assert.equal(zIndexValue("3"), 3);
  assert.equal(zIndexValue("-2"), 0);
  assert.equal(zIndexValue("99"), 10);
});

test("computeFreePositionStyle defaults x/y to 50% and omits zIndex when unset", () => {
  const s = computeFreePositionStyle({});
  assert.equal(s.position, "absolute");
  assert.equal(s.top, "50%");
  assert.equal(s.left, "50%");
  assert.equal(s.width, undefined);
  assert.equal(s.zIndex, undefined);
});

test("computeFreePositionStyle carries through explicit x/y/width/height/zIndex", () => {
  const s = computeFreePositionStyle({ x: "12", y: "88", posWidth: "200px", posHeight: "80px", zIndex: "3" });
  assert.equal(s.top, "88%");
  assert.equal(s.left, "12%");
  assert.equal(s.width, "200px");
  assert.equal(s.height, "80px");
  assert.equal(s.zIndex, "3");
});

test("computeFreePositionStyle allows an out-of-range x/y through unchanged — cropping is the slide's own overflow:hidden, not a squish/clamp here", () => {
  const s = computeFreePositionStyle({ x: "-23.6", y: "120", posWidth: "277px", posHeight: "67px" });
  assert.equal(s.left, "-23.6%");
  assert.equal(s.top, "120%");
  assert.equal(s.maxWidth, undefined);
  assert.equal(s.maxHeight, undefined);
});

test("computeFreePositionStyle treats zIndex 0 as unset", () => {
  const s = computeFreePositionStyle({ zIndex: "0" });
  assert.equal(s.zIndex, undefined);
});

test("computeFreePositionStyle emits rotate only for a real non-zero number", () => {
  assert.equal(computeFreePositionStyle({ rotate: "-15" }).rotate, "-15deg");
  assert.equal(computeFreePositionStyle({ rotate: "0" }).rotate, undefined);
  assert.equal(computeFreePositionStyle({ rotate: "1;color:red" }).rotate, undefined);
});

test("toCssText kebab-cases keys and joins declarations", () => {
  assert.equal(toCssText({ top: "50%", zIndex: "3" }), "top:50%;z-index:3");
});

test("toCssText quotes an unquoted fontFamily value", () => {
  assert.equal(toCssText({ fontFamily: "Poppins" }), "font-family:'Poppins'");
});

test("toCssText leaves an already-quoted fontFamily value alone", () => {
  assert.equal(toCssText({ fontFamily: "'Poppins'" }), "font-family:'Poppins'");
});

test("typoStyle appends px to letterSpacing/wordSpacing/fontSize", () => {
  const s = typoStyle({ fontSize: "16", letterSpacing: "0.5", wordSpacing: "2" });
  assert.equal(s.fontSize, "16px");
  assert.equal(s.letterSpacing, "0.5px");
  assert.equal(s.wordSpacing, "2px");
});

test("elBorderShadowStyle omits unset keys entirely", () => {
  assert.deepEqual(elBorderShadowStyle({}), {});
});

test("bestTextColor picks white on a dark background, black on a light one", () => {
  assert.equal(bestTextColor("#000000"), "#ffffff");
  assert.equal(bestTextColor("#ffffff"), "#000000");
});

test("elHoverClass/elEntranceClass add the generic class when the effect is on at any breakpoint", () => {
  assert.equal(elHoverClass({ hoverEffect: "none" }), undefined);
  assert.equal(elHoverClass({ hoverEffect: "lift" }), "ds-hover ds-hover-lift");
  // Desktop off, mobile on: the element still needs the generic class for its mobile rule to act on.
  assert.equal(elHoverClass({}, { "mobile:hoverEffect": "glow" }), "ds-hover");
  assert.equal(elHoverClass({}, { "mobile:hoverEffect": "none", "tablet:marginTop": "4" }), undefined);
  assert.equal(elEntranceClass({ entrance: "fade" }), "ds-entrance ds-entrance-fade");
  assert.equal(elEntranceClass({}, { "tablet:entrance": "zoom" }), "ds-entrance");
});

// What a render file's bpStyleRules does for one tier: merge the tier's keys over the base, build.
test("elEffectBpStyle turns a tier's own hover/entrance into that tier's CSS", () => {
  const base = { hoverEffect: "lift", entrance: "fade" };
  const bp = { "mobile:hoverEffect": "none", "mobile:entrance": "zoom" };
  const mobile = { ...base, hoverEffect: "none", entrance: "zoom" };
  assert.equal(toCssText(elEffectBpStyle(mobile, base, bp)), "--ds-hover-tf:none;--ds-hover-sh:none;animation-name:ds-entrance-zoom");
  // Tablet has no override of its own: it restates the desktop effect.
  assert.equal(
    toCssText(elEffectBpStyle(base, base, bp)),
    "--ds-hover-tf:translateY(-4px);--ds-hover-sh:0 8px 20px rgba(0, 0, 0, 0.12);animation-name:ds-entrance-fade",
  );
  // "" (a freshly toggled override) is off, like "none".
  assert.equal(elEffectBpStyle({ entrance: "" }, {}, { "mobile:entrance": "" }).animationName, undefined);
  assert.equal(elEffectBpStyle({ entrance: "" }, { entrance: "fade" }, { "mobile:entrance": "" }).animationName, "none");
});

test("elEffectBpStyle adds nothing for an element with no effect anywhere", () => {
  assert.deepEqual(elEffectBpStyle({ marginTop: "8" }, {}, { "mobile:marginTop": "8" }), {});
});

test("elVariantBpStyle restates a tier's variant/scale in full, only when a tier overrides one", () => {
  const bp = { "mobile:variant": "outline" };
  assert.deepEqual(elVariantBpStyle("button", { variant: "outline" }, bp), {
    background: "transparent",
    color: "inherit",
    border: "2px solid currentColor",
  });
  // Tablet has no override of its own: it restates the desktop (default primary) look.
  assert.equal(elVariantBpStyle("button", {}, bp).border, "none");
  assert.equal(
    toCssText(elVariantBpStyle("badge", { variant: "filled", scale: "lg" }, { "tablet:scale": "lg", "tablet:variant": "filled" })),
    "background:var(--color-primary, #0f62fe);color:var(--color-primary-content, #fff);border:none;padding:0.2em 0.9em;font-size:0.9rem",
  );
  assert.deepEqual(elVariantBpStyle("badge", { scale: "sm" }, { "mobile:marginTop": "4" }), {});
  assert.deepEqual(elVariantBpStyle("button", { scale: "sm" }, { "mobile:scale": "sm" }), {});
});
