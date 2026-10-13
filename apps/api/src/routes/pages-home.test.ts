import test from "node:test";
import assert from "node:assert/strict";
import { pageHasContent } from "./pages-home.js";

test("homepage requires an element in a current Designer section", () => {
  assert.equal(pageHasContent([{ type: "section", props: { rows: [{ columns: [{ elements: [{ type: "heading" }] }] }] } }]), true);
  assert.equal(pageHasContent([{ type: "section", props: { rows: [{ columns: [{ elements: [] }] }] } }]), false);
});

test("homepage content check supports legacy rows and malformed layout", () => {
  assert.equal(pageHasContent([{ rows: [{ columns: [{ elements: [{ type: "text" }] }] }] }]), true);
  assert.equal(pageHasContent(null), false);
  assert.equal(pageHasContent([{ props: { rows: [null] } }]), false);
});
