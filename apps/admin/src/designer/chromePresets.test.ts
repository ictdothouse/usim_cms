// Every header/footer preset must save: each one's layout goes through the
// same validator apps/api runs on write, with and without a site logo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLayout } from "@ucms/element-schema";
import { CHROME_PRESETS } from "./chromePresets";

const t = (k: string) => (k === "chrome-sample-copyright" ? "© {year} Org" : k);

for (const preset of CHROME_PRESETS) {
  test(`${preset.kind} preset "${preset.id}" passes element-schema`, () => {
    for (const logoUrl of ["", "https://example.com/logo.png"]) {
      assert.equal(validateLayout(preset.build({ t, logoUrl, menuId: "m1" })), null);
    }
  });
}

// The floating pill sat in its own white band above the page until it set
// settings.transparent; only headers have that setting.
test("Floating and Transparent are the header presets that float over the page", () => {
  assert.deepEqual(
    CHROME_PRESETS.filter((p) => p.transparent).map((p) => `${p.kind}:${p.id}`),
    ["header:floating", "header:transparent"],
  );
});
