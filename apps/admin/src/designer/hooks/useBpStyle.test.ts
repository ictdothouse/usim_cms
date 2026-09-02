import { test } from "node:test";
import assert from "node:assert/strict";
import { __testOnly_bpFns } from "./useBpStyle";

test("bpGetValue returns the desktop base value when bp is desktop", () => {
  const { bpGetValue } = __testOnly_bpFns("desktop");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "1rem");
});

test("bpGetValue returns the override for the current non-desktop bp when present", () => {
  const { bpGetValue } = __testOnly_bpFns("tablet");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "2rem");
});

test("bpGetValue falls back to the base value when no override exists at the current bp", () => {
  const { bpGetValue } = __testOnly_bpFns("mobile");
  assert.equal(bpGetValue("1rem", { "tablet:paddingTop": "2rem" }, "paddingTop"), "1rem");
});

test("bpKeysOverridden is true if ANY of the given keys has an override at the current bp", () => {
  const { bpKeysOverridden } = __testOnly_bpFns("tablet");
  assert.equal(bpKeysOverridden({ "tablet:paddingTop": "2rem" }, ["paddingTop", "paddingRight"]), true);
  assert.equal(bpKeysOverridden({ "tablet:paddingTop": "2rem" }, ["paddingRight", "paddingBottom"]), false);
});

test("toggleBpKeys seeds every key at empty string when enabling, removes all when disabling", () => {
  const { toggleBpKeys } = __testOnly_bpFns("tablet");
  const enabled = toggleBpKeys(undefined, ["paddingTop", "paddingRight"]);
  assert.deepEqual(enabled, { "tablet:paddingTop": "", "tablet:paddingRight": "" });
  const disabled = toggleBpKeys(enabled, ["paddingTop", "paddingRight"]);
  assert.deepEqual(disabled, {});
});

test("hiddenAtBp reads the matching hideDesktop/hideTablet/hideMobile flag for the current bp", () => {
  const { hiddenAtBp } = __testOnly_bpFns("mobile");
  assert.equal(hiddenAtBp({ hideMobile: "true" }), true);
  assert.equal(hiddenAtBp({ hideDesktop: "true" }), false);
  assert.equal(hiddenAtBp(undefined), false);
});
