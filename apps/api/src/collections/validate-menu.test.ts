// This repo uses Node's built-in test runner (see apps/api's "test" script:
// `tsx --test src/**/*.test.ts`, and the existing proxy-sync.test.ts) — not
// vitest/jest. `describe`/`it` come from "node:test", assertions from
// "node:assert/strict" (no expect()/toBeNull()/toMatch() — use assert.equal/
// assert.match instead).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateMenuItems } from "./validate-menu.js";

describe("validateMenuItems", () => {
  it("accepts an empty menu", () => {
    assert.equal(validateMenuItems([]), null);
  });

  it("accepts a simple custom-link item", () => {
    const items = [{ id: "a", label: "Home", linkType: "custom", url: "/", target: "_self" }];
    assert.equal(validateMenuItems(items), null);
  });

  it("rejects a javascript: URL", () => {
    const items = [{ id: "a", label: "Bad", linkType: "custom", url: "javascript:alert(1)" }];
    assert.match(validateMenuItems(items) ?? "", /unsafe/i);
  });

  it("accepts one level of nested children", () => {
    const items = [
      {
        id: "a",
        label: "About",
        linkType: "custom",
        url: "/about",
        children: [{ id: "b", label: "History", linkType: "custom", url: "/about/history" }],
      },
    ];
    assert.equal(validateMenuItems(items), null);
  });

  it("accepts a mega menu with columns and icon/image items", () => {
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: {
          columns: [
            {
              heading: "Faculties",
              items: [
                { label: "Science", linkType: "custom", url: "/science", icon: "graduation-cap", image: "" },
              ],
            },
          ],
        },
      },
    ];
    assert.equal(validateMenuItems(items), null);
  });

  it("rejects a mega menu image with an unsafe URL", () => {
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: { columns: [{ items: [{ label: "X", linkType: "custom", url: "/x", image: "javascript:alert(1)" }] }] },
      },
    ];
    assert.match(validateMenuItems(items) ?? "", /unsafe/i);
  });

  it("rejects nesting deeper than 3 levels", () => {
    const items = [{ id: "a", label: "L1", linkType: "custom", url: "/", children: [
      { id: "b", label: "L2", linkType: "custom", url: "/", children: [
        { id: "c", label: "L3", linkType: "custom", url: "/", children: [
          { id: "d", label: "L4", linkType: "custom", url: "/" },
        ] },
      ] },
    ] }];
    assert.match(validateMenuItems(items) ?? "", /depth/i);
  });

  it("rejects an item missing a label", () => {
    assert.match(validateMenuItems([{ id: "a", linkType: "custom", url: "/" }]) ?? "", /label/);
  });

  it("rejects linkType page/post/category with no refId", () => {
    assert.match(validateMenuItems([{ id: "a", label: "X", linkType: "page" }]) ?? "", /refId/);
  });

  it("rejects an item with both children and megaMenu", () => {
    const items = [
      {
        id: "a",
        label: "Both",
        linkType: "custom",
        url: "/",
        children: [{ id: "b", label: "Child", linkType: "custom", url: "/" }],
        megaMenu: { columns: [] },
      },
    ];
    assert.match(validateMenuItems(items) ?? "", /both/i);
  });

  it("rejects a mega menu with more than 8 columns", () => {
    const columns = Array.from({ length: 9 }, (_, i) => ({
      items: [{ label: `Item ${i}`, linkType: "custom", url: "/" }],
    }));
    const items = [
      {
        id: "a",
        label: "TooMany",
        linkType: "custom",
        url: "/",
        megaMenu: { columns },
      },
    ];
    assert.match(validateMenuItems(items) ?? "", /too many columns/i);
  });

  it("rejects a mega menu column with more than 20 items", () => {
    const items_array = Array.from({ length: 21 }, (_, i) => ({
      label: `Item ${i}`,
      linkType: "custom",
      url: `/item${i}`,
    }));
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: { columns: [{ items: items_array }] },
      },
    ];
    assert.match(validateMenuItems(items) ?? "", /too many items/i);
  });

  it("rejects a mega menu column item with children or megaMenu", () => {
    const items = [
      {
        id: "a",
        label: "Academic",
        linkType: "custom",
        url: "/academic",
        megaMenu: {
          columns: [
            {
              items: [
                {
                  label: "Bad",
                  linkType: "custom",
                  url: "/bad",
                  children: [{ label: "Nested", linkType: "custom", url: "/" }],
                },
              ],
            },
          ],
        },
      },
    ];
    assert.match(validateMenuItems(items) ?? "", /cannot have children or megaMenu/i);
  });
});
