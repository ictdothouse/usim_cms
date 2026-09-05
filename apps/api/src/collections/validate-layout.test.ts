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

test("accepts a slider with the current rows-based slide shape", () => {
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
                    type: "slider",
                    props: {
                      height: "32rem",
                      slides: JSON.stringify([
                        {
                          imageUrl: "https://example.com/a.jpg",
                          bgSize: "cover",
                          rows: [
                            {
                              columns: [
                                {
                                  elements: [
                                    { type: "heading", props: { text: "Hi", level: "2", align: "left" } },
                                    { type: "button", props: { label: "Go", href: "/x", variant: "primary" } },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ]),
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

test("accepts a slide-nested element with free-position props and a real bp override", () => {
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
                    type: "slider",
                    props: {
                      slides: JSON.stringify([
                        {
                          imageUrl: "",
                          rows: [
                            {
                              columns: [
                                {
                                  elements: [
                                    {
                                      type: "button",
                                      props: { label: "Go", href: "/x", position: "custom", x: "40", y: "20", posWidth: "12rem", posHeight: "3rem" },
                                      bp: { "mobile:x": "10", "mobile:y": "80" },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ]),
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

test("accepts a heading with hoverEffect/entrance and rejects an unrecognized value", () => {
  const layout = [
    { type: "section", props: { rows: [{ columns: [{ elements: [{ type: "heading", props: { text: "Hi", hoverEffect: "lift", entrance: "fade" } }] }] }] } },
  ];
  assert.equal(validateLayout(layout), null);

  const bad = [
    { type: "section", props: { rows: [{ columns: [{ elements: [{ type: "heading", props: { text: "Hi", hoverEffect: "spin" } }] }] }] } },
  ];
  assert.match(validateLayout(bad) ?? "", /unrecognized/);
});

test("rejects an unrecognized slide-nested element position value", () => {
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
                    type: "slider",
                    props: {
                      slides: JSON.stringify([
                        { imageUrl: "", rows: [{ columns: [{ elements: [{ type: "button", props: { label: "Go", href: "/x", position: "floating" } }] }] }] },
                      ]),
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
  assert.match(validateLayout(layout) ?? "", /unrecognized/);
});

test("accepts a slider still in the legacy heading/subtitle/buttons shape (not yet upgraded)", () => {
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
                    type: "slider",
                    props: {
                      slides: JSON.stringify([
                        { imageUrl: "", heading: "Legacy heading", subtitle: "Legacy subtitle", buttons: [{ label: "Go", href: "/x" }] },
                      ]),
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

test("rejects a javascript: URL smuggled into a slide's nested button href", () => {
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
                    type: "slider",
                    props: {
                      slides: JSON.stringify([
                        {
                          imageUrl: "",
                          rows: [{ columns: [{ elements: [{ type: "button", props: { label: "Go", href: "javascript:alert(1)" } }] }] }],
                        },
                      ]),
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
  assert.match(validateLayout(layout) ?? "", /unsafe URL/);
});

test("rejects an unrecognized slide bgSize value", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              {
                elements: [
                  { type: "slider", props: { slides: JSON.stringify([{ imageUrl: "", bgSize: "zoom", rows: [] }]) } },
                ],
              },
            ],
          },
        ],
      },
    },
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
