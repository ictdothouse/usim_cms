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

test("accepts a testimonial element's repeater items", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                elements: [
                  {
                    type: "testimonial",
                    props: {
                      testimonials: JSON.stringify([
                        { avatar: "https://example.com/a.jpg", quote: "Great!", name: "Jane", role: "Alumni", meta: "2024" },
                      ]),
                      columns: "2",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  assert.equal(validateLayout(layout), null);
});

test("rejects a javascript: URL smuggled into a repeater's image field", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                elements: [
                  {
                    type: "peoplegrid",
                    props: {
                      people: JSON.stringify([{ photo: "javascript:alert(1)", name: "x" }]),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  assert.match(validateLayout(layout) ?? "", /unsafe value/);
});

test("accepts a locked section", () => {
  const layout = [
    { type: "section", props: { locked: "true", rows: [] } },
  ];
  assert.equal(validateLayout(layout), null);
});

test("rejects an invalid locked value", () => {
  const layout = [
    { type: "section", props: { locked: "yes", rows: [] } },
  ];
  assert.match(validateLayout(layout) ?? "", /unrecognized/);
});

test("rejects a repeater item with an unrecognized key", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                elements: [
                  {
                    type: "logocloud",
                    props: {
                      logos: JSON.stringify([{ image: "", href: "", alt: "", onclick: "evil()" }]),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  assert.match(validateLayout(layout) ?? "", /unsafe value/);
});
