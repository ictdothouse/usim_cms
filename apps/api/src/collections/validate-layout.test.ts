import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLayout } from "./validate-layout.js";

test("accepts a menu element's props", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ type: "menu", props: { menuId: "abc-123", layout: "horizontal", dropdownTrigger: "hover", megaMenuWidth: "contained" } }] }] }],
      },
    },
  ];
  assert.equal(validateLayout(layout), null);
});

test("rejects an invalid menu dropdownTrigger", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [{ columns: [{ elements: [{ type: "menu", props: { dropdownTrigger: "double-click" } }] }] }],
      },
    },
  ];
  assert.match(validateLayout(layout) ?? "", /unrecognized/);
});
