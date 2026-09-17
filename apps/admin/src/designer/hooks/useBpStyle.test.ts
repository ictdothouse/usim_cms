import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_bpStyleFns } from "./useBpStyle";

test("bpKey prefixes with the current breakpoint, desktop included", () => {
  assert.equal(__testOnly_bpStyleFns("desktop").bpKey("paddingTop"), "desktop:paddingTop");
  assert.equal(__testOnly_bpStyleFns("tablet").bpKey("paddingTop"), "tablet:paddingTop");
  assert.equal(__testOnly_bpStyleFns("mobile").bpKey("paddingTop"), "mobile:paddingTop");
});

test("bpGetValue only consults overrides off-desktop, falls back to base otherwise", () => {
  const desktop = __testOnly_bpStyleFns("desktop");
  const tablet = __testOnly_bpStyleFns("tablet");
  assert.equal(desktop.bpGetValue("1rem", { "tablet:gap": "2rem" }, "gap"), "1rem");
  assert.equal(tablet.bpGetValue("1rem", { "tablet:gap": "2rem" }, "gap"), "2rem");
  assert.equal(tablet.bpGetValue("1rem", undefined, "gap"), "1rem");
  assert.equal(tablet.bpGetValue(undefined, undefined, "gap"), "");
});

test("bpKeysOverridden/toggleBpKeys: enabling seeds an empty override, disabling removes it", () => {
  const { bpKeysOverridden, toggleBpKeys } = __testOnly_bpStyleFns("mobile");
  assert.equal(bpKeysOverridden(undefined, ["paddingTop", "paddingBottom"]), false);
  const enabled = toggleBpKeys(undefined, ["paddingTop", "paddingBottom"]);
  assert.deepEqual(enabled, { "mobile:paddingTop": "", "mobile:paddingBottom": "" });
  assert.equal(bpKeysOverridden(enabled, ["paddingTop"]), true);
  const disabled = toggleBpKeys(enabled, ["paddingTop", "paddingBottom"]);
  assert.deepEqual(disabled, {});
});

test("sideValue prefers the per-side key, falls back to the shared axis key, both bp-aware", () => {
  const tablet = __testOnly_bpStyleFns("tablet");
  const props = { paddingTop: "", paddingY: "1rem" };
  assert.equal(tablet.sideValue(props, undefined, "paddingTop", "paddingY"), "1rem");
  assert.equal(tablet.sideValue(props, { "tablet:paddingTop": "3rem" }, "paddingTop", "paddingY"), "3rem");
});
