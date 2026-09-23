import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFonts } from "./collectFonts";

test("collectFonts returns distinct fontFamily values used by heading/text/list elements", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                elements: [
                  { type: "heading", props: { fontFamily: "Inter" } },
                  { type: "text", props: { fontFamily: "Inter" } },
                  { type: "list", props: { fontFamily: "Roboto" } },
                  { type: "button", props: { fontFamily: "Ignored" } },
                  { type: "text", props: {} },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  assert.deepEqual(collectFonts(layout), ["Inter", "Roboto"]);
});

test("collectFonts skips non-section blocks and tolerates missing rows/columns/elements", () => {
  const layout = [
    { type: "siteChrome", props: { rows: [{ columns: [{ elements: [{ type: "heading", props: { fontFamily: "Should Skip" } }] }] }] } },
    { type: "section", props: {} },
    { type: "section" },
  ];
  assert.deepEqual(collectFonts(layout), []);
});

test("collectFonts returns an empty array for an empty layout", () => {
  assert.deepEqual(collectFonts([]), []);
});
