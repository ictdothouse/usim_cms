import { test } from "node:test";
import assert from "node:assert/strict";
import { customHtmlRemovals } from "@ucms/element-style";
import { sanitizeCustomHtml, sanitizePostBody } from "./sanitize-custom-html.js";

// What apps/api saves for a post using the editor's alignment, colors, font
// and a bookmark card.
const savedPostBody =
  '<p style="text-align:center">c</p><p style="background-color:#fbf3db;color:#e03e3e">b</p>' +
  '<span style="font-family:&quot;Playfair Display&quot;">f</span>' +
  '<a href="https://x.test/p" style="display:flex;gap:12px;border:1px solid #e5e7eb" data-bookmark-type="post"><img src="https://x.test/i.png" style="width:96px;object-fit:cover" /></a>';

test("a post body keeps the editor's styles and the bookmark card layout on the site", () => {
  const result = sanitizePostBody(savedPostBody);
  assert.match(result, /<p style="text-align:center">/);
  assert.match(result, /<p style="background-color:#fbf3db;color:#e03e3e">/);
  assert.match(result, /font-family:&quot;Playfair Display&quot;/);
  assert.match(result, /<a href="https:\/\/x\.test\/p" style="display:flex;gap:12px;border:1px solid #e5e7eb" rel="noopener noreferrer">/);
  assert.match(result, /<img src="https:\/\/x\.test\/i\.png" style="width:96px;object-fit:cover" \/>/);
});

test("a post body still drops scripts, handlers and open-ended styles", () => {
  const result = sanitizePostBody('<p style="background:url(https://evil.example/x);position:fixed" onclick="x()">a</p><script>alert(1)</script><span style="font-family:Calibri">b</span>');
  assert.equal(result, "<p>a</p><span>b</span>");
});

test("Custom HTML still keeps no style attribute at all", () => {
  assert.equal(sanitizeCustomHtml('<p style="text-align:center">c</p>'), "<p>c</p>");
});

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
