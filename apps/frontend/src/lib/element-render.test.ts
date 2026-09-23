import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fluidTextSize,
  hexToRgba,
  shadowToCss,
  renderInline,
  lengthValue,
  marginStyle,
  paddingStyle,
  elBorderShadowStyle,
  typoStyle,
  elHoverClass,
  elEntranceClass,
  elRadius,
  cls,
  headingTag,
  safeUrl,
  PAD,
  SPACE,
  RADIUS,
} from "./element-render";

test("fluidTextSize converts px to a clamp() with a floor and vw term", () => {
  assert.equal(fluidTextSize("40px"), "clamp(22px, 4vw, 40px)");
});

test("fluidTextSize converts rem to a px floor/vw but keeps the ceiling in the author's original unit", () => {
  assert.equal(fluidTextSize("2rem"), "clamp(18px, 3.2vw, 2rem)");
});

test("fluidTextSize passes through unrecognized units unchanged", () => {
  assert.equal(fluidTextSize("100%"), "100%");
  assert.equal(fluidTextSize(""), "");
});

test("hexToRgba expands 3-digit and 6-digit hex", () => {
  assert.equal(hexToRgba("#fff", 1), "rgba(255, 255, 255, 1)");
  assert.equal(hexToRgba("#ff0000", 0.5), "rgba(255, 0, 0, 0.5)");
});

test("hexToRgba defaults alpha to 1 when not finite", () => {
  assert.equal(hexToRgba("#000000", NaN), "rgba(0, 0, 0, 1)");
});

test("shadowToCss resolves legacy preset keywords", () => {
  assert.equal(shadowToCss("none"), null);
  assert.equal(shadowToCss("sm"), "0 1px 3px rgba(0,0,0,.1)");
});

test("shadowToCss parses a pipe-delimited custom shadow", () => {
  assert.equal(shadowToCss("2|4|8|0|#000000|0.5"), "2px 4px 8px 0px rgba(0, 0, 0, 0.5)");
});

test("shadowToCss returns null for empty/malformed input", () => {
  assert.equal(shadowToCss(undefined), null);
  assert.equal(shadowToCss(""), null);
  assert.equal(shadowToCss("|"), null);
});

test("renderInline escapes HTML before applying markdown", () => {
  assert.equal(renderInline("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("renderInline applies bold, italic, and link markdown", () => {
  assert.equal(renderInline("**bold** *italic*"), "<strong>bold</strong> <em>italic</em>");
  assert.equal(renderInline("[go](https://example.com)"), '<a href="https://example.com">go</a>');
});

test("renderInline falls back to # for an unsafe link URL", () => {
  assert.equal(renderInline("[x](javascript:alert)"), '<a href="#">x</a>');
});

test("lengthValue resolves a preset keyword through the given table", () => {
  assert.equal(lengthValue("md", PAD, "0"), PAD.md);
});

test("lengthValue treats a bare number as px", () => {
  assert.equal(lengthValue("20", PAD, "0"), "20px");
});

test("lengthValue passes through an explicit CSS length untouched", () => {
  assert.equal(lengthValue("2.5rem", PAD, "0"), "2.5rem");
});

test("lengthValue falls back when unset", () => {
  assert.equal(lengthValue(undefined, PAD, "0"), "0");
});

test("marginStyle returns null when no margin prop is set", () => {
  assert.equal(marginStyle({}), null);
});

test("marginStyle expands marginY/marginX shorthand to all four sides", () => {
  assert.equal(marginStyle({ marginY: "md", marginX: "sm" }), `margin:${SPACE.md} ${SPACE.sm} ${SPACE.md} ${SPACE.sm}`);
});

test("marginStyle lets a per-side override win over the shorthand", () => {
  assert.equal(marginStyle({ marginY: "md", marginTop: "lg" }), `margin:${SPACE.lg} 0 ${SPACE.md} 0`);
});

test("paddingStyle returns null when no padding prop is set", () => {
  assert.equal(paddingStyle({}), null);
});

test("paddingStyle expands uniform padding to all four sides", () => {
  assert.equal(paddingStyle({ padding: "sm" }), `padding:${PAD.sm} ${PAD.sm} ${PAD.sm} ${PAD.sm}`);
});

test("elBorderShadowStyle combines border and shadow, joined by semicolon", () => {
  assert.equal(elBorderShadowStyle({ borderWidth: "2", borderColor: "#000000", shadow: "sm" }), "border:2px solid #000000;box-shadow:0 1px 3px rgba(0,0,0,.1)");
});

test("elBorderShadowStyle returns null when neither border nor shadow is set", () => {
  assert.equal(elBorderShadowStyle({}), null);
});

test("typoStyle only emits declarations for props that are actually set", () => {
  assert.equal(typoStyle({ color: "#fff", fontWeight: "700" }), "color:#fff;font-weight:700");
});

test("typoStyle returns empty string when nothing is set", () => {
  assert.equal(typoStyle({}), "");
});

test("elHoverClass/elEntranceClass skip the 'none' sentinel", () => {
  assert.equal(elHoverClass({ hoverEffect: "none" }), undefined);
  assert.equal(elHoverClass({ hoverEffect: "lift" }), "ds-hover-lift");
  assert.equal(elEntranceClass({ entrance: "fade" }), "ds-entrance-fade");
});

test("elRadius resolves each corner independently, falling back to the shared radius", () => {
  const result = elRadius({ radius: "md", radiusTopLeft: "full" });
  assert.equal(result, `${RADIUS.full} ${RADIUS.md} ${RADIUS.md} ${RADIUS.md}`);
});

test("elRadius defaults to RADIUS.none when nothing is set", () => {
  assert.equal(elRadius({}), `${RADIUS.none} ${RADIUS.none} ${RADIUS.none} ${RADIUS.none}`);
});

test("cls joins truthy class names with a space, dropping falsy ones", () => {
  assert.equal(cls("a", undefined, "b"), "a b");
  assert.equal(cls(), "");
});

test("headingTag maps a valid level to hN, defaulting to h2", () => {
  assert.equal(headingTag("3"), "h3");
  assert.equal(headingTag("9"), "h2");
  assert.equal(headingTag(undefined), "h2");
});

test("safeUrl passes a safe URL through and drops an unsafe scheme", () => {
  assert.equal(safeUrl("https://example.com"), "https://example.com");
  assert.equal(safeUrl("javascript:alert(1)"), undefined);
  assert.equal(safeUrl(undefined), undefined);
});
