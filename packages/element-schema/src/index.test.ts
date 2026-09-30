import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeUrl, isSafeCssUrl, validateElement, validateLayout, validateOverrides } from "./index.js";

test("isSafeUrl accepts http(s) and relative URLs", () => {
  assert.equal(isSafeUrl("https://example.com"), true);
  assert.equal(isSafeUrl("/about"), true);
  assert.equal(isSafeUrl("#anchor"), true);
  assert.equal(isSafeUrl(""), true);
});

test("isSafeUrl rejects javascript: and data: schemes, incl. control-char evasion", () => {
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("java\tscript:alert(1)"), false);
  assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false);
});

test("isSafeCssUrl also rejects quote/paren/brace breakout chars", () => {
  assert.equal(isSafeCssUrl("https://example.com/a.png"), true);
  assert.equal(isSafeCssUrl("https://example.com/a.png');}body{background:red"), false);
});

test("validateElement rejects unknown props keys", () => {
  const err = validateElement({ props: { notarealfield: "x" } }, "layout[0]");
  assert.match(err ?? "", /unknown field "notarealfield"/);
});

test("validateElement accepts a known enum field and rejects an invalid value", () => {
  assert.equal(validateElement({ props: { align: "center" } }, "layout[0]"), null);
  const err = validateElement({ props: { align: "diagonal" } }, "layout[0]");
  assert.match(err ?? "", /align has an unrecognized value/);
});

test("validateElement rejects a non-hex color and accepts a valid one", () => {
  assert.equal(validateElement({ props: { textColor: "#ff0000" } }, "layout[0]"), null);
  const err = validateElement({ props: { textColor: "red" } }, "layout[0]");
  assert.match(err ?? "", /textColor must be a hex color/);
});

test("validateElement rejects an unsafe URL in an attr-url key", () => {
  const err = validateElement({ props: { href: "javascript:alert(1)" } }, "layout[0]");
  assert.match(err ?? "", /href has an unsafe URL scheme/);
});

test("validateElement recurses into container children", () => {
  const ok = validateElement({ children: [{ props: { align: "center" } }] }, "layout[0]");
  assert.equal(ok, null);
  const err = validateElement({ children: [{ props: { align: "bad" } }] }, "layout[0]");
  assert.match(err ?? "", /children\[0\].*align has an unrecognized value/);
});

test("validateLayout walks section rows/columns/elements and surfaces the first error", () => {
  const layout = [
    {
      type: "section",
      props: {
        rows: [
          {
            columns: [
              { elements: [{ props: { align: "center" } }] },
              { elements: [{ props: { align: "nope" } }] },
            ],
          },
        ],
      },
    },
  ];
  const err = validateLayout(layout);
  assert.match(err ?? "", /align has an unrecognized value/);
});

test("validateLayout accepts a legacy hero block with a safe imageUrl only", () => {
  assert.equal(validateLayout([{ type: "hero", props: { imageUrl: "https://example.com/a.jpg" } }]), null);
  const err = validateLayout([{ type: "hero", props: { imageUrl: "javascript:alert(1)" } }]);
  assert.match(err ?? "", /imageUrl has an unsafe URL/);
});

test("validateOverrides strips the breakpoint prefix before validating the underlying key", () => {
  assert.equal(validateOverrides({ "0.0": { "tablet:align": "center" } }), null);
  const err = validateOverrides({ "0.0": { "tablet:align": "nope" } });
  assert.match(err ?? "", /align has an unrecognized value/);
});
