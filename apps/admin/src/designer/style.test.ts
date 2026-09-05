import { test } from "node:test";
import assert from "node:assert/strict";
import { PAD, RADIUS, LEGACY_SHADOW, gapPx, hexToRgba, shadowToCss, lengthValue, colStyle, elRadius, typoStyle, overlayColors } from "./style";

test("lengthValue resolves a preset keyword, falls back when unset, passes through a literal", () => {
  assert.equal(lengthValue("md", PAD, "0"), PAD.md);
  assert.equal(lengthValue(undefined, PAD, "1rem"), "1rem");
  assert.equal(lengthValue("42px", PAD, "0"), "42px");
});

test("gapPx converts rem to px, passes through a bare number, guards bad input", () => {
  assert.equal(gapPx("2rem"), 32);
  assert.equal(gapPx("24"), 24);
  assert.equal(gapPx(undefined), "");
  assert.equal(gapPx("not-a-number"), "");
});

test("hexToRgba expands 3-char and 6-char hex, guards a non-finite alpha to 1", () => {
  assert.equal(hexToRgba("#fff", 0.5), "rgba(255, 255, 255, 0.5)");
  assert.equal(hexToRgba("#112233", 1), "rgba(17, 34, 51, 1)");
  assert.equal(hexToRgba("#000000", NaN), "rgba(0, 0, 0, 1)");
});

test("shadowToCss resolves a legacy preset, returns undefined for 'none', builds a custom pipe shadow", () => {
  assert.equal(shadowToCss("md"), LEGACY_SHADOW.md);
  assert.equal(shadowToCss("none"), undefined);
  assert.equal(shadowToCss(undefined), undefined);
  assert.equal(shadowToCss("2|4|8|0|#000000|0.5"), "2px 4px 8px 0px rgba(0, 0, 0, 0.5)");
});

test("colStyle returns {} with no props, sets background/padding/radius when present", () => {
  assert.deepEqual(colStyle(undefined), {});
  const s = colStyle({ bg: "#fff", padding: "sm", radius: "md" });
  assert.equal(s.background, "#fff");
  assert.equal(s.padding, `${PAD.sm} ${PAD.sm} ${PAD.sm} ${PAD.sm}`);
  assert.equal(s.borderRadius, `${RADIUS.md} ${RADIUS.md} ${RADIUS.md} ${RADIUS.md}`);
});

test("elRadius falls back to RADIUS.none when unset", () => {
  assert.equal(elRadius({}), `${RADIUS.none} ${RADIUS.none} ${RADIUS.none} ${RADIUS.none}`);
});

test("typoStyle only sets keys that are actually present", () => {
  assert.deepEqual(typoStyle({}), {});
  assert.deepEqual(typoStyle({ color: "#111827", fontWeight: "700" }), { color: "#111827", fontWeight: "700" });
});

test("overlayColors picks a black-based vs white-based line color depending on background", () => {
  const onWhite = overlayColors("#ffffff");
  const onBlack = overlayColors("#000000");
  assert.match(onWhite.line, /^rgba\(0, 0, 0,/);
  assert.match(onBlack.line, /^rgba\(255, 255, 255,/);
});
