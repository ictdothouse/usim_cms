import { test } from "node:test";
import assert from "node:assert/strict";
import { customHtmlRemovals } from "@ucms/element-style";
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

// The Designer's hint predicts removals with a tag scan over the shared
// allowlist; this pins it to what the real sanitizer does.
test("customHtmlRemovals (the Designer's hint) agrees with the real sanitizer", () => {
  const cases: [string, string[]][] = [
    ['<p class="x" style="color:red" onclick="go()">Hi</p><script>if (a<b) go()</script>', ["style", "onclick", "<script>"]],
    ['<iframe src="https://www.youtube.com/embed/x"></iframe><a href="javascript:alert(1)">x</a>', ["<iframe>", "href"]],
    ['<div data-id="1"><img src="//cdn.example/a.png" srcset="a.png 2x" alt=""></div>', ["data-id", "src", "srcset"]],
    ['<a href="https://example.com" target="_blank">ok</a><img src="/a.png" alt=""><table><tr><td>1</td></tr></table>', []],
  ];
  for (const [raw, expected] of cases) {
    assert.deepEqual(customHtmlRemovals(raw), expected, raw);
    const clean = sanitizeCustomHtml(raw);
    // Nothing it lets through gets cut, nothing it flags survives.
    assert.deepEqual(customHtmlRemovals(clean), [], clean);
    for (const r of expected) assert.ok(!clean.includes(r.startsWith("<") ? r.slice(0, -1) : ` ${r}=`), `${r} in ${clean}`);
  }
});
