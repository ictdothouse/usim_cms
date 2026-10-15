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
} from "./index.js";

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
