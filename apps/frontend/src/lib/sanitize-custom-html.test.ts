import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCustomHtml } from "./sanitize-custom-html.js";

test("custom HTML keeps basic static markup and safe links", () => {
  const result = sanitizeCustomHtml('<p class="notice"><a href="https://example.com">Read</a></p>');
  assert.match(result, /<p class="notice">/);
  assert.match(result, /href="https:\/\/example\.com"/);
  assert.match(result, /rel="noopener noreferrer"/);
});

test("custom HTML removes executable tags, event handlers, and unsafe URLs", () => {
  const result = sanitizeCustomHtml('<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)"><a href="data:text/html,x">bad</a>');
  assert.doesNotMatch(result, /<script|onerror|javascript:|data:text\/html/i);
  assert.match(result, /<img/);
  assert.match(result, />bad<\/a>/);
});
