import { test } from "node:test";
import assert from "node:assert/strict";
import { customHtmlRemovals, escapeHtml, sanitizeUrl } from "./index.js";

test("escapeHtml escapes all 5 HTML-special chars", () => {
  assert.equal(escapeHtml(`<script>alert("x") & 'y'</script>`), "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;");
});

test("escapeHtml leaves plain text unchanged", () => {
  assert.equal(escapeHtml("hello world 123"), "hello world 123");
});

test("sanitizeUrl accepts http(s) and schemeless/relative URLs", () => {
  assert.equal(sanitizeUrl("https://example.com"), "https://example.com");
  assert.equal(sanitizeUrl("http://example.com"), "http://example.com");
  assert.equal(sanitizeUrl("/about"), "/about");
  assert.equal(sanitizeUrl("#anchor"), "#anchor");
});

test("sanitizeUrl rejects javascript:/data: schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), null);
});

test("sanitizeUrl strips control/space chars before the scheme check (evasion)", () => {
  assert.equal(sanitizeUrl("java\tscript:alert(1)"), null);
  assert.equal(sanitizeUrl("  https://example.com  "), "https://example.com");
});

test("sanitizeUrl returns null for an empty or whitespace-only string", () => {
  assert.equal(sanitizeUrl(""), null);
  assert.equal(sanitizeUrl("   "), null);
});

test("customHtmlRemovals lists disallowed tags and attributes once each, in order", () => {
  assert.deepEqual(
    customHtmlRemovals('<p class="note" style="color:red" onclick="go()">Hi</p><SCRIPT>x()</SCRIPT><p style="x">again</p>'),
    ["style", "onclick", "<script>"],
  );
  assert.deepEqual(customHtmlRemovals('<iframe src="https://youtube.com/embed/x"></iframe>'), ["<iframe>"]);
});

test("customHtmlRemovals flags an href/src whose scheme the site refuses", () => {
  assert.deepEqual(customHtmlRemovals('<a href="java\tscript:alert(1)">x</a>'), ["href"]);
  assert.deepEqual(customHtmlRemovals("<img src='//evil.example/x.png'>"), ["src"]);
  assert.deepEqual(customHtmlRemovals('<a href="mailto:a@b.c">m</a><a href=/about>r</a><img src="https://x/y.png" alt="">'), []);
});

test("customHtmlRemovals reads script/style bodies and comments as text, not markup", () => {
  assert.deepEqual(customHtmlRemovals("<script>if (a<b) go()</script><style>p>b{}</style><!-- <iframe> -->"), ["<script>", "<style>"]);
});

test("customHtmlRemovals is empty for allowed markup", () => {
  assert.deepEqual(customHtmlRemovals('<table><tr><td aria-label="x">1</td></tr></table><br/>plain text'), []);
});
